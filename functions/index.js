import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import YAML from 'yaml';

initializeApp();
const db = getFirestore();

const allowedOrigins = new Set([
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

function stripHtml(input = '') {
  return input.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
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

const stateCodes = new Set(Object.keys(stateCentroids));

function deriveStateFromAward(awardId = '', recipientState = '') {
  if (stateCodes.has(recipientState)) return recipientState;
  const prefix = String(awardId).slice(0, 2).toUpperCase();
  return stateCodes.has(prefix) ? prefix : 'DC';
}

function centroidForState(state) {
  const [lat, lng] = stateCentroids[state] || stateCentroids.DC;
  return { lat, lng };
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

async function updatePowerMap() {
  const legislatorsYaml = await fetchText('https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml', { signal: AbortSignal.timeout(20000) }).catch(() => '');
  const legislators = legislatorsYaml ? YAML.parse(legislatorsYaml) : [];
  const people = [];
  for (const leg of legislators || []) {
    const term = leg.terms?.[leg.terms.length - 1] || {};
    const state = term.state || 'DC';
    const coords = centroidForState(state);
    people.push({
      id: `congress-${leg.id?.bioguide}`,
      name: [leg.name?.official_full || `${leg.name?.first || ''} ${leg.name?.last || ''}`.trim()][0],
      branch: 'congress',
      chamber: term.type === 'sen' ? 'Senate' : 'House',
      party: term.party || '',
      state,
      district: term.district ?? null,
      role: term.type === 'sen' ? 'U.S. Senator' : 'U.S. Representative',
      lat: coords.lat,
      lng: coords.lng,
      source: 'unitedstates/congress-legislators',
      updated_at: new Date().toISOString(),
    });
  }
  const staticPower = [
    { id: 'whitehouse-president', name: 'Donald J. Trump', branch: 'white_house', role: 'President', party: 'Republican', state: 'DC' },
    { id: 'whitehouse-vice-president', name: 'JD Vance', branch: 'white_house', role: 'Vice President', party: 'Republican', state: 'DC' },
    ...['John G. Roberts, Jr.', 'Clarence Thomas', 'Samuel A. Alito, Jr.', 'Sonia Sotomayor', 'Elena Kagan', 'Neil M. Gorsuch', 'Brett M. Kavanaugh', 'Amy Coney Barrett', 'Ketanji Brown Jackson'].map((name) => ({ id: `scotus-${md5(name).slice(0, 10)}`, name, branch: 'judicial', role: name.includes('Roberts') ? 'Chief Justice' : 'Associate Justice', party: '', state: 'DC' })),
  ].map((person) => ({ ...person, ...centroidForState(person.state), source: 'official/static seed', updated_at: new Date().toISOString() }));
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

function classifyFlight(raw) {
  const modelUpper = (raw.t || '').toUpperCase();
  const flightStr = (raw.flight || '').trim().toUpperCase();
  if (modelUpper === 'TWR' || raw.lat == null || raw.lon == null) return null;
  const callsign = flightStr || raw.hex || 'UNKNOWN';
  const altRaw = raw.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const airlineCode = airlineCodeRe.exec(callsign)?.[1] || '';
  const isHeli = heliTypes.has(modelUpper);
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
  const [phaSnap, awardSnap] = await Promise.all([
    phaQuery.get(),
    db.collection('hud_pha_awards').orderBy('start_date', 'desc').limit(250).get(),
  ]);
  const phas = phaSnap.docs.map((doc) => doc.data());
  const awards = awardSnap.docs.map((doc) => doc.data()).filter((award) => !state || award.recipient_state === state);
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
    res.json({ inserted_or_updated: awards.length, start, end, timestamp: new Date().toISOString() });
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
    res.json({ inserted_or_updated: roster.length, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('[AutoNateAI Intel Functions] HUD PHA roster update failed', err);
    res.status(500).json({ error: 'HUD PHA roster update failed', detail: err instanceof Error ? err.message : 'Unknown error' });
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
