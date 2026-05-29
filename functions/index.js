import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { onRequest } from 'firebase-functions/v2/https';

initializeApp();

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

app.get('/api/flights', cache(300000, async () => ({
  commercial_flights: [],
  private_flights: [],
  private_jets: [],
  military_flights: [],
  jamming_zones: [],
  source: 'Firebase Functions migration placeholder',
  timestamp: new Date().toISOString(),
})));

app.get('/api/satellites', cache(3600000, async () => ({
  satellites: [],
  source: 'Firebase Functions migration placeholder',
  timestamp: new Date().toISOString(),
})));

app.get('/api/cctv', cache(3600000, async () => ({
  cameras: [],
  total: 0,
  region: 'all',
  source: 'Firebase Functions migration placeholder',
  timestamp: new Date().toISOString(),
})));

app.get('/api/infrastructure', cache(86400000, async () => ({
  infrastructure: [],
  total: 0,
  source: 'Firebase Functions migration placeholder',
  timestamp: new Date().toISOString(),
})));

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
