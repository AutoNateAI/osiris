import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import YAML from 'yaml';
import { researchUniversities } from './research-universities.js';

initializeApp();
const db = getFirestore();
const githubTokenSecret = defineSecret('GITHUB_TOKEN');

const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
  'http://100.110.2.29:3002',
  'https://intel.autonateai.com',
]);

const app = express();

const jsonCache = new Map();

function cacheKey(req) {
  return `${req.method}:${req.originalUrl}`;
}

function cache(ttlMs, handler) {
  return async (req, res) => {
    const key = cacheKey(req);
    const hit = jsonCache.get(key);
    if (hit && Date.now() - hit.time < ttlMs) {
      res.set('X-Intel-Cache', 'hit');
      res.json(hit.data);
      return;
    }
    try {
      const data = await handler(req);
      jsonCache.set(key, { time: Date.now(), data });
      res.set('X-Intel-Cache', 'miss');
      res.json(data);
    } catch (err) {
      console.error('[AutoNateAI Intel Functions]', req.path, err);
      res.status(500).json({
        error: 'Route failed',
        detail: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  };
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(input = '') {
  return input.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}

const SIK_ESTON_CENTER = { lat: 36.8767, lng: -89.5879 };
const SIK_ESTON_BASE = 'https://business.sikeston.net';
const HOPEWELL_CENTER = { lat: 37.3043, lng: -77.2872 };
const HOPEWELL_BASE = 'https://www.hpgchamber.org';

function decodeEntity(input = '') {
  return String(input)
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function gzStrip(input = '') {
  return decodeEntity(String(input).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
}

function stablePoint(seed = '') {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const angle = ((hash >>> 0) % 360) * Math.PI / 180;
  const radius = 0.004 + (((hash >>> 8) % 1000) / 1000) * 0.025;
  return { lat: SIK_ESTON_CENTER.lat + Math.sin(angle) * radius, lng: SIK_ESTON_CENTER.lng + Math.cos(angle) * radius };
}

function stableRegionalPoint(seed = '', center = SIK_ESTON_CENTER, maxRadius = 0.025) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const angle = ((hash >>> 0) % 360) * Math.PI / 180;
  const radius = 0.005 + (((hash >>> 8) % 1000) / 1000) * maxRadius;
  return { lat: center.lat + Math.sin(angle) * radius, lng: center.lng + Math.cos(angle) * radius };
}

function parseSikestonAddress(raw = '') {
  const address = decodeURIComponent(String(raw).replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim();
  const match = address.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2}),?\s*(\d{5}(?:-\d{4})?)?$/i);
  return {
    address: match?.[1]?.trim() || address,
    city: match?.[2]?.trim() || 'Sikeston',
    state: (match?.[3] || 'MO').toUpperCase(),
    zip: match?.[4] || '',
  };
}

function parseHopewellAddress(raw = '') {
  const address = decodeURIComponent(String(raw).replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim();
  const match = address.match(/^(.*?),\s*([^,]+),\s*([A-Za-z ]{2,20}),?\s*(\d{5}(?:-\d{4})?)?$/i);
  const state = (match?.[3] || 'VA').trim();
  return {
    address: match?.[1]?.trim() || address,
    city: match?.[2]?.trim() || 'Hopewell',
    state: /^virginia$/i.test(state) ? 'VA' : state.toUpperCase(),
    zip: match?.[4] || '',
    full: address,
  };
}

function chamberStableId(prefix, input) {
  return `${prefix}-${md5(input).slice(0, 16)}`;
}

function parseSikestonCategories(html) {
  const links = new Map();
  const regex = /href="(https:\/\/business\.sikeston\.net\/list\/category\/[^"]+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = regex.exec(html))) links.set(match[1], decodeEntity(match[2].replace(/,$/, '')));
  return [...links.entries()].map(([url, category]) => ({ url, category }));
}

function parseSikestonMembers(html, category) {
  const members = new Map();
  const linkRegex = /href="(https:\/\/business\.sikeston\.net\/list\/member\/[^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>([^<]*)/gi;
  let match;
  while ((match = linkRegex.exec(html))) {
    const source_url = match[1].split('?')[0];
    const name = decodeEntity(match[2] || match[3] || '');
    if (!name || name.length > 120) continue;
    const current = members.get(source_url) || { source_url, categories: [] };
    current.name = current.name || name;
    current.categories = [...new Set([...(current.categories || []), category])];
    members.set(source_url, current);
  }
  const mapAddresses = [...html.matchAll(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/gi)].map((m) => parseSikestonAddress(m[1]));
  return [...members.values()].map((member, index) => ({ ...member, ...mapAddresses[index] }));
}

function parseSikestonMemberDetail(html, source_url) {
  const title = decodeEntity(html.match(/<title>(.*?)\s+\|/)?.[1] || '');
  const meta = decodeEntity(html.match(/<meta name="description" content="([^"]+)"/i)?.[1] || '');
  const categories = meta.split('|').slice(1).map((s) => s.trim()).filter(Boolean);
  const mapAddress = parseSikestonAddress(html.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || '');
  return {
    name: title,
    categories,
    phone: decodeEntity(html.match(/href="tel:([^"]+)"/i)?.[1] || html.match(/(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/)?.[1] || ''),
    website: decodeEntity((html.match(/href="(https?:\/\/(?!business\.sikeston\.net|www\.sikeston\.net|www\.google\.com|growthzone\.com|growthzonecms|gmpg\.org|fonts\.googleapis\.com|fonts\.gstatic\.com|use\.fontawesome\.com|code\.jquery\.com)[^"]+)"/i)?.[1] || '').replace(/\/$/, '')),
    source_url,
    ...mapAddress,
  };
}

async function fetchSikestonBusinesses({ geocode = false, limit = 400 } = {}) {
  const summaries = new Map();
  if (geocode) {
    const listHtml = await fetchText(`${SIK_ESTON_BASE}/list`, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
    for (const { url, category } of parseSikestonCategories(listHtml)) {
      const html = await fetchText(url, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
      for (const member of parseSikestonMembers(html, category)) {
        const current = summaries.get(member.source_url) || { source_url: member.source_url, categories: [] };
        summaries.set(member.source_url, {
          ...current,
          ...member,
          categories: [...new Set([...(current.categories || []), ...(member.categories || [])])],
        });
      }
    }
  } else {
    const html = await fetchText(`${SIK_ESTON_BASE}/list/search?sa=true`, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
    for (const member of parseSikestonMembers(html, 'Chamber Member')) {
      const current = summaries.get(member.source_url) || { source_url: member.source_url, categories: [] };
      summaries.set(member.source_url, {
        ...current,
        ...member,
        categories: [...new Set([...(current.categories || []), ...(member.categories || [])])],
      });
    }
  }
  const now = new Date().toISOString();
  const businesses = [];
  for (const summary of [...summaries.values()].slice(0, limit)) {
    let detail = {};
    if (geocode) {
      try {
        const html = await fetchText(summary.source_url, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
        detail = parseSikestonMemberDetail(html, summary.source_url);
      } catch {}
    }
    const merged = {
      ...summary,
      ...detail,
      categories: [...new Set([...(summary.categories || []), ...(detail.categories || [])])],
    };
    const fullAddress = [merged.address, merged.city, merged.state, merged.zip].filter(Boolean).join(', ');
    const geo = geocode ? await geocodeUsAddress([fullAddress]) : null;
    const fallback = stablePoint(`${merged.name}-${fullAddress}`);
    businesses.push({
      id: chamberStableId('sikeston-biz', merged.source_url || merged.name || fullAddress),
      type: 'sikeston_business',
      name: merged.name || 'Unknown Sikeston business',
      categories: merged.categories || [],
      address: merged.address || '',
      city: merged.city || 'Sikeston',
      state: merged.state || 'MO',
      zip: merged.zip || '',
      phone: merged.phone || '',
      website: merged.website || '',
      source_url: merged.source_url,
      lat: geo?.lat ?? fallback.lat,
      lng: geo?.lng ?? fallback.lng,
      geocode_source: geo?.geocode_source || (fullAddress ? 'Deterministic Sikeston fallback pending geocode' : 'Sikeston centroid fallback'),
      data_confidence: geo ? 92 : 45,
      last_updated: now,
    });
  }
  return businesses;
}

function parseSikestonEventLinks(html) {
  const links = new Map();
  const regex = /href="(https:\/\/business\.sikeston\.net\/events\/details\/[^"]+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = regex.exec(html))) links.set(match[1].replace(/&amp;/g, '&'), decodeEntity(match[2]));
  return [...links.entries()].map(([url, title]) => ({ url, title }));
}

function parseSikestonEventDetail(html, source_url, fallbackTitle = '') {
  const title = decodeEntity(html.match(/<meta itemprop="name" content="([^"]+)"/i)?.[1] || fallbackTitle || html.match(/<h1>(.*?)<\/h1>/i)?.[1] || '');
  const startDate = decodeEntity(html.match(/itemprop="startDate" content="([^"]+)"/i)?.[1] || '');
  const endDate = decodeEntity(html.match(/itemprop="endDate" content="([^"]+)"/i)?.[1] || '');
  const location = gzStrip(html.match(/class="col-sm-12 gz-event-location"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const description = gzStrip(html.match(/<div class="row gz-event-description"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const fees = gzStrip(html.match(/<span class="gz-event-fees">([\s\S]*?)<\/span>/i)?.[1] || '');
  const fallback = stablePoint(`${title}-${startDate}-${location}`);
  return {
    id: chamberStableId('sikeston-event', source_url.split('?')[0]),
    type: 'sikeston_event',
    title,
    startDate,
    endDate,
    date_label: startDate,
    time_label: startDate ? new Date(startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) : '',
    location,
    address: location,
    fees,
    contact: decodeEntity(html.match(/mailto:([^"?]+)[^"]*"/i)?.[1] || ''),
    description,
    source_url: source_url.split('?')[0],
    lat: fallback.lat,
    lng: fallback.lng,
    geocode_source: 'Deterministic Sikeston fallback pending geocode',
    data_confidence: 42,
    last_updated: new Date().toISOString(),
  };
}

async function fetchSikestonEvents({ geocode = false, limit = 200 } = {}) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const eventLinks = new Map();
  for (let offset = 0; offset < 3; offset++) {
    const d = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + offset, 1));
    const month = d.toISOString().slice(0, 10);
    const html = await fetchText(`${SIK_ESTON_BASE}/events/calendar?calendarMonth=${month}`, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
    for (const event of parseSikestonEventLinks(html)) eventLinks.set(event.url, event.title);
  }
  const events = [];
  for (const [url, fallbackTitle] of [...eventLinks.entries()].slice(0, limit)) {
    try {
      const html = await fetchText(url, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
      const event = parseSikestonEventDetail(html, url, fallbackTitle);
      const geo = geocode ? await geocodeUsAddress([`${event.location}, Sikeston, MO`]) : null;
      events.push({
        ...event,
        lat: geo?.lat ?? event.lat,
        lng: geo?.lng ?? event.lng,
        geocode_source: geo?.geocode_source || event.geocode_source,
        data_confidence: geo ? 86 : event.data_confidence,
      });
    } catch {}
  }
  return events.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

function parseHopewellMemberCards(html, category = 'Chamber Member') {
  return String(html).split(/<div class="gz-list-card-wrapper[^>]*>/i).slice(1).map((card) => {
    const source_url = decodeEntity(card.match(/<h5[^>]*gz-card-title[\s\S]*?<a href="([^"]+)"/i)?.[1] || '').split('?')[0];
    const titleMatch = card.match(/<h5[^>]*gz-card-title[\s\S]*?<a[^>]*(?:alt="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i);
    const name = decodeEntity(titleMatch?.[1] || titleMatch?.[2] || '');
    const mapAddress = parseHopewellAddress(card.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || '');
    const phone = decodeEntity(card.match(/href="tel:([^"]+)"/i)?.[1] || card.match(/gz-card-phone[\s\S]*?<span>(.*?)<\/span>/i)?.[1] || '');
    if (!source_url || !name) return null;
    return { source_url, name, categories: [category], phone, ...mapAddress };
  }).filter(Boolean);
}

function parseHopewellAlphaLinks(html) {
  const letters = new Set();
  const regex = /href="https:\/\/www\.hpgchamber\.org\/members\/searchalpha\/([^"]+)"/gi;
  let match;
  while ((match = regex.exec(html))) letters.add(match[1]);
  return [...letters].filter((letter) => letter.length <= 3);
}

function parseHopewellMemberDetail(html, source_url) {
  const name = decodeEntity(html.match(/<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title>(.*?)\s+\|/)?.[1] || '');
  const categories = [...html.matchAll(/\/members\/category\/[^"]+">([^<]+)/gi)].map((m) => decodeEntity(m[1].replace(/,$/, ''))).filter(Boolean);
  const mapAddress = parseHopewellAddress(html.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || html.match(/https:\/\/maps\.google\.com\/maps\?[^"]*q=([^"&]+)/i)?.[1] || '');
  return {
    name,
    categories,
    phone: decodeEntity(html.match(/href="tel:([^"]+)"/i)?.[1] || html.match(/(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/)?.[1] || ''),
    website: decodeEntity((html.match(/href="(https?:\/\/(?!www\.hpgchamber\.org|hpgchamber\.org|www\.google\.com|maps\.google\.com|chambermaster\.blob\.core\.windows\.net|growthzone\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|code\.jquery\.com)[^"]+)"/i)?.[1] || '').replace(/\/$/, '')),
    source_url,
    ...mapAddress,
  };
}

async function fetchHopewellBusinesses({ geocode = false, limit = 600 } = {}) {
  const summaries = new Map();
  const indexHtml = await fetchText(`${HOPEWELL_BASE}/members/`, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
  const letters = parseHopewellAlphaLinks(indexHtml);
  for (const letter of letters) {
    const html = await fetchText(`${HOPEWELL_BASE}/members/searchalpha/${letter}`, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
    for (const member of parseHopewellMemberCards(html)) {
      const current = summaries.get(member.source_url) || { source_url: member.source_url, categories: [] };
      summaries.set(member.source_url, {
        ...current,
        ...member,
        categories: [...new Set([...(current.categories || []), ...(member.categories || [])])],
      });
    }
  }
  const now = new Date().toISOString();
  const businesses = [];
  for (const summary of [...summaries.values()].slice(0, limit)) {
    let detail = {};
    if (geocode) {
      try {
        const html = await fetchText(summary.source_url, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
        detail = parseHopewellMemberDetail(html, summary.source_url);
      } catch {}
    }
    const merged = {
      ...summary,
      ...detail,
      categories: [...new Set([...(summary.categories || []), ...(detail.categories || [])])],
    };
    const fullAddress = [merged.address, merged.city, merged.state, merged.zip].filter(Boolean).join(', ');
    const geo = geocode ? await geocodeUsAddress([fullAddress]) : null;
    const fallback = stableRegionalPoint(`${merged.name}-${fullAddress}`, HOPEWELL_CENTER, 0.04);
    businesses.push({
      id: chamberStableId('hopewell-biz', merged.source_url || merged.name || fullAddress),
      type: 'hopewell_business',
      name: merged.name || 'Unknown Hopewell business',
      categories: merged.categories || [],
      address: merged.address || '',
      city: merged.city || 'Hopewell',
      state: merged.state || 'VA',
      zip: merged.zip || '',
      phone: merged.phone || '',
      website: merged.website || '',
      source_url: merged.source_url,
      lat: geo?.lat ?? fallback.lat,
      lng: geo?.lng ?? fallback.lng,
      geocode_source: geo?.geocode_source || (fullAddress ? 'Deterministic Hopewell fallback pending geocode' : 'Hopewell centroid fallback'),
      data_confidence: geo ? 92 : 45,
      last_updated: now,
    });
  }
  return businesses;
}

function parseHopewellEventLinks(html) {
  const links = new Map();
  const regex = /href="(https:\/\/www\.hpgchamber\.org\/events\/details\/[^"]+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = regex.exec(html))) links.set(match[1].replace(/&amp;/g, '&'), decodeEntity(match[2]));
  return [...links.entries()].map(([url, title]) => ({ url, title }));
}

function eventTextAfter(html, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h5[^>]*>\\s*${escaped}\\s*<\\/h5>([\\s\\S]*?)(?:<h5|<\\/div>\\s*<\\/div>|<\\/div>\\s*<div class="col-sm-12)`, 'i'));
  return gzStrip(match?.[1] || '');
}

function parseHopewellEventDetail(html, source_url, fallbackTitle = '') {
  const title = decodeEntity(html.match(/<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<meta itemprop="name" content="([^"]+)"/i)?.[1] || fallbackTitle || '');
  const startDate = decodeEntity(html.match(/itemprop="startDate" content="([^"]+)"/i)?.[1] || '');
  const endDate = decodeEntity(html.match(/itemprop="endDate" content="([^"]+)"/i)?.[1] || '');
  const mapAddress = parseHopewellAddress(html.match(/https:\/\/maps\.google\.com\/maps\?[^"]*q=([^"&]+)/i)?.[1] || html.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || '');
  const venue = gzStrip(html.match(/class="col-sm-12 gz-event-location"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const location = [venue.split('\n')[0], mapAddress.full].filter(Boolean).join(' - ');
  const fallback = stableRegionalPoint(`${title}-${startDate}-${location}`, HOPEWELL_CENTER, 0.04);
  return {
    id: chamberStableId('hopewell-event', source_url.split('?')[0]),
    type: 'hopewell_event',
    title,
    startDate,
    endDate,
    date_label: gzStrip(html.match(/<div class="col-sm-12 gz-event-date">([\s\S]*?)<\/div>/i)?.[1] || '').replace(/^Date and Time\s*/i, ''),
    time_label: startDate ? new Date(startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '',
    location: location || venue || mapAddress.full,
    address: mapAddress.full || venue,
    fees: eventTextAfter(html, 'Fees/Admission') || gzStrip(html.match(/<span class="gz-event-fees">([\s\S]*?)<\/span>/i)?.[1] || ''),
    contact: decodeEntity(html.match(/mailto:([^"?]+)[^"]*"/i)?.[1] || ''),
    description: gzStrip(html.match(/<div class="row gz-event-description"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || ''),
    source_url: source_url.split('?')[0],
    lat: fallback.lat,
    lng: fallback.lng,
    geocode_source: 'Deterministic Hopewell fallback pending geocode',
    data_confidence: 42,
    last_updated: new Date().toISOString(),
  };
}

async function fetchHopewellEvents({ geocode = false, limit = 250 } = {}) {
  const months = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'];
  const eventLinks = new Map();
  for (const month of months) {
    const html = await fetchText(`${HOPEWELL_BASE}/events/calendar?calendarMonth=${month}`, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
    for (const event of parseHopewellEventLinks(html)) eventLinks.set(event.url, event.title);
  }
  const events = [];
  for (const [url, fallbackTitle] of [...eventLinks.entries()].slice(0, limit)) {
    try {
      const html = await fetchText(url, { headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0' }, signal: AbortSignal.timeout(25000) });
      const event = parseHopewellEventDetail(html, url, fallbackTitle);
      const geo = geocode ? await geocodeUsAddress([event.address || `${event.location}, Hopewell, VA`]) : null;
      events.push({
        ...event,
        lat: geo?.lat ?? event.lat,
        lng: geo?.lng ?? event.lng,
        geocode_source: geo?.geocode_source || event.geocode_source,
        data_confidence: geo ? 86 : event.data_confidence,
      });
    } catch {}
  }
  return events.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

const GITHUB_API_BASE = 'https://api.github.com';
const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
const OPENALEX_API_BASE = 'https://api.openalex.org';
const OPENALEX_ARXIV_SOURCE_ID = 'https://openalex.org/S4306400194';
const OPENALEX_MAILTO = 'autonate.ai@gmail.com';

function githubHeaders() {
  const githubToken = process.env.GITHUB_TOKEN || githubTokenSecret.value();
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'AutoNateAI-OSIRIS/1.0 university research scanner',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  return headers;
}

async function fetchGithubJson(path) {
  return fetchJson(`${GITHUB_API_BASE}${path}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(20000),
  });
}

async function fetchOpenAlexJson(path) {
  const separator = path.includes('?') ? '&' : '?';
  return fetchJson(`${OPENALEX_API_BASE}${path}${separator}mailto=${encodeURIComponent(OPENALEX_MAILTO)}`, {
    headers: { 'User-Agent': `AutoNateAI-OSIRIS/1.0 mailto:${OPENALEX_MAILTO}` },
    signal: AbortSignal.timeout(20000),
  });
}

function parseXmlTag(xml = '', tag) {
  const match = String(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeEntity((match?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, ''));
}

function parseArxivEntries(xml = '') {
  return String(xml).split(/<entry>/i).slice(1).map((entry) => {
    const id = parseXmlTag(entry, 'id');
    const arxivId = id.split('/abs/')[1] || id.split('/').pop() || md5(id);
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((m) => decodeEntity(m[1]));
    const categories = [...entry.matchAll(/<category[^>]*term="([^"]+)"/gi)].map((m) => decodeEntity(m[1]));
    return {
      id: `arxiv-${arxivId.replace(/[^a-zA-Z0-9._-]/g, '-')}`,
      arxiv_id: arxivId,
      title: parseXmlTag(entry, 'title'),
      abstract: parseXmlTag(entry, 'summary'),
      authors,
      categories,
      primary_category: categories[0] || '',
      published_at: parseXmlTag(entry, 'published'),
      updated_at: parseXmlTag(entry, 'updated'),
      pdf_url: id ? id.replace('/abs/', '/pdf/') : '',
      source_url: id,
    };
  }).filter((paper) => paper.title);
}

async function fetchArxivPapersForUniversity(university, limit = 5) {
  const query = new URLSearchParams({
    search_query: `all:"${university.name}" OR all:"${university.short_name}"`,
    start: '0',
    max_results: String(limit),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });
  const xml = await fetchText(`${ARXIV_API_BASE}?${query.toString()}`, {
    headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0 university research scanner' },
    signal: AbortSignal.timeout(20000),
  });
  return parseArxivEntries(xml).map((paper) => ({
    ...paper,
    id: `${university.id}-${paper.id}`,
    university_id: university.id,
    university_name: university.name,
    lat: university.lat,
    lng: university.lng,
    last_seen: new Date().toISOString(),
  }));
}

async function fetchRecentArxivCorpus(limit = 300) {
  const query = new URLSearchParams({
    search_query: 'cat:cs.* OR cat:eess.* OR cat:stat.ML OR cat:math.OC',
    start: '0',
    max_results: String(Math.min(Math.max(limit, 25), 1000)),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });
  const xml = await fetchText(`${ARXIV_API_BASE}?${query.toString()}`, {
    headers: { 'User-Agent': 'AutoNateAI-OSIRIS/1.0 university research scanner' },
    signal: AbortSignal.timeout(30000),
  });
  return parseArxivEntries(xml);
}

function openAlexIdTail(id = '') {
  return String(id).split('/').pop() || '';
}

function arxivIdFromUrl(url = '') {
  return String(url)
    .replace(/^https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/^https?:\/\/doi\.org\/10\.48550\/arxiv\./i, '')
    .replace(/\.pdf$/i, '')
    .split(/[?#]/)[0];
}

function extractOpenAlexArxivLocation(work = {}) {
  return (work.locations || []).find((location) => location.source?.id === OPENALEX_ARXIV_SOURCE_ID && (location.landing_page_url || location.pdf_url));
}

function openAlexWorkToArxivPaper(work, university, arxivLocation) {
  const sourceUrl = arxivLocation?.landing_page_url || work.primary_location?.landing_page_url || work.id;
  const arxivId = arxivIdFromUrl(sourceUrl) || openAlexIdTail(work.id);
  const authors = (work.authorships || []).map((authorship) => authorship.author?.display_name).filter(Boolean);
  return {
    id: `${university.id}-arxiv-${arxivId.replace(/[^a-zA-Z0-9._-]/g, '-')}`,
    arxiv_id: arxivId,
    openalex_id: work.id || '',
    title: work.title || work.display_name || '',
    abstract: '',
    authors,
    categories: (work.concepts || []).slice(0, 6).map((concept) => concept.display_name).filter(Boolean),
    primary_category: work.concepts?.[0]?.display_name || '',
    published_at: work.publication_date || '',
    updated_at: work.updated_date || '',
    pdf_url: arxivLocation?.pdf_url || '',
    source_url: sourceUrl,
    doi: work.doi || '',
    university_id: university.id,
    university_name: university.name,
    lat: university.lat,
    lng: university.lng,
    discovery_source: 'openalex_arxiv_location',
    last_seen: new Date().toISOString(),
  };
}

async function fetchOpenAlexArxivPapersForUniversity(university, limit = 5) {
  const institutionQuery = new URLSearchParams({
    search: university.name,
    'per-page': '1',
    select: 'id,display_name,country_code',
  });
  const institutionResponse = await fetchOpenAlexJson(`/institutions?${institutionQuery.toString()}`);
  const institution = institutionResponse.results?.find((item) => item.country_code === 'US') || institutionResponse.results?.[0];
  const institutionId = openAlexIdTail(institution?.id);
  if (!institutionId) return [];

  const today = new Date().toISOString().slice(0, 10);
  const lastYear = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const worksQuery = new URLSearchParams({
    filter: `institutions.id:${institutionId},locations.source.id:${openAlexIdTail(OPENALEX_ARXIV_SOURCE_ID)},from_publication_date:${lastYear},to_publication_date:${today}`,
    sort: 'publication_date:desc',
    'per-page': String(Math.min(Math.max(limit, 1), 20)),
    select: 'id,doi,title,display_name,publication_date,updated_date,locations,primary_location,authorships,concepts',
  });
  const worksResponse = await fetchOpenAlexJson(`/works?${worksQuery.toString()}`);
  return (worksResponse.results || [])
    .map((work) => {
      const arxivLocation = extractOpenAlexArxivLocation(work);
      return arxivLocation ? openAlexWorkToArxivPaper(work, university, arxivLocation) : null;
    })
    .filter(Boolean)
    .slice(0, limit);
}

function matchArxivPapersForUniversity(corpus, university, limit = 5) {
  const needles = [university.name, university.short_name, ...(university.aliases || [])]
    .map((value) => String(value || '').toLowerCase())
    .filter((value) => value.length > 2);
  return corpus
    .filter((paper) => {
      const haystack = `${paper.title} ${paper.abstract} ${(paper.authors || []).join(' ')}`.toLowerCase();
      return needles.some((needle) => haystack.includes(needle));
    })
    .slice(0, limit)
    .map((paper) => ({
      ...paper,
      id: `${university.id}-${paper.id}`,
      university_id: university.id,
      university_name: university.name,
      lat: university.lat,
      lng: university.lng,
      last_seen: new Date().toISOString(),
    }));
}

function repoMomentumScore(repo, previousSnapshot) {
  const stars = Number(repo.stargazers_count || 0);
  const forks = Number(repo.forks_count || 0);
  const issues = Number(repo.open_issues_count || 0);
  const pushedAt = repo.pushed_at ? Date.parse(repo.pushed_at) : 0;
  const daysSincePush = pushedAt ? Math.max(0, (Date.now() - pushedAt) / 86400000) : 365;
  const starDelta = previousSnapshot ? stars - Number(previousSnapshot.stars || 0) : 0;
  const forkDelta = previousSnapshot ? forks - Number(previousSnapshot.forks || 0) : 0;
  return Math.round(Math.min(100, (stars ** 0.45) * 5 + (forks ** 0.5) * 4 + Math.max(0, starDelta) * 6 + Math.max(0, forkDelta) * 8 + Math.max(0, 30 - daysSincePush) + Math.min(10, issues)));
}

async function scanUniversityGithub(university, options = {}) {
  const now = new Date().toISOString();
  const repoLimit = Math.max(1, Math.min(Number(options.repoLimit || 5), 20));
  const repos = [];
  const snapshots = [];
  const orgs = [];

  for (const orgName of university.github_orgs || []) {
    try {
      const org = await fetchGithubJson(`/orgs/${encodeURIComponent(orgName)}`);
      orgs.push({
        id: `github-org-${org.login.toLowerCase()}`,
        university_id: university.id,
        university_name: university.name,
        login: org.login,
        name: org.name || org.login,
        description: org.description || '',
        html_url: org.html_url,
        public_repos: Number(org.public_repos || 0),
        followers: Number(org.followers || 0),
        avatar_url: org.avatar_url || '',
        last_scanned: now,
      });

      const orgRepos = await fetchGithubJson(`/orgs/${encodeURIComponent(org.login)}/repos?sort=updated&direction=desc&per_page=${repoLimit}`);
      for (const repo of Array.isArray(orgRepos) ? orgRepos : []) {
        const repoId = `github-repo-${repo.id}`;
        const previousSnap = await db.collection('github_repo_snapshots')
          .where('repo_id', '==', repoId)
          .orderBy('snapshot_at', 'desc')
          .limit(1)
          .get()
          .catch(() => null);
        const previous = previousSnap?.docs?.[0]?.data();
        const score = repoMomentumScore(repo, previous);
        const normalized = {
          id: repoId,
          university_id: university.id,
          university_name: university.name,
          org_login: org.login,
          repo_full_name: repo.full_name,
          name: repo.name,
          description: repo.description || '',
          html_url: repo.html_url,
          language: repo.language || '',
          topics: repo.topics || [],
          stars: Number(repo.stargazers_count || 0),
          forks: Number(repo.forks_count || 0),
          watchers: Number(repo.watchers_count || 0),
          open_issues: Number(repo.open_issues_count || 0),
          default_branch: repo.default_branch || '',
          pushed_at: repo.pushed_at || '',
          created_at: repo.created_at || '',
          updated_at: repo.updated_at || '',
          momentum_score: score,
          last_scanned: now,
        };
        repos.push(normalized);
        snapshots.push({
          id: `${repoId}-${now.replace(/[:.]/g, '-')}`,
          repo_id: repoId,
          repo_full_name: repo.full_name,
          university_id: university.id,
          org_login: org.login,
          snapshot_at: now,
          stars: normalized.stars,
          forks: normalized.forks,
          watchers: normalized.watchers,
          open_issues: normalized.open_issues,
          pushed_at: normalized.pushed_at,
          momentum_score: score,
        });
      }
    } catch (err) {
      console.warn('[AutoNateAI Intel Functions] GitHub org scan failed', university.id, orgName, err instanceof Error ? err.message : err);
    }
  }
  return { orgs, repos, snapshots };
}

function universityNarrative(university, repos, papers) {
  const topRepo = repos.slice().sort((a, b) => Number(b.momentum_score || 0) - Number(a.momentum_score || 0))[0];
  const latestPaper = papers.slice().sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))[0];
  if (topRepo && latestPaper) {
    return `${university.short_name} is showing an active research-to-code signal: ${topRepo.repo_full_name} is the strongest current GitHub momentum node while recent arXiv activity includes "${latestPaper.title}".`;
  }
  if (topRepo) return `${university.short_name} has active open-source movement led by ${topRepo.repo_full_name}, with repo momentum driven by stars, forks, and recent updates.`;
  if (latestPaper) return `${university.short_name} has recent arXiv research activity including "${latestPaper.title}", but no mapped GitHub repository signal yet.`;
  return `${university.short_name} is seeded for monitoring; GitHub and arXiv signals will strengthen as scanner coverage expands.`;
}

export async function runUniversityResearchScan({ limit = 100, repoLimit = 5, arxivLimit = 5, arxivBackfill = false } = {}) {
  const scanStarted = new Date().toISOString();
  const universities = researchUniversities.slice(0, Math.min(limit, researchUniversities.length));
  await writeCollection('research_universities', researchUniversities.map((u, index) => ({
    ...u,
    rank_seed: index + 1,
    type: 'research_university',
    last_seeded: scanStarted,
  })));

  const allOrgs = [];
  const allRepos = [];
  const allSnapshots = [];
  const allPapers = [];
  const rollups = [];
  const arxivCorpus = await fetchRecentArxivCorpus(Math.max(250, universities.length * arxivLimit)).catch((err) => {
    console.warn('[AutoNateAI Intel Functions] arXiv corpus scan failed', err instanceof Error ? err.message : err);
    return [];
  });

  for (const university of universities) {
    const github = await scanUniversityGithub(university, { repoLimit });
    const paperMap = new Map(matchArxivPapersForUniversity(arxivCorpus, university, arxivLimit).map((paper) => [paper.id, paper]));
    if (arxivBackfill) {
      try {
        const openAlexPapers = await fetchOpenAlexArxivPapersForUniversity(university, arxivLimit);
        for (const paper of openAlexPapers) paperMap.set(paper.id, paper);
        await sleep(150);
      } catch (err) {
        console.warn('[AutoNateAI Intel Functions] OpenAlex arXiv university backfill failed', university.id, err instanceof Error ? err.message : err);
      }
    }
    const papers = [...paperMap.values()]
      .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
      .slice(0, arxivLimit);
    allOrgs.push(...github.orgs);
    allRepos.push(...github.repos);
    allSnapshots.push(...github.snapshots);
    allPapers.push(...papers);

    const stars = github.repos.reduce((sum, repo) => sum + Number(repo.stars || 0), 0);
    const forks = github.repos.reduce((sum, repo) => sum + Number(repo.forks || 0), 0);
    const topMomentum = Math.max(0, ...github.repos.map((repo) => Number(repo.momentum_score || 0)));
    const score = Math.round(Math.min(100, topMomentum * 0.55 + Math.min(25, github.repos.length * 3) + Math.min(20, papers.length * 4) + Math.min(15, Math.log10(stars + forks + 1) * 6)));
    rollups.push({
      id: university.id,
      ...university,
      type: 'university_research',
      repo_count: github.repos.length,
      org_count: github.orgs.length,
      arxiv_paper_count: papers.length,
      total_stars: stars,
      total_forks: forks,
      top_momentum_score: topMomentum,
      opportunity_score: score,
      top_repos: github.repos.slice().sort((a, b) => Number(b.momentum_score || 0) - Number(a.momentum_score || 0)).slice(0, 5).map((repo) => ({
        repo_full_name: repo.repo_full_name,
        html_url: repo.html_url,
        stars: repo.stars,
        forks: repo.forks,
        momentum_score: repo.momentum_score,
        language: repo.language,
      })),
      recent_papers: papers.slice(0, 5).map((paper) => ({
        arxiv_id: paper.arxiv_id,
        title: paper.title,
        published_at: paper.published_at,
        source_url: paper.source_url,
        categories: paper.categories,
      })),
      narrative: universityNarrative(university, github.repos, papers),
      scan_started_at: scanStarted,
      last_scanned: new Date().toISOString(),
    });
    await sleep(200);
  }

  if (allOrgs.length) await writeCollection('github_university_orgs', allOrgs);
  if (allRepos.length) await writeCollection('github_university_repos', allRepos);
  if (allSnapshots.length) await writeCollection('github_repo_snapshots', allSnapshots);
  if (allPapers.length) await writeCollection('arxiv_papers', allPapers);
  if (rollups.length) await writeCollection('university_research_signals', rollups);
  await writeCollection('university_research_scans', [{
    id: `university-research-${scanStarted.replace(/[:.]/g, '-')}`,
    scan_started_at: scanStarted,
    scan_finished_at: new Date().toISOString(),
    university_count: universities.length,
    org_count: allOrgs.length,
    repo_count: allRepos.length,
    repo_snapshot_count: allSnapshots.length,
    arxiv_paper_count: allPapers.length,
    arxiv_backfill: Boolean(arxivBackfill),
  }]);
  jsonCache.clear();
  return {
    university_count: universities.length,
    org_count: allOrgs.length,
    repo_count: allRepos.length,
    repo_snapshot_count: allSnapshots.length,
    arxiv_paper_count: allPapers.length,
    arxiv_backfill: Boolean(arxivBackfill),
    timestamp: new Date().toISOString(),
  };
}

function parseRSSItems(xml, sourceName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];
    const getTag = (tag) => {
      const tagMatch = itemXml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return (tagMatch?.[1] || tagMatch?.[2] || '').trim();
    };
    const title = stripHtml(getTag('title'));
    const description = stripHtml(getTag('description'));
    items.push({
      title: title.length > 100 ? `${title.substring(0, 100)}...` : title,
      description,
      link: getTag('link'),
      pubDate: getTag('pubDate') || new Date().toISOString(),
      source: sourceName,
    });
  }

  return items;
}

const yahooHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json',
};

async function fetchYahooQuote(symbol) {
  try {
    const data = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`, {
      signal: AbortSignal.timeout(8000),
      headers: yahooHeaders,
    });
    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const currentPrice = meta?.regularMarketPrice || closes[closes.length - 1];
    const previousClose = meta?.chartPreviousClose || closes[0];
    if (!currentPrice || !previousClose) return null;
    const changePercent = ((currentPrice - previousClose) / previousClose) * 100;
    return {
      price: Math.round(currentPrice * 100) / 100,
      change_percent: Math.round(changePercent * 100) / 100,
      up: changePercent >= 0,
    };
  } catch {
    try {
      const data = await fetchJson(`https://query2.finance.yahoo.com/v6/finance/quote?symbols=${encodeURIComponent(symbol)}`, {
        signal: AbortSignal.timeout(8000),
        headers: yahooHeaders,
      });
      const quote = data.quoteResponse?.result?.[0];
      if (!quote) return null;
      return {
        price: Math.round((quote.regularMarketPrice || 0) * 100) / 100,
        change_percent: Math.round((quote.regularMarketChangePercent || 0) * 100) / 100,
        up: (quote.regularMarketChangePercent || 0) >= 0,
      };
    } catch {
      return null;
    }
  }
}

const newsFeeds = {
  BBC: 'https://feeds.bbci.co.uk/news/world/rss.xml',
  AlJazeera: 'https://www.aljazeera.com/xml/rss/all.xml',
  GDACS: 'https://www.gdacs.org/xml/rss.xml',
};

const riskKeywords = ['war', 'missile', 'strike', 'attack', 'crisis', 'tension', 'military', 'conflict', 'defense', 'clash', 'nuclear', 'invasion', 'bomb', 'drone', 'weapon', 'sanctions', 'ceasefire', 'escalation', 'killed', 'destroyed', 'operation', 'casualty', 'frontline', 'threat'];
const keywordCoords = {
  ukraine: [49.487, 31.272], kyiv: [50.450, 30.523], russia: [61.524, 105.318], moscow: [55.755, 37.617],
  israel: [31.046, 34.851], gaza: [31.416, 34.333], iran: [32.427, 53.688], lebanon: [33.854, 35.862],
  syria: [34.802, 38.996], yemen: [15.552, 48.516], china: [35.861, 104.195], taiwan: [23.697, 120.960],
  'united states': [38.907, -77.036], europe: [48.800, 2.300], 'middle east': [31.500, 34.800],
};

function scoreRisk(text = '') {
  const lower = text.toLowerCase();
  let score = 1;
  for (const keyword of riskKeywords) if (lower.includes(keyword)) score += 2;
  return Math.min(10, score);
}

function findCoords(text = '') {
  const lower = text.toLowerCase();
  for (const [keyword, coords] of Object.entries(keywordCoords)) {
    if (lower.includes(keyword)) return coords;
  }
  return null;
}

const exchanges = [
  { name: 'NYSE', tz: 'America/New_York', open: 9.5, close: 16, country: 'US' },
  { name: 'NASDAQ', tz: 'America/New_York', open: 9.5, close: 16, country: 'US' },
  { name: 'LSE', tz: 'Europe/London', open: 8, close: 16.5, country: 'GB' },
  { name: 'TSE', tz: 'Asia/Tokyo', open: 9, close: 15, country: 'JP' },
  { name: 'SSE', tz: 'Asia/Shanghai', open: 9.5, close: 15, country: 'CN' },
  { name: 'HKEX', tz: 'Asia/Hong_Kong', open: 9.5, close: 16, country: 'HK' },
  { name: 'BSE', tz: 'Asia/Kolkata', open: 9.25, close: 15.5, country: 'IN' },
  { name: 'FRA', tz: 'Europe/Berlin', open: 8, close: 20, country: 'DE' },
  { name: 'TSX', tz: 'America/Toronto', open: 9.5, close: 16, country: 'CA' },
  { name: 'ASX', tz: 'Australia/Sydney', open: 10, close: 16, country: 'AU' },
  { name: 'KRX', tz: 'Asia/Seoul', open: 9, close: 15.5, country: 'KR' },
  { name: 'MOEX', tz: 'Europe/Moscow', open: 10, close: 18.5, country: 'RU' },
];

function isExchangeOpen(exchange) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: exchange.tz, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(new Date());
    const weekday = parts.find((part) => part.type === 'weekday')?.value || '';
    if (['Sat', 'Sun'].includes(weekday)) return false;
    const hour = Number.parseInt(parts.find((part) => part.type === 'hour')?.value || '0', 10);
    const minute = Number.parseInt(parts.find((part) => part.type === 'minute')?.value || '0', 10);
    const decimal = hour + minute / 60;
    return decimal >= exchange.open && decimal < exchange.close;
  } catch {
    return false;
  }
}

function parseFireCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const latIdx = header.indexOf('latitude');
  const lngIdx = header.indexOf('longitude');
  const brightIdx = header.indexOf('bright_ti4') !== -1 ? header.indexOf('bright_ti4') : header.indexOf('brightness');
  const confIdx = header.indexOf('confidence');
  const dateIdx = header.indexOf('acq_date');
  const timeIdx = header.indexOf('acq_time');
  const frpIdx = header.indexOf('frp');
  const fires = [];
  const step = lines.length > 2000 ? Math.ceil(lines.length / 2000) : 1;

  for (let i = 1; i < lines.length; i += step) {
    const columns = lines[i].split(',');
    const lat = Number.parseFloat(columns[latIdx]);
    const lng = Number.parseFloat(columns[lngIdx]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    fires.push({
      lat: Math.round(lat * 1000) / 1000,
      lng: Math.round(lng * 1000) / 1000,
      brightness: Number.parseFloat(columns[brightIdx]) || 0,
      confidence: columns[confIdx] || 'unknown',
      date: columns[dateIdx] || '',
      time: columns[timeIdx] || '',
      frp: Number.parseFloat(columns[frpIdx]) || 0,
      type: 'fire',
    });
  }

  return fires;
}

const missionClassify = {
  USA: { mission: 'Military Recon', color: '#FF3D3D' },
  NROL: { mission: 'NRO Classified', color: '#FF3D3D' },
  LACROSSE: { mission: 'SAR Imaging', color: '#00E5FF' },
  MENTOR: { mission: 'SIGINT', color: '#FFFFFF' },
  ORION: { mission: 'SIGINT', color: '#FFFFFF' },
  TRUMPET: { mission: 'SIGINT', color: '#FFFFFF' },
  GPS: { mission: 'Navigation', color: '#448AFF' },
  NAVSTAR: { mission: 'Navigation', color: '#448AFF' },
  GLONASS: { mission: 'Navigation', color: '#448AFF' },
  GALILEO: { mission: 'Navigation', color: '#448AFF' },
  BEIDOU: { mission: 'Navigation', color: '#448AFF' },
  SBIRS: { mission: 'Early Warning', color: '#FF00FF' },
  DSP: { mission: 'Early Warning', color: '#FF00FF' },
  STARLINK: { mission: 'Commercial Comms', color: '#00E676' },
  ONEWEB: { mission: 'Commercial Comms', color: '#00E676' },
  PLANET: { mission: 'Earth Imaging', color: '#00E676' },
  WORLDVIEW: { mission: 'Commercial Imaging', color: '#00E676' },
  ISS: { mission: 'Space Station', color: '#FFD700' },
  TIANGONG: { mission: 'Space Station', color: '#FFD700' },
  COSMOS: { mission: 'Russian Military', color: '#FF6B6B' },
  YAOGAN: { mission: 'Chinese Recon', color: '#FF6B6B' },
  FENGYUN: { mission: 'Weather', color: '#87CEEB' },
  GOES: { mission: 'Weather', color: '#87CEEB' },
  NOAA: { mission: 'Weather', color: '#87CEEB' },
  METEOSAT: { mission: 'Weather', color: '#87CEEB' },
  LANDSAT: { mission: 'Earth Observation', color: '#90EE90' },
  SENTINEL: { mission: 'Earth Observation', color: '#90EE90' },
  TERRA: { mission: 'Earth Science', color: '#90EE90' },
  AQUA: { mission: 'Earth Science', color: '#90EE90' },
};

function classifySatellite(name) {
  const upper = name.toUpperCase();
  for (const [keyword, info] of Object.entries(missionClassify)) {
    if (upper.includes(keyword)) return info;
  }
  return { mission: 'Unknown', color: '#00E5FF' };
}

function gmst(jd) {
  const t = (jd - 2451545.0) / 36525.0;
  const gmstSec = 67310.54841 + (876600.0 * 3600 + 8640184.812866) * t + 0.093104 * t * t - 6.2e-6 * t * t * t;
  return ((gmstSec % 86400) / 86400.0) * 2 * Math.PI;
}

function propagateSatellite(line1, line2) {
  try {
    const incDeg = Number.parseFloat(line2.substring(8, 16));
    const raanDeg = Number.parseFloat(line2.substring(17, 25));
    const ecc = Number.parseFloat(`0.${line2.substring(26, 33).trim()}`);
    const argPerDeg = Number.parseFloat(line2.substring(34, 42));
    const meanAnomDeg = Number.parseFloat(line2.substring(43, 51));
    const meanMotion = Number.parseFloat(line2.substring(52, 63));
    if (Number.isNaN(meanMotion) || meanMotion === 0) return null;

    const now = new Date();
    const epochYear = Number.parseInt(line1.substring(18, 20), 10);
    const epochDay = Number.parseFloat(line1.substring(20, 32));
    const fullYear = epochYear > 56 ? 1900 + epochYear : 2000 + epochYear;
    const epochDate = new Date(fullYear, 0, 1);
    epochDate.setDate(epochDate.getDate() + epochDay - 1);
    const elapsedMin = (now.getTime() - epochDate.getTime()) / 60000;
    if (Math.abs(elapsedMin) > 43200 && !line1.includes('27885-3')) return null;

    const n = meanMotion * 2 * Math.PI / 1440;
    const meanAnomaly = ((meanAnomDeg * Math.PI / 180) + n * elapsedMin) % (2 * Math.PI);
    let eccentricAnomaly = meanAnomaly;
    for (let j = 0; j < 10; j++) eccentricAnomaly = meanAnomaly + ecc * Math.sin(eccentricAnomaly);

    const sinV = Math.sqrt(1 - ecc * ecc) * Math.sin(eccentricAnomaly) / (1 - ecc * Math.cos(eccentricAnomaly));
    const cosV = (Math.cos(eccentricAnomaly) - ecc) / (1 - ecc * Math.cos(eccentricAnomaly));
    const trueAnomaly = Math.atan2(sinV, cosV);
    const semiMajor = (398600.4418 / ((meanMotion * 2 * Math.PI / 86400) ** 2)) ** (1 / 3);
    const radius = semiMajor * (1 - ecc * Math.cos(eccentricAnomaly));
    const inc = incDeg * Math.PI / 180;
    const raan = raanDeg * Math.PI / 180;
    const argPer = argPerDeg * Math.PI / 180;
    const u = trueAnomaly + argPer;
    const x = radius * (Math.cos(raan) * Math.cos(u) - Math.sin(raan) * Math.sin(u) * Math.cos(inc));
    const y = radius * (Math.sin(raan) * Math.cos(u) + Math.cos(raan) * Math.sin(u) * Math.cos(inc));
    const z = radius * Math.sin(u) * Math.sin(inc);
    const theta = gmst(2440587.5 + now.getTime() / 86400000);
    const xRot = x * Math.cos(theta) + y * Math.sin(theta);
    const yRot = -x * Math.sin(theta) + y * Math.cos(theta);
    const lng = Math.atan2(yRot, xRot) * 180 / Math.PI;
    const lat = Math.atan2(z, Math.sqrt(xRot * xRot + yRot * yRot)) * 180 / Math.PI;
    const alt = radius - 6371;
    if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || alt < 100 || alt > 50000) return null;
    return {
      lat: Math.round(lat * 10000) / 10000,
      lng: Math.round((((lng + 540) % 360) - 180) * 10000) / 10000,
      alt: Math.round(alt),
    };
  } catch {
    return null;
  }
}

let cachedTles = [];
let cachedTleTime = 0;

async function fetchTflCameras() {
  try {
    const data = await fetchJson('https://api.tfl.gov.uk/Place/Type/JamCam', { signal: AbortSignal.timeout(12000) });
    return (data || []).map((camera) => {
      const image = camera.additionalProperties?.find((prop) => prop.key === 'imageUrl');
      const camId = camera.id?.replace('JamCams_', '') || '';
      return {
        id: `tfl-${camera.id}`,
        lat: camera.lat,
        lng: camera.lon,
        name: camera.commonName || 'London JamCam',
        city: 'London',
        country: 'UK',
        feed_url: image?.value || `https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/${camId}.jpg`,
        source: 'TfL',
      };
    }).filter((camera) => camera.lat && camera.lng);
  } catch {
    return [];
  }
}

async function fetchWsdotCameras() {
  try {
    const data = await fetchJson('https://data.wsdot.wa.gov/log/public/cameras.json', { signal: AbortSignal.timeout(10000) });
    return (data || []).map((camera) => ({
      id: `wsdot-${camera.CameraID}`,
      lat: camera.CameraLocation?.Latitude,
      lng: camera.CameraLocation?.Longitude,
      name: camera.Title || 'WSDOT Camera',
      city: 'Washington',
      country: 'US',
      feed_url: camera.ImageURL || '',
      source: 'WSDOT',
    })).filter((camera) => camera.lat && camera.lng && camera.feed_url);
  } catch {
    return [];
  }
}

async function fetchCaltransCameras() {
  const cameras = [];
  for (const district of ['d03', 'd04', 'd05', 'd06', 'd07', 'd08', 'd10', 'd11', 'd12']) {
    try {
      const data = await fetchJson(`https://cwwp2.dot.ca.gov/data/${district}/cctv/cctvStatus${district.toUpperCase()}.json`, { signal: AbortSignal.timeout(8000) });
      for (const camera of data?.data || []) {
        const lat = Number.parseFloat(camera.location?.latitude);
        const lng = Number.parseFloat(camera.location?.longitude);
        const url = camera.cctv?.imageData?.static?.currentImageURL;
        if (!lat || !lng || !url) continue;
        cameras.push({
          id: `cal-${district}-${cameras.length}`,
          lat,
          lng,
          name: camera.location?.locationName || 'Caltrans',
          city: 'California',
          country: 'US',
          feed_url: url,
          source: 'Caltrans',
        });
      }
    } catch {
      // Continue with other districts.
    }
  }
  return cameras;
}

async function fetchCanadaCameras() {
  const cameras = [];
  for (const [url, source, city] of [
    ['https://511on.ca/api/v2/get/cameras', '511 Ontario', 'Ontario'],
    ['https://511.alberta.ca/api/v2/get/cameras', 'Alberta 511', 'Alberta'],
  ]) {
    try {
      const data = await fetchJson(url, { signal: AbortSignal.timeout(10000) });
      for (const camera of data || []) {
        const lat = camera.latitude ?? camera.Latitude;
        const lng = camera.longitude ?? camera.Longitude;
        const feedUrl = camera.imageUrl || camera.url || camera.Views?.[0]?.Url || '';
        if (!lat || !lng) continue;
        cameras.push({
          id: `${source.toLowerCase().replace(/\W+/g, '-')}-${camera.id || camera.Id || cameras.length}`,
          lat,
          lng,
          name: camera.description || camera.name || camera.Location || `${city} Camera`,
          city,
          country: 'Canada',
          feed_url: feedUrl,
          source,
        });
      }
    } catch {
      // Continue with other Canadian sources.
    }
  }
  return cameras.filter((camera) => camera.lat && camera.lng);
}

async function fetchUsEastCameras() {
  const cameras = [
    { id: 'butler-oh-hamilton', lat: 39.3988617, lng: -84.5595353, name: 'Hamilton, OH', city: 'Hamilton', country: 'US', feed_url: 'https://gsccam.butlersheriff.org/axis-cgi/jpg/image.cgi', external_url: 'https://gsccam.butlersheriff.org/camera/index.html#/video', source: 'Butler County, OH' },
    { id: 'butler-oh-129-747', lat: 39.381435, lng: -84.438423, name: 'OH-129 at 747', city: 'Butler County', country: 'US', feed_url: 'https://towercam.butlersheriff.org/axis-cgi/jpg/image.cgi', external_url: 'https://towercam.butlersheriff.org/aca/index.html#view', source: 'Butler County, OH' },
    { id: 'cincinnati-cincyvision-yt', lat: 39.089101, lng: -84.527943, name: 'CincyVision YT', city: 'Cincinnati', country: 'US', external_url: 'https://www.youtube.com/@AaronPreslin/live', source: 'Cincinnati, OH' },
  ];
  try {
    const data = await fetchJson('https://fl511.com/api/v2/cameras', { signal: AbortSignal.timeout(8000) });
    for (const camera of (data || []).slice(0, 800)) {
      if (!camera.latitude || !camera.longitude) continue;
      cameras.push({
        id: `fl-${cameras.length}`,
        lat: camera.latitude,
        lng: camera.longitude,
        name: camera.description || 'FL-511 Camera',
        city: 'Florida',
        country: 'US',
        feed_url: camera.imageUrl || '',
        source: 'FL-511',
      });
    }
  } catch {
    // Static cameras still provide a usable layer.
  }
  return cameras.filter((camera) => camera.lat && camera.lng);
}

async function fetchUsCentralCameras() {
  try {
    const data = await fetchJson('https://www.travelmidwest.com/lmiga/cameraReport.json', { signal: AbortSignal.timeout(8000) });
    return (data?.cameraReports || data || []).slice(0, 800).map((camera, index) => ({
      id: `ildot-${index}`,
      lat: camera.latitude,
      lng: camera.longitude,
      name: camera.cameraName || camera.description || 'IDOT Camera',
      city: 'Illinois',
      country: 'US',
      feed_url: camera.imageUrl || camera.url || '',
      source: 'IDOT',
    })).filter((camera) => camera.lat && camera.lng);
  } catch {
    return [];
  }
}

async function fetchEuropeCameras() {
  try {
    const data = await fetchJson('https://opendata.ndw.nu/cameras.json', { signal: AbortSignal.timeout(8000) });
    return (data || []).slice(0, 1000).map((camera, index) => ({
      id: `nl-${index}`,
      lat: camera.lat,
      lng: camera.lng,
      name: camera.name || 'NL Camera',
      city: 'Netherlands',
      country: 'NL',
      feed_url: camera.imageUrl || '',
      source: 'RWS',
    })).filter((camera) => camera.lat && camera.lng);
  } catch {
    return [];
  }
}

async function fetchAsiaCameras() {
  try {
    const data = await fetchJson('https://api.data.gov.sg/v1/transport/traffic-images', { signal: AbortSignal.timeout(10000) });
    return (data.items?.[0]?.cameras || []).map((camera) => ({
      id: `sin-${camera.camera_id}`,
      lat: camera.location?.latitude,
      lng: camera.location?.longitude,
      name: `Camera ${camera.camera_id}`,
      city: 'Singapore',
      country: 'Singapore',
      feed_url: camera.image,
      source: 'LTA Singapore',
    })).filter((camera) => camera.lat && camera.lng && camera.feed_url);
  } catch {
    return [];
  }
}

const stateCentroids = {
  AL: [32.8067, -86.7911], AK: [61.3707, -152.4044], AZ: [33.7298, -111.4312], AR: [34.9697, -92.3731],
  CA: [36.1162, -119.6816], CO: [39.0598, -105.3111], CT: [41.5978, -72.7554], DE: [39.3185, -75.5071],
  DC: [38.9072, -77.0369], FL: [27.7663, -81.6868], GA: [33.0406, -83.6431], HI: [21.0943, -157.4983],
  ID: [44.2405, -114.4788], IL: [40.3495, -88.9861], IN: [39.8494, -86.2583], IA: [42.0115, -93.2105],
  KS: [38.5266, -96.7265], KY: [37.6681, -84.6701], LA: [31.1695, -91.8678], ME: [44.6939, -69.3819],
  MD: [39.0639, -76.8021], MA: [42.2302, -71.5301], MI: [43.3266, -84.5361], MN: [45.6945, -93.9002],
  MS: [32.7416, -89.6787], MO: [38.4561, -92.2884], MT: [46.9219, -110.4544], NE: [41.1254, -98.2681],
  NV: [38.3135, -117.0554], NH: [43.4525, -71.5639], NJ: [40.2989, -74.5210], NM: [34.8405, -106.2485],
  NY: [42.1657, -74.9481], NC: [35.6301, -79.8064], ND: [47.5289, -99.7840], OH: [40.3888, -82.7649],
  OK: [35.5653, -96.9289], OR: [44.5720, -122.0709], PA: [40.5908, -77.2098], RI: [41.6809, -71.5118],
  SC: [33.8569, -80.9450], SD: [44.2998, -99.4388], TN: [35.7478, -86.6923], TX: [31.0545, -97.5635],
  UT: [40.1500, -111.8624], VT: [44.0459, -72.7107], VA: [37.7693, -78.1700], WA: [47.4009, -121.4905],
  WV: [38.4912, -80.9545], WI: [44.2685, -89.6165], WY: [42.7560, -107.3025],
};

const stateCapitals = {
  AL: ['Montgomery', 32.3777, -86.3000], AK: ['Juneau', 58.3019, -134.4197], AZ: ['Phoenix', 33.4484, -112.0740],
  AR: ['Little Rock', 34.7465, -92.2896], CA: ['Sacramento', 38.5816, -121.4944], CO: ['Denver', 39.7392, -104.9903],
  CT: ['Hartford', 41.7658, -72.6734], DE: ['Dover', 39.1582, -75.5244], DC: ['Washington', 38.9072, -77.0369],
  FL: ['Tallahassee', 30.4383, -84.2807], GA: ['Atlanta', 33.7490, -84.3880], HI: ['Honolulu', 21.3069, -157.8583],
  ID: ['Boise', 43.6150, -116.2023], IL: ['Springfield', 39.7817, -89.6501], IN: ['Indianapolis', 39.7684, -86.1581],
  IA: ['Des Moines', 41.5868, -93.6250], KS: ['Topeka', 39.0473, -95.6752], KY: ['Frankfort', 38.2009, -84.8733],
  LA: ['Baton Rouge', 30.4515, -91.1871], ME: ['Augusta', 44.3106, -69.7795], MD: ['Annapolis', 38.9784, -76.4922],
  MA: ['Boston', 42.3601, -71.0589], MI: ['Lansing', 42.7325, -84.5555], MN: ['Saint Paul', 44.9537, -93.0900],
  MS: ['Jackson', 32.2988, -90.1848], MO: ['Jefferson City', 38.5767, -92.1735], MT: ['Helena', 46.5891, -112.0391],
  NE: ['Lincoln', 40.8136, -96.7026], NV: ['Carson City', 39.1638, -119.7674], NH: ['Concord', 43.2081, -71.5376],
  NJ: ['Trenton', 40.2206, -74.7597], NM: ['Santa Fe', 35.6870, -105.9378], NY: ['Albany', 42.6526, -73.7562],
  NC: ['Raleigh', 35.7796, -78.6382], ND: ['Bismarck', 46.8083, -100.7837], OH: ['Columbus', 39.9612, -82.9988],
  OK: ['Oklahoma City', 35.4676, -97.5164], OR: ['Salem', 44.9429, -123.0351], PA: ['Harrisburg', 40.2732, -76.8867],
  RI: ['Providence', 41.8240, -71.4128], SC: ['Columbia', 34.0007, -81.0348], SD: ['Pierre', 44.3683, -100.3510],
  TN: ['Nashville', 36.1627, -86.7816], TX: ['Austin', 30.2672, -97.7431], UT: ['Salt Lake City', 40.7608, -111.8910],
  VT: ['Montpelier', 44.2601, -72.5754], VA: ['Richmond', 37.5407, -77.4360], WA: ['Olympia', 47.0379, -122.9007],
  WV: ['Charleston', 38.3498, -81.6326], WI: ['Madison', 43.0731, -89.4012], WY: ['Cheyenne', 41.1400, -104.8202],
};

const stateCodes = new Set(Object.keys(stateCentroids));
const stateNameToCode = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
  kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN',
  texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};
const placeNameToState = {
  chicago: 'IL', syracuse: 'NY', buffalo: 'NY', stockton: 'CA', hawaii: 'HI', 'kansas city': 'KS',
  baltimore: 'MD', boston: 'MA', philadelphia: 'PA', cleveland: 'OH', detroit: 'MI', denver: 'CO',
  atlanta: 'GA', dallas: 'TX', houston: 'TX', phoenix: 'AZ', seattle: 'WA', portland: 'OR',
};

function deriveStateFromAward(awardId = '', recipientState = '') {
  if (stateCodes.has(recipientState)) return recipientState;
  const prefix = String(awardId).slice(0, 2).toUpperCase();
  return stateCodes.has(prefix) ? prefix : 'DC';
}

function inferStateFromText(text = '') {
  const lower = String(text).toLowerCase();
  const normalized = lower.replace(/\./g, '');
  for (const [name, code] of Object.entries(stateNameToCode)) {
    if (normalized.includes(name)) return code;
  }
  for (const [name, code] of Object.entries(placeNameToState)) {
    if (normalized.includes(name)) return code;
  }
  const codeMatch = normalized.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i);
  return codeMatch && stateCodes.has(codeMatch[0].toUpperCase()) ? codeMatch[0].toUpperCase() : '';
}

function stateCodeFromName(name = '') {
  return stateNameToCode[String(name).toLowerCase()] || '';
}

function centroidForState(state) {
  const [lat, lng] = stateCentroids[state] || stateCentroids.DC;
  return { lat, lng };
}

function capitalForState(state) {
  const [city, lat, lng] = stateCapitals[state] || stateCapitals.DC;
  return { city, lat, lng };
}

function fallbackCoordsForState(state) {
  const capital = capitalForState(stateCodes.has(state) ? state : 'DC');
  return { lat: capital.lat, lng: capital.lng, city: capital.city };
}

function normalizePointOrg(input) {
  const state = String(input.state || '').toUpperCase();
  const fallback = fallbackCoordsForState(state);
  const lat = Number(input.lat ?? fallback.lat);
  const lng = Number(input.lng ?? fallback.lng);
  return {
    id: input.id || md5(`${input.category}:${input.name}:${input.city || fallback.city}:${state}`),
    name: input.name || 'Unknown Organization',
    category: input.category,
    subtype: input.subtype || input.category,
    city: input.city || fallback.city,
    state: stateCodes.has(state) ? state : 'DC',
    county: input.county || '',
    lat: Number.isFinite(lat) ? lat : fallback.lat,
    lng: Number.isFinite(lng) ? lng : fallback.lng,
    source: input.source || '',
    source_id: input.source_id || '',
    website: input.website || '',
    phone: input.phone || '',
    data_confidence: Number(input.data_confidence || (input.lat && input.lng ? 90 : 55)),
    last_updated: new Date().toISOString(),
    ...input.extra,
  };
}

function careerOneStopConfig() {
  return {
    userId: process.env.CAREERONESTOP_USER_ID || process.env.COS_USER_ID || '',
    token: process.env.CAREERONESTOP_API_TOKEN || process.env.COS_API_TOKEN || '',
  };
}

async function fetchCareerOneStopJson(path) {
  const { userId, token } = careerOneStopConfig();
  if (!userId || !token) return null;
  return fetchJson(`https://api.careeronestop.org/v1/${path.replace('{userId}', encodeURIComponent(userId))}`, {
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
}

function normalizeOrgName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|incorporated|llc|corp|corporation|corporate|company|co|the|of|and)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantNameTokens(name = '') {
  return normalizeOrgName(name).split(' ').filter((token) => token.length > 2);
}

async function writeCollection(collectionName, records) {
  let batch = db.batch();
  let writes = 0;
  for (const record of records) {
    batch.set(db.collection(collectionName).doc(record.id), record, { merge: true });
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return records.length;
}

async function clearCollection(collectionName, limit = 10000) {
  const snap = await db.collection(collectionName).limit(limit).get();
  let batch = db.batch();
  let writes = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return snap.size;
}

async function clearCollectionWhereState(collectionName, state, limit = 10000) {
  if (!stateCodes.has(state)) return 0;
  const snap = await db.collection(collectionName).where('state', '==', state).limit(limit).get();
  let batch = db.batch();
  let writes = 0;
  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return snap.size;
}

async function geocodeOrganizationByName(name) {
  const queries = [
    `${name}, United States`,
    name,
  ];
  for (const q of queries) {
    try {
      const params = new URLSearchParams({
        q,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '1',
        countrycodes: 'us',
      });
      const results = await fetchJson(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'AutoNateAI-Intel/1.0 (https://intel.autonateai.com)' },
      });
      const hit = Array.isArray(results) ? results[0] : null;
      if (!hit) continue;
      const address = hit.address || {};
      const state = String(address.state_code || stateCodeFromName(address.state) || inferStateFromText(hit.display_name || '') || '').toUpperCase();
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      if (!stateCodes.has(state) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      return {
        city: address.city || address.town || address.village || address.hamlet || address.county || capitalForState(state).city,
        state,
        county: address.county || '',
        lat,
        lng,
        geocode_display_name: hit.display_name || '',
        geocode_source: 'OpenStreetMap Nominatim organization search',
        data_confidence: 78,
      };
    } catch (err) {
      console.warn('[AutoNateAI Intel Functions] Organization geocode failed', name, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

async function geocodeUsAddress(parts = []) {
  const address = parts.filter(Boolean).join(' ');
  if (!address) return null;
  try {
    const params = new URLSearchParams({
      address,
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const data = await fetchJson(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params.toString()}`, { signal: AbortSignal.timeout(10000) });
    const hit = data.result?.addressMatches?.[0];
    const coords = hit?.coordinates;
    if (!coords || !Number.isFinite(Number(coords.x)) || !Number.isFinite(Number(coords.y))) return null;
    return {
      lat: Number(coords.y),
      lng: Number(coords.x),
      geocode_source: 'US Census Geocoder',
      geocode_match: hit.matchedAddress || '',
    };
  } catch (err) {
    console.warn('[AutoNateAI Intel Functions] Census geocode failed', address, err instanceof Error ? err.message : err);
    return null;
  }
}

const publicWorkforceCenterSeeds = [
  { name: 'Virginia Workforce Center - Alexandria Cherokee Avenue', address: '5520 Cherokee Ave Suite 100', city: 'Alexandria', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Alexandria Mark Center', address: '4850 Mark Center Drive Suite 100', city: 'Alexandria', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Arlington County', address: '2100 Washington Boulevard First Floor', city: 'Arlington', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Bristol', address: '300 Towne Center Drive Suite 40', city: 'Bristol', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Charlottesville', address: '944 Glenwood Station Lane Suite 103', city: 'Charlottesville', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Chesterfield Turner Road', address: '304 Turner Rd Suite N', city: 'Richmond', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Covington', address: '106 North Maple Avenue', city: 'Covington', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Culpeper', address: '210 E Stevens St', city: 'Culpeper', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Danville', address: '211 Nor Dan Drive Suite 1055', city: 'Danville', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Eastern Shore', address: '25036 Lankford Highway Unit 16', city: 'Onley', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Emporia', address: '321 Halifax Street', city: 'Emporia', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Fishersville', address: '1076 Jefferson Hwy', city: 'Fishersville', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Fredericksburg', address: '10304 Spotsylvania Avenue Suite 100', city: 'Fredericksburg', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Galax', address: '1117 East Stuart Drive Suite 167', city: 'Galax', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Workforce Center - Hampton', address: '600 Butler Farm Road Suite B', city: 'Hampton', state: 'VA', source_url: 'https://virginiaworks.gov/locations/' },
  { name: 'Virginia Career Works - Henrico Center', address: '121 Cedar Fork Road', city: 'Henrico', state: 'VA', source_url: 'https://www.reddit.com/r/rva/comments/1tlqlc5/virginia_career_works_henrico_centers_may_2026/' },
  { name: 'SEMCA Michigan Works! American Job Center - Wyandotte', address: '2121 Biddle Ave', city: 'Wyandotte', state: 'MI', phone: '734-362-3466', source_url: 'https://www.semcamiworks.org/american-job-centers/' },
  { name: 'SEMCA Michigan Works! American Job Center - Dearborn', address: '6451 Schaefer Rd 2nd Floor', city: 'Dearborn', state: 'MI', phone: '313-203-3366', source_url: 'https://www.semcamiworks.org/american-job-centers/' },
  { name: 'SEMCA Michigan Works! American Job Center - Highland Park', address: '144 Manchester St', city: 'Highland Park', state: 'MI', phone: '313-826-0299', source_url: 'https://www.semcamiworks.org/american-job-centers/' },
  { name: 'SEMCA Michigan Works! American Job Center - Monroe', address: '1531 N Telegraph Rd Ste D', city: 'Monroe', state: 'MI', phone: '734-240-7950', source_url: 'https://www.semcamiworks.org/american-job-centers/' },
  { name: 'SEMCA Michigan Works! American Job Center - Southgate', address: '15100 Northline Rd', city: 'Southgate', state: 'MI', phone: '734-362-3466', source_url: 'https://www.semcamiworks.org/american-job-centers/' },
  { name: 'SEMCA Michigan Works! American Job Center - Wayne', address: '35731 W Michigan Ave', city: 'Wayne', state: 'MI', phone: '734-858-4284', source_url: 'https://www.semcamiworks.org/american-job-centers/' },
  { name: 'Michigan Works! Berrien, Cass, Van Buren - Benton Harbor Service Center', address: '499 W Main Street', city: 'Benton Harbor', state: 'MI', phone: '1-800-285-WORKS', source_url: 'https://www.miworks.org/public-information' },
  { name: 'Michigan Works! Berrien, Cass, Van Buren - Paw Paw Service Center', address: '32849 E Red Arrow Hwy #100', city: 'Paw Paw', state: 'MI', phone: '1-800-285-WORKS', source_url: 'https://www.miworks.org/public-information' },
  { name: 'Michigan Works! Berrien, Cass, Van Buren - Cassopolis Service Center', address: '120 N Broadway 1st Floor', city: 'Cassopolis', state: 'MI', phone: '1-800-285-WORKS', source_url: 'https://www.miworks.org/public-information' },
  { name: 'West Michigan Works! Service Center - Grand Rapids Franklin', address: '121 Franklin St SE', city: 'Grand Rapids', state: 'MI', source_url: 'https://www.westmiworks.org/locations/' },
  { name: 'West Michigan Works! Service Center - Grand Rapids Leonard', address: '215 Straight Ave NW', city: 'Grand Rapids', state: 'MI', source_url: 'https://www.westmiworks.org/locations/' },
];

const workforceSubrecipientLocationSeeds = {
  'area community services employment and training council': { city: 'Grand Rapids', state: 'MI', lat: 42.9634, lng: -85.6681, source: 'known Michigan Works regional operator' },
  'area community services employment training council': { city: 'Grand Rapids', state: 'MI', lat: 42.9634, lng: -85.6681, source: 'known Michigan Works regional operator' },
  'west michigan works': { city: 'Grand Rapids', state: 'MI', lat: 42.9634, lng: -85.6681, source: 'known Michigan Works regional operator' },
  'w e upjohn unemployment trustee corporation': { city: 'Kalamazoo', state: 'MI', lat: 42.2917, lng: -85.5872, source: 'known Michigan workforce intermediary' },
  'w. e. upjohn unemployment trustee corporation': { city: 'Kalamazoo', state: 'MI', lat: 42.2917, lng: -85.5872, source: 'known Michigan workforce intermediary' },
  'w e upjohn unemployment trustee': { city: 'Kalamazoo', state: 'MI', lat: 42.2917, lng: -85.5872, source: 'known Michigan workforce intermediary' },
  'detroit employment solutions corporation': { city: 'Detroit', state: 'MI', lat: 42.3314, lng: -83.0458, source: 'known local workforce board' },
  'gst michigan works': { city: 'Flint', state: 'MI', lat: 43.0125, lng: -83.6875, source: 'known Michigan Works regional operator' },
  'southeast michigan community alliance inc': { city: 'Taylor', state: 'MI', lat: 42.2409, lng: -83.2697, source: 'known Michigan Works regional operator' },
  'southeast michigan community alliance, inc': { city: 'Taylor', state: 'MI', lat: 42.2409, lng: -83.2697, source: 'known Michigan Works regional operator' },
  'county of macomb': { city: 'Mount Clemens', state: 'MI', lat: 42.5973, lng: -82.8780, source: 'county seat' },
  'virginia employment commission': { city: 'Richmond', state: 'VA', lat: 37.5407, lng: -77.4360, source: 'state workforce agency' },
  'city of virginia beach': { city: 'Virginia Beach', state: 'VA', lat: 36.8529, lng: -75.9780, source: 'city centroid' },
  'county of henrico': { city: 'Henrico', state: 'VA', lat: 37.5059, lng: -77.3324, source: 'county centroid' },
  'county of pulaski': { city: 'Pulaski', state: 'VA', lat: 37.0479, lng: -80.7798, source: 'county seat' },
  'southwestern community action council': { city: 'Cedar Bluff', state: 'VA', lat: 37.0876, lng: -81.7657, source: 'known community action region' },
  'southwestern community action council inc': { city: 'Cedar Bluff', state: 'VA', lat: 37.0876, lng: -81.7657, source: 'known community action region' },
  'lee county va': { city: 'Jonesville', state: 'VA', lat: 36.6887, lng: -83.1110, source: 'county seat' },
  'pittsylvania county of': { city: 'Chatham', state: 'VA', lat: 36.8257, lng: -79.3981, source: 'county seat' },
  'county of richmond': { city: 'Warsaw', state: 'VA', lat: 37.9587, lng: -76.7580, source: 'county seat' },
  'greater peninsula workforce development consortium': { city: 'Hampton', state: 'VA', lat: 37.0299, lng: -76.3452, source: 'known workforce region' },
  'city of lynchburg': { city: 'Lynchburg', state: 'VA', lat: 37.4138, lng: -79.1422, source: 'city centroid' },
  'city of roanoke': { city: 'Roanoke', state: 'VA', lat: 37.2710, lng: -79.9414, source: 'city centroid' },
  'theskillsource group': { city: 'Vienna', state: 'VA', lat: 38.9012, lng: -77.2653, source: 'known workforce intermediary' },
  'the skillsource group': { city: 'Vienna', state: 'VA', lat: 38.9012, lng: -77.2653, source: 'known workforce intermediary' },
  'the skillsource group inc': { city: 'Vienna', state: 'VA', lat: 38.9012, lng: -77.2653, source: 'known workforce intermediary' },
  'county of charlotte': { city: 'Charlotte Court House', state: 'VA', lat: 37.0568, lng: -78.6383, source: 'county seat' },
  'city of charlottesville': { city: 'Charlottesville', state: 'VA', lat: 38.0293, lng: -78.4767, source: 'city centroid' },
  'page county government': { city: 'Luray', state: 'VA', lat: 38.6654, lng: -78.4595, source: 'county seat' },
  'county of arlington': { city: 'Arlington', state: 'VA', lat: 38.8816, lng: -77.0910, source: 'county centroid' },
  'city of petersburg': { city: 'Petersburg', state: 'VA', lat: 37.2279, lng: -77.4019, source: 'city centroid' },
  'county of page virginia': { city: 'Luray', state: 'VA', lat: 38.6654, lng: -78.4595, source: 'county seat' },
  'peninsula family service': { city: 'Newport News', state: 'VA', lat: 37.0871, lng: -76.4730, source: 'known service area' },
  'county of prince george': { city: 'Prince George', state: 'VA', lat: 37.2204, lng: -77.2883, source: 'county seat near Hopewell' },
  'commonwealth of virginia state board of education': { city: 'Richmond', state: 'VA', lat: 37.5407, lng: -77.4360, source: 'state agency' },
  'city of hopewell': { city: 'Hopewell', state: 'VA', lat: 37.3043, lng: -77.2872, source: 'city centroid' },
  'hopewell city': { city: 'Hopewell', state: 'VA', lat: 37.3043, lng: -77.2872, source: 'city centroid' },
};

function workforceSubrecipientSeedForKey(key) {
  return Object.entries(workforceSubrecipientLocationSeeds)
    .find(([seedKey]) => normalizeOrgName(seedKey) === key)?.[1] || null;
}

async function enrichFundedFaithLocations(limit = 100) {
  const snap = await db.collection('funded_faith_orgs').limit(Math.min(limit, 500)).get();
  const inferredUpdates = [];
  const geocodeCandidates = [];
  for (const doc of snap.docs) {
    const org = doc.data();
    const weakLocation = org.state === 'DC' && (!org.city || org.city === 'Washington') && !org.geocode_source;
    if (!weakLocation) continue;
    const inferredState = inferStateFromText(org.name || '');
    if (inferredState && inferredState !== 'DC') {
      const capital = capitalForState(inferredState);
      inferredUpdates.push({
        ref: doc.ref,
        data: {
          city: capital.city,
          state: inferredState,
          lat: capital.lat,
          lng: capital.lng,
          data_confidence: Math.max(Number(org.data_confidence || 0), 62),
          geocode_source: 'recipient-name state inference',
          last_updated: new Date().toISOString(),
        },
      });
      continue;
    }
    geocodeCandidates.push({ ref: doc.ref, org });
  }
  let batch = db.batch();
  let writes = 0;
  for (const update of inferredUpdates) {
    batch.set(update.ref, update.data, { merge: true });
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();

  const geocodeUpdates = [];
  for (const { ref, org } of geocodeCandidates.slice(0, 15)) {
    const geocoded = await geocodeOrganizationByName(org.name);
    if (geocoded) {
      geocodeUpdates.push({
        ref,
        data: {
          ...geocoded,
          last_updated: new Date().toISOString(),
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  }
  batch = db.batch();
  writes = 0;
  for (const update of geocodeUpdates) {
    batch.set(update.ref, update.data, { merge: true });
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return { scanned: snap.size, inferred: inferredUpdates.length, geocoded: geocodeUpdates.length, updated: inferredUpdates.length + geocodeUpdates.length, remaining_geocode_candidates: Math.max(0, geocodeCandidates.length - 15) };
}

function normalizeHudAward(row) {
  const awardId = row['Award ID'] || row.generated_internal_id || String(row.internal_id || crypto.randomUUID());
  const state = deriveStateFromAward(awardId, row['Recipient State']);
  const coords = centroidForState(state);
  return {
    id: md5(`hud:${awardId}:${row['Start Date'] || ''}:${row['Award Amount'] || 0}`),
    award_id: awardId,
    participant_code: String(awardId).slice(0, 5).toUpperCase(),
    recipient_name: row['Recipient Name'] || 'Unknown PHA',
    recipient_city: row['Recipient City'] || '',
    recipient_state: state,
    recipient_zip: row['Recipient ZIP Code'] || '',
    start_date: row['Start Date'] || '',
    end_date: row['End Date'] || '',
    amount: Number(row['Award Amount'] || 0),
    awarding_agency: row['Awarding Agency'] || '',
    awarding_subagency: row['Awarding Sub Agency'] || '',
    funding_agency: row['Funding Agency'] || '',
    funding_subagency: row['Funding Sub Agency'] || '',
    award_type: row['Award Type'] || '',
    cfda_number: row['CFDA Number'] || '',
    program_title: row['CFDA Program Title'] || row['Funding Sub Agency'] || 'HUD Program',
    lat: coords.lat,
    lng: coords.lng,
    source: 'USAspending',
    updated_at: new Date().toISOString(),
  };
}

function daysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 86400000);
}

function distanceMiles(a, b) {
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function decoratePhaForMap(pha, recentAwards = []) {
  const latestAward = recentAwards
    .filter((award) => award.participant_code && award.participant_code === pha.participant_code)
    .sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))[0];
  const latestDate = latestAward?.start_date || pha.latest_award_date || '';
  const latestEndDate = latestAward?.end_date || '';
  const daysSinceLatest = latestDate ? Math.max(0, Math.round((Date.now() - new Date(latestDate).getTime()) / 86400000)) : 99999;
  const recencyScore = Math.max(0, Math.min(100, 100 - (daysSinceLatest / 1095) * 100));
  const spendWindowDays = daysBetween(latestDate, latestEndDate);
  const amountScore = Math.min(100, Math.log10(Math.max(Number(pha.total_amount || 0), 1)) * 10);
  const countScore = Math.min(100, Math.log10(Math.max(Number(pha.award_count || 0), 1) + 1) * 32);
  const windowScore = Math.min(100, Math.log10(Math.max(spendWindowDays, 1)) * 24);
  const flow_score = Math.round((recencyScore * 0.42) + (amountScore * 0.28) + (countScore * 0.2) + (windowScore * 0.1));
  const flow_bucket = recencyScore >= 80 ? 'fresh' : recencyScore >= 45 ? 'active' : recencyScore >= 10 ? 'aging' : 'dormant';
  return {
    ...pha,
    latest_award_date: latestDate,
    latest_award_end_date: latestEndDate,
    latest_award_amount: Number(latestAward?.amount || 0),
    latest_award_program: latestAward?.program_title || '',
    days_since_latest_award: daysSinceLatest,
    spend_window_days: spendWindowDays,
    recency_score: Math.round(recencyScore),
    flow_score,
    flow_bucket,
  };
}

async function recomputePhaFundingProfiles() {
  const [phaSnap, awardSnap, sbirSnap] = await Promise.all([
    db.collection('hud_phas').limit(5000).get(),
    db.collection('hud_pha_awards').orderBy('start_date', 'desc').limit(2000).get(),
    db.collection('sbir_recipients').limit(25000).get(),
  ]);
  const awards = awardSnap.docs.map((doc) => doc.data());
  const sbirRecipients = sbirSnap.docs.map((doc) => doc.data()).filter((row) => Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng)));
  let batch = db.batch();
  let writes = 0;
  const now = new Date().toISOString();
  for (const doc of phaSnap.docs) {
    const pha = doc.data();
    const scored = decoratePhaForMap(pha, awards);
    const phaAwards = awards.filter((award) => award.participant_code && award.participant_code === pha.participant_code);
    const annualHudFunding = Number(pha.opfund_amount || 0) + Number(pha.capfund_amount || 0) + Number(scored.total_amount || pha.total_amount || 0);
    const totalUnits = Number(pha.total_units || 0);
    const profile = {
      pha_code: pha.participant_code || pha.id,
      fiscal_year: new Date().getUTCFullYear(),
      total_units: totalUnits,
      public_housing_units: Math.max(0, totalUnits - Number(pha.section8_units || 0)),
      section8_units: Number(pha.section8_units || 0),
      program_type: pha.program_type || '',
      opfund_amount: Number(pha.opfund_amount || 0),
      opfund_year: new Date().getUTCFullYear(),
      opfund_source: 'HUD Public Housing Authority GIS roster',
      capitalfund_amount: Number(pha.capfund_amount || 0),
      capitalfund_year: new Date().getUTCFullYear(),
      capitalfund_source: 'HUD Public Housing Authority GIS roster',
      hcv_vouchers: Number(pha.section8_units || 0),
      hcv_budget_authority: 0,
      usaspending_award_count: Number(pha.award_count || phaAwards.length || 0),
      usaspending_total_obligations: Number(pha.total_amount || 0),
      latest_award_date: scored.latest_award_date || '',
      congressional_district: '',
      county_fips: '',
      census_tract: '',
      annual_hud_funding: annualHudFunding,
      funding_per_unit: totalUnits ? annualHudFunding / totalUnits : 0,
      section8_ratio: totalUnits ? Number(pha.section8_units || 0) / totalUnits : 0,
      opportunity_score: Math.min(100, Math.round(
        Math.min(annualHudFunding / 1000000, 35) +
        Math.min(totalUnits / 100, 20) +
        Math.min(Number(pha.section8_units || 0) / Math.max(totalUnits, 1) * 20, 20) +
        Number(scored.flow_score || 0) * 0.25
      )),
      last_updated: now,
      data_confidence: pha.participant_code ? 0.82 : 0.55,
      match_strategy: ['HUD PHA code', 'HUD participant code', 'state', 'city'],
    };
    const nearby = { sbir_awards_10mi: 0, sbir_awards_25mi: 0, sbir_awards_50mi: 0, unique10: new Set(), unique25: new Set(), unique50: new Set(), investment25: 0 };
    for (const recipient of sbirRecipients) {
      if (recipient.state_code && pha.state && recipient.state_code !== pha.state) continue;
      const dist = distanceMiles(pha, recipient);
      if (dist <= 50) {
        nearby.sbir_awards_50mi += Number(recipient.award_count || 0);
        nearby.unique50.add(recipient.id || recipient.name);
      }
      if (dist <= 25) {
        nearby.sbir_awards_25mi += Number(recipient.award_count || 0);
        nearby.unique25.add(recipient.id || recipient.name);
        nearby.investment25 += Number(recipient.total_awarded || 0);
      }
      if (dist <= 10) {
        nearby.sbir_awards_10mi += Number(recipient.award_count || 0);
        nearby.unique10.add(recipient.id || recipient.name);
      }
    }
    const ecosystem = {
      pha_code: profile.pha_code,
      sbir_awards_10mi: nearby.sbir_awards_10mi,
      sbir_awards_25mi: nearby.sbir_awards_25mi,
      sbir_awards_50mi: nearby.sbir_awards_50mi,
      unique_sbir_companies_10mi: nearby.unique10.size,
      unique_sbir_companies_25mi: nearby.unique25.size,
      unique_sbir_companies_50mi: nearby.unique50.size,
      universities_25mi: 0,
      community_colleges_25mi: 0,
      hospitals_25mi: 0,
      total_federal_investment_25mi: Math.round((nearby.investment25 + annualHudFunding) * 100) / 100,
      last_updated: now,
      data_confidence: profile.data_confidence,
    };
    batch.set(db.collection('pha_funding_profile').doc(`${profile.pha_code}-${profile.fiscal_year}`), profile, { merge: true });
    batch.set(db.collection('pha_ecosystem_summary').doc(profile.pha_code), ecosystem, { merge: true });
    writes += 2;
    if (writes >= 440) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return { profiles: phaSnap.size, awards: awards.length, sbir_recipients: sbirRecipients.length };
}

async function recomputeHudPhaScores() {
  const [phaSnap, awardSnap] = await Promise.all([
    db.collection('hud_phas').limit(5000).get(),
    db.collection('hud_pha_awards').orderBy('start_date', 'desc').limit(2000).get(),
  ]);
  const awards = awardSnap.docs.map((doc) => doc.data());
  let batch = db.batch();
  let writes = 0;
  for (const doc of phaSnap.docs) {
    const scored = decoratePhaForMap(doc.data(), awards);
    batch.set(doc.ref, {
      latest_award_date: scored.latest_award_date || '',
      latest_award_end_date: scored.latest_award_end_date || '',
      latest_award_amount: Number(scored.latest_award_amount || 0),
      latest_award_program: scored.latest_award_program || '',
      days_since_latest_award: Number(scored.days_since_latest_award || 99999),
      spend_window_days: Number(scored.spend_window_days || 0),
      recency_score: Number(scored.recency_score || 0),
      flow_score: Number(scored.flow_score || 0),
      flow_bucket: scored.flow_bucket || 'dormant',
      scored_at: new Date().toISOString(),
    }, { merge: true });
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
  return { phas: phaSnap.size, awards: awards.length };
}

async function fetchHudPhaRoster() {
  const data = await fetchJson('https://opendata.arcgis.com/api/v3/datasets/3d6ef39026b94eb59ddb7ce28eb0b692_0/downloads/data?format=geojson&spatialRefId=4326&where=1%3D1', {
    signal: AbortSignal.timeout(30000),
  });
  return (data.features || []).map((feature) => {
    const props = feature.properties || {};
    const [lng, lat] = feature.geometry?.coordinates || [null, null];
    const code = props.PARTICIPANT_CODE || String(props.OBJECTID || crypto.randomUUID());
    return {
      id: `hud-${code}`,
      participant_code: code,
      name: props.FORMAL_PARTICIPANT_NAME || 'Unknown PHA',
      state: code.slice(0, 2),
      city: props.STD_CITY || '',
      address: props.STD_ADDR || '',
      zip: props.STD_ZIP5 || '',
      email: props.HA_EMAIL_ADDR_TEXT || props.EXEC_DIR_EMAIL || '',
      phone: props.HA_PHN_NUM || props.EXEC_DIR_PHONE || '',
      program_type: props.HA_PROGRAM_TYPE || '',
      section8_units: Number(props.SECTION8_UNITS_CNT || 0),
      total_units: Number(props.PHA_TOTAL_UNITS || props.TOTAL_UNITS || 0),
      occupied_units: Number(props.TOTAL_OCCUPIED || 0),
      opfund_amount: Number(props.OPFUND_AMNT || 0),
      capfund_amount: Number(props.CAPFUND_AMNT || 0),
      ross_amount: Number(props.ROSS_AMNT || 0),
      fss_amount: Number(props.FSS_AMNT || 0),
      hud_profile_spending_per_month: Number(props.SPENDING_PER_MONTH || 0),
      total_amount: 0,
      award_count: 0,
      programs: {},
      lat: typeof lat === 'number' ? lat : centroidForState(code.slice(0, 2)).lat,
      lng: typeof lng === 'number' ? lng : centroidForState(code.slice(0, 2)).lng,
      source: 'HUD Public Housing Authorities GIS',
      roster_updated_at: new Date().toISOString(),
    };
  }).filter((pha) => pha.lat && pha.lng);
}

async function persistHudPhaRoster(roster) {
  let batch = db.batch();
  let writes = 0;
  for (const pha of roster) {
    batch.set(db.collection('hud_phas').doc(pha.id), pha, { merge: true });
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

async function searchHudPhaAwards(startDate, endDate, limit = 100, maxPages = 3) {
  const awards = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = {
      filters: {
        award_type_codes: ['02', '03', '04', '05'],
        time_period: [{ start_date: startDate, end_date: endDate }],
        agencies: [{ type: 'funding', tier: 'toptier', name: 'Department of Housing and Urban Development' }],
        keyword: 'housing authority',
      },
      fields: ['Award ID', 'Recipient Name', 'Recipient City', 'Recipient State', 'Recipient ZIP Code', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'Funding Agency', 'Funding Sub Agency', 'Award Type', 'CFDA Number', 'CFDA Program Title'],
      sort: 'Start Date',
      order: 'desc',
      limit,
      page,
    };
    const data = await fetchJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const results = data.results || [];
    awards.push(...results.map(normalizeHudAward));
    if (!results.length || !data.page_metadata?.hasNext) break;
  }
  return awards;
}

async function persistHudAwards(awards) {
  let batch = db.batch();
  let writes = 0;
  const phaTotals = new Map();
  for (const award of awards) {
    batch.set(db.collection('hud_pha_awards').doc(award.id), award, { merge: true });
    writes++;
    const phaId = `hud-${award.participant_code || md5(`${award.recipient_name}:${award.recipient_state}`)}`;
    const current = phaTotals.get(phaId) || {
      id: phaId,
      name: award.recipient_name,
      state: award.recipient_state,
      lat: award.lat,
      lng: award.lng,
      total_amount: 0,
      award_count: 0,
      programs: {},
      latest_award_date: award.start_date,
      updated_at: new Date().toISOString(),
    };
    current.total_amount += award.amount;
    current.award_count += 1;
    current.programs[award.cfda_number || award.program_title || 'unknown'] = award.program_title || award.cfda_number || 'HUD Program';
    if ((award.start_date || '') > (current.latest_award_date || '')) current.latest_award_date = award.start_date;
    phaTotals.set(phaId, current);
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  for (const pha of phaTotals.values()) {
    batch.set(db.collection('hud_phas').doc(pha.id), {
      id: pha.id,
      name: pha.name,
      state: pha.state,
      lat: pha.lat,
      lng: pha.lng,
      total_amount: FieldValue.increment(pha.total_amount),
      award_count: FieldValue.increment(pha.award_count),
      programs: pha.programs,
      latest_award_date: pha.latest_award_date,
      updated_at: pha.updated_at,
    }, { merge: true });
    writes++;
    if (writes >= 450) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes) await batch.commit();
}

function schoolOwnership(value) {
  return { 1: 'Public', 2: 'Private nonprofit', 3: 'Private for-profit' }[Number(value)] || 'Unknown';
}

function predominantDegree(value) {
  return { 0: 'Non-degree', 1: 'Certificate', 2: 'Associate', 3: 'Bachelor', 4: 'Graduate' }[Number(value)] || 'Unknown';
}

async function fetchEducationOrgs(limit = 1000, state = '') {
  const perPage = Math.min(100, limit);
  const pages = Math.ceil(Math.min(limit, 5000) / perPage);
  const apiKey = process.env.DATA_GOV_API_KEY || 'DEMO_KEY';
  const fields = [
    'id', 'school.name', 'school.city', 'school.state', 'school.zip', 'school.school_url',
    'school.ownership', 'school.degrees_awarded.predominant', 'location.lat', 'location.lon',
    'latest.student.size', 'latest.completion.completion_rate_4yr_150nt', 'latest.aid.pell_grant_rate',
  ].join(',');
  const records = [];
  for (let page = 0; page < pages; page++) {
    const params = new URLSearchParams({
      api_key: apiKey,
      per_page: String(perPage),
      page: String(page),
      fields,
      sort: 'latest.student.size:desc',
    });
    if (state && stateCodes.has(state)) params.set('school.state', state);
    const data = await fetchJson(`https://api.data.gov/ed/collegescorecard/v1/schools?${params.toString()}`, { signal: AbortSignal.timeout(20000) });
    const results = data.results || [];
    for (const row of results) {
      records.push(normalizePointOrg({
        id: `edu-${row.id}`,
        name: row['school.name'],
        category: 'education',
        subtype: predominantDegree(row['school.degrees_awarded.predominant']),
        city: row['school.city'],
        state: row['school.state'],
        lat: row['location.lat'],
        lng: row['location.lon'],
        source: 'College Scorecard',
        source_id: String(row.id || ''),
        website: row['school.school_url'] ? `https://${String(row['school.school_url']).replace(/^https?:\/\//, '')}` : '',
        data_confidence: row['location.lat'] && row['location.lon'] ? 95 : 60,
        extra: {
          institution_type: predominantDegree(row['school.degrees_awarded.predominant']),
          school_ownership: schoolOwnership(row['school.ownership']),
          student_size: Number(row['latest.student.size'] || 0),
          completion_rate: Number(row['latest.completion.completion_rate_4yr_150nt'] || 0),
          pell_share: Number(row['latest.aid.pell_grant_rate'] || 0),
        },
      }));
    }
    if (!results.length) break;
  }
  return records.slice(0, limit);
}

async function fetchHealthOrgs(limit = 2000, state = '') {
  const records = [];
  const pageSize = Math.min(2000, limit);
  for (let offset = 0; offset < Math.min(limit, 10000); offset += pageSize) {
    const where = state && stateCodes.has(state) ? `SITE_STATE_ABBR='${state}'` : '1=1';
    const params = new URLSearchParams({
      where,
      outFields: '*',
      f: 'json',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
    });
    const data = await fetchJson(`https://gisportal.hrsa.gov/server/rest/services/HealthCareFacilities/PrimaryHealthCareFacilities_FS/MapServer/0/query?${params.toString()}`, { signal: AbortSignal.timeout(20000) });
    const features = data.features || [];
    for (const feature of features) {
      const a = feature.attributes || {};
      records.push(normalizePointOrg({
        id: `health-hrsa-${a.HCC_FCT_ID || a.OBJECTID || md5(`${a.SITE_NM}:${a.SITE_CITY}:${a.SITE_STATE_ABBR}`)}`,
        name: a.SITE_NM || a.GRANTEE_NM,
        category: 'health',
        subtype: a.HCC_TYP_DESC || a.HCC_LOC_SETTING_DESC || 'Health Center',
        city: a.SITE_CITY,
        state: a.SITE_STATE_ABBR,
        county: a.COUNTY_NM,
        lat: feature.geometry?.y,
        lng: feature.geometry?.x,
        source: 'HRSA Health Care Service Delivery Sites',
        source_id: String(a.SITE_SOURCE_ID || a.HCC_FCT_ID || ''),
        website: a.SITE_URL ? `https://${String(a.SITE_URL).replace(/^https?:\/\//, '')}` : '',
        phone: a.SITE_PHONE_NUM,
        data_confidence: feature.geometry?.y && feature.geometry?.x ? 95 : 55,
        extra: {
          facility_type: a.HCC_TYP_DESC || '',
          fqhc_status: a.FQHC_LAL_NUM ? 'FQHC look-alike' : (a.GRANT_NUM ? 'HRSA grantee/site' : ''),
          rural_health: a.RURAL_IND === 'Y',
          hrsa_grantee: a.GRANTEE_NM || '',
          service_area: a.SITE_POP_TYP_DESC || '',
          congressional_district: a.CONG_DIST_NM || '',
        },
      }));
    }
    if (features.length < pageSize) break;
  }
  return records.slice(0, limit);
}

async function fetchHospitalOrgs(limit = 1000, state = '') {
  const records = [];
  const pageSize = Math.min(500, limit);
  for (let offset = 0; offset < Math.min(limit, 5000); offset += pageSize) {
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });
    if (state && stateCodes.has(state)) {
      params.set('conditions[0][property]', 'state');
      params.set('conditions[0][operator]', '=');
      params.set('conditions[0][value]', state);
    }
    const data = await fetchJson(`https://data.cms.gov/provider-data/api/1/datastore/query/xubh-q36u/0?${params.toString()}`, { signal: AbortSignal.timeout(20000) });
    const results = data.results || [];
    for (const row of results) {
      const code = String(row.state || '').toUpperCase();
      const fallback = fallbackCoordsForState(code);
      const geocoded = state && stateCodes.has(state)
        ? await geocodeUsAddress([row.address, row.citytown, code, row.zip_code])
        : null;
      records.push(normalizePointOrg({
        id: `health-cms-${row.facility_id}`,
        name: row.facility_name,
        category: 'health',
        subtype: row.hospital_type || 'Hospital',
        city: row.citytown,
        state: code,
        county: row.countyparish,
        lat: geocoded?.lat ?? (row.citytown === fallback.city.toUpperCase() ? fallback.lat : undefined),
        lng: geocoded?.lng ?? (row.citytown === fallback.city.toUpperCase() ? fallback.lng : undefined),
        source: 'CMS Hospital General Information',
        source_id: String(row.facility_id || ''),
        phone: row.telephone_number,
        data_confidence: geocoded ? 92 : 72,
        extra: {
          facility_type: row.hospital_type || 'Hospital',
          hospital_ownership: row.hospital_ownership || '',
          emergency_services: row.emergency_services || '',
          hospital_overall_rating: row.hospital_overall_rating || '',
          address: row.address || '',
          cms_facility_id: row.facility_id || '',
          geocode_source: geocoded?.geocode_source || '',
          geocode_match: geocoded?.geocode_match || '',
          award_match_names: /spectrum health/i.test(row.facility_name || '') ? ['COREWELL HEALTH', 'SPECTRUM HEALTH'] : [],
        },
      }));
    }
    if (results.length < pageSize) break;
  }
  return records.slice(0, limit);
}

async function searchAwardAggregates({ terms, agencyName = '', limitPerTerm = 100, maxPages = 3, state = '' }) {
  const awards = new Map();
  for (const term of terms) {
    for (let page = 1; page <= maxPages; page++) {
      const filters = {
        award_type_codes: ['02', '03', '04', '05'],
        time_period: [{ start_date: '2010-01-01', end_date: new Date().toISOString().slice(0, 10) }],
        recipient_search_text: [term],
      };
      if (agencyName) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: agencyName }];
      if (state && stateCodes.has(state)) filters.recipient_locations = [{ country: 'USA', state }];
      const body = {
        filters,
        fields: ['Award ID', 'Recipient Name', 'Recipient City', 'Recipient State', 'Recipient ZIP Code', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'Funding Agency', 'CFDA Program Title'],
        sort: 'Award Amount',
        order: 'desc',
        limit: limitPerTerm,
        page,
      };
      const data = await fetchJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      for (const row of data.results || []) {
        const name = row['Recipient Name'] || '';
        if (!name) continue;
        const key = normalizeOrgName(name);
        if (!key) continue;
        const agg = awards.get(key) || {
          recipient_name: name,
          award_count: 0,
          total_obligations: 0,
          latest_award_date: '',
          awarding_agencies: [],
          programs: [],
        };
        agg.award_count += 1;
        agg.total_obligations += Number(row['Award Amount'] || 0);
        if ((row['Start Date'] || '') > (agg.latest_award_date || '')) agg.latest_award_date = row['Start Date'];
        agg.awarding_agencies = [...new Set([...agg.awarding_agencies, row['Awarding Agency'] || row['Funding Agency']].filter(Boolean))].slice(0, 10);
        agg.programs = [...new Set([...agg.programs, row['CFDA Program Title']].filter(Boolean))].slice(0, 10);
        awards.set(key, agg);
      }
      if (!data.results?.length || !data.page_metadata?.hasNext) break;
    }
  }
  return awards;
}

function attachAwardAggregates(orgs, awards, options = {}) {
  return orgs.map((org) => {
    const names = [org.name, ...(Array.isArray(org.award_match_names) ? org.award_match_names : [])].filter(Boolean);
    const keys = names.map(normalizeOrgName).filter(Boolean);
    const key = keys[0] || '';
    let best = keys.map((candidate) => awards.get(candidate)).find(Boolean);
    if (!best && options.allowPartial !== false) {
      const orgTokens = new Set(significantNameTokens(org.name));
      for (const [awardKey, award] of awards.entries()) {
        const awardTokens = significantNameTokens(award.recipient_name);
        const shared = awardTokens.filter((token) => orgTokens.has(token));
        const parentSystemMatch = awardTokens.length >= 2 && awardTokens.every((token) => orgTokens.has(token));
        const strongOverlap = parentSystemMatch || (shared.length >= Math.min(3, awardTokens.length) && shared.length >= Math.min(3, orgTokens.size));
        if (strongOverlap && awardKey.length >= 8 && key.length >= 8 && (awardKey.includes(key) || key.includes(awardKey) || shared.length >= 3)) {
          best = award;
          break;
        }
      }
    }
    if (!best) return org;
    return {
      ...org,
      award_count: best.award_count,
      total_obligations: Math.round(best.total_obligations * 100) / 100,
      latest_award_date: best.latest_award_date,
      awarding_agencies: best.awarding_agencies,
      programs: best.programs,
      award_recipient_name: best.recipient_name,
      funding_enriched: true,
    };
  });
}

async function searchUsaspendingCapability({ category, keyword, agencyName = '', limit = 500, maxPages = 5, state = '' }) {
  const orgs = new Map();
  for (let page = 1; page <= maxPages; page++) {
    const filters = {
      award_type_codes: ['02', '03', '04', '05'],
      time_period: [{ start_date: '2010-01-01', end_date: new Date().toISOString().slice(0, 10) }],
      keyword,
    };
    if (agencyName) filters.agencies = [{ type: 'funding', tier: 'toptier', name: agencyName }];
    const body = {
      filters,
      fields: ['Award ID', 'Recipient Name', 'Recipient City', 'Recipient State', 'Recipient ZIP Code', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'Funding Agency', 'CFDA Program Title'],
      sort: 'Start Date',
      order: 'desc',
      limit: Math.min(limit, 100),
      page,
    };
    const data = await fetchJson('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
      method: 'POST',
      signal: AbortSignal.timeout(25000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    for (const row of data.results || []) {
      const rowState = String(row['Recipient State'] || inferStateFromText(`${row['Recipient Name'] || ''} ${row['Recipient City'] || ''}`) || '').toUpperCase();
      if (state && stateCodes.has(state) && rowState !== state) continue;
      const name = row['Recipient Name'] || '';
      if (!name) continue;
      const key = md5(`${category}:${name}:${rowState || row['Recipient ZIP Code'] || ''}`);
      const current = orgs.get(key) || normalizePointOrg({
        id: `${category}-${key}`,
        name,
        category,
        subtype: row['CFDA Program Title'] || keyword,
        city: row['Recipient City'] || '',
        state: rowState,
        source: 'USAspending',
        source_id: key,
        data_confidence: row['Recipient City'] ? 70 : 45,
        extra: {
          award_count: 0,
          total_obligations: 0,
          latest_award_date: '',
          awarding_agencies: [],
          programs: [],
        },
      });
      current.award_count = Number(current.award_count || 0) + 1;
      current.total_obligations = Number(current.total_obligations || 0) + Number(row['Award Amount'] || 0);
      if ((row['Start Date'] || '') > (current.latest_award_date || '')) current.latest_award_date = row['Start Date'];
      current.awarding_agencies = [...new Set([...(current.awarding_agencies || []), row['Awarding Agency'] || row['Funding Agency']].filter(Boolean))].slice(0, 8);
      current.programs = [...new Set([...(current.programs || []), row['CFDA Program Title']].filter(Boolean))].slice(0, 8);
      orgs.set(key, current);
    }
    if (!data.results?.length || !data.page_metadata?.hasNext || orgs.size >= limit) break;
  }
  return Array.from(orgs.values()).slice(0, limit);
}

function normalizeServiceList(services) {
  return (Array.isArray(services) ? services : [])
    .map((service) => service.ServiceName || service.name || service)
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeCareerOneStopAjc(row) {
  const state = String(row.StateAbbr || row.state || '').toUpperCase();
  const lat = Number(row.Latitude);
  const lng = Number(row.Longitude);
  return normalizePointOrg({
    id: `workforce-ajc-${row.ID || md5(`${row.Name}:${row.Address1}:${state}`)}`,
    name: row.Name,
    category: 'workforce',
    subtype: row.ProgramType || 'American Job Center',
    city: row.City,
    state,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    source: 'CareerOneStop American Job Centers',
    source_id: row.ID || '',
    website: row.WebSiteUrl || '',
    phone: row.Phone || '',
    data_confidence: Number.isFinite(lat) && Number.isFinite(lng) ? 98 : 72,
    extra: {
      address: [row.Address1, row.Address2].filter(Boolean).join(' '),
      zip: row.Zip || '',
      email: row.GeneralEmail || '',
      center_status: row.CenterStatus || '',
      center_is_open: row.CenterIsOpen || '',
      open_hours: row.OpenHour || '',
      veteran_rep: row.VeteranRep || '',
      business_rep: row.BusinessRep || '',
      youth_contact: row.YSContact || '',
      youth_contact_email: row.YSContactEmail || '',
      last_source_updated: row.LastUpdated || '',
      worker_services: normalizeServiceList(row.WorkersServices),
      business_services: normalizeServiceList(row.BusinessServices),
      youth_services: normalizeServiceList(row.YouthServices),
      funding_enriched: false,
      award_count: 0,
      total_obligations: 0,
      latest_award_date: '',
      awarding_agencies: [],
      programs: [],
    },
  });
}

function normalizeCareerOneStopBoard(row) {
  const state = String(row.STATE || row.state || '').toUpperCase();
  const lat = Number(row.GEOCODE?.LAT);
  const lng = Number(row.GEOCODE?.LON);
  const contacts = Array.isArray(row.CONTACTS) ? row.CONTACTS : [];
  const primaryContact = contacts[0] || {};
  return normalizePointOrg({
    id: `workforce-board-${row.ID || md5(`${row.BOARD}:${row.ADDR1}:${state}`)}`,
    name: row.BOARD || row.COMPANY,
    category: 'workforce',
    subtype: row.TYPE || row.LEVEL || 'Workforce Board',
    city: row.CITY || primaryContact.CCITY,
    state,
    lat: Number.isFinite(lat) ? lat : undefined,
    lng: Number.isFinite(lng) ? lng : undefined,
    source: 'CareerOneStop Workforce Boards',
    source_id: row.ID || '',
    website: row.URL || primaryContact.CURL || '',
    phone: primaryContact.CPHONE || '',
    data_confidence: Number.isFinite(lat) && Number.isFinite(lng) ? 96 : 72,
    extra: {
      address: [row.ADDR1, row.ADDR2].filter(Boolean).join(' '),
      zip: row.ZIP || primaryContact.CZIP || '',
      counties: row.COUNTIES || '',
      cities_served: row.CITIES || '',
      towns_served: row.TOWNS || '',
      board_level: row.LEVEL || '',
      board_type: row.TYPE || '',
      company: row.COMPANY || '',
      contact_name: primaryContact.CNAME || '',
      contact_title: primaryContact.CTITLE || '',
      contact_email: primaryContact.CEMAIL || '',
      funding_enriched: false,
      award_count: 0,
      total_obligations: 0,
      latest_award_date: '',
      awarding_agencies: [],
      programs: [],
    },
  });
}

async function fetchCareerOneStopWorkforceOrgs(limit = 3000, state = '') {
  const [ajcData, boardData] = await Promise.all([
    fetchCareerOneStopJson('ajcfinder/{userId}').catch((err) => {
      console.warn('[AutoNateAI Intel Functions] CareerOneStop AJC fetch failed', err instanceof Error ? err.message : err);
      return null;
    }),
    fetchCareerOneStopJson('BoardsCouncilsFinder/{userId}').catch((err) => {
      console.warn('[AutoNateAI Intel Functions] CareerOneStop boards fetch failed', err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  const ajcs = (ajcData?.OneStopCenterList || [])
    .map(normalizeCareerOneStopAjc)
    .filter((org) => org.name && (!state || org.state === state));
  const boards = (boardData?.BOARDS || [])
    .map(normalizeCareerOneStopBoard)
    .filter((org) => org.name && (!state || org.state === state));
  return [...ajcs, ...boards].slice(0, limit);
}

async function fetchPublicWorkforceServiceOrgs(limit = 3000, state = '') {
  const seeds = publicWorkforceCenterSeeds
    .filter((seed) => !state || seed.state === state)
    .slice(0, limit);
  const orgs = [];
  for (const seed of seeds) {
    const geocoded = await geocodeUsAddress([seed.address, seed.city, seed.state]);
    orgs.push(normalizePointOrg({
      id: `workforce-public-${md5(`${seed.name}:${seed.address}:${seed.state}`)}`,
      name: seed.name,
      category: 'workforce',
      subtype: 'American Job Center / Workforce Service Center',
      city: seed.city,
      state: seed.state,
      lat: geocoded?.lat,
      lng: geocoded?.lng,
      source: 'Public state workforce location data',
      source_id: seed.source_url,
      phone: seed.phone || '',
      data_confidence: geocoded ? 93 : 78,
      extra: {
        address: seed.address,
        source_url: seed.source_url,
        geocode_source: geocoded?.geocode_source || '',
        geocode_match: geocoded?.geocode_match || '',
        funding_enriched: false,
        award_count: 0,
        total_obligations: 0,
        latest_award_date: '',
        awarding_agencies: [],
        programs: [],
      },
    }));
  }
  return orgs;
}

async function fetchWorkforceSubrecipientOrgs(limit = 1000, state = '') {
  if (!state || !stateCodes.has(state)) return [];
  const filters = {
    award_type_codes: ['02', '03', '04', '05'],
    time_period: [{ start_date: '2010-01-01', end_date: new Date().toISOString().slice(0, 10) }],
    agencies: [{ type: 'funding', tier: 'toptier', name: 'Department of Labor' }],
    recipient_locations: [{ country: 'USA', state }],
  };
  const grouped = await fetchJson('https://api.usaspending.gov/api/v2/search/spending_by_subaward_grouped/', {
    method: 'POST',
    signal: AbortSignal.timeout(25000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filters, limit: 10, page: 1, sort: 'subaward_obligation', order: 'desc' }),
  });
  const subrecipientMap = new Map();
  for (const award of grouped.results || []) {
    const awardId = award.award_generated_internal_id;
    if (!awardId) continue;
    for (let page = 1; page <= 3; page++) {
      const data = await fetchJson('https://api.usaspending.gov/api/v2/subawards/', {
        method: 'POST',
        signal: AbortSignal.timeout(25000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ award_id: awardId, limit: 100, page, sort: 'amount', order: 'desc' }),
      });
      for (const row of data.results || []) {
        const name = row.recipient_name || '';
        if (!name) continue;
        const key = normalizeOrgName(name);
        if (!key) continue;
        const current = subrecipientMap.get(key) || {
          recipient_name: name,
          award_count: 0,
          total_obligations: 0,
          latest_award_date: '',
          programs: [],
          parent_awards: [],
        };
        current.award_count += 1;
        current.total_obligations += Number(row.amount || 0);
        if ((row.action_date || '') > (current.latest_award_date || '')) current.latest_award_date = row.action_date;
        current.programs = [...new Set([...current.programs, row.description].filter(Boolean))].slice(0, 12);
        current.parent_awards = [...new Set([...current.parent_awards, award.award_id].filter(Boolean))].slice(0, 12);
        subrecipientMap.set(key, current);
      }
      if (!data.page_metadata?.hasNext) break;
    }
  }

  const records = [];
  for (const [key, sub] of subrecipientMap.entries()) {
    const seeded = workforceSubrecipientSeedForKey(key);
    const geocoded = seeded || null;
    if (state && geocoded?.state && geocoded.state !== state) continue;
    const fallback = capitalForState(state);
    records.push(normalizePointOrg({
      id: `workforce-subrecipient-${md5(`${sub.recipient_name}:${state}`)}`,
      name: sub.recipient_name,
      category: 'workforce',
      subtype: 'DOL Workforce Subrecipient',
      city: geocoded?.city || fallback.city,
      state,
      lat: geocoded?.lat,
      lng: geocoded?.lng,
      source: 'USAspending subaward data',
      source_id: sub.parent_awards.join(','),
      data_confidence: seeded ? 88 : geocoded ? 76 : 52,
      extra: {
        award_count: sub.award_count,
        total_obligations: Math.round(sub.total_obligations * 100) / 100,
        latest_award_date: sub.latest_award_date,
        awarding_agencies: ['Department of Labor'],
        programs: sub.programs,
        parent_awards: sub.parent_awards,
        funding_enriched: true,
        subrecipient_since: '2010-01-01',
        geocode_source: seeded?.source || geocoded?.geocode_source || 'state capital fallback',
        geocode_match: geocoded?.geocode_display_name || '',
      },
    }));
  }
  return records
    .sort((a, b) => Number(b.total_obligations || 0) - Number(a.total_obligations || 0))
    .slice(0, limit);
}

async function fetchWorkforceOrgs(limit = 1000, state = '') {
  const terms = [
    'workforce development',
    'WIOA',
    'American Job Center',
    'apprenticeship',
    'employment services',
    'job training',
    'career center',
    'labor workforce',
  ];
  const all = [];
  for (const term of terms) {
    all.push(...await searchUsaspendingCapability({ category: 'workforce', keyword: term, agencyName: 'Department of Labor', limit: Math.ceil(limit / terms.length), maxPages: 8, state }));
  }
  const byId = new Map(all.map((record) => [record.id, { ...record, subtype: record.subtype || 'Workforce funded recipient' }]));
  return Array.from(byId.values()).slice(0, limit);
}

async function fetchWorkforceLayerOrgs(limit = 3000, state = '') {
  const fundingRecipients = await fetchWorkforceOrgs(Math.min(limit, 1000), state);
  const [publicServiceOrgs, careerOneStopOrgs, subrecipientOrgs] = await Promise.all([
    fetchPublicWorkforceServiceOrgs(limit, state),
    fetchCareerOneStopWorkforceOrgs(limit, state),
    state ? fetchWorkforceSubrecipientOrgs(limit, state) : Promise.resolve([]),
  ]);
  const serviceById = new Map([...publicServiceOrgs, ...careerOneStopOrgs, ...subrecipientOrgs].map((org) => [org.id, org]));
  const serviceOrgs = Array.from(serviceById.values()).slice(0, limit);
  if (!serviceOrgs.length) {
    return {
      orgs: fundingRecipients,
      fundingRecipients,
      source_mode: careerOneStopConfig().token ? 'usaspending_fallback' : 'usaspending_fallback_missing_careeronestop_token',
    };
  }
  const awardMap = new Map(fundingRecipients.map((recipient) => [normalizeOrgName(recipient.name), {
    recipient_name: recipient.name,
    state: recipient.state,
    city: recipient.city,
    award_count: Number(recipient.award_count || 0),
    total_obligations: Number(recipient.total_obligations || 0),
    latest_award_date: recipient.latest_award_date || '',
    awarding_agencies: recipient.awarding_agencies || [],
    programs: recipient.programs || [],
  }]).filter(([key]) => key));
  const enriched = attachAwardAggregates(serviceOrgs, awardMap, { allowPartial: true });
  const serviceStates = new Set(enriched.map((org) => org.state).filter(Boolean));
  const fallbackRecipients = state
    ? []
    : fundingRecipients.filter((recipient) => !serviceStates.has(recipient.state));
  return {
    orgs: [...enriched, ...fallbackRecipients].slice(0, limit),
    fundingRecipients,
    source_mode: subrecipientOrgs.length
      ? 'public_service_locations_and_usaspending_subrecipients'
      : careerOneStopOrgs.length ? 'public_and_careeronestop_service_locations' : 'public_service_locations',
  };
}

const faithTerms = ['church', 'ministries', 'ministry', 'mission', 'faith', 'baptist', 'methodist', 'catholic', 'synagogue', 'mosque', 'temple'];
function faithConfidence(name = '') {
  const lower = name.toLowerCase();
  const matches = faithTerms.filter((term) => lower.includes(term));
  return { matches, confidence: Math.min(95, 45 + matches.length * 18) };
}

async function fetchFundedFaithOrgs(limit = 1000, state = '') {
  const all = [];
  for (const term of ['church', 'ministries', 'faith based', 'catholic charities', 'mission']) {
    all.push(...await searchUsaspendingCapability({ category: 'funded_faith', keyword: term, limit: Math.ceil(limit / 5), maxPages: 4, state }));
  }
  const filtered = [];
  const seen = new Set();
  for (const record of all) {
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    const signal = faithConfidence(record.name);
    if (signal.matches.length === 0) continue;
    filtered.push({
      ...record,
      subtype: 'Federally funded faith organization',
      faith_match_terms: signal.matches,
      faith_confidence: signal.confidence,
      data_confidence: Math.max(Number(record.data_confidence || 0), signal.confidence),
    });
  }
  return filtered.slice(0, limit);
}

async function recomputeCommunityCapabilitySummary() {
  const [eduSnap, workforceSnap, healthSnap, faithSnap, phaSnap, sbirSnap] = await Promise.all([
    db.collection('education_orgs').limit(10000).get(),
    db.collection('workforce_orgs').limit(10000).get(),
    db.collection('health_orgs').limit(10000).get(),
    db.collection('funded_faith_orgs').limit(10000).get(),
    db.collection('hud_phas').limit(5000).get(),
    db.collection('sbir_recipients').limit(25000).get(),
  ]);
  const summaries = new Map();
  const ensure = (state) => {
    const code = stateCodes.has(state) ? state : 'DC';
    if (!summaries.has(code)) summaries.set(code, { id: code, state: code, ...centroidForState(code), education_count: 0, workforce_count: 0, health_count: 0, funded_faith_count: 0, pha_count: 0, sbir_recipient_count: 0, total_known_federal_obligations: 0, last_updated: new Date().toISOString() });
    return summaries.get(code);
  };
  eduSnap.docs.forEach((doc) => { ensure(doc.data().state).education_count++; });
  workforceSnap.docs.forEach((doc) => { const d = doc.data(); const s = ensure(d.state); s.workforce_count++; s.total_known_federal_obligations += Number(d.total_obligations || 0); });
  healthSnap.docs.forEach((doc) => { ensure(doc.data().state).health_count++; });
  faithSnap.docs.forEach((doc) => { const d = doc.data(); const s = ensure(d.state); s.funded_faith_count++; s.total_known_federal_obligations += Number(d.total_obligations || 0); });
  phaSnap.docs.forEach((doc) => { ensure(doc.data().state).pha_count++; });
  sbirSnap.docs.forEach((doc) => { ensure(doc.data().state_code || doc.data().state).sbir_recipient_count++; });
  const records = Array.from(summaries.values()).map((s) => ({
    ...s,
    capability_score: Math.min(100, Math.round(s.education_count * 0.4 + s.workforce_count * 0.5 + s.health_count * 0.35 + s.funded_faith_count * 0.3 + s.pha_count * 0.25 + s.sbir_recipient_count * 0.15)),
  }));
  await writeCollection('community_capability_summary', records);
  return records.length;
}

const STATIC_POWER_ORIGINS = {
  'Donald J. Trump': { origin_city: 'Palm Beach', origin_state: 'FL', lat: 26.7056, lng: -80.0364, origin_source: 'static residence seed', origin_kind: 'residence' },
  'JD Vance': { origin_city: 'Cincinnati', origin_state: 'OH', lat: 39.1031, lng: -84.512, origin_source: 'static residence seed', origin_kind: 'residence' },
  'John G. Roberts, Jr.': { origin_city: 'Buffalo', origin_state: 'NY', lat: 42.8864, lng: -78.8784, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Clarence Thomas': { origin_city: 'Pin Point', origin_state: 'GA', lat: 31.9474, lng: -81.0907, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Samuel A. Alito, Jr.': { origin_city: 'Trenton', origin_state: 'NJ', lat: 40.2206, lng: -74.7597, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Sonia Sotomayor': { origin_city: 'Bronx', origin_state: 'NY', lat: 40.8448, lng: -73.8648, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Elena Kagan': { origin_city: 'New York', origin_state: 'NY', lat: 40.7128, lng: -74.006, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Neil M. Gorsuch': { origin_city: 'Denver', origin_state: 'CO', lat: 39.7392, lng: -104.9903, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Brett M. Kavanaugh': { origin_city: 'Washington', origin_state: 'DC', lat: 38.9072, lng: -77.0369, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Amy Coney Barrett': { origin_city: 'New Orleans', origin_state: 'LA', lat: 29.9511, lng: -90.0715, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
  'Ketanji Brown Jackson': { origin_city: 'Washington', origin_state: 'DC', lat: 38.9072, lng: -77.0369, origin_source: 'static birthplace fallback', origin_kind: 'birthplace' },
};

function parseWikidataPoint(point = '') {
  const match = String(point).match(/Point\(([-0-9.]+) ([-0-9.]+)\)/);
  if (!match) return null;
  return { lng: Number(match[1]), lat: Number(match[2]) };
}

async function fetchWikidataHomeBases(wikidataIds = []) {
  const unique = [...new Set(wikidataIds.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += 80) {
    const values = unique.slice(i, i + 80).map((id) => `wd:${id}`).join(' ');
    const query = `
      SELECT ?person ?residenceLabel ?residenceCoord ?birthplaceLabel ?birthplaceCoord WHERE {
        VALUES ?person { ${values} }
        OPTIONAL { ?person wdt:P551 ?residence. ?residence wdt:P625 ?residenceCoord. }
        OPTIONAL { ?person wdt:P19 ?birthplace. ?birthplace wdt:P625 ?birthplaceCoord. }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    `;
    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`;
    try {
      const data = await fetchJson(url, {
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'AutoNateAI-Intel/1.0 (https://intel.autonateai.com)' },
      });
      for (const row of data.results?.bindings || []) {
        const id = row.person?.value?.split('/').pop();
        const residenceCoord = parseWikidataPoint(row.residenceCoord?.value);
        const birthCoord = parseWikidataPoint(row.birthplaceCoord?.value);
        const coord = residenceCoord || birthCoord;
        if (id && coord) {
          out.set(id, {
            ...coord,
            origin_city: residenceCoord ? row.residenceLabel?.value || '' : row.birthplaceLabel?.value || '',
            origin_source: residenceCoord ? 'Wikidata residence' : 'Wikidata birthplace fallback',
            origin_kind: residenceCoord ? 'residence' : 'birthplace',
          });
        }
      }
    } catch (err) {
      console.warn('[AutoNateAI Intel Functions] Wikidata home base lookup failed', err instanceof Error ? err.message : err);
    }
  }
  return out;
}

async function updatePowerMap() {
  const legislatorsYaml = await fetchText('https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml', { signal: AbortSignal.timeout(20000) }).catch(() => '');
  const legislators = legislatorsYaml ? YAML.parse(legislatorsYaml) : [];
  const homeBases = await fetchWikidataHomeBases((legislators || []).map((leg) => leg.id?.wikidata));
  const people = [];
  for (const leg of legislators || []) {
    const term = leg.terms?.[leg.terms.length - 1] || {};
    const state = term.state || 'DC';
    const coords = capitalForState(state);
    const origin = homeBases.get(leg.id?.wikidata) || {};
    people.push({
      id: `congress-${leg.id?.bioguide}`,
      name: [leg.name?.official_full || `${leg.name?.first || ''} ${leg.name?.last || ''}`.trim()][0],
      branch: 'congress',
      chamber: term.type === 'sen' ? 'Senate' : 'House',
      party: term.party || '',
      state,
      represented_state: state,
      district: term.district ?? null,
      role: term.type === 'sen' ? 'U.S. Senator' : 'U.S. Representative',
      lat: coords.lat,
      lng: coords.lng,
      origin_city: coords.city,
      origin_state: state,
      origin_source: 'state capital',
      origin_kind: 'represented_state_capital',
      home_city: origin.origin_city || '',
      home_state: origin.origin_state || state,
      home_source: origin.origin_source || '',
      home_kind: origin.origin_kind || '',
      source: 'unitedstates/congress-legislators',
      updated_at: new Date().toISOString(),
    });
  }
  const staticPower = [
    { id: 'whitehouse-president', name: 'Donald J. Trump', branch: 'white_house', role: 'President', party: 'Republican', state: 'DC' },
    { id: 'whitehouse-vice-president', name: 'JD Vance', branch: 'white_house', role: 'Vice President', party: 'Republican', state: 'DC' },
    ...['John G. Roberts, Jr.', 'Clarence Thomas', 'Samuel A. Alito, Jr.', 'Sonia Sotomayor', 'Elena Kagan', 'Neil M. Gorsuch', 'Brett M. Kavanaugh', 'Amy Coney Barrett', 'Ketanji Brown Jackson'].map((name) => ({ id: `scotus-${md5(name).slice(0, 10)}`, name, branch: 'judicial', role: name.includes('Roberts') ? 'Chief Justice' : 'Associate Justice', party: '', state: 'DC' })),
  ].map((person) => ({
    ...person,
    ...centroidForState(person.state),
    ...(STATIC_POWER_ORIGINS[person.name] || {}),
    represented_state: person.state,
    source: 'official/static seed',
    updated_at: new Date().toISOString(),
  }));
  people.push(...staticPower);
  let batch = db.batch();
  people.forEach((person) => batch.set(db.collection('federal_power').doc(person.id), person, { merge: true }));
  await batch.commit();
  return people.length;
}

const flightRegions = [
  { lat: 39.8, lon: -98.5, dist: 2000 },
  { lat: 50.0, lon: 15.0, dist: 2000 },
  { lat: 35.0, lon: 105.0, dist: 2000 },
  { lat: -25.0, lon: 133.0, dist: 2000 },
  { lat: 0.0, lon: 20.0, dist: 2500 },
  { lat: -15.0, lon: -60.0, dist: 2000 },
];

const heliTypes = new Set(['R22', 'R44', 'R66', 'B06', 'B06T', 'B204', 'B205', 'B206', 'B212', 'B222', 'B230', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B525', 'AS32', 'AS35', 'AS50', 'AS55', 'AS65', 'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'H125', 'H130', 'H135', 'H145', 'H155', 'H160', 'H175', 'H215', 'H225', 'S55', 'S58', 'S61', 'S64', 'S70', 'S76', 'S92', 'A109', 'A119', 'A139', 'A169', 'A189', 'AW09', 'MD52', 'MD60', 'MDHI', 'MD90', 'NOTR', 'B47G', 'HUEY', 'GAMA', 'CABR', 'EXE']);
const privateJetTypes = new Set(['G150', 'G200', 'G280', 'GLEX', 'G500', 'G550', 'G600', 'G650', 'G700', 'GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GL5T', 'GL7T', 'GV', 'GIV', 'CL30', 'CL35', 'CL60', 'BD70', 'BD10', 'C25A', 'C25B', 'C25C', 'C500', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C680', 'C700', 'C750', 'E35L', 'E50P', 'E55P', 'E545', 'E550', 'FA50', 'FA7X', 'FA8X', 'F900', 'F2TH', 'LJ35', 'LJ40', 'LJ45', 'LJ60', 'LJ70', 'LJ75', 'PC12', 'PC24', 'TBM7', 'TBM8', 'TBM9', 'PRM1', 'SF50', 'EA50', 'VLJ']);
const militaryIndicators = new Set(['C17', 'C5M', 'C130', 'C30J', 'KC10', 'KC46', 'KC35', 'E3CF', 'E3TF', 'E8A', 'B1B', 'B2', 'B52', 'F16', 'F15', 'F18', 'F22', 'F35', 'A10', 'F117', 'RC135', 'E6B', 'P8A', 'P3', 'MQ9', 'RQ4', 'U2', 'EP3', 'RC12', 'V22', 'CH47', 'UH60', 'AH64', 'AH1Z', 'MV22', 'EUFI', 'RFAL', 'TORD', 'TYP', 'GR4']);
const airlineCodeRe = /^([A-Z]{3})\d/;

async function fetchFlightRegion(region) {
  try {
    const data = await fetchJson(`https://api.adsb.lol/v2/lat/${region.lat}/lon/${region.lon}/dist/${region.dist}`, { signal: AbortSignal.timeout(12000) });
    return data.ac || [];
  } catch {
    return [];
  }
}

function extractRouteInfo(raw) {
  const route = typeof raw.route === 'string' ? raw.route.trim().toUpperCase() : '';
  const routeParts = route.split(/[-\s>]+/).filter(Boolean);
  const departure = String(
    raw.origin ||
    raw.departure ||
    raw.from ||
    raw.nav_origin ||
    (raw.route && raw.route.origin) ||
    (raw.route && raw.route.from) ||
    routeParts[0] ||
    ''
  ).trim().toUpperCase();
  const destination = String(
    raw.destination ||
    raw.dest ||
    raw.to ||
    raw.nav_destination ||
    (raw.route && raw.route.destination) ||
    (raw.route && raw.route.to) ||
    (routeParts.length > 1 ? routeParts[routeParts.length - 1] : '') ||
    ''
  ).trim().toUpperCase();
  return { departure, destination, route };
}

function classifyFlight(raw) {
  const modelUpper = (raw.t || '').toUpperCase();
  const flightStr = (raw.flight || '').trim().toUpperCase();
  if (modelUpper === 'TWR' || raw.lat == null || raw.lon == null) return null;
  const callsign = flightStr || raw.hex || 'UNKNOWN';
  const altRaw = raw.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const airlineCode = airlineCodeRe.exec(callsign)?.[1] || '';
  const isHeli = heliTypes.has(modelUpper);
  const routeInfo = extractRouteInfo(raw);
  let category = 'commercial';
  if ((raw.dbFlags || 0) & 1 || militaryIndicators.has(modelUpper) || /^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i.test(raw.flight || '')) category = 'military';
  else if (privateJetTypes.has(modelUpper)) category = 'jet';
  else if (!airlineCode && modelUpper && !['A319', 'A320', 'A321', 'A332', 'A333', 'A339', 'A343', 'A359', 'A388', 'B737', 'B738', 'B739', 'B38M', 'B39M', 'B752', 'B753', 'B763', 'B764', 'B772', 'B77L', 'B77W', 'B788', 'B789', 'B78X', 'E170', 'E175', 'E190', 'E195', 'CRJ7', 'CRJ9', 'AT43', 'AT72', 'DH8D'].includes(modelUpper)) category = 'private';
  return {
    callsign,
    lat: Math.round(raw.lat * 100000) / 100000,
    lng: Math.round(raw.lon * 100000) / 100000,
    alt: Math.round(altMeters),
    heading: Math.round(raw.track || 0),
    speed_knots: typeof raw.gs === 'number' ? Math.round(raw.gs * 10) / 10 : null,
    model: raw.t || 'Unknown',
    icao24: raw.hex || '',
    registration: raw.r || 'N/A',
    departure: routeInfo.departure,
    destination: routeInfo.destination,
    route: routeInfo.route,
    squawk: raw.squawk || '',
    airline_code: airlineCode,
    aircraft_category: isHeli ? 'heli' : 'plane',
    category,
    grounded: typeof altRaw === 'number' && altRaw < 100,
    nac_p: raw.nac_p,
    type: 'flight',
  };
}

function aggregateJamming(points, threshold) {
  const grid = new Map();
  for (const point of points) {
    const gLat = Math.floor(point.lat / 2) * 2;
    const gLng = Math.floor(point.lng / 2) * 2;
    const key = `${gLat},${gLng}`;
    if (!grid.has(key)) grid.set(key, { lat: gLat + 1, lng: gLng + 1, count: 0, total_nac_p: 0 });
    const cell = grid.get(key);
    cell.count++;
    cell.total_nac_p += point.nac_p;
  }
  return Array.from(grid.values()).filter((zone) => zone.count >= 3).map((zone) => ({
    lat: zone.lat,
    lng: zone.lng,
    severity: Math.round((1 - (zone.total_nac_p / zone.count) / threshold) * 100),
    count: zone.count,
  }));
}

const nuclearFacilities = [
  { id: 'nuc-ua-zaporizhzhia', name: 'Zaporizhzhia NPP', city: 'Enerhodar', country: 'Ukraine', lat: 47.5113, lng: 34.5861, status: 'Active Conflict Zone', reactors: 6, capacityMW: 5700, owner: 'Energoatom (Russian controlled)' },
  { id: 'nuc-ua-rivne', name: 'Rivne NPP', city: 'Varash', country: 'Ukraine', lat: 51.3278, lng: 25.8917, status: 'Operational', reactors: 4, capacityMW: 2835, owner: 'Energoatom' },
  { id: 'nuc-ua-south', name: 'South Ukraine NPP', city: 'Yuzhnoukrainsk', country: 'Ukraine', lat: 47.8147, lng: 31.2186, status: 'Operational', reactors: 3, capacityMW: 2850, owner: 'Energoatom' },
  { id: 'nuc-ua-khmelnytskyi', name: 'Khmelnytskyi NPP', city: 'Netishyn', country: 'Ukraine', lat: 50.3017, lng: 26.6489, status: 'Operational', reactors: 2, capacityMW: 2000, owner: 'Energoatom' },
  { id: 'nuc-ua-chernobyl', name: 'Chernobyl (Decommissioned)', city: 'Pripyat', country: 'Ukraine', lat: 51.3891, lng: 30.0992, status: 'Decommissioned / Exclusion Zone', reactors: 4, capacityMW: 0, owner: 'State Agency' },
  { id: 'nuc-fr-gravelines', name: 'Gravelines NPP', city: 'Gravelines', country: 'France', lat: 51.0125, lng: 2.1363, status: 'Operational', reactors: 6, capacityMW: 5460, owner: 'EDF' },
  { id: 'nuc-fr-cattenom', name: 'Cattenom NPP', city: 'Cattenom', country: 'France', lat: 49.4158, lng: 6.2181, status: 'Operational', reactors: 4, capacityMW: 5200, owner: 'EDF' },
  { id: 'nuc-fr-flamanville', name: 'Flamanville NPP', city: 'Flamanville', country: 'France', lat: 49.5386, lng: -1.8811, status: 'Operational', reactors: 3, capacityMW: 3960, owner: 'EDF' },
  { id: 'nuc-fr-tricastin', name: 'Tricastin NPP', city: 'Saint-Paul-Trois-Chateaux', country: 'France', lat: 44.3322, lng: 4.7306, status: 'Operational', reactors: 4, capacityMW: 3660, owner: 'EDF' },
  { id: 'nuc-uk-sizewell', name: 'Sizewell B NPP', city: 'Leiston', country: 'UK', lat: 52.2131, lng: 1.6186, status: 'Operational', reactors: 1, capacityMW: 1198, owner: 'EDF Energy' },
  { id: 'nuc-uk-hinkley', name: 'Hinkley Point C', city: 'Somerset', country: 'UK', lat: 51.2081, lng: -3.1319, status: 'Under Construction', reactors: 2, capacityMW: 3200, owner: 'EDF Energy' },
  { id: 'nuc-ru-kursk', name: 'Kursk NPP', city: 'Kurchatov', country: 'Russia', lat: 51.6742, lng: 35.6033, status: 'Operational', reactors: 4, capacityMW: 4000, owner: 'Rosenergoatom' },
  { id: 'nuc-ru-leningrad', name: 'Leningrad NPP', city: 'Sosnovy Bor', country: 'Russia', lat: 59.8406, lng: 29.0433, status: 'Operational', reactors: 4, capacityMW: 4000, owner: 'Rosenergoatom' },
  { id: 'nuc-ru-balakovo', name: 'Balakovo NPP', city: 'Balakovo', country: 'Russia', lat: 52.0911, lng: 47.9564, status: 'Operational', reactors: 4, capacityMW: 4000, owner: 'Rosenergoatom' },
  { id: 'nuc-ru-rostov', name: 'Rostov NPP', city: 'Volgodonsk', country: 'Russia', lat: 47.5286, lng: 42.1014, status: 'Operational', reactors: 4, capacityMW: 4014, owner: 'Rosenergoatom' },
  { id: 'nuc-us-palo-verde', name: 'Palo Verde', city: 'Tonopah', country: 'US', lat: 33.3886, lng: -112.8617, status: 'Operational', reactors: 3, capacityMW: 3937, owner: 'APS' },
  { id: 'nuc-us-browns-ferry', name: 'Browns Ferry', city: 'Athens', country: 'US', lat: 34.7042, lng: -87.1186, status: 'Operational', reactors: 3, capacityMW: 3400, owner: 'TVA' },
  { id: 'nuc-us-vogtle', name: 'Vogtle (AP1000)', city: 'Waynesboro', country: 'US', lat: 33.1417, lng: -81.7631, status: 'Operational', reactors: 4, capacityMW: 4500, owner: 'Georgia Power' },
  { id: 'nuc-ca-bruce', name: 'Bruce Nuclear', city: 'Tiverton', country: 'Canada', lat: 44.3253, lng: -81.5997, status: 'Operational', reactors: 8, capacityMW: 6503, owner: 'Bruce Power' },
  { id: 'nuc-cn-hongyanhe', name: 'Hongyanhe NPP', city: 'Dalian', country: 'China', lat: 39.7944, lng: 121.48, status: 'Operational', reactors: 6, capacityMW: 6366, owner: 'CGN' },
  { id: 'nuc-cn-yangjiang', name: 'Yangjiang NPP', city: 'Yangjiang', country: 'China', lat: 21.7061, lng: 112.2597, status: 'Operational', reactors: 6, capacityMW: 6000, owner: 'CGN' },
  { id: 'nuc-cn-tianwan', name: 'Tianwan NPP', city: 'Lianyungang', country: 'China', lat: 34.6869, lng: 119.4597, status: 'Operational', reactors: 6, capacityMW: 6050, owner: 'CNNC' },
  { id: 'nuc-jp-fukushima', name: 'Fukushima Daiichi', city: 'Okuma', country: 'Japan', lat: 37.4211, lng: 141.0328, status: 'Destroyed / Decommissioning', reactors: 6, capacityMW: 0, owner: 'TEPCO' },
  { id: 'nuc-kr-kori', name: 'Kori/Shin-Kori NPP', city: 'Busan', country: 'South Korea', lat: 35.3197, lng: 129.2894, status: 'Operational', reactors: 7, capacityMW: 7489, owner: 'KHNP' },
  { id: 'nuc-ir-bushehr', name: 'Bushehr NPP', city: 'Bushehr', country: 'Iran', lat: 28.8292, lng: 50.8864, status: 'Operational', reactors: 1, capacityMW: 915, owner: 'AEOI' },
  { id: 'nuc-ae-barakah', name: 'Barakah NPP', city: 'Al Dhafra', country: 'UAE', lat: 23.9686, lng: 52.2356, status: 'Operational', reactors: 4, capacityMW: 5380, owner: 'ENEC' },
  { id: 'nuc-za-koeberg', name: 'Koeberg NPP', city: 'Cape Town', country: 'South Africa', lat: -33.6769, lng: 18.4344, status: 'Operational', reactors: 2, capacityMW: 1860, owner: 'Eskom' },
];

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

app.use(async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const authHeader = req.header('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    res.status(401).json({ error: 'Missing Firebase ID token' });
    return;
  }

  try {
    req.user = await getAuth().verifyIdToken(match[1]);
    next();
  } catch (err) {
    res.status(401).json({
      error: 'Invalid Firebase ID token',
      detail: err instanceof Error ? err.message : 'Unknown auth error',
    });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'operational',
    platform: 'AutoNateAI Intel Functions',
    project: process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'autonateai-learning-hub',
    uid: req.user.uid,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/earthquakes', async (_req, res) => {
  try {
    const response = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      res.status(502).json({ earthquakes: [], error: 'USGS unavailable' });
      return;
    }

    const data = await response.json();
    const earthquakes = (data.features || []).map((feature) => {
      const coords = feature.geometry?.coordinates || [0, 0, 0];
      const props = feature.properties || {};
      return {
        id: feature.id,
        lat: coords[1],
        lng: coords[0],
        depth: coords[2],
        magnitude: props.mag,
        place: props.place,
        time: props.time,
        url: props.url,
        tsunami: props.tsunami,
        type: props.type,
        felt: props.felt,
        alert: props.alert,
      };
    });

    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
    res.json({
      earthquakes,
      total: earthquakes.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      earthquakes: [],
      error: 'Failed to fetch earthquake data',
      detail: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});

app.get('/api/markets', cache(120000, async () => {
  const defenseStocks = ['RTX', 'LMT', 'NOC', 'GD', 'BA', 'PLTR'];
  const oilTickers = ['CL=F', 'BZ=F'];
  const commodityTickers = ['GC=F', 'SI=F', 'HG=F', 'NG=F', 'ZW=F', 'ZC=F'];
  const cryptoTickers = ['BTC-USD', 'ETH-USD'];
  const indexTickers = ['ES=F', 'NQ=F'];
  const commodityNames = { 'GC=F': 'Gold', 'SI=F': 'Silver', 'HG=F': 'Copper', 'NG=F': 'Natural Gas', 'ZW=F': 'Wheat', 'ZC=F': 'Corn' };
  const oilNames = { 'CL=F': 'WTI Crude', 'BZ=F': 'Brent Crude' };
  const cryptoNames = { 'BTC-USD': 'Bitcoin', 'ETH-USD': 'Ethereum' };
  const indexNames = { 'ES=F': 'S&P 500', 'NQ=F': 'Nasdaq 100' };

  const [stockResults, oilResults, commodityResults, cryptoResults, indexResults, coinGecko] = await Promise.all([
    Promise.all(defenseStocks.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) }))),
    Promise.all(oilTickers.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) }))),
    Promise.all(commodityTickers.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) }))),
    Promise.all(cryptoTickers.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) }))),
    Promise.all(indexTickers.map(async (symbol) => ({ symbol, data: await fetchYahooQuote(symbol) }))),
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true', { signal: AbortSignal.timeout(8000) }).catch(() => ({})),
  ]);

  const stocks = {};
  for (const { symbol, data } of stockResults) if (data) stocks[symbol] = data;
  const oil = {};
  for (const { symbol, data } of oilResults) if (data) oil[oilNames[symbol] || symbol] = data;
  const commodities = {};
  for (const { symbol, data } of commodityResults) if (data) commodities[commodityNames[symbol] || symbol] = data;
  const cryptoAssets = {};
  for (const { symbol, data } of cryptoResults) if (data) cryptoAssets[cryptoNames[symbol] || symbol] = data;
  if (!cryptoAssets.Bitcoin && coinGecko.bitcoin) cryptoAssets.Bitcoin = { price: Math.round(coinGecko.bitcoin.usd * 100) / 100, change_percent: Math.round((coinGecko.bitcoin.usd_24h_change || 0) * 100) / 100, up: (coinGecko.bitcoin.usd_24h_change || 0) >= 0 };
  if (!cryptoAssets.Ethereum && coinGecko.ethereum) cryptoAssets.Ethereum = { price: Math.round(coinGecko.ethereum.usd * 100) / 100, change_percent: Math.round((coinGecko.ethereum.usd_24h_change || 0) * 100) / 100, up: (coinGecko.ethereum.usd_24h_change || 0) >= 0 };
  const indices = {};
  for (const { symbol, data } of indexResults) if (data) indices[indexNames[symbol] || symbol] = data;

  return { stocks, oil, commodities, crypto: cryptoAssets, indices, timestamp: new Date().toISOString() };
}));

app.get('/api/news', cache(60000, async () => {
  const telegramChannels = ['OSINTtechnical', 'Faytuks', 'Liveuamap', 'CyberKnow'];
  const telegramResults = await Promise.allSettled(telegramChannels.map(async (channel) => {
    const html = await fetchText(`https://t.me/s/${channel}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': yahooHeaders['User-Agent'] },
    });
    const blocks = html.match(/<div class="tgme_widget_message_wrap js-widget_message_wrap"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi) || [];
    return blocks.flatMap((block) => {
      const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/i);
      if (!textMatch) return [];
      const description = stripHtml(textMatch[1]);
      if (!description || description.length < 10) return [];
      const dateMatch = block.match(/<a class="tgme_widget_message_date" href="(https:\/\/t\.me\/[^"]+)".*?<time datetime="([^"]+)"/i);
      return [{
        title: description.split('\n')[0].substring(0, 100),
        description,
        link: dateMatch ? dateMatch[1] : `https://t.me/${channel}`,
        pubDate: dateMatch ? dateMatch[2] : new Date().toISOString(),
        source: `t.me/${channel}`,
      }];
    }).slice(-8);
  }));

  let articles = [];
  for (const result of telegramResults) if (result.status === 'fulfilled') articles.push(...result.value);
  if (articles.length === 0) {
    const fallbackResults = await Promise.allSettled(Object.entries(newsFeeds).map(async ([source, url]) => parseRSSItems(await fetchText(url, { signal: AbortSignal.timeout(5000) }), source).slice(0, 5)));
    for (const result of fallbackResults) if (result.status === 'fulfilled') articles.push(...result.value);
  }

  const news = articles.map((article) => {
    const text = article.description || article.title;
    const riskScore = scoreRisk(text);
    const coords = findCoords(text);
    return {
      id: md5((article.link || '') + (article.pubDate || '')),
      title: article.title,
      description: article.description,
      link: article.link,
      published: article.pubDate,
      source: article.source,
      risk_score: riskScore,
      coords: coords ? [coords[0], coords[1]] : null,
      coords_default: !coords,
      machine_assessment: riskScore >= 8 ? 'AI Analysis indicates elevated tactical priority based on OSINT stream patterns.' : null,
    };
  }).sort((a, b) => new Date(b.published).getTime() - new Date(a.published).getTime());

  return { news, total: news.length, timestamp: new Date().toISOString() };
}));

app.get('/api/space-weather', cache(60000, async () => {
  const [kpRes, alertsRes, flareRes] = await Promise.allSettled([
    fetchJson('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json', { signal: AbortSignal.timeout(8000) }),
    fetchJson('https://services.swpc.noaa.gov/json/alerts.json', { signal: AbortSignal.timeout(8000) }),
    fetchJson('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', { signal: AbortSignal.timeout(8000) }),
  ]);
  const latest = kpRes.status === 'fulfilled' && Array.isArray(kpRes.value) ? kpRes.value[kpRes.value.length - 1] : {};
  const kpIndex = Number.parseFloat(latest?.kp_index || latest?.Kp || 0);
  let stormLevel = 'Quiet';
  let stormColor = '#00E676';
  if (kpIndex >= 8) { stormLevel = 'Extreme (G5)'; stormColor = '#FF1744'; }
  else if (kpIndex >= 7) { stormLevel = 'Severe (G4)'; stormColor = '#FF3D3D'; }
  else if (kpIndex >= 6) { stormLevel = 'Strong (G3)'; stormColor = '#FF9500'; }
  else if (kpIndex >= 5) { stormLevel = 'Moderate (G2)'; stormColor = '#FFD700'; }
  else if (kpIndex >= 4) { stormLevel = 'Minor (G1)'; stormColor = '#FFD700'; }
  else if (kpIndex >= 3) { stormLevel = 'Unsettled'; stormColor = '#D4AF37'; }
  return {
    kp_index: kpIndex,
    storm_level: stormLevel,
    storm_color: stormColor,
    kp_timestamp: latest?.time_tag || '',
    alerts: alertsRes.status === 'fulfilled' && Array.isArray(alertsRes.value) ? alertsRes.value.slice(0, 10).map((alert) => ({ id: alert.product_id || `alert-${Date.now()}`, issue_datetime: alert.issue_datetime, message: (alert.message || '').substring(0, 200) })) : [],
    solar_flares: flareRes.status === 'fulfilled' && Array.isArray(flareRes.value) ? flareRes.value.slice(0, 5).filter((flare) => flare.max_class).map((flare) => ({ class: flare.max_class, begin: flare.begin_time, peak: flare.max_time, end: flare.end_time })) : [],
    timestamp: new Date().toISOString(),
  };
}));

app.get('/api/live-news', cache(86400000, async () => {
  const feeds = [
    { id: 'nbcnews', name: 'NBC News NOW', city: 'New York', country: 'US', lat: 40.759, lng: -73.980, url: 'https://www.youtube.com/channel/UCeY0bbntWzzVIaj2z3QigXg/live', embed_allowed: false, category: 'mainstream', language: 'en' },
    { id: 'cbsnews', name: 'CBS News 24/7', city: 'New York', country: 'US', lat: 40.764, lng: -73.973, url: 'https://www.youtube.com/channel/UC8p1vwvWtl6T73JiExfWs1g/live', embed_allowed: false, category: 'mainstream', language: 'en' },
    { id: 'abcnews', name: 'ABC News Live', city: 'New York', country: 'US', lat: 40.763, lng: -73.979, url: 'https://www.youtube.com/channel/UCBi2mrWuNuyYy4gbM6fU18Q/live', embed_allowed: false, category: 'mainstream', language: 'en' },
    { id: 'bloomberg', name: 'Bloomberg TV', city: 'New York', country: 'US', lat: 40.756, lng: -73.988, url: 'https://www.youtube.com/channel/UC_vQ72b7v5n2938v9d5c80w/live', embed_allowed: false, category: 'finance', language: 'en' },
    { id: 'cspan', name: 'C-SPAN', city: 'Washington DC', country: 'US', lat: 38.897, lng: -77.036, url: 'https://www.youtube.com/channel/UCb--64Gl51jIEVE-GLDAVTg/live', embed_allowed: false, category: 'government', language: 'en' },
    { id: 'cbc', name: 'CBC News', city: 'Toronto', country: 'CA', lat: 43.644, lng: -79.387, url: 'https://www.youtube.com/channel/UCKy1dAqELon0zgzZPOz9SVw/live', embed_allowed: false, category: 'mainstream', language: 'en' },
    { id: 'skynews', name: 'Sky News', city: 'London', country: 'GB', lat: 51.500, lng: -0.118, url: 'https://www.youtube.com/embed/live_stream?channel=UCoMdktPbSTixAyNGwb-UYkQ&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'france24en', name: 'France 24 EN', city: 'Paris', country: 'FR', lat: 48.830, lng: 2.280, url: 'https://www.youtube.com/embed/live_stream?channel=UCQfwfsi5VrQ8yKZ-UWmAEFg&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'dwnews', name: 'DW News', city: 'Berlin', country: 'DE', lat: 52.508, lng: 13.376, url: 'https://www.youtube.com/embed/live_stream?channel=UCknLrEdhRCp1aegoMqRaCZg&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'euronews', name: 'Euronews', city: 'Lyon', country: 'FR', lat: 45.764, lng: 4.836, url: 'https://www.youtube.com/embed/live_stream?channel=UCtUbOIRGKZkW7555n6x6q6g&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'trtworld', name: 'TRT World', city: 'Istanbul', country: 'TR', lat: 41.008, lng: 28.978, url: 'https://www.youtube.com/embed/live_stream?channel=UC7fWeaHZQg1p9-4v98L1D1A&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'ukrinform', name: 'UKRINFORM', city: 'Kyiv', country: 'UA', lat: 50.450, lng: 30.523, url: 'https://www.youtube.com/embed/live_stream?channel=UCaDkCK6iFHPE0lmpaYL-WxQ&autoplay=1&mute=1', embed_allowed: true, category: 'conflict', language: 'en' },
    { id: 'aljazeera', name: 'Al Jazeera EN', city: 'Doha', country: 'QA', lat: 25.286, lng: 51.534, url: 'https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'almayadeen', name: 'Al Mayadeen', city: 'Beirut', country: 'LB', lat: 33.888, lng: 35.495, url: 'https://www.youtube.com/embed/live_stream?channel=UCZCFHCU-2eGF7V5ciMkoPHw&autoplay=1&mute=1', embed_allowed: true, category: 'conflict', language: 'ar' },
    { id: 'lbcilebanon', name: 'LBCI Lebanon', city: 'Beirut', country: 'LB', lat: 33.893, lng: 35.501, url: 'https://www.youtube.com/embed/live_stream?channel=UCpE6gpKewomi17XDyPfpFjA&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'ar' },
    { id: 'africanews', name: 'Africanews', city: 'Pointe-Noire', country: 'CG', lat: -4.778, lng: 11.865, url: 'https://www.youtube.com/embed/live_stream?channel=UC5T2fB_W0Z31T0c8yN36a8A&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'sabcnews', name: 'SABC News', city: 'Johannesburg', country: 'ZA', lat: -26.204, lng: 28.047, url: 'https://www.youtube.com/embed/live_stream?channel=UC8yH-uI81UUtEMDsowQyx1g&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'nhkworld', name: 'NHK World', city: 'Tokyo', country: 'JP', lat: 35.690, lng: 139.692, url: 'https://www.youtube.com/embed/live_stream?channel=UCSPEjw8F2nQDtmUKPFNF7_A&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'cna', name: 'CNA 24/7', city: 'Singapore', country: 'SG', lat: 1.290, lng: 103.852, url: 'https://www.youtube.com/embed/live_stream?channel=UC83jt4dlz1Gjl58fzQrrKZg&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'wion', name: 'WION', city: 'New Delhi', country: 'IN', lat: 28.614, lng: 77.209, url: 'https://www.youtube.com/embed/live_stream?channel=UC_gUM8rL-Lrg6O3adPW9K1g&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'abcau', name: 'ABC Australia', city: 'Sydney', country: 'AU', lat: -33.867, lng: 151.207, url: 'https://www.youtube.com/embed/live_stream?channel=UC5iLnYoF4Ryb63YdGD9RfWQ&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'arirang', name: 'Arirang TV', city: 'Seoul', country: 'KR', lat: 37.566, lng: 126.978, url: 'https://www.youtube.com/embed/live_stream?channel=UCw9-5Y1CjW7Qy1Yf5q1y2-Q&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'cgtn', name: 'CGTN', city: 'Beijing', country: 'CN', lat: 39.904, lng: 116.407, url: 'https://www.youtube.com/channel/UCgrNz-aDmcr2uuto8_DL2jg/live', embed_allowed: false, category: 'state', language: 'en' },
    { id: 'telesur', name: 'teleSUR EN', city: 'Caracas', country: 'VE', lat: 10.491, lng: -66.902, url: 'https://www.youtube.com/embed/live_stream?channel=UCmuTmpLY35O3csvhyA6vrkg&autoplay=1&mute=1', embed_allowed: true, category: 'mainstream', language: 'en' },
    { id: 'rt', name: 'RT News', city: 'Moscow', country: 'RU', lat: 55.755, lng: 37.617, url: 'https://rumble.com/c/RTNewsEN', embed_allowed: false, category: 'state', language: 'en' },
  ];
  return { feeds, total: feeds.length, categories: ['mainstream', 'government', 'finance', 'conflict', 'state'], timestamp: new Date().toISOString() };
}));

app.get('/api/country-risk', cache(300000, async () => {
  const riskFactors = {
    UA: { base: 85, tags: ['active_conflict', 'infrastructure_damage'] }, RU: { base: 72, tags: ['sanctions', 'military_mobilization'] },
    IL: { base: 78, tags: ['active_conflict', 'regional_instability'] }, PS: { base: 90, tags: ['active_conflict', 'humanitarian_crisis'] },
    SY: { base: 82, tags: ['post_conflict', 'infrastructure_damage'] }, YE: { base: 88, tags: ['active_conflict', 'humanitarian_crisis'] },
    MM: { base: 76, tags: ['civil_unrest', 'military_junta'] }, SD: { base: 84, tags: ['active_conflict', 'humanitarian_crisis'] },
    AF: { base: 80, tags: ['post_conflict', 'governance_collapse'] }, KP: { base: 70, tags: ['nuclear_risk', 'isolation'] },
    IR: { base: 68, tags: ['sanctions', 'nuclear_program', 'regional_proxy'] }, CN: { base: 35, tags: ['strategic_competition', 'taiwan_tensions'] },
    TW: { base: 45, tags: ['invasion_risk', 'semiconductor_dependency'] }, VE: { base: 60, tags: ['economic_collapse', 'political_instability'] },
    HT: { base: 85, tags: ['gang_violence', 'governance_collapse'] }, LB: { base: 65, tags: ['economic_crisis', 'political_deadlock'] },
    PK: { base: 55, tags: ['terrorism', 'political_instability'] }, SO: { base: 82, tags: ['terrorism', 'state_fragility'] },
    LY: { base: 72, tags: ['divided_government', 'militia_control'] }, ET: { base: 62, tags: ['ethnic_tensions', 'regional_conflicts'] },
  };
  const exchangeStatus = exchanges.map((exchange) => ({ name: exchange.name, country: exchange.country, open: isExchangeOpen(exchange) }));
  const countries = Object.entries(riskFactors).map(([code, data]) => ({
    code,
    risk_score: data.base,
    risk_level: data.base >= 80 ? 'CRITICAL' : data.base >= 60 ? 'HIGH' : data.base >= 40 ? 'ELEVATED' : 'LOW',
    tags: data.tags,
  })).sort((a, b) => b.risk_score - a.risk_score);
  return { countries, exchanges: exchangeStatus, open_exchanges: exchangeStatus.filter((exchange) => exchange.open).length, total_exchanges: exchangeStatus.length, timestamp: new Date().toISOString() };
}));

app.get('/api/cyber-threats', cache(300000, async () => {
  const results = { threats: [], stats: {}, timestamp: new Date().toISOString() };
  try {
    const data = await fetchJson('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { signal: AbortSignal.timeout(10000) });
    results.threats.push(...(data.vulnerabilities || []).filter((vulnerability) => {
      const daysAgo = (Date.now() - new Date(vulnerability.dateAdded).getTime()) / (1000 * 60 * 60 * 24);
      return daysAgo <= 30;
    }).slice(0, 10).map((vulnerability) => ({
      id: vulnerability.cveID,
      name: vulnerability.vulnerabilityName,
      vendor: vulnerability.vendorProject,
      product: vulnerability.product,
      severity: 'CRITICAL',
      date: vulnerability.dateAdded,
      due: vulnerability.dueDate,
      source: 'CISA KEV',
    })));
    results.stats.cisa_total = data.vulnerabilities?.length || 0;
  } catch {
    results.stats.cisa_total = 0;
  }
  results.stats.active_cves = results.threats.length;
  results.stats.threat_level = results.threats.length >= 8 ? 'CRITICAL' : results.threats.length >= 4 ? 'HIGH' : 'ELEVATED';
  return results;
}));

app.get('/api/gdelt', cache(300000, async () => {
  const rssFeeds = [
    { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'BBC World' },
    { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'Al Jazeera' },
    { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', source: 'NYT World' },
  ];
  const geoDict = {
    ukraine: [31.1656, 48.3794], kyiv: [30.5234, 50.4501], russia: [37.6173, 55.7558], moscow: [37.6173, 55.7558],
    gaza: [34.4668, 31.5017], israel: [34.8516, 31.0461], 'tel aviv': [34.7818, 32.0853], palestine: [35.2332, 31.9522],
    iran: [53.6880, 32.4279], tehran: [51.3890, 35.6892], syria: [38.9968, 34.8021], lebanon: [35.8623, 33.8547],
    beirut: [35.5018, 33.8938], yemen: [47.5868, 15.5527], houthi: [44.2066, 15.3694], sudan: [30.2176, 12.8628],
    china: [116.4074, 39.9042], taiwan: [120.9605, 23.6978], korea: [127.7669, 35.9078], usa: [-77.0369, 38.9072],
    myanmar: [95.9560, 21.9162], haiti: [-72.2852, 18.9712], somalia: [46.1996, 5.1521], bulgaria: [25.4858, 42.7339],
    serbia: [21.0059, 44.0165], greece: [21.8243, 39.0742], turkey: [35.2433, 38.9637], macedonia: [21.7453, 41.6086],
    romania: [24.9668, 45.9432], france: [2.2137, 46.2276], germany: [10.4515, 51.1657], uk: [-3.4359, 55.3781],
    mexico: [-102.5528, 23.6345],
  };
  const conflictKeywords = ['attack', 'strike', 'missile', 'drone', 'war', 'troops', 'military', 'protest', 'riot', 'police', 'clash', 'bomb', 'killed', 'forces'];
  const events = [];
  let eventId = 0;

  for (const feed of rssFeeds) {
    try {
      const xml = await fetchText(feed.url, { signal: AbortSignal.timeout(5000) });
      const items = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
      for (const item of items) {
        const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/i) || item.match(/<title>(.*?)<\/title>/i);
        const linkMatch = item.match(/<link>(.*?)<\/link>/i);
        const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/i) || item.match(/<description>(.*?)<\/description>/i);
        if (!titleMatch || !linkMatch) continue;
        const title = stripHtml(titleMatch[1]);
        const link = linkMatch[1];
        const description = descMatch ? stripHtml(descMatch[1]) : '';
        const searchText = `${title} ${description}`.toLowerCase();
        if (!conflictKeywords.some((keyword) => searchText.includes(keyword))) continue;
        for (const [location, point] of Object.entries(geoDict)) {
          if (!new RegExp(`\\b${location}\\b`, 'i').test(searchText)) continue;
          const jitterLng = ((((eventId * 137.5) % 200) - 100) / 100) * 1.5;
          const jitterLat = ((((eventId * 251.3) % 200) - 100) / 100) * 1.5;
          events.push({
            id: `osint-${feed.source.replace(/\s+/g, '')}-${eventId++}`,
            lat: point[1] + jitterLat,
            lng: point[0] + jitterLng,
            name: `[${feed.source}] ${title}`,
            url: link,
            html: `<a href="${link}" target="_blank">${title}</a><br/><i>Source: ${feed.source}</i>`,
            type: 'conflict',
          });
          break;
        }
      }
    } catch (err) {
      console.warn('[AutoNateAI Intel Functions] GDELT feed failed', feed.source, err instanceof Error ? err.message : err);
    }
  }

  return { events, gdelt: events, total: events.length, timestamp: new Date().toISOString(), source: 'OSINT RSS Mapping' };
}));

app.get('/api/weather', cache(300000, async () => {
  const data = await fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100', { signal: AbortSignal.timeout(10000) });
  const events = [];
  for (const event of data.events || []) {
    const geom = event.geometry && event.geometry.length > 0 ? event.geometry[event.geometry.length - 1] : null;
    if (!geom || geom.type !== 'Point') continue;
    const category = event.categories?.[0]?.id || 'unknown';
    if (category === 'wildfires' || category === 'earthquakes') continue;
    let type = event.categories?.[0]?.title || 'Anomaly';
    let icon = 'alert';
    let severity = 'low';
    if (category === 'severeStorms') { type = 'Severe Storm'; icon = 'cyclone'; severity = 'high'; }
    else if (category === 'volcanoes') { type = 'Volcano Eruption'; icon = 'volcano'; severity = 'high'; }
    else if (category === 'seaIce') { type = 'Iceberg / Sea Ice'; icon = 'ice'; severity = 'medium'; }
    events.push({
      id: event.id,
      title: event.title,
      category,
      type,
      icon,
      severity,
      lat: geom.coordinates[1],
      lng: geom.coordinates[0],
      date: geom.date,
      source: event.sources?.[0]?.url || 'NASA EONET',
    });
  }
  return { events, weather_events: events, total: events.length, timestamp: new Date().toISOString() };
}));

app.get('/api/air-quality', cache(600000, async () => {
  const data = await fetchJson('https://api.openaq.org/v2/latest?limit=500&parameter=pm25&order_by=lastUpdated&sort=desc', {
    signal: AbortSignal.timeout(10000),
    headers: { Accept: 'application/json' },
  });
  const stations = [];
  for (const location of data.results || []) {
    if (!location.coordinates?.latitude || !location.coordinates?.longitude) continue;
    const pm25 = location.measurements?.find((measurement) => measurement.parameter === 'pm25');
    if (!pm25) continue;
    const value = pm25.value;
    let level = 'Good';
    let color = '#00E676';
    if (value > 150) { level = 'Hazardous'; color = '#8B0000'; }
    else if (value > 100) { level = 'Unhealthy'; color = '#FF1744'; }
    else if (value > 55) { level = 'Unhealthy (Sensitive)'; color = '#FF9500'; }
    else if (value > 35) { level = 'Moderate'; color = '#FFD700'; }
    stations.push({
      id: `aq-${location.location}`,
      name: location.location,
      city: location.city || 'Unknown',
      country: location.country,
      lat: location.coordinates.latitude,
      lng: location.coordinates.longitude,
      pm25: value,
      unit: pm25.unit,
      level,
      color,
      lastUpdated: pm25.lastUpdated,
    });
  }
  return { stations, total: stations.length, timestamp: new Date().toISOString() };
}));

app.get('/api/frontlines', cache(1800000, async () => {
  const frontlines = await fetchJson('https://deepstatemap.live/api/history/last', { signal: AbortSignal.timeout(10000) }).catch(() => null);
  return { frontlines, timestamp: new Date().toISOString() };
}));

app.get('/api/fires', cache(600000, async () => {
  let fires = [];
  let source = '';
  const sources = [
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv',
    'https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv',
  ];
  for (const url of sources) {
    try {
      const text = await fetchText(url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'AutoNateAI-Intel/3.5' },
      });
      if (text.includes('latitude') && text.length > 200) {
        fires = parseFireCsv(text);
        source = url.includes('SUOMI') ? 'NASA-FIRMS (VIIRS)' : 'NASA-FIRMS (MODIS)';
        if (fires.length) break;
      }
    } catch {
      // Try the next open feed.
    }
  }
  try {
    const volcanoData = await fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes&limit=50', { signal: AbortSignal.timeout(10000) });
    fires.push(...(volcanoData.events || []).map((event) => {
      const geo = event.geometry?.[event.geometry.length - 1];
      if (!geo?.coordinates) return null;
      return {
        lat: geo.coordinates[1],
        lng: geo.coordinates[0],
        brightness: 500,
        confidence: 'high',
        date: geo.date?.split('T')[0] || '',
        time: '',
        frp: 100,
        title: `[VOLCANO] ${event.title}`,
        type: 'volcano',
      };
    }).filter(Boolean));
    if (!source) source = 'NASA-EONET';
  } catch {
    // Volcano enrichment is optional.
  }
  return { fires, total: fires.length, source: source || 'Unknown', timestamp: new Date().toISOString() };
}));

app.get('/api/maritime', cache(300000, async () => {
  const ports = [
    { name: 'Shanghai', country: 'CN', lat: 31.23, lng: 121.47, type: 'container', volume: '47.3M TEU', rank: 1 },
    { name: 'Singapore', country: 'SG', lat: 1.26, lng: 103.84, type: 'container', volume: '37.2M TEU', rank: 2 },
    { name: 'Ningbo-Zhoushan', country: 'CN', lat: 29.87, lng: 121.55, type: 'container', volume: '33.3M TEU', rank: 3 },
    { name: 'Shenzhen', country: 'CN', lat: 22.54, lng: 114.05, type: 'container', volume: '30.0M TEU', rank: 4 },
    { name: 'Guangzhou', country: 'CN', lat: 23.08, lng: 113.32, type: 'container', volume: '24.2M TEU', rank: 5 },
    { name: 'Busan', country: 'KR', lat: 35.10, lng: 129.04, type: 'container', volume: '22.7M TEU', rank: 6 },
    { name: 'Rotterdam', country: 'NL', lat: 51.90, lng: 4.50, type: 'container', volume: '14.5M TEU', rank: 8 },
    { name: 'Los Angeles', country: 'US', lat: 33.74, lng: -118.27, type: 'container', volume: '9.9M TEU', rank: 13 },
    { name: 'Norfolk Naval Station', country: 'US', lat: 36.95, lng: -76.33, type: 'naval', fleet: 'US Atlantic Fleet' },
    { name: 'Yokosuka', country: 'JP', lat: 35.28, lng: 139.67, type: 'naval', fleet: 'US 7th Fleet' },
    { name: 'Tartus', country: 'SY', lat: 34.89, lng: 35.89, type: 'naval', fleet: 'Russian Mediterranean' },
    { name: 'Zhanjiang', country: 'CN', lat: 21.20, lng: 110.39, type: 'naval', fleet: 'PLA Navy South Sea Fleet' },
  ];
  const chokepoints = [
    { name: 'Strait of Hormuz', lat: 26.57, lng: 56.25, traffic: '21M bpd oil', risk: 'HIGH' },
    { name: 'Strait of Malacca', lat: 2.50, lng: 101.50, traffic: '16M bpd oil', risk: 'MODERATE' },
    { name: 'Suez Canal', lat: 30.43, lng: 32.34, traffic: '12% world trade', risk: 'ELEVATED' },
    { name: 'Bab el-Mandeb', lat: 12.58, lng: 43.33, traffic: '6.2M bpd oil', risk: 'CRITICAL' },
    { name: 'Panama Canal', lat: 9.08, lng: -79.68, traffic: '5% world trade', risk: 'LOW' },
    { name: 'Taiwan Strait', lat: 24.00, lng: 119.00, traffic: '88% large ships', risk: 'ELEVATED' },
  ];
  return { ports, chokepoints, ships: [], total_ports: ports.length, total_chokepoints: chokepoints.length, total_ships: 0, timestamp: new Date().toISOString() };
}));

app.get('/api/flights', cache(45000, async () => {
  const regionResults = await Promise.allSettled(flightRegions.map((region) => fetchFlightRegion(region)));
  const allRaw = [];
  const seenHex = new Set();
  for (const result of regionResults) {
    if (result.status !== 'fulfilled') continue;
    for (const aircraft of result.value) {
      const hex = (aircraft.hex || '').toLowerCase().trim();
      if (hex && !seenHex.has(hex)) {
        seenHex.add(hex);
        allRaw.push(aircraft);
      }
    }
  }

  const commercial = [];
  const privateFlights = [];
  const privateJets = [];
  const military = [];
  const gpsJamming = [];
  for (const raw of allRaw) {
    const flight = classifyFlight(raw);
    if (!flight) continue;
    if (typeof flight.nac_p === 'number' && flight.nac_p <= 4 && !flight.grounded) {
      gpsJamming.push({ lat: flight.lat, lng: flight.lng, nac_p: flight.nac_p, callsign: flight.callsign });
    }
    if (flight.category === 'military') military.push(flight);
    else if (flight.category === 'jet') privateJets.push(flight);
    else if (flight.category === 'private') privateFlights.push(flight);
    else commercial.push(flight);
  }

  return {
    commercial_flights: commercial,
    private_flights: privateFlights,
    private_jets: privateJets,
    military_flights: military,
    gps_jamming: aggregateJamming(gpsJamming, 4),
    total: allRaw.length,
    timestamp: new Date().toISOString(),
  };
}));

app.get('/api/satellites', cache(120000, async () => {
  let source = 'memory-cache';
  if (!cachedTles.length || Date.now() - cachedTleTime > 3600000) {
    const data = await fetchJson('https://db.satnogs.org/api/tle/?format=json', {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'application/json' },
    }).catch(() => null);
    if (Array.isArray(data)) {
      const seen = new Set();
      const fetched = [];
      for (const item of data) {
        const name = (item.tle0 || '').trim().replace(/^0\s+/, '');
        if (name && item.tle1 && item.tle2 && !seen.has(name)) {
          seen.add(name);
          fetched.push({ name, line1: item.tle1.trim(), line2: item.tle2.trim() });
        }
      }
      if (fetched.length) {
        cachedTles = fetched;
        cachedTleTime = Date.now();
        source = 'satnogs-api';
      }
    }
  }

  let allSats = cachedTles;
  if (!allSats.length) {
    const fallback = '1 25544U 98067A   24146.40251785  .00015505  00000-0  27885-3 0  9997\n2 25544  51.6402 189.7042 0004381 334.8091 106.8778 15.50091157455243';
    allSats = [{ name: 'ISS (FALLBACK)', line1: fallback.split('\n')[0], line2: fallback.split('\n')[1] }];
    source = 'emergency-fallback';
  }

  const sampled = allSats.length > 2000 ? allSats.filter((_, i) => i % Math.ceil(allSats.length / 2000) === 0) : allSats;
  const satellites = [];
  for (const sat of sampled) {
    const pos = propagateSatellite(sat.line1, sat.line2);
    if (!pos) continue;
    const classification = classifySatellite(sat.name);
    satellites.push({
      name: sat.name,
      lat: pos.lat,
      lng: pos.lng,
      alt: pos.alt,
      mission: classification.mission,
      color: classification.color,
      noradId: sat.line1.substring(2, 7).trim(),
    });
  }

  return { satellites, total: satellites.length, source, raw_count: allSats.length, timestamp: new Date().toISOString() };
}));

app.get('/api/cctv', cache(300000, async (req) => {
  const regionFetchers = {
    uk: fetchTflCameras,
    'us-west': async () => [...await fetchWsdotCameras(), ...await fetchCaltransCameras()],
    'us-east': fetchUsEastCameras,
    'us-central': fetchUsCentralCameras,
    canada: fetchCanadaCameras,
    europe: fetchEuropeCameras,
    asia: fetchAsiaCameras,
  };
  const requestedRegion = req.query.region;
  const regions = requestedRegion === 'all' || !requestedRegion
    ? Object.keys(regionFetchers)
    : String(requestedRegion).split(',').filter((region) => region in regionFetchers);
  const results = await Promise.allSettled(regions.map((region) => regionFetchers[region]()));
  const cameras = [];
  const sources = {};
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const camera of result.value) {
      cameras.push(camera);
      sources[camera.source] = (sources[camera.source] || 0) + 1;
    }
  }
  return { cameras, total: cameras.length, sources, regions, timestamp: new Date().toISOString() };
}));

app.get('/api/infrastructure', cache(86400000, async () => ({
  infrastructure: nuclearFacilities,
  total: nuclearFacilities.length,
  timestamp: new Date().toISOString(),
})));

app.get('/api/region-dossier', cache(3600000, async (req) => {
  const lat = Number.parseFloat(req.query.lat || '0');
  const lng = Number.parseFloat(req.query.lng || '0');
  const geoData = await fetchJson(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=5&addressdetails=1`, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'AutoNateAIIntel/1.0' },
  }).catch(() => ({}));
  const address = geoData.address || {};
  const countryName = address.country || '';
  const countryCode = address.country_code?.toUpperCase() || '';
  const locationInfo = {
    city: address.city || address.town || address.village || '',
    state: address.state || address.region || '',
    country: countryName,
    country_code: countryCode,
    display_name: geoData.display_name,
  };
  const [countryResult, wikiResult] = await Promise.allSettled([
    countryCode ? fetchJson(`https://restcountries.com/v3.1/alpha/${countryCode}?fields=name,capital,population,area,region,subregion,languages,currencies,flag,flags,timezones`, { signal: AbortSignal.timeout(5000) }) : null,
    (locationInfo.city || countryName) ? fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(locationInfo.city || countryName)}`, { signal: AbortSignal.timeout(5000) }).catch(() => null) : null,
  ]);
  const countryData = countryResult.status === 'fulfilled' ? countryResult.value : null;
  const wiki = wikiResult.status === 'fulfilled' ? wikiResult.value : null;
  return {
    coordinates: { lat, lng },
    location: locationInfo,
    country: countryData ? {
      name: countryData.name?.common,
      official_name: countryData.name?.official,
      capital: countryData.capital?.[0],
      population: countryData.population,
      area: countryData.area,
      region: countryData.region,
      subregion: countryData.subregion,
      languages: countryData.languages ? Object.values(countryData.languages) : [],
      currencies: countryData.currencies ? Object.entries(countryData.currencies).map(([code, info]) => `${info.name} (${info.symbol || code})`) : [],
      flag: countryData.flag,
      flag_url: countryData.flags?.svg,
      timezones: countryData.timezones,
    } : null,
    head_of_state: null,
    wikipedia: wiki ? { title: wiki.title, extract: wiki.extract?.substring(0, 500), thumbnail: wiki.thumbnail?.source } : null,
    timestamp: new Date().toISOString(),
  };
}));

app.get('/api/hud-pha-flows', cache(300000, async (req) => {
  const state = req.query.state ? String(req.query.state).toUpperCase() : '';
  let phaQuery = db.collection('hud_phas').orderBy('total_amount', 'desc').limit(5000);
  if (state && stateCodes.has(state)) phaQuery = db.collection('hud_phas').where('state', '==', state).orderBy('total_amount', 'desc').limit(5000);
  const [phaSnap, awardSnap, profileSnap, ecosystemSnap] = await Promise.all([
    phaQuery.get(),
    db.collection('hud_pha_awards').orderBy('start_date', 'desc').limit(250).get(),
    db.collection('pha_funding_profile').where('fiscal_year', '==', new Date().getUTCFullYear()).limit(5000).get(),
    db.collection('pha_ecosystem_summary').limit(5000).get(),
  ]);
  const awards = awardSnap.docs.map((doc) => doc.data()).filter((award) => !state || award.recipient_state === state);
  const profiles = new Map(profileSnap.docs.map((doc) => [doc.data().pha_code, doc.data()]));
  const ecosystems = new Map(ecosystemSnap.docs.map((doc) => [doc.data().pha_code, doc.data()]));
  const phas = phaSnap.docs.map((doc) => {
    const pha = doc.data();
    const decorated = typeof pha.flow_score === 'number' && pha.flow_bucket ? pha : decoratePhaForMap(pha, awards);
    const code = decorated.participant_code || decorated.id;
    return {
      ...decorated,
      funding_profile: profiles.get(code) || null,
      ecosystem_summary: ecosystems.get(code) || null,
    };
  });
  const stateTotals = {};
  for (const pha of phas) {
    const bucket = stateTotals[pha.state] || { state: pha.state, total_amount: 0, pha_count: 0, award_count: 0, ...centroidForState(pha.state) };
    bucket.total_amount += Number(pha.total_amount || 0);
    bucket.pha_count += 1;
    bucket.award_count += Number(pha.award_count || 0);
    stateTotals[pha.state] = bucket;
  }
  return {
    phas,
    awards,
    state_totals: Object.values(stateTotals),
    total_phas: phas.length,
    total_awards: awards.length,
    timestamp: new Date().toISOString(),
  };
}));

app.get('/api/sbir-recipients', cache(300000, async (req) => {
  const state = req.query.state ? String(req.query.state).toUpperCase() : '';
  const startYear = Math.max(2010, Math.min(2030, Number(req.query.start_year || 2025)));
  const endYear = Math.max(startYear, Math.min(2030, Number(req.query.end_year || 2030)));
  const limit = Math.min(Number(req.query.limit || 20000), 25000);
  let query = db.collection('sbir_recipients').orderBy('total_awarded', 'desc').limit(limit);
  if (state && stateCodes.has(state)) {
    query = db.collection('sbir_recipients').where('state_code', '==', state).orderBy('total_awarded', 'desc').limit(limit);
  }
  const snap = await query.get();
  const recipients = snap.docs.map((doc) => {
    const recipient = doc.data();
    const awardsByYear = recipient.awards_by_year || {};
    const amountByYear = recipient.amount_by_year || {};
    const hasYearRollup = Object.keys(awardsByYear).length > 0 || Object.keys(amountByYear).length > 0;
    if (!hasYearRollup) return recipient;
    let awardCount = 0;
    let totalAwarded = 0;
    let firstAwardDate = '';
    let latestAwardDate = '';
    for (let year = startYear; year <= endYear; year++) {
      awardCount += Number(awardsByYear[String(year)] || 0);
      totalAwarded += Number(amountByYear[String(year)] || 0);
      if (recipient.first_award_by_year?.[String(year)] && (!firstAwardDate || recipient.first_award_by_year[String(year)] < firstAwardDate)) {
        firstAwardDate = recipient.first_award_by_year[String(year)];
      }
      if (recipient.latest_award_by_year?.[String(year)] && recipient.latest_award_by_year[String(year)] > latestAwardDate) {
        latestAwardDate = recipient.latest_award_by_year[String(year)];
      }
    }
    const daysSinceLatest = latestAwardDate ? Math.max(0, Math.round((Date.now() - new Date(latestAwardDate).getTime()) / 86400000)) : 99999;
    const recencyScore = Math.max(0, Math.min(100, 100 - (daysSinceLatest / 1095) * 100));
    const opportunityScore = Math.round(
      Math.min(totalAwarded / 250000, 45) +
      Math.min(awardCount * 1.6, 25) +
      Math.min(Object.entries(awardsByYear).filter(([year, count]) => Number(year) >= startYear && Number(year) <= endYear && Number(count) > 0).length * 2, 18) +
      recencyScore * 0.18
    );
    return {
      ...recipient,
      award_count: awardCount,
      total_awarded: Math.round(totalAwarded * 100) / 100,
      recent_awarded: totalAwarded,
      first_award_date: firstAwardDate,
      latest_award_date: latestAwardDate,
      recency_score: Math.round(recencyScore),
      opportunity_score: Math.min(100, opportunityScore),
      activity_bucket: recencyScore >= 80 ? 'hot' : recencyScore >= 45 ? 'warm' : recencyScore >= 10 ? 'steady' : 'dormant',
      year_range: `${startYear}-${endYear}`,
    };
  }).filter((recipient) => Number(recipient.award_count || 0) > 0);
  const stateTotals = {};
  for (const recipient of recipients) {
    const code = recipient.state_code || 'NA';
    const bucket = stateTotals[code] || {
      state_code: code,
      state_name: code,
      recipient_count: 0,
      award_count: 0,
      total_awarded: 0,
      ...centroidForState(code),
    };
    bucket.recipient_count += 1;
    bucket.award_count += Number(recipient.award_count || 0);
    bucket.total_awarded += Number(recipient.total_awarded || 0);
    stateTotals[code] = bucket;
  }
  return {
    recipients,
    state_totals: Object.values(stateTotals),
    total_recipients: recipients.length,
    since: `${startYear}-01-01`,
    through: `${endYear}-12-31`,
    year_range: { start_year: startYear, end_year: endYear },
    source: 'SBIR.gov bulk awards via Public Funding Intelligence',
    timestamp: new Date().toISOString(),
  };
}));

async function readCapabilityCollection(collectionName, req) {
  const state = req.query.state ? String(req.query.state).toUpperCase() : '';
  const limit = Math.min(Number(req.query.limit || 5000), 10000);
  let query = db.collection(collectionName).limit(limit);
  if (state && stateCodes.has(state)) query = db.collection(collectionName).where('state', '==', state).limit(limit);
  const snap = await query.get();
  const orgs = snap.docs.map((doc) => doc.data()).sort((a, b) => Number(b.total_obligations || b.student_size || b.data_confidence || 0) - Number(a.total_obligations || a.student_size || a.data_confidence || 0));
  return { orgs, total: orgs.length, timestamp: new Date().toISOString() };
}

app.get('/api/education-orgs', cache(300000, async (req) => readCapabilityCollection('education_orgs', req)));
app.get('/api/workforce-orgs', cache(300000, async (req) => readCapabilityCollection('workforce_orgs', req)));
app.get('/api/workforce-funding-recipients', cache(300000, async (req) => readCapabilityCollection('workforce_funding_recipients', req)));
app.get('/api/health-orgs', cache(300000, async (req) => readCapabilityCollection('health_orgs', req)));
app.get('/api/funded-faith-orgs', cache(300000, async (req) => readCapabilityCollection('funded_faith_orgs', req)));

app.get('/api/sikeston-businesses', cache(300000, async () => {
  let snap = await db.collection('sikeston_businesses').limit(1000).get();
  if (snap.empty) {
    const businesses = await fetchSikestonBusinesses({ geocode: false, limit: 400 });
    return { businesses, total: businesses.length, source: `${SIK_ESTON_BASE}/list`, timestamp: new Date().toISOString(), persisted: false };
  }
  const businesses = snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { businesses, total: businesses.length, source: `${SIK_ESTON_BASE}/list`, timestamp: new Date().toISOString(), persisted: true };
}));

app.get('/api/sikeston-events', cache(300000, async () => {
  let snap = await db.collection('sikeston_events').limit(500).get();
  if (snap.empty) {
    const events = await fetchSikestonEvents({ geocode: false, limit: 200 });
    return { events, total: events.length, source: `${SIK_ESTON_BASE}/events/calendar`, timestamp: new Date().toISOString(), persisted: false };
  }
  const events = snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
  return { events, total: events.length, source: `${SIK_ESTON_BASE}/events/calendar`, timestamp: new Date().toISOString(), persisted: true };
}));

app.all('/api/sikeston/update', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 400), 800);
    const geocode = String(req.query.geocode ?? req.body?.geocode ?? '1') !== '0';
    const [businesses, events] = await Promise.all([
      fetchSikestonBusinesses({ geocode, limit }),
      fetchSikestonEvents({ geocode, limit: 250 }),
    ]);
    await clearCollection('sikeston_businesses');
    await clearCollection('sikeston_events');
    await writeCollection('sikeston_businesses', businesses);
    await writeCollection('sikeston_events', events);
    jsonCache.clear();
    res.json({
      inserted_or_updated: { businesses: businesses.length, events: events.length },
      geocode,
      business_geocoded: businesses.filter((b) => b.data_confidence >= 90).length,
      event_geocoded: events.filter((e) => e.data_confidence >= 80).length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Sikeston update failed', err);
    res.status(500).json({ error: 'Sikeston update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/hopewell-businesses', cache(300000, async () => {
  let snap = await db.collection('hopewell_businesses').limit(1200).get();
  if (snap.empty) {
    const businesses = await fetchHopewellBusinesses({ geocode: false, limit: 600 });
    return { businesses, total: businesses.length, source: `${HOPEWELL_BASE}/members/`, timestamp: new Date().toISOString(), persisted: false };
  }
  const businesses = snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  return { businesses, total: businesses.length, source: `${HOPEWELL_BASE}/members/`, timestamp: new Date().toISOString(), persisted: true };
}));

app.get('/api/hopewell-events', cache(300000, async () => {
  let snap = await db.collection('hopewell_events').limit(500).get();
  if (snap.empty) {
    const events = await fetchHopewellEvents({ geocode: false, limit: 250 });
    return { events, total: events.length, source: `${HOPEWELL_BASE}/events/calendar`, timestamp: new Date().toISOString(), persisted: false };
  }
  const events = snap.docs.map((doc) => doc.data()).sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')));
  return { events, total: events.length, source: `${HOPEWELL_BASE}/events/calendar`, timestamp: new Date().toISOString(), persisted: true };
}));

app.all('/api/hopewell/update', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 600), 1000);
    const geocode = String(req.query.geocode ?? req.body?.geocode ?? '1') !== '0';
    const [businesses, events] = await Promise.all([
      fetchHopewellBusinesses({ geocode, limit }),
      fetchHopewellEvents({ geocode, limit: 250 }),
    ]);
    await clearCollection('hopewell_businesses');
    await clearCollection('hopewell_events');
    await writeCollection('hopewell_businesses', businesses);
    await writeCollection('hopewell_events', events);
    jsonCache.clear();
    res.json({
      inserted_or_updated: { businesses: businesses.length, events: events.length },
      geocode,
      business_geocoded: businesses.filter((b) => b.data_confidence >= 90).length,
      event_geocoded: events.filter((e) => e.data_confidence >= 80).length,
      event_window: '2026-06-01 through 2026-12-31',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Hopewell update failed', err);
    res.status(500).json({ error: 'Hopewell update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/university-research', cache(300000, async () => {
  let snap = await db.collection('university_research_signals').orderBy('opportunity_score', 'desc').limit(150).get();
  if (snap.empty) {
    const seeded = researchUniversities.map((u, index) => ({
      ...u,
      id: u.id,
      type: 'university_research',
      rank_seed: index + 1,
      repo_count: 0,
      org_count: Array.isArray(u.github_orgs) ? u.github_orgs.length : 0,
      arxiv_paper_count: 0,
      total_stars: 0,
      total_forks: 0,
      opportunity_score: 10,
      top_momentum_score: 0,
      top_repos: [],
      recent_papers: [],
      narrative: `${u.short_name} is seeded for university research intelligence monitoring.`,
      last_scanned: '',
    }));
    return { universities: seeded, total: seeded.length, persisted: false, timestamp: new Date().toISOString() };
  }
  const universities = snap.docs.map((doc) => doc.data());
  return { universities, total: universities.length, persisted: true, timestamp: new Date().toISOString() };
}));

app.get('/api/university-research/repos', cache(300000, async (req) => {
  const universityId = String(req.query.university_id || '');
  const limit = Math.min(Number(req.query.limit || 500), 2000);
  let query = db.collection('github_university_repos').orderBy('momentum_score', 'desc').limit(limit);
  if (universityId) query = db.collection('github_university_repos').where('university_id', '==', universityId).limit(limit);
  const snap = await query.get();
  const repos = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => Number(b.momentum_score || 0) - Number(a.momentum_score || 0));
  return { repos, total: repos.length, timestamp: new Date().toISOString() };
}));

app.get('/api/university-research/papers', cache(300000, async (req) => {
  const universityId = String(req.query.university_id || '');
  const limit = Math.min(Number(req.query.limit || 500), 2000);
  let query = db.collection('arxiv_papers').orderBy('published_at', 'desc').limit(limit);
  if (universityId) query = db.collection('arxiv_papers').where('university_id', '==', universityId).limit(limit);
  const snap = await query.get();
  const papers = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
  return { papers, total: papers.length, timestamp: new Date().toISOString() };
}));

app.get('/api/university-research/snapshots', cache(300000, async (req) => {
  const universityId = String(req.query.university_id || '');
  const repoId = String(req.query.repo_id || '');
  const limit = Math.min(Number(req.query.limit || 500), 2000);
  let query = db.collection('github_repo_snapshots').limit(limit);
  if (repoId) query = db.collection('github_repo_snapshots').where('repo_id', '==', repoId).limit(limit);
  else if (universityId) query = db.collection('github_repo_snapshots').where('university_id', '==', universityId).limit(limit);
  else query = db.collection('github_repo_snapshots').orderBy('snapshot_at', 'desc').limit(limit);
  const snap = await query.get();
  const snapshots = snap.docs
    .map((doc) => doc.data())
    .sort((a, b) => String(b.snapshot_at || '').localeCompare(String(a.snapshot_at || '')));
  return { snapshots, total: snapshots.length, timestamp: new Date().toISOString() };
}));

app.all('/api/university-research/update', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 100), 100);
    const repoLimit = Math.min(Number(req.query.repo_limit || req.body?.repo_limit || 5), 20);
    const arxivLimit = Math.min(Number(req.query.arxiv_limit || req.body?.arxiv_limit || 5), 20);
    const arxivBackfill = String(req.query.arxiv_backfill || req.body?.arxiv_backfill || '').toLowerCase() === 'true';
    const result = await runUniversityResearchScan({ limit, repoLimit, arxivLimit, arxivBackfill });
    res.json(result);
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] University research update failed', err);
    res.status(500).json({ error: 'University research update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/community-capability-summary', cache(300000, async () => {
  const snap = await db.collection('community_capability_summary').limit(200).get();
  const summaries = snap.docs.map((doc) => doc.data());
  return { summaries, total: summaries.length, timestamp: new Date().toISOString() };
}));

app.all('/api/hud-pha-flows/update', async (req, res) => {
  try {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const start = req.query.start || req.body?.start || yesterday.toISOString().slice(0, 10);
    const end = req.query.end || req.body?.end || yesterday.toISOString().slice(0, 10);
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 100), 100);
    const pages = Math.min(Number(req.query.pages || req.body?.pages || 3), 10);
    const awards = await searchHudPhaAwards(start, end, limit, pages);
    await persistHudAwards(awards);
    const scored = await recomputeHudPhaScores();
    res.json({ inserted_or_updated: awards.length, scored, start, end, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] HUD PHA update failed', err);
    res.status(500).json({ error: 'HUD PHA update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/federal-power', cache(86400000, async () => {
  let snap = await db.collection('federal_power').limit(700).get();
  if (snap.empty) {
    await updatePowerMap();
    snap = await db.collection('federal_power').limit(700).get();
  }
  const people = snap.docs.map((doc) => doc.data());
  return { people, total: people.length, timestamp: new Date().toISOString() };
}));

app.all('/api/hud-pha-flows/update-roster', async (_req, res) => {
  try {
    const roster = await fetchHudPhaRoster();
    await persistHudPhaRoster(roster);
    const scored = await recomputeHudPhaScores();
    res.json({ inserted_or_updated: roster.length, scored, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] HUD PHA roster update failed', err);
    res.status(500).json({ error: 'HUD PHA roster update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/hud-pha-flows/recompute', async (_req, res) => {
  try {
    const scored = await recomputeHudPhaScores();
    res.json({ scored, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] HUD PHA score recompute failed', err);
    res.status(500).json({ error: 'HUD PHA score recompute failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/hud-pha-flows/recompute-funding-profiles', async (_req, res) => {
  try {
    const result = await recomputePhaFundingProfiles();
    res.json({ result, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] HUD PHA funding profile recompute failed', err);
    res.status(500).json({ error: 'HUD PHA funding profile recompute failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/education-orgs/update', async (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state).toUpperCase() : '';
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 1000), 5000);
    const awardTerms = state === 'MI'
      ? ['grand rapids community college', 'university of michigan', 'michigan state university', 'wayne state university', 'college', 'university']
      : ['community college', 'university', 'college'];
    const [baseOrgs, awards] = await Promise.all([
      fetchEducationOrgs(limit, state),
      searchAwardAggregates({ terms: awardTerms, limitPerTerm: 100, maxPages: 3, state }),
    ]);
    const orgs = attachAwardAggregates(baseOrgs, awards, { allowPartial: false });
    if (state) await clearCollectionWhereState('education_orgs', state);
    else await clearCollection('education_orgs');
    await writeCollection('education_orgs', orgs);
    res.json({ inserted_or_updated: orgs.length, funding_enriched: orgs.filter((org) => org.funding_enriched).length, state: state || 'ALL', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Education org update failed', err);
    res.status(500).json({ error: 'Education org update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/workforce-orgs/update', async (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state).toUpperCase() : '';
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 1000), 3000);
    const { orgs, fundingRecipients, source_mode } = await fetchWorkforceLayerOrgs(limit, state);
    if (state) {
      await clearCollectionWhereState('workforce_orgs', state);
      await clearCollectionWhereState('workforce_funding_recipients', state);
    } else {
      await clearCollection('workforce_orgs');
      await clearCollection('workforce_funding_recipients');
    }
    await writeCollection('workforce_orgs', orgs);
    await writeCollection('workforce_funding_recipients', fundingRecipients);
    res.json({
      inserted_or_updated: orgs.length,
      funding_recipients: fundingRecipients.length,
      source_mode,
      careeronestop_configured: Boolean(careerOneStopConfig().token && careerOneStopConfig().userId),
      state: state || 'ALL',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Workforce org update failed', err);
    res.status(500).json({ error: 'Workforce org update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/health-orgs/update', async (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state).toUpperCase() : '';
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 2000), 10000);
    const hospitalLimit = Math.max(100, Math.floor(limit / 2));
    const healthCenterLimit = Math.max(100, limit - hospitalLimit);
    const awardTerms = state === 'MI'
      ? ['corewell health', 'spectrum health', 'mary free bed', 'hospital', 'health']
      : ['hospital', 'health', 'medical center'];
    const [healthCenters, hospitals, awards] = await Promise.all([
      fetchHealthOrgs(healthCenterLimit, state),
      fetchHospitalOrgs(hospitalLimit, state),
      searchAwardAggregates({ terms: awardTerms, agencyName: 'Department of Health and Human Services', limitPerTerm: 100, maxPages: 3, state }),
    ]);
    const orgs = attachAwardAggregates([...healthCenters, ...hospitals], awards, { allowPartial: true });
    if (state) await clearCollectionWhereState('health_orgs', state);
    else await clearCollection('health_orgs');
    await writeCollection('health_orgs', orgs);
    res.json({ inserted_or_updated: orgs.length, hospitals: hospitals.length, health_centers: healthCenters.length, funding_enriched: orgs.filter((org) => org.funding_enriched).length, state: state || 'ALL', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Health org update failed', err);
    res.status(500).json({ error: 'Health org update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/funded-faith-orgs/update', async (req, res) => {
  try {
    const state = req.query.state ? String(req.query.state).toUpperCase() : '';
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 1000), 3000);
    const orgs = await fetchFundedFaithOrgs(limit, state);
    if (!state) await clearCollection('funded_faith_orgs');
    await writeCollection('funded_faith_orgs', orgs);
    res.json({ inserted_or_updated: orgs.length, state: state || 'ALL', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Funded faith org update failed', err);
    res.status(500).json({ error: 'Funded faith org update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/funded-faith-orgs/enrich-locations', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || req.body?.limit || 100), 500);
    const result = await enrichFundedFaithLocations(limit);
    res.json({ result, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Funded faith location enrichment failed', err);
    res.status(500).json({ error: 'Funded faith location enrichment failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/community-capability/recompute', async (_req, res) => {
  try {
    const states = await recomputeCommunityCapabilitySummary();
    res.json({ states, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Community capability recompute failed', err);
    res.status(500).json({ error: 'Community capability recompute failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.all('/api/federal-power/update', async (_req, res) => {
  try {
    const count = await updatePowerMap();
    res.json({ inserted_or_updated: count, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] Federal power update failed', err);
    res.status(500).json({ error: 'Federal power update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/balloons', cache(300000, async () => ({ balloons: [], total: 0, timestamp: new Date().toISOString() })));

app.get('/api/radiation', cache(300000, async () => ({ stations: [], total: 0, timestamp: new Date().toISOString() })));

app.get('/api/stats', cache(30000, async () => {
  const [weather, gdelt] = await Promise.all([
    fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100', { signal: AbortSignal.timeout(10000) }).catch(() => ({ events: [] })),
    Promise.resolve({ events: [] }),
  ]);
  const weatherCount = (weather.events || []).filter((event) => event.geometry?.some((geom) => geom.type === 'Point')).length;
  return {
    stats: {
      flights: 0,
      sats: 0,
      cctv: 0,
      weather: weatherCount,
      nuclear: 0,
      incidents: gdelt.events.length,
    },
    timestamp: new Date().toISOString(),
  };
}));

app.use((req, res) => {
  res.status(404).json({
    error: 'Route not migrated to Firebase Functions yet',
    path: req.path,
  });
});

export const intelApi = onRequest({
  region: 'us-central1',
  timeoutSeconds: 60,
  memory: '512MiB',
  secrets: [githubTokenSecret],
  serviceAccount: 'firebase-adminsdk-fbsvc@autonateai-learning-hub.iam.gserviceaccount.com',
  cors: false,
}, app);

export const dailyHudPhaPull = onSchedule({
  region: 'us-central1',
  schedule: '15 8 * * *',
  timeZone: 'America/New_York',
  timeoutSeconds: 540,
  memory: '512MiB',
  serviceAccount: 'firebase-adminsdk-fbsvc@autonateai-learning-hub.iam.gserviceaccount.com',
}, async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const roster = await fetchHudPhaRoster();
  await persistHudPhaRoster(roster);
  const awards = await searchHudPhaAwards(yesterday, yesterday, 100, 10);
  await persistHudAwards(awards);
  await updatePowerMap();
  console.log(`[AutoNateAI Intel] Daily HUD PHA pull stored ${roster.length} PHAs and ${awards.length} awards for ${yesterday}`);
});

export const universityResearchScanner = onSchedule({
  region: 'us-central1',
  schedule: '0 6,14,22 * * *',
  timeZone: 'America/Chicago',
  timeoutSeconds: 540,
  memory: '512MiB',
  secrets: [githubTokenSecret],
  serviceAccount: 'firebase-adminsdk-fbsvc@autonateai-learning-hub.iam.gserviceaccount.com',
}, async () => {
  const result = await runUniversityResearchScan({ limit: 100, repoLimit: 5, arxivLimit: 5 });
  console.log('[AutoNateAI Intel] University research scanner complete', result);
});
