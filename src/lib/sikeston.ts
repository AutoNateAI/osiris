const SIKeston_CENTER = { lat: 36.8767, lng: -89.5879 };
const CHAMBER_BASE = 'https://business.sikeston.net';
const USER_AGENT = 'AutoNateAI-OSIRIS/1.0 (Sikeston regional layer)';

type SikestonBusiness = {
  id: string;
  type: 'sikeston_business';
  name: string;
  categories: string[];
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  website: string;
  source_url: string;
  lat: number;
  lng: number;
  geocode_source: string;
  data_confidence: number;
  last_updated: string;
};

type SikestonEvent = {
  id: string;
  type: 'sikeston_event';
  title: string;
  startDate: string;
  endDate: string;
  date_label: string;
  time_label: string;
  location: string;
  address: string;
  fees: string;
  contact: string;
  description: string;
  source_url: string;
  lat: number;
  lng: number;
  geocode_source: string;
  data_confidence: number;
  last_updated: string;
};

type SikestonBusinessResponse = { businesses: SikestonBusiness[]; total: number; source: string; timestamp: string };
type SikestonEventsResponse = { events: SikestonEvent[]; total: number; source: string; timestamp: string };

let businessCache: { time: number; data: SikestonBusinessResponse } | null = null;
let eventsCache: { time: number; data: SikestonEventsResponse } | null = null;

function decodeHtml(input = '') {
  return input
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripHtml(input = '') {
  return decodeHtml(input.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '));
}

function stableId(prefix: string, input: string) {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  return `${prefix}-${Math.abs(hash >>> 0).toString(36)}`;
}

function stableFallbackPoint(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const angle = ((hash >>> 0) % 360) * Math.PI / 180;
  const radius = 0.004 + (((hash >>> 8) % 1000) / 1000) * 0.025;
  return {
    lat: SIKeston_CENTER.lat + Math.sin(angle) * radius,
    lng: SIKeston_CENTER.lng + Math.cos(angle) * radius,
  };
}

async function fetchText(url: string) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.text();
}

function parseAddress(raw = '') {
  const address = decodeURIComponent(raw.replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim();
  const match = address.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2}),?\s*(\d{5}(?:-\d{4})?)?$/i);
  return {
    address: match?.[1]?.trim() || address,
    city: match?.[2]?.trim() || 'Sikeston',
    state: (match?.[3] || 'MO').toUpperCase(),
    zip: match?.[4] || '',
    full: address,
  };
}

async function geocodeUsAddress(address: string) {
  if (!address) return null;
  try {
    const params = new URLSearchParams({
      address,
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const res = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.result?.addressMatches?.[0];
    const coords = hit?.coordinates;
    if (!coords || !Number.isFinite(Number(coords.x)) || !Number.isFinite(Number(coords.y))) return null;
    return {
      lat: Number(coords.y),
      lng: Number(coords.x),
      geocode_source: 'US Census Geocoder',
      geocode_match: hit.matchedAddress || '',
    };
  } catch {
    return null;
  }
}

function parseCategoryLinks(html: string) {
  const links = new Map<string, string>();
  const regex = /href="(https:\/\/business\.sikeston\.net\/list\/category\/[^"]+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = regex.exec(html))) links.set(match[1], decodeHtml(match[2].replace(/,$/, '')));
  return [...links.entries()].map(([url, category]) => ({ url, category }));
}

function parseMemberSummaries(html: string, category: string) {
  const members = new Map<string, Partial<SikestonBusiness> & { source_url: string }>();
  const linkRegex = /href="(https:\/\/business\.sikeston\.net\/list\/member\/[^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*>([^<]*)/gi;
  let match;
  while ((match = linkRegex.exec(html))) {
    const source_url = match[1].split('?')[0];
    const name = decodeHtml(match[2] || match[3] || '');
    if (!name || name.length > 120) continue;
    const current = members.get(source_url) || { source_url, categories: [] };
    current.name = current.name || name;
    current.categories = [...new Set([...(current.categories || []), category])];
    members.set(source_url, current);
  }
  const mapRegex = /https:\/\/www\.google\.com\/maps\?q=([^"]+)/gi;
  const mapAddresses = [...html.matchAll(mapRegex)].map((m) => parseAddress(m[1]));
  return [...members.values()].map((member, index) => ({ ...member, ...mapAddresses[index] }));
}

function parseMemberDetails(html: string, source_url: string) {
  const title = decodeHtml(html.match(/<title>(.*?)\s+\|/)?.[1] || '');
  const meta = decodeHtml(html.match(/<meta name="description" content="([^"]+)"/i)?.[1] || '');
  const categories = meta.split('|').slice(1).map((s) => s.trim()).filter(Boolean);
  const mapAddress = parseAddress(html.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || '');
  const phone = decodeHtml(html.match(/href="tel:([^"]+)"/i)?.[1] || html.match(/(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/)?.[1] || '');
  const website = decodeHtml((html.match(/href="(https?:\/\/(?!business\.sikeston\.net|www\.sikeston\.net|www\.google\.com|growthzone\.com|growthzonecms|gmpg\.org|fonts\.googleapis\.com|fonts\.gstatic\.com|use\.fontawesome\.com|code\.jquery\.com)[^"]+)"/i)?.[1] || '').replace(/\/$/, ''));
  return {
    name: title,
    categories,
    phone,
    website,
    source_url,
    ...mapAddress,
  };
}

export async function fetchSikestonBusinesses(options: { geocode?: boolean; limit?: number } = {}) {
  if (!options.geocode && businessCache && Date.now() - businessCache.time < 300000) return businessCache.data;
  const summaries = new Map<string, Partial<SikestonBusiness> & { source_url: string }>();

  if (options.geocode) {
    const listHtml = await fetchText(`${CHAMBER_BASE}/list`);
    const categories = parseCategoryLinks(listHtml);
    for (const { url, category } of categories) {
      const html = await fetchText(url);
      for (const member of parseMemberSummaries(html, category)) {
        const current = summaries.get(member.source_url) || { source_url: member.source_url, categories: [] };
        summaries.set(member.source_url, {
          ...current,
          ...member,
          categories: [...new Set([...(current.categories || []), ...(member.categories || [])])],
        });
      }
    }
  } else {
    const html = await fetchText(`${CHAMBER_BASE}/list/search?sa=true`);
    for (const member of parseMemberSummaries(html, 'Chamber Member')) {
      const current = summaries.get(member.source_url) || { source_url: member.source_url, categories: [] };
      summaries.set(member.source_url, {
        ...current,
        ...member,
        categories: [...new Set([...(current.categories || []), ...(member.categories || [])])],
      });
    }
  }

  const now = new Date().toISOString();
  const detailLimit = Math.min(options.limit || 400, summaries.size);
  const businesses: SikestonBusiness[] = [];
  for (const summary of [...summaries.values()].slice(0, detailLimit)) {
    let detail: Partial<SikestonBusiness> = {};
    if (options.geocode) {
      try {
        detail = parseMemberDetails(await fetchText(summary.source_url), summary.source_url);
      } catch {}
    }
    const merged: Partial<SikestonBusiness> & { source_url: string; categories: string[] } = {
      ...summary,
      ...detail,
      categories: [...new Set([...(summary.categories || []), ...(detail.categories || [])])],
      source_url: summary.source_url,
    };
    const fullAddress = [merged.address, merged.city, merged.state, merged.zip].filter(Boolean).join(', ');
    const geo = options.geocode ? await geocodeUsAddress(fullAddress) : null;
    const fallback = stableFallbackPoint(`${merged.name}-${fullAddress}`);
    businesses.push({
      id: stableId('sikeston-biz', merged.source_url || merged.name || fullAddress),
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

  const data = { businesses, total: businesses.length, source: `${CHAMBER_BASE}/list`, timestamp: now };
  if (!options.geocode) businessCache = { time: Date.now(), data };
  return data;
}

function parseEventLinks(html: string) {
  const links = new Map<string, string>();
  const regex = /href="(https:\/\/business\.sikeston\.net\/events\/details\/[^"]+)"[^>]*>([^<]+)/gi;
  let match;
  while ((match = regex.exec(html))) links.set(match[1].replace(/&amp;/g, '&'), decodeHtml(match[2]));
  return [...links.entries()].map(([url, title]) => ({ url, title }));
}

function textAfter(html: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h5[^>]*>\\s*${escaped}\\s*<\\/h5>([\\s\\S]*?)(?:<h5|<\\/div>\\s*<\\/div>|<\\/div>\\s*<div class="col-sm-12)`, 'i'));
  return stripHtml(match?.[1] || '');
}

function parseEventDetail(html: string, source_url: string, fallbackTitle = '') {
  const title = decodeHtml(html.match(/<meta itemprop="name" content="([^"]+)"/i)?.[1] || fallbackTitle || html.match(/<h1>(.*?)<\/h1>/i)?.[1] || '');
  const startDate = decodeHtml(html.match(/itemprop="startDate" content="([^"]+)"/i)?.[1] || '');
  const endDate = decodeHtml(html.match(/itemprop="endDate" content="([^"]+)"/i)?.[1] || '');
  const location = stripHtml(html.match(/class="col-sm-12 gz-event-location"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const description = stripHtml(html.match(/<div class="row gz-event-description"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const fees = textAfter(html, 'Fees/Admission') || stripHtml(html.match(/<span class="gz-event-fees">([\s\S]*?)<\/span>/i)?.[1] || '');
  const contact = decodeHtml(html.match(/mailto:([^"?]+)[^"]*"/i)?.[1] || '');
  const dateLabel = stripHtml(html.match(/<div class="col-sm-12 gz-event-date">([\s\S]*?)<\/div>/i)?.[1] || '');
  const fallback = stableFallbackPoint(`${title}-${startDate}-${location}`);
  return {
    id: stableId('sikeston-event', source_url),
    type: 'sikeston_event' as const,
    title,
    startDate,
    endDate,
    date_label: dateLabel.replace(/^Date and Time\s*/i, ''),
    time_label: startDate ? new Date(startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }) : '',
    location,
    address: location,
    fees,
    contact,
    description,
    source_url: source_url.split('?')[0],
    lat: fallback.lat,
    lng: fallback.lng,
    geocode_source: 'Deterministic Sikeston fallback pending geocode',
    data_confidence: 42,
    last_updated: new Date().toISOString(),
  };
}

export async function fetchSikestonEvents(options: { months?: string[]; geocode?: boolean; limit?: number } = {}) {
  if (!options.geocode && eventsCache && Date.now() - eventsCache.time < 300000) return eventsCache.data;
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const months = options.months || [0, 1, 2].map((offset) => {
    const d = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + offset, 1));
    return d.toISOString().slice(0, 10);
  });
  const eventLinks = new Map<string, string>();
  for (const month of months) {
    const html = await fetchText(`${CHAMBER_BASE}/events/calendar?calendarMonth=${month}`);
    for (const event of parseEventLinks(html)) eventLinks.set(event.url, event.title);
  }
  const events: SikestonEvent[] = [];
  for (const [url, fallbackTitle] of [...eventLinks.entries()].slice(0, options.limit || 200)) {
    try {
      const event = parseEventDetail(await fetchText(url), url, fallbackTitle);
      const geo = options.geocode ? await geocodeUsAddress(`${event.location}, Sikeston, MO`) : null;
      events.push({
        ...event,
        lat: geo?.lat ?? event.lat,
        lng: geo?.lng ?? event.lng,
        geocode_source: geo?.geocode_source || event.geocode_source,
        data_confidence: geo ? 86 : event.data_confidence,
      });
    } catch {}
  }
  events.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const data = { events, total: events.length, source: `${CHAMBER_BASE}/events/calendar`, timestamp: new Date().toISOString() };
  if (!options.geocode) eventsCache = { time: Date.now(), data };
  return data;
}
