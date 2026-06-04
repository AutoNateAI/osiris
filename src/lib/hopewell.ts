const HOPEWELL_CENTER = { lat: 37.3043, lng: -77.2872 };
const CHAMBER_BASE = 'https://www.hpgchamber.org';
const USER_AGENT = 'AutoNateAI-OSIRIS/1.0 (Hopewell regional layer)';

type HopewellBusiness = {
  id: string;
  type: 'hopewell_business';
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

type HopewellEvent = {
  id: string;
  type: 'hopewell_event';
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

type HopewellBusinessResponse = { businesses: HopewellBusiness[]; total: number; source: string; timestamp: string };
type HopewellEventsResponse = { events: HopewellEvent[]; total: number; source: string; timestamp: string };

let businessCache: { time: number; data: HopewellBusinessResponse } | null = null;
let eventsCache: { time: number; data: HopewellEventsResponse } | null = null;

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
  const radius = 0.005 + (((hash >>> 8) % 1000) / 1000) * 0.04;
  return {
    lat: HOPEWELL_CENTER.lat + Math.sin(angle) * radius,
    lng: HOPEWELL_CENTER.lng + Math.cos(angle) * radius,
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

function parseMemberCards(html: string, category = 'Chamber Member') {
  const cards = html.split(/<div class="gz-list-card-wrapper[^>]*>/i).slice(1);
  return cards.map((card) => {
    const source_url = decodeHtml(card.match(/<h5[^>]*gz-card-title[\s\S]*?<a href="([^"]+)"/i)?.[1] || '').split('?')[0];
    const name = decodeHtml(card.match(/<h5[^>]*gz-card-title[\s\S]*?<a[^>]*(?:alt="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/i)?.[1] || card.match(/<h5[^>]*gz-card-title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
    const mapAddress = parseAddress(card.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || '');
    const phone = decodeHtml(card.match(/href="tel:([^"]+)"/i)?.[1] || card.match(/gz-card-phone[\s\S]*?<span>(.*?)<\/span>/i)?.[1] || '');
    if (!source_url || !name) return null;
    return { source_url, name, categories: [category], phone, ...mapAddress };
  }).filter(Boolean) as Array<Partial<HopewellBusiness> & { source_url: string; categories: string[] }>;
}

function parseAlphaLinks(html: string) {
  const letters = new Set<string>();
  const regex = /href="https:\/\/www\.hpgchamber\.org\/members\/searchalpha\/([^"]+)"/gi;
  let match;
  while ((match = regex.exec(html))) letters.add(match[1]);
  return [...letters].filter((letter) => letter.length <= 3);
}

function parseMemberDetails(html: string, source_url: string) {
  const name = decodeHtml(html.match(/<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title>(.*?)\s+\|/)?.[1] || '');
  const categories = [...html.matchAll(/\/members\/category\/[^"]+">([^<]+)/gi)].map((m) => decodeHtml(m[1].replace(/,$/, ''))).filter(Boolean);
  const mapAddress = parseAddress(html.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || html.match(/https:\/\/maps\.google\.com\/maps\?[^"]*q=([^"&]+)/i)?.[1] || '');
  const phone = decodeHtml(html.match(/href="tel:([^"]+)"/i)?.[1] || html.match(/(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/)?.[1] || '');
  const website = decodeHtml((html.match(/href="(https?:\/\/(?!www\.hpgchamber\.org|hpgchamber\.org|www\.google\.com|maps\.google\.com|chambermaster\.blob\.core\.windows\.net|growthzone\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|code\.jquery\.com)[^"]+)"/i)?.[1] || '').replace(/\/$/, ''));
  return { name, categories, phone, website, source_url, ...mapAddress };
}

export async function fetchHopewellBusinesses(options: { geocode?: boolean; limit?: number } = {}) {
  if (!options.geocode && businessCache && Date.now() - businessCache.time < 300000) return businessCache.data;
  const summaries = new Map<string, Partial<HopewellBusiness> & { source_url: string; categories: string[] }>();
  const indexHtml = await fetchText(`${CHAMBER_BASE}/members/`);
  const letters = parseAlphaLinks(indexHtml);

  for (const letter of letters) {
    const html = await fetchText(`${CHAMBER_BASE}/members/searchalpha/${letter}`);
    for (const member of parseMemberCards(html)) {
      const current = summaries.get(member.source_url) || { source_url: member.source_url, categories: [] };
      summaries.set(member.source_url, {
        ...current,
        ...member,
        categories: [...new Set([...(current.categories || []), ...(member.categories || [])])],
      });
    }
  }

  const now = new Date().toISOString();
  const businesses: HopewellBusiness[] = [];
  for (const summary of [...summaries.values()].slice(0, options.limit || 600)) {
    let detail: Partial<HopewellBusiness> = {};
    if (options.geocode) {
      try {
        detail = parseMemberDetails(await fetchText(summary.source_url), summary.source_url);
      } catch {}
    }
    const merged = {
      ...summary,
      ...detail,
      categories: [...new Set([...(summary.categories || []), ...(detail.categories || [])])],
    };
    const fullAddress = [merged.address, merged.city, merged.state, merged.zip].filter(Boolean).join(', ');
    const geo = options.geocode ? await geocodeUsAddress(fullAddress) : null;
    const fallback = stableFallbackPoint(`${merged.name}-${fullAddress}`);
    businesses.push({
      id: stableId('hopewell-biz', merged.source_url || merged.name || fullAddress),
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

  const data = { businesses, total: businesses.length, source: `${CHAMBER_BASE}/members/`, timestamp: now };
  if (!options.geocode) businessCache = { time: Date.now(), data };
  return data;
}

function parseEventLinks(html: string) {
  const links = new Map<string, string>();
  const regex = /href="(https:\/\/www\.hpgchamber\.org\/events\/details\/[^"]+)"[^>]*>([^<]+)/gi;
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
  const title = decodeHtml(html.match(/<h1[^>]*itemprop="name"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<meta itemprop="name" content="([^"]+)"/i)?.[1] || fallbackTitle || '');
  const startDate = decodeHtml(html.match(/itemprop="startDate" content="([^"]+)"/i)?.[1] || '');
  const endDate = decodeHtml(html.match(/itemprop="endDate" content="([^"]+)"/i)?.[1] || '');
  const mapAddress = parseAddress(html.match(/https:\/\/maps\.google\.com\/maps\?[^"]*q=([^"&]+)/i)?.[1] || html.match(/https:\/\/www\.google\.com\/maps\?q=([^"]+)/i)?.[1] || '');
  const venue = stripHtml(html.match(/class="col-sm-12 gz-event-location"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const description = stripHtml(html.match(/<div class="row gz-event-description"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] || '');
  const fees = textAfter(html, 'Fees/Admission') || stripHtml(html.match(/<span class="gz-event-fees">([\s\S]*?)<\/span>/i)?.[1] || '');
  const contact = decodeHtml(html.match(/mailto:([^"?]+)[^"]*"/i)?.[1] || '');
  const dateLabel = stripHtml(html.match(/<div class="col-sm-12 gz-event-date">([\s\S]*?)<\/div>/i)?.[1] || '');
  const location = [venue.split('\n')[0], mapAddress.full].filter(Boolean).join(' - ');
  const fallback = stableFallbackPoint(`${title}-${startDate}-${location}`);
  return {
    id: stableId('hopewell-event', source_url.split('?')[0]),
    type: 'hopewell_event' as const,
    title,
    startDate,
    endDate,
    date_label: dateLabel.replace(/^Date and Time\s*/i, ''),
    time_label: startDate ? new Date(startDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '',
    location: location || venue || mapAddress.full,
    address: mapAddress.full || venue,
    fees,
    contact,
    description,
    source_url: source_url.split('?')[0],
    lat: fallback.lat,
    lng: fallback.lng,
    geocode_source: 'Deterministic Hopewell fallback pending geocode',
    data_confidence: 42,
    last_updated: new Date().toISOString(),
  };
}

export async function fetchHopewellEvents(options: { months?: string[]; geocode?: boolean; limit?: number } = {}) {
  if (!options.geocode && eventsCache && Date.now() - eventsCache.time < 300000) return eventsCache.data;
  const months = options.months || ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'];
  const eventLinks = new Map<string, string>();
  for (const month of months) {
    const html = await fetchText(`${CHAMBER_BASE}/events/calendar?calendarMonth=${month}`);
    for (const event of parseEventLinks(html)) eventLinks.set(event.url, event.title);
  }
  const events: HopewellEvent[] = [];
  for (const [url, fallbackTitle] of [...eventLinks.entries()].slice(0, options.limit || 250)) {
    try {
      const event = parseEventDetail(await fetchText(url), url, fallbackTitle);
      const geo = options.geocode ? await geocodeUsAddress(event.address || `${event.location}, Hopewell, VA`) : null;
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
