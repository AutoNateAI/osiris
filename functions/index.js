import cors from 'cors';
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
  cors: false,
}, app);
