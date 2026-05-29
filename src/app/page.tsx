'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, BarChart3, Newspaper, Search, Share2, Map as MapIcon, X, Globe, MapPinned, Radar, Satellite, Moon, Sun, ExternalLink, AlertTriangle, Building2, RadioTower, Activity, Shield, Database, Wifi, Landmark, Users } from 'lucide-react';
import IntelFeed from '@/components/IntelFeed';
import MarketsPanel from '@/components/MarketsPanel';
import SearchBar from '@/components/SearchBar';
import ScaleBar from '@/components/ScaleBar';
import ErrorBoundary from '@/components/ErrorBoundary';
import SharePanel from '@/components/SharePanel';
import ViewPresets from '@/components/ViewPresets';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import GlobalStatusBar from '@/components/GlobalStatusBar';
import LiveAlerts from '@/components/LiveAlerts';
import { authenticatedFetch } from '@/lib/apiClient';

const OsirisMap = dynamic(() => import('@/components/OsirisMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));
const CameraViewer = dynamic(() => import('@/components/CameraViewer'));
const OsintPanel = dynamic(() => import('@/components/OsintPanel'));

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      // Mobile if narrow, OR landscape phone (short height + moderate width)
      setIsMobile(w < 768 || (h < 500 && w < 1024));
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);
  return isMobile;
}
const UptimeClock = () => {
  const [uptime, setUptime] = useState('00:00:00');
  const startTime = useRef(Date.now());
  useEffect(() => {
    const iv = setInterval(() => {
      const e = Math.floor((Date.now() - startTime.current) / 1000);
      setUptime(`${String(Math.floor(e/3600)).padStart(2,'0')}:${String(Math.floor((e%3600)/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="hidden lg:inline">UPTIME: <span className="text-[var(--gold-primary)]">{uptime}</span></span>;
};

const ZuluClock = () => {
  const [time, setTime] = useState('');
  useEffect(() => {
    const iv = setInterval(() => {
      const now = new Date();
      setTime(`ZULU ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')}:${String(now.getUTCSeconds()).padStart(2,'0')}Z`);
    }, 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="text-[var(--cyan-primary)] font-bold tabular-nums">{time || 'ZULU --:--:--Z'}</span>;
};

const DataThroughput = ({ data }: { data: any }) => {
  const [throughput, setThroughput] = useState('0.00');
  const [pingTime, setPingTime] = useState<number | null>(null);

  useEffect(() => {
    const iv = setInterval(() => {
      let estimatedBytes = 0;
      if (data) {
        if (data.satellites) estimatedBytes += data.satellites.length * 150;
        if (data.commercial_flights) estimatedBytes += data.commercial_flights.length * 120;
        if (data.cameras) estimatedBytes += data.cameras.length * 80;
        if (data.gdelt) estimatedBytes += data.gdelt.length * 300;
        if (data.live_feeds) estimatedBytes += data.live_feeds.length * 500;
      }
      
      const megabytes = estimatedBytes / 1024 / 1024;
      setThroughput(megabytes > 0 ? (megabytes * 1.5).toFixed(2) : "0.00");
      
      setPingTime(Math.floor(30 + estimatedBytes / 100000));
    }, 2500);
    return () => clearInterval(iv);
  }, [data]);

  return <span className="text-[var(--alert-green)] font-bold tabular-nums">{throughput} MB/s</span>;
};

function money(value: any) {
  const n = Number(value || 0);
  if (!n) return '$0';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function EntityDetailModal({ entity, onClose }: { entity: any; onClose: () => void }) {
  if (!entity) return null;
  const isPha = entity.type === 'hud_pha';
  const rows = isPha
    ? [['Participant Code', entity.participant_code], ['State', entity.state], ['Program Type', entity.program_type || 'Not specified'], ['Total Units', Number(entity.total_units || 0).toLocaleString()], ['Section 8 Units', Number(entity.section8_units || 0).toLocaleString()], ['USAspending Awards', Number(entity.award_count || 0).toLocaleString()], ['USAspending Total', money(entity.total_amount)]]
    : [['Branch', entity.branch], ['Role', entity.role], ['Chamber', entity.chamber || 'N/A'], ['State', entity.state], ['Party', entity.party || 'Nonpartisan/Unknown'], ['District', entity.district ?? 'Statewide/N/A']];
  const bars = isPha
    ? [['USAspending', Number(entity.total_amount || 0), '#00AEEF'], ['HUD OpFund', Number(entity.opfund_amount || 0), '#76FF03'], ['HUD CapFund', Number(entity.capfund_amount || 0), '#D4AF37'], ['ROSS/FSS', Number(entity.ross_amount || 0) + Number(entity.fss_amount || 0), '#B388FF']]
    : [['Influence Node', entity.branch === 'white_house' ? 100 : entity.branch === 'judicial' ? 80 : 60, entity.party === 'Republican' ? '#EB5757' : entity.party === 'Democrat' ? '#2F80ED' : '#FFFFFF']];
  const maxBar = Math.max(...bars.map(([, v]) => Number(v)), 1);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-[650] bg-black/60 backdrop-blur-sm flex items-center justify-center p-3">
      <motion.div initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} className="glass-panel osiris-glow w-full max-w-3xl max-h-[86vh] overflow-y-auto styled-scrollbar">
        <div className="flex items-start justify-between gap-4 p-5 border-b border-[var(--border-secondary)]">
          <div>
            <div className="hud-label mb-1">{isPha ? 'HUD PUBLIC HOUSING AGENCY' : 'FEDERAL POWER NODE'}</div>
            <h2 className="text-lg font-mono font-bold text-[var(--text-primary)] tracking-wide">{entity.name}</h2>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">{isPha ? 'HUD roster details enriched with USAspending award totals where award identifiers match the agency code.' : 'Political authority plotted by represented state or institutional seat for comparison against HUD funding flows.'}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-red-900/30 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid md:grid-cols-[1.1fr_0.9fr] gap-5">
          <div className="space-y-4">
            <div>
              <div className="hud-label mb-2">PROFILE TABLE</div>
              <div className="overflow-hidden rounded border border-[var(--border-secondary)]">
                {rows.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[140px_1fr] border-b last:border-b-0 border-[var(--border-secondary)] text-[11px]">
                    <div className="bg-[var(--panel-secondary)] px-3 py-2 text-[var(--text-muted)] font-mono">{k}</div>
                    <div className="px-3 py-2 text-[var(--text-primary)]">{v || 'N/A'}</div>
                  </div>
                ))}
              </div>
            </div>
            {isPha && <div><div className="hud-label mb-2">ADDRESS / CONTACT</div><div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{[entity.address, entity.city, entity.state, entity.zip].filter(Boolean).join(', ') || 'No address in roster.'}<br />{entity.email || 'No email listed'} · {entity.phone || 'No phone listed'}</div></div>}
          </div>
          <div className="space-y-4">
            <div>
              <div className="hud-label mb-2">{isPha ? 'FUNDING PROFILE' : 'POWER PROFILE'}</div>
              <div className="space-y-2">
                {bars.map(([label, value, color]) => (
                  <div key={label as string}>
                    <div className="flex justify-between text-[10px] mb-1"><span>{label}</span><span>{isPha ? money(value) : value}</span></div>
                    <div className="h-2 bg-white/10 rounded overflow-hidden"><div className="h-full" style={{ width: `${Math.max(3, (Number(value) / maxBar) * 100)}%`, backgroundColor: color as string }} /></div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded border border-[var(--border-secondary)] p-3"><div className="hud-label mb-2">INTERPRETATION</div><p className="text-[10px] text-[var(--text-secondary)] leading-relaxed">{isPha ? 'This point is the HUD agency roster coordinate. Funding bars combine roster profile fields and matched USAspending totals, so historical backfills will make the USAspending side richer over time.' : 'Power Loop Edges draw party-colored links from congressional nodes to HUD flow centers for the same state, making oversight and funding geography visible together.'}</p></div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Dashboard() {
  const dataRef = useRef<any>({});
  const [dataVersion, setDataVersion] = useState(0);
  const data = dataRef.current;

  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [mapView, setMapView] = useState({ zoom: 2.5, latitude: 20 });
  const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [globalStats, setGlobalStats] = useState<any>(null);
  const mouseCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const coordsDisplayRef = useRef<HTMLDivElement>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [regionDossier, setRegionDossier] = useState<any>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [activeCamera, setActiveCamera] = useState<any>(null);
  const [detailEntity, setDetailEntity] = useState<any>(null);
  const [spaceWeather, setSpaceWeather] = useState<any>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [showMarkets, setShowMarkets] = useState(true);
  const [showIntel, setShowIntel] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'layers'|'markets'|'intel'|'search'|'recon'|null>(null);
  const [mapProjection, setMapProjection] = useState<'globe'|'mercator'>('globe');
  const [mapStyle, setMapStyle] = useState<'dark'|'satellite'>('dark');
  const [siteTheme, setSiteTheme] = useState<'dark'|'light'>('dark');
  const [sweepData, setSweepData] = useState<any>(null);
  const [scanTargets, setScanTargets] = useState<any[]>([]);

  const isMobile = useIsMobile();
  const startTime = useRef(Date.now());
  const geocodeCache = useRef<Map<string, string>>(new Map());
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodedPos = useRef<{ lat: number; lng: number } | null>(null);

  // ── DEFAULT: Most layers OFF — fast initial load ──
  const [activeLayers, setActiveLayers] = useState({
    flights: false,
    private: false,
    jets: false,
    military: false,
    maritime: true,
    satellites: false,
    balloons: false,
    cctv: true,
    live_news: true,
    news_intel: true,
    earthquakes: true,
    fires: false,
    weather: false,
    radiation: false,
    infrastructure: false,
    hud_pha_flows: false,
    federal_power: false,
    power_edges: false,
    global_incidents: true,
    war_alerts: false,
    gps_jamming: false,
    day_night: true,
  });
  const [liveFeedUrl, setLiveFeedUrl] = useState<string | null>(null);
  const [liveFeedName, setLiveFeedName] = useState('');
  const [liveFeedEmbedAllowed, setLiveFeedEmbedAllowed] = useState(true);

  // Splash screen
  useEffect(() => {
    const splashTimer = setTimeout(() => setShowSplash(false), 2500);
    return () => clearTimeout(splashTimer);
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem('autonateai-intel-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
      setSiteTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = siteTheme;
    document.documentElement.style.colorScheme = siteTheme;
    window.localStorage.setItem('autonateai-intel-theme', siteTheme);
  }, [siteTheme]);

  // URL state: parse on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    const lat = parseFloat(p.get('lat') || '');
    const lon = parseFloat(p.get('lon') || '');
    const zoom = parseFloat(p.get('zoom') || '');
    if (!isNaN(lat) && !isNaN(lon)) {
      setFlyToLocation({ lat, lng: lon, ts: Date.now() });
      if (!isNaN(zoom)) setMapView(v => ({ ...v, zoom }));
    }
    const layers = p.get('layers');
    if (layers) {
      const active = layers.split(',');
      setActiveLayers(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { (next as any)[k] = active.includes(k); });
        return next;
      });
    }
  }, []);

  // URL state: update URL on view change (debounced)
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const p = new URLSearchParams();
      p.set('lat', (mouseCoordsRef.current?.lat ?? mapView.latitude ?? 20).toFixed(4));
      p.set('lon', (mouseCoordsRef.current?.lng ?? 0).toFixed(4));
      p.set('zoom', mapView.zoom.toFixed(2));
      const active = Object.entries(activeLayers).filter(([,v]) => v).map(([k]) => k).join(',');
      p.set('layers', active);
      const url = `${window.location.pathname}?${p.toString()}`;
      window.history.replaceState(null, '', url);
    }, 1500);
  }, [mapView, activeLayers]);

  // Global Stats Fetch
  useEffect(() => {
    authenticatedFetch('/api/stats')
      .then(res => res.json())
      .then(d => {
        if (d.stats) setGlobalStats(d.stats);
      })
      .catch(console.error);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as Element)?.tagName)) return;
      if (e.key === 'f' && !e.ctrlKey) {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
        setIsFullscreen(!!document.fullscreenElement);
      }
      if (e.key === 'l') setShowLayers(p => !p);
      if (e.key === 'm') setShowMarkets(p => !p);
      if (e.key === 'i') setShowIntel(p => !p);
      if (e.key === 'r') setFlyToLocation({ lat: 20, lng: 0, ts: Date.now() });
      if (e.key === 'g') setMapProjection(p => p === 'globe' ? 'mercator' : 'globe');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Mouse coords + reverse geocode (Zero-Render)
  const handleMouseCoords = useCallback((coords: { lat: number; lng: number }) => {
    mouseCoordsRef.current = coords;
    if (coordsDisplayRef.current) {
      coordsDisplayRef.current.innerText = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
    }
    if (geocodeTimer.current) clearTimeout(geocodeTimer.current);
    geocodeTimer.current = setTimeout(async () => {
      if (lastGeocodedPos.current) {
        const d = Math.abs(coords.lat - lastGeocodedPos.current.lat) + Math.abs(coords.lng - lastGeocodedPos.current.lng);
        if (d < 0.5) return; // increased threshold — fewer geocode calls
      }
      const gk = `${coords.lat.toFixed(1)},${coords.lng.toFixed(1)}`; // coarser grid = more cache hits
      if (geocodeCache.current.has(gk)) { setLocationLabel(geocodeCache.current.get(gk)!); lastGeocodedPos.current = coords; return; }
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${coords.lat}&lon=${coords.lng}&format=json&zoom=10&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
        if (res.ok) {
          const d = await res.json();
          const a = d.address || {};
          const label = [a.city||a.town||a.village||a.county, a.state||a.region, a.country].filter(Boolean).join(', ') || 'Unknown';
          if (geocodeCache.current.size > 500) { const it = geocodeCache.current.keys(); for (let i=0;i<100;i++) { const k = it.next().value; if(k) geocodeCache.current.delete(k); }}
          geocodeCache.current.set(gk, label);
          setLocationLabel(label);
          lastGeocodedPos.current = coords;
        }
      } catch (e) { console.warn('[AutoNateAI Intel] Suppressed error:', e instanceof Error ? e.message : e); }
    }, 3000); // 3s debounce (was 1.5s)
  }, []);

  // Region dossier (right-click)
  const handleRightClick = useCallback(async (coords: { lat: number; lng: number }) => {
    setDossierLoading(true); setRegionDossier(null);
    try {
      const res = await authenticatedFetch(`/api/region-dossier?lat=${coords.lat}&lng=${coords.lng}`);
      if (res.ok) setRegionDossier(await res.json());
    } catch (e) { console.warn('[AutoNateAI Intel] Suppressed error:', e instanceof Error ? e.message : e); } finally { setDossierLoading(false); }
  }, []);

  // Entity click handler (hoisted from JSX to comply with Rules of Hooks — Fixes #113)
  const handleEntityClick = useCallback((entity: any) => {
    if (entity?.type === 'cctv') setActiveCamera(entity);
    if (entity?.type === 'hud_pha' || entity?.type === 'federal_power') setDetailEntity(entity);
    if (entity?.type === 'live_news' && entity.url) {
      setLiveFeedUrl(entity.url);
      setLiveFeedName(entity.name);
      setLiveFeedEmbedAllowed(entity.embed_allowed !== false);
    }
  }, []);

  // ── SHARED FETCH UTILITY (Fixes #107 — single definition, not 3 copies) ──
  const fetchEndpoint = useCallback(async (url: string, transform?: (d: any) => any, options?: RequestInit) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await authenticatedFetch(url, options);
      if (res.ok) {
        const json = await res.json();
        const d = transform ? transform(json) : json;
        dataRef.current = { ...dataRef.current, ...d };
        setDataVersion(v => v + 1);
        setBackendStatus('connected');
      }
    } catch (e) {
      console.warn('[AutoNateAI Intel] Suppressed error:', e instanceof Error ? e.message : e);
      setBackendStatus('error');
    }
  }, []);

  // ── PROGRESSIVE DATA LOADING (request-optimized) ──
  useEffect(() => {
    // Priority 1: Core feeds (always needed for panels)
    fetchEndpoint('/api/earthquakes');
    fetchEndpoint('/api/news');
    const marketTimer = setTimeout(() => fetchEndpoint('/api/markets', d => ({ markets: d })), 800);

    // Priority 2: Space Weather (needed for MarketsPanel)
    const spaceTimer = setTimeout(async () => {
      try {
        const r = await authenticatedFetch('/api/space-weather');
        if (r.ok) setSpaceWeather(await r.json());
      } catch (e) { console.warn('[AutoNateAI Intel] Suppressed error:', e instanceof Error ? e.message : e); }
    }, 5000);

    // Polling — OPTIMIZED intervals to minimize edge requests
    const intervals = [
      setInterval(() => fetchEndpoint('/api/earthquakes'), 900000),  // 15 min (was 5)
      setInterval(() => fetchEndpoint('/api/news'), 1800000),        // 30 min (was 10)
      setInterval(() => fetchEndpoint('/api/markets', d => ({ markets: d })), 900000), // 15 min (was 5)
    ];
    return () => {
      clearTimeout(marketTimer);
      clearTimeout(spaceTimer);
      intervals.forEach(clearInterval);
    };
  }, [fetchEndpoint]);

  // ── LAYER-AWARE DATA LOADING — only fetch when layer is toggled ON ──
  const layerFetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {

    // Flights
    if (activeLayers.flights || activeLayers.military || activeLayers.jets || activeLayers.private) {
      if (!layerFetchedRef.current.has('flights')) {
        fetchEndpoint('/api/flights');
        layerFetchedRef.current.add('flights');
      }
    }
    // Satellites
    if (activeLayers.satellites && !layerFetchedRef.current.has('satellites')) {
      fetchEndpoint('/api/satellites');
      layerFetchedRef.current.add('satellites');
    }
    // Fires
    if (activeLayers.fires && !layerFetchedRef.current.has('fires')) {
      fetchEndpoint('/api/fires');
      layerFetchedRef.current.add('fires');
    }
    // CCTV
    if (activeLayers.cctv && !layerFetchedRef.current.has('cctv')) {
      fetchEndpoint('/api/cctv?region=all');
      layerFetchedRef.current.add('cctv');
    }
    // Maritime
    if (activeLayers.maritime && !layerFetchedRef.current.has('maritime')) {
      fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }));
      layerFetchedRef.current.add('maritime');
    }
    // Balloons
    if (activeLayers.balloons && !layerFetchedRef.current.has('balloons')) {
      fetchEndpoint('/api/balloons', d => ({ balloons: d.balloons }));
      layerFetchedRef.current.add('balloons');
    }
    // Radiation
    if (activeLayers.radiation && !layerFetchedRef.current.has('radiation')) {
      fetchEndpoint('/api/radiation', d => ({ radiation: d.stations }));
      layerFetchedRef.current.add('radiation');
    }
    // Live News
    if (activeLayers.live_news && !layerFetchedRef.current.has('live_news')) {
      fetchEndpoint('/api/live-news', d => ({ live_feeds: d.feeds }));
      layerFetchedRef.current.add('live_news');
    }
    // Weather
    if (activeLayers.weather && !layerFetchedRef.current.has('weather')) {
      fetchEndpoint('/api/weather', d => ({ weather_events: d.events }));
      layerFetchedRef.current.add('weather');
    }
    // Infrastructure
    if (activeLayers.infrastructure && !layerFetchedRef.current.has('infrastructure')) {
      fetchEndpoint('/api/infrastructure', d => ({ infrastructure: d.infrastructure }));
      layerFetchedRef.current.add('infrastructure');
    }
    if (activeLayers.hud_pha_flows && !layerFetchedRef.current.has('hud_pha_flows')) {
      fetchEndpoint('/api/hud-pha-flows', d => ({ hud_phas: d.phas, hud_pha_awards: d.awards, hud_state_totals: d.state_totals }));
      layerFetchedRef.current.add('hud_pha_flows');
    }
    if (activeLayers.federal_power && !layerFetchedRef.current.has('federal_power')) {
      fetchEndpoint('/api/federal-power', d => ({ federal_power: d.people }));
      layerFetchedRef.current.add('federal_power');
    }
    // Global Incidents (GDELT)
    if (activeLayers.global_incidents && !layerFetchedRef.current.has('gdelt')) {
      fetchEndpoint('/api/gdelt', d => ({ gdelt: d.events }));
      layerFetchedRef.current.add('gdelt');
    }

  }, [activeLayers]);

  // ── LAYER-AWARE POLLING — only poll data for active layers ──
  useEffect(() => {
    const intervals: ReturnType<typeof setInterval>[] = [];
    if (activeLayers.flights || activeLayers.military || activeLayers.jets || activeLayers.private) {
      intervals.push(setInterval(() => fetchEndpoint('/api/flights'), 300000)); // 5 min (was 2 min)
    }

    if (activeLayers.balloons) {
      intervals.push(setInterval(() => fetchEndpoint('/api/balloons', d => ({ balloons: d.balloons })), 300000)); // 5m
    }
    if (activeLayers.radiation) {
      intervals.push(setInterval(() => fetchEndpoint('/api/radiation', d => ({ radiation: d.stations })), 300000)); // 5m
    }
    if (activeLayers.maritime) {
      intervals.push(setInterval(() => fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships })), 60000)); // 1m
    }
    // Fires: no polling needed (data changes very slowly, initial fetch is enough)
    return () => intervals.forEach(clearInterval);
  }, [activeLayers, fetchEndpoint]);

  // CCTV: loaded once on layer toggle via layerFetchedRef (no viewport polling)

  // Reactive layer fetch: handled by layerFetchedRef above (no duplicate)

  const totalFlights = useMemo(() => (
    (data.commercial_flights?.length||0)+(data.private_flights?.length||0)+(data.private_jets?.length||0)+(data.military_flights?.length||0)
  ), [data.commercial_flights, data.private_flights, data.private_jets, data.military_flights]);


  return (
    <main className="fixed inset-0 w-full h-full bg-[var(--bg-void)] overflow-hidden">

      {/* ── SPLASH ── */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            className="absolute inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden"
            style={{ background: 'radial-gradient(ellipse at center, #0a0a14 0%, var(--bg-void) 70%)' }}
          >
            {/* ── Scanline CRT overlay ── */}
            <div className="absolute inset-0 pointer-events-none z-[1]" style={{
              backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(212,175,55,0.015) 2px, rgba(212,175,55,0.015) 4px)',
              animation: 'splashScanDrift 8s linear infinite',
            }} />

            {/* ── V4.2 badge — top-left ── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              transition={{ delay: 0.8, duration: 0.5 }}
              className="absolute top-6 left-6 z-[2] font-mono text-[10px] tracking-[0.3em] text-[var(--gold-primary)]"
            >
              V4.2
            </motion.div>



            {/* ── Geometric tactical logo ── */}
            <div className="relative w-40 h-40 mb-8 flex items-center justify-center z-[2]">
              {/* Outer ring — slow clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.6, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: 360 }}
                transition={{ opacity: { duration: 0.6 }, scale: { duration: 0.8, ease: 'easeOut' }, rotate: { duration: 20, repeat: Infinity, ease: 'linear' } }}
                className="absolute inset-0 rounded-full"
                style={{ border: '1px solid rgba(212,175,55,0.2)' }}
              >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ background: 'var(--gold-primary)', boxShadow: '0 0 12px var(--gold-primary), 0 0 24px rgba(212,175,55,0.3)' }} />
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-1 h-1 rounded-full" style={{ background: 'rgba(212,175,55,0.5)', boxShadow: '0 0 6px rgba(212,175,55,0.3)' }} />
              </motion.div>

              {/* Middle ring — faster counter-clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: -360 }}
                transition={{ opacity: { duration: 0.6, delay: 0.15 }, scale: { duration: 0.8, delay: 0.15, ease: 'easeOut' }, rotate: { duration: 12, repeat: Infinity, ease: 'linear' } }}
                className="absolute rounded-full"
                style={{ inset: '18px', border: '1px solid rgba(0,229,255,0.15)' }}
              >
                <div className="absolute top-1/2 right-0 translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--cyan-primary)', boxShadow: '0 0 10px var(--cyan-primary), 0 0 20px rgba(0,229,255,0.2)' }} />
                <div className="absolute bottom-0 left-1/4 translate-y-1/2 w-1 h-1 rounded-full" style={{ background: 'rgba(0,229,255,0.4)' }} />
              </motion.div>

              {/* Inner ring — fastest clockwise */}
              <motion.div
                initial={{ opacity: 0, scale: 0.2, rotate: 0 }}
                animate={{ opacity: 1, scale: 1, rotate: 360 }}
                transition={{ opacity: { duration: 0.6, delay: 0.3 }, scale: { duration: 0.8, delay: 0.3, ease: 'easeOut' }, rotate: { duration: 7, repeat: Infinity, ease: 'linear' } }}
                className="absolute rounded-full"
                style={{ inset: '40px', border: '1px solid rgba(212,175,55,0.25)' }}
              >
                <div className="absolute top-0 left-1/4 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--gold-primary)', boxShadow: '0 0 8px var(--gold-primary)' }} />
              </motion.div>

              {/* Core circle + crosshair */}
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
                className="relative w-12 h-12 rounded-full flex items-center justify-center"
                style={{ border: '2px solid var(--gold-primary)', boxShadow: '0 0 20px rgba(212,175,55,0.15), inset 0 0 20px rgba(212,175,55,0.05)' }}
              >
                <motion.div
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-5 h-5 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.4) 0%, rgba(212,175,55,0.05) 70%)' }}
                />
                {/* Crosshair lines */}
                <div className="absolute w-[1px] h-full" style={{ background: 'linear-gradient(to bottom, transparent, rgba(212,175,55,0.3), transparent)' }} />
                <div className="absolute w-full h-[1px]" style={{ background: 'linear-gradient(to right, transparent, rgba(212,175,55,0.3), transparent)' }} />
              </motion.div>

              {/* Faint pulsing radar sweep */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.15, 0], rotate: [0, 360] }}
                transition={{ opacity: { duration: 3, repeat: Infinity }, rotate: { duration: 3, repeat: Infinity, ease: 'linear' }, delay: 0.6 }}
                className="absolute inset-[10px] rounded-full"
                style={{ background: 'conic-gradient(from 0deg, transparent 0deg, rgba(212,175,55,0.15) 40deg, transparent 80deg)' }}
              />
            </div>

            {/* ── AutoNateAI title — letter-by-letter stagger ── */}
            <div className="flex items-center gap-[2px] mb-3 z-[2]">
              {'AUTONATEAI'.split('').map((letter, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ delay: 0.5 + i * 0.055, duration: 0.5, ease: 'easeOut' }}
                  className="text-3xl md:text-5xl font-bold tracking-[0.24em] md:tracking-[0.32em] font-mono"
                  style={{ color: 'var(--text-heading)', textShadow: '0 0 30px rgba(212,175,55,0.2)' }}
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {/* ── Subtitle — typewriter reveal ── */}
            <div className="overflow-hidden mb-8 z-[2]">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ delay: 1.2, duration: 0.8, ease: 'easeInOut' }}
                className="overflow-hidden whitespace-nowrap"
              >
                <p className="text-[10px] md:text-[11px] font-mono tracking-[0.5em] text-[var(--gold-primary)]" style={{ opacity: 0.8 }}>
                  GLOBAL INTELLIGENCE PLATFORM
                </p>
              </motion.div>
            </div>

            {/* ── Multi-stage progress bar ── */}
            <div className="w-64 md:w-80 z-[2]">
              {/* Thin progress track */}
              <div className="relative w-full h-[2px] rounded-full overflow-hidden" style={{ background: 'rgba(212,175,55,0.1)' }}>
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: ['0%', '25%', '50%', '78%', '100%'] }}
                  transition={{ duration: 2.2, delay: 0.5, times: [0, 0.25, 0.5, 0.75, 1], ease: 'easeInOut' }}
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--gold-primary), var(--cyan-primary), var(--gold-primary))', boxShadow: '0 0 12px rgba(212,175,55,0.4)' }}
                />
              </div>

              {/* Status messages — cycling */}
              <div className="mt-3 h-4 flex items-center justify-center">
                {[
                  { text: 'ESTABLISHING SECURE CONNECTION...', delay: 0.5 },
                  { text: 'INITIALIZING FEEDS...', delay: 1.1 },
                  { text: 'CALIBRATING SENSORS...', delay: 1.7 },
                  { text: 'SYSTEM READY', delay: 2.2 },
                ].map((stage, i) => (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 1, 1, 0] }}
                    transition={{ delay: stage.delay, duration: 0.6, times: [0, 0.1, 0.7, 1] }}
                    className="absolute text-[9px] font-mono tracking-[0.25em]"
                    style={{ color: i === 3 ? 'var(--cyan-primary)' : 'var(--text-muted)' }}
                  >
                    {stage.text}
                  </motion.span>
                ))}
              </div>
            </div>

            {/* ── Decorative grid lines ── */}
            <div className="absolute inset-0 pointer-events-none z-[0]" style={{ opacity: 0.03 }}>
              <div className="absolute inset-0" style={{
                backgroundImage: 'linear-gradient(rgba(212,175,55,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.5) 1px, transparent 1px)',
                backgroundSize: '60px 60px',
              }} />
            </div>

            {/* ── Corner frame accents ── */}
            {[
              { t: '10px', l: '10px', bw: '2px 0 0 2px' },
              { t: '10px', r: '10px', bw: '2px 2px 0 0' },
              { b: '10px', l: '10px', bw: '0 0 2px 2px' },
              { b: '10px', r: '10px', bw: '0 2px 2px 0' },
            ].map((pos, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.3 }}
                transition={{ delay: 0.8 + i * 0.1, duration: 0.5 }}
                className="absolute w-8 h-8 z-[2]"
                style={{ top: pos.t, bottom: pos.b, left: pos.l, right: pos.r, borderWidth: pos.bw, borderStyle: 'solid', borderColor: 'var(--gold-primary)' }}
              />
            ))}



            {/* ── Inline keyframe for scanline drift ── */}
            <style>{`
              @keyframes splashScanDrift {
                0% { background-position: 0 0; }
                100% { background-position: 0 100vh; }
              }
            `}</style>
          </motion.div>
        )}
      </AnimatePresence>



      {/* ── MAP ── */}
      <ErrorBoundary name="Map">
        <OsirisMap 
          data={data} 
          activeLayers={activeLayers} 
          projection={mapProjection} 
          mapStyle={mapStyle === 'satellite' ? 'satellite' : siteTheme}
          onEntityClick={handleEntityClick} 
          onMouseCoords={handleMouseCoords} 
          onRightClick={handleRightClick} 
          onViewStateChange={setMapView} 
          flyToLocation={flyToLocation}
          sweepData={sweepData}
          scanTargets={scanTargets}
        />
      </ErrorBoundary>


      {/* ── MAP VIEW CONTROLS (3D/2D + SATELLITE TOGGLE) ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.5 }}
        className="absolute bottom-[75px] md:bottom-6 left-3 md:left-[315px] z-[200] flex items-center gap-2 pointer-events-none"
      >
        {/* 3D/2D Toggle */}
        <button
          onClick={() => setMapProjection(p => p === 'globe' ? 'mercator' : 'globe')}
          className="glass-panel p-2.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group relative"
          title={mapProjection === 'globe' ? 'Switch to 2D Map' : 'Switch to 3D Globe'}
        >
          {mapProjection === 'globe' ? (
            <MapPinned className="w-4 h-4 text-[var(--gold-primary)] group-hover:scale-110 transition-transform" />
          ) : (
            <Globe className="w-4 h-4 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />
          )}
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity glass-panel px-2 py-1 z-[300]">
            {mapProjection === 'globe' ? '2D MAP' : '3D GLOBE'}
          </span>
        </button>

        {/* Map Style Toggle */}
        <button
          onClick={() => setMapStyle(s => s === 'dark' ? 'satellite' : 'dark')}
          className="glass-panel p-2.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group relative"
          title={mapStyle === 'dark' ? 'Satellite View' : 'Night View'}
        >
          {mapStyle === 'dark' ? (
            <Satellite className="w-4 h-4 text-[var(--alert-green)] group-hover:scale-110 transition-transform" />
          ) : (
            <Moon className="w-4 h-4 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />
          )}
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity glass-panel px-2 py-1 z-[300]">
            {mapStyle === 'dark' ? 'SATELLITE' : 'NIGHT MODE'}
          </span>
        </button>

        {/* Full UI Theme Toggle */}
        <button
          onClick={() => setSiteTheme(t => t === 'dark' ? 'light' : 'dark')}
          className="glass-panel p-2.5 pointer-events-auto hover:border-[var(--gold-primary)]/40 transition-colors group relative"
          title={siteTheme === 'dark' ? 'Light Theme' : 'Dark Theme'}
        >
          {siteTheme === 'dark' ? (
            <Sun className="w-4 h-4 text-[var(--gold-primary)] group-hover:scale-110 transition-transform" />
          ) : (
            <Moon className="w-4 h-4 text-[var(--cyan-primary)] group-hover:scale-110 transition-transform" />
          )}
          <span className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 text-[9px] font-mono text-[var(--text-muted)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity glass-panel px-2 py-1 z-[300]">
            {siteTheme === 'dark' ? 'LIGHT THEME' : 'DARK THEME'}
          </span>
        </button>
      </motion.div>

      {/* ── HEADER ── */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 2.5 }} className={`absolute top-3 left-3 md:top-5 md:left-5 z-[200] pointer-events-none flex items-center gap-2 md:gap-3`}>
        <div className="w-7 h-7 md:w-9 md:h-9 flex items-center justify-center relative">
          {/* Ambient glow ring — slow rotating */}
          <div className="absolute inset-[-4px] md:inset-[-5px] rounded-full border border-[var(--gold-primary)]/20" style={{ animation: 'osiris-rotate 12s linear infinite' }}>
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[var(--gold-primary)] shadow-[0_0_6px_var(--gold-primary)]" />
          </div>
          <div className="absolute inset-[-8px] md:inset-[-10px] rounded-full border border-[var(--gold-primary)]/10" style={{ animation: 'osiris-rotate 20s linear infinite reverse' }}>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-0.5 h-0.5 rounded-full bg-[var(--gold-primary)]/60" />
          </div>
          <div className="w-5 h-5 md:w-7 md:h-7 rounded-full border-2 border-[var(--gold-primary)] flex items-center justify-center animate-glow-pulse">
            <div className="w-2.5 h-2.5 md:w-3.5 md:h-3.5 rounded-full bg-[var(--gold-primary)]/30 border border-[var(--gold-primary)]/60" />
          </div>
          <div className="absolute w-[1px] h-full bg-[var(--gold-primary)]/30" />
          <div className="absolute w-full h-[1px] bg-[var(--gold-primary)]/30" />
        </div>
        {/* Horizontal rule extending from logo */}
        <div className="hidden md:block absolute top-1/2 left-[52px] w-[200px] h-[1px] bg-gradient-to-r from-[var(--gold-primary)]/40 via-[var(--gold-primary)]/15 to-transparent" />
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-base md:text-xl font-bold tracking-[0.16em] md:tracking-[0.22em] text-[var(--text-heading)] font-mono">AUTONATEAI</h1>
            <span className="hidden md:inline-flex items-center gap-1 px-1.5 py-[1px] rounded-sm border border-[var(--cyan-primary)]/40 bg-[var(--cyan-primary)]/10 text-[7px] font-mono font-bold tracking-[0.15em] text-[var(--cyan-primary)] uppercase" style={{ lineHeight: '1.4' }}>
              <Globe className="w-2.5 h-2.5" />
              OPEN SOURCE
            </span>
          </div>
          <span className="text-[8px] md:text-[9px] text-[var(--gold-primary)] font-mono tracking-[0.16em] md:tracking-[0.24em] opacity-80">INTELLIGENCE COMMAND</span>
        </div>
      </motion.div>

      {/* ── TOP-RIGHT STATUS (desktop) — C2 DISPLAY ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3 }} className="status-bar-desktop absolute top-3 right-3 md:top-4 md:right-5 z-[200] pointer-events-none flex items-center gap-1.5 md:gap-3 text-[9px] md:text-[10px] font-mono tracking-widest text-[var(--text-muted)]">

        {/* Zulu Clock */}
        <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border border-[var(--border-primary)] bg-black/30">
          <ZuluClock />
        </span>

        <span className="hidden lg:inline text-[var(--border-primary)]">│</span>

        <span className="flex items-center gap-1">SYS: <span className={backendStatus === 'connected' ? 'text-[var(--alert-green)]' : 'text-[var(--alert-red)]'}>{backendStatus.toUpperCase()}</span></span>

        {spaceWeather && <span className="hidden lg:inline">SOLAR: <span style={{ color: spaceWeather.storm_color, fontWeight: 700 }}>Kp{spaceWeather.kp_index}</span></span>}

        {/* Active Data Feeds */}
        <span className="hidden lg:inline-flex items-center gap-1">
          <Wifi className="w-3 h-3 text-[var(--cyan-primary)]" />
          <span className="text-[var(--cyan-primary)] font-bold">{Object.values(activeLayers).filter(Boolean).length}</span>
          <span className="text-[var(--text-muted)]/60">FEEDS</span>
        </span>

        <UptimeClock />
        
        <a href='https://ko-fi.com/M8D41ZYW4Z' target='_blank' className="pointer-events-auto hover:opacity-80 transition-opacity ml-1 flex items-center">
          <span className="px-3 py-1 rounded-sm border border-[var(--gold-primary)]/40 bg-[var(--gold-primary)]/10 text-[var(--gold-primary)] text-[11px] font-bold tracking-[0.2em]">SUPPORT PROJECT</span>
        </a>
      </motion.div>

      {/* ── MOBILE: Compact top status ── */}
      {isMobile && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.5 }} className="absolute top-3 right-3 z-[200] pointer-events-auto flex items-center gap-2">
          <a href='https://ko-fi.com/M8D41ZYW4Z' target='_blank' className="glass-panel px-2 py-1 flex items-center gap-1.5 text-[7px] font-mono tracking-widest hover:opacity-80 transition-opacity border-[var(--gold-primary)]/40 bg-[var(--gold-primary)]/10">
            <div className="w-1 h-1 rounded-full bg-[var(--gold-primary)] animate-osiris-pulse" />
            <span className="text-[var(--gold-primary)] font-bold">SUPPORT PROJECT</span>
          </a>
        </motion.div>
      )}



      {/* ── LEFT HUD (desktop): Layers + Stats + Markets + Intel ── */}
      <div className="desktop-panel absolute left-5 top-20 bottom-24 w-72 flex flex-col gap-3 z-[200] pointer-events-none overflow-y-auto styled-scrollbar pr-1">
        {showLayers && (
          <>
            <LayerPanel data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} />
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }} className="glass-panel px-3 py-2.5 pointer-events-auto">
              <div className="grid grid-cols-5 gap-2 text-center">
                <div><div className="hud-label">AIRCRAFT</div><div className="hud-value text-[10px] animate-data-pulse">{globalStats ? globalStats.flights.toLocaleString() : '0'}</div></div>
                <div><div className="hud-label">SATS</div><div className="hud-value text-[10px]">{globalStats ? globalStats.sats.toLocaleString() : '0'}</div></div>
                <div><div className="hud-label">CCTV</div><div className="hud-value text-[10px]">{globalStats ? globalStats.cctv.toLocaleString() : '0'}</div></div>
                <div><div className="hud-label">WEATHER</div><div className="hud-value text-[10px]" style={{ color: '#E040FB' }}>{globalStats ? globalStats.weather.toLocaleString() : '0'}</div></div>
                <div><div className="hud-label">NUCLEAR</div><div className="hud-value text-[10px]" style={{ color: '#76FF03' }}>{globalStats ? globalStats.nuclear.toLocaleString() : '0'}</div></div>
              </div>
            </motion.div>
            <ViewPresets onNavigate={(lat, lng, zoom) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMapView(v => ({ ...v, zoom })); }} />
          </>
        )}
        {showMarkets && <MarketsPanel data={data} spaceWeather={spaceWeather} />}
        {showIntel && <IntelFeed data={data} onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })} />}
      </div>

      {/* ── RIGHT HUD (desktop): Search + RECON + Live Alerts ── */}
      <div className="desktop-panel absolute right-5 top-20 bottom-24 w-80 flex flex-col gap-3 z-[200] pointer-events-auto overflow-y-auto styled-scrollbar pr-1">
        <div className="flex gap-2 items-start">
          <div className="flex-1"><SearchBar onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })} /></div>
          <div className="relative"><SharePanel mapView={mapView} activeLayers={activeLayers} mouseCoords={null} /></div>
        </div>
        <OsintPanel onSweepVisualize={setSweepData} onScanGeolocate={(target, data) => {
          setScanTargets(prev => {
            const existing = prev.filter(t => t.id !== target);
            return [{ id: target, timestamp: Date.now(), ...data }, ...existing].slice(0, 10);
          });
          setFlyToLocation({ lat: data.lat, lng: data.lng, ts: Date.now() });
        }} />
        <LiveAlerts data={data} onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })} onWatchFeed={(url, name) => { setLiveFeedUrl(url); setLiveFeedName(name); }} />
      </div>

      {/* ── LIVE FEED VIEWER OVERLAY ── */}
      <AnimatePresence>
        {liveFeedUrl && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setLiveFeedUrl(null)}
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="w-[90vw] max-w-[900px] flex flex-col relative rounded-xl overflow-hidden border border-[var(--border-primary)] shadow-2xl bg-black"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#111] border-b border-[var(--border-primary)]">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#FF4081] animate-osiris-pulse" />
                  <span className="text-[12px] font-mono font-bold text-white tracking-wider">{liveFeedName}</span>
                  <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-mono text-[9px] font-bold">LIVE STREAM</span>
                  {!liveFeedEmbedAllowed && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-mono text-[9px]">EXTERNAL ONLY</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href={
                      liveFeedUrl.includes('channel=')
                        ? `https://www.youtube.com/channel/${liveFeedUrl.split('channel=')[1].split('&')[0]}/live`
                        : liveFeedUrl.includes('/embed/')
                        ? `https://www.youtube.com/watch?v=${liveFeedUrl.split('/embed/')[1].split('?')[0]}`
                        : liveFeedUrl
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--border-primary)] hover:bg-[var(--gold-primary)] hover:text-black text-white transition-colors text-[11px] font-mono"
                  >
                    <span>Open in YouTube</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button onClick={() => setLiveFeedUrl(null)} className="text-white/70 hover:text-white transition-colors p-1">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Body — iframe or external card */}
              {liveFeedEmbedAllowed ? (
                <div className="w-full aspect-video relative bg-black">
                  <iframe
                    src={liveFeedUrl}
                    className="w-full h-full absolute inset-0"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="w-full aspect-video flex items-center justify-center bg-black/95">
                  <div className="text-center px-8">
                    <div className="w-14 h-14 rounded-full bg-[#39FF14]/10 border border-[#39FF14]/20 flex items-center justify-center mx-auto mb-4">
                      <ExternalLink className="w-6 h-6 text-[#39FF14]" />
                    </div>
                    <p className="text-[13px] font-mono font-bold text-white tracking-widest mb-2">EMBED RESTRICTED</p>
                    <p className="text-[11px] font-mono text-white/50 mb-6 max-w-xs">
                      {liveFeedName} does not allow third-party embedding. Click below to open the live stream directly.
                    </p>
                    <a
                      href={
                        liveFeedUrl.includes('channel=')
                          ? `https://www.youtube.com/channel/${liveFeedUrl.split('channel=')[1].split('&')[0]}/live`
                          : liveFeedUrl.includes('/embed/')
                          ? `https://www.youtube.com/watch?v=${liveFeedUrl.split('/embed/')[1].split('?')[0]}`
                          : liveFeedUrl
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded border border-[#39FF14]/40 text-[#39FF14] font-mono text-[12px] hover:bg-[#39FF14]/10 transition-colors tracking-wider"
                    >
                      <ExternalLink className="w-4 h-4" />
                      OPEN LIVE STREAM
                    </a>
                  </div>
                </div>
              )}

              {/* Footer — only show for embeddable feeds */}
              {liveFeedEmbedAllowed && (
                <div className="bg-[#111]/90 px-4 py-2.5 border-t border-[var(--border-primary)] flex items-center gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-[var(--gold-primary)] shrink-0" />
                  <span className="text-[11px] font-mono text-white/70 leading-relaxed">
                    If you see &ldquo;Video unavailable&rdquo;, use <strong className="text-[var(--gold-primary)]">Open in YouTube</strong> above.
                  </span>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ MOBILE UI ═══ */}
      {isMobile && (
        <>
          {/* Mobile Bottom Navigation */}
          <div className="mobile-nav">
            <div className="glass-panel mobile-nav-inner">
              {[
                { id: 'layers' as const, icon: Layers, label: 'LAYERS' },
                { id: 'markets' as const, icon: BarChart3, label: 'MARKETS' },
                { id: 'intel' as const, icon: Newspaper, label: 'INTEL' },
                { id: 'recon' as const, icon: Radar, label: 'RECON' },
                { id: 'search' as const, icon: Search, label: 'SEARCH' },
              ].map(tab => (
                <button key={tab.id} onClick={() => setMobilePanel(mobilePanel === tab.id ? null : tab.id)}
                  className={`mobile-nav-btn ${mobilePanel === tab.id ? 'active' : ''}`}>
                  <tab.icon className={`w-4 h-4 ${tab.id === 'recon' ? 'text-[var(--cyan-primary)]' : ''}`} />
                  <span className={tab.id === 'recon' ? 'text-[var(--cyan-primary)]' : ''}>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Mobile Drawer */}
          <AnimatePresence>
            {mobilePanel && (
              <motion.div
                initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed bottom-[52px] left-0 right-0 z-[400] glass-panel rounded-b-none overflow-y-auto styled-scrollbar"
                style={{ maxHeight: 'min(55vh, calc(100dvh - 100px))', paddingBottom: 'env(safe-area-inset-bottom, 4px)' }}
              >
                <div className="mobile-drawer-handle" />
                <div className="px-3 pb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="hud-text text-[9px] text-[var(--text-primary)]">
                      {mobilePanel === 'layers' ? 'LAYERS & STATS' : mobilePanel === 'markets' ? 'MARKETS & INTEL' : mobilePanel === 'intel' ? 'INTEL FEED' : mobilePanel === 'recon' ? 'AUTONATEAI RECON' : 'SEARCH'}
                    </span>
                    <button onClick={() => setMobilePanel(null)} className="text-[var(--text-muted)] p-1"><X className="w-4 h-4" /></button>
                  </div>
                  {mobilePanel === 'layers' && (
                    <>
                      <div className="glass-panel-sm p-2 mb-2">
                        <div className="grid grid-cols-5 gap-1 text-center">
                          <div><div className="hud-label" style={{fontSize:'6px'}}>AIR</div><div className="hud-value text-[9px]">{totalFlights.toLocaleString()}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>SAT</div><div className="hud-value text-[9px]">{(data.satellites?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>CAM</div><div className="hud-value text-[9px]">{(data.cameras?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>WX</div><div className="hud-value text-[9px]" style={{color:'#E040FB'}}>{(data.weather_events?.length||0)}</div></div>
                          <div><div className="hud-label" style={{fontSize:'6px'}}>NUC</div><div className="hud-value text-[9px]" style={{color:'#76FF03'}}>{(data.infrastructure?.length||0)}</div></div>
                        </div>
                      </div>
                      <LayerPanel data={data} activeLayers={activeLayers} setActiveLayers={setActiveLayers} />
                      <div className="mt-2">
                        <ViewPresets onNavigate={(lat, lng, zoom) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMapView(v => ({ ...v, zoom })); setMobilePanel(null); }} />
                      </div>
                    </>
                  )}
                  {mobilePanel === 'markets' && <MarketsPanel data={data} spaceWeather={spaceWeather} />}
                  {mobilePanel === 'intel' && <IntelFeed data={data} onLocate={(lat, lng) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMobilePanel(null); }} />}
                  {mobilePanel === 'search' && (
                    <div className="space-y-2">
                      <SearchBar onLocate={(lat, lng) => { setFlyToLocation({ lat, lng, ts: Date.now() }); setMobilePanel(null); }} />
                      <SharePanel mapView={mapView} activeLayers={activeLayers} mouseCoords={null} />
                    </div>
                  )}
                  {mobilePanel === 'recon' && (
                    <div className="space-y-2">
                      <OsintPanel isOpen={true} onClose={() => setMobilePanel(null)} isMobile={true} onSweepVisualize={setSweepData} />
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}

      {/* ── BOTTOM CENTER (desktop) ── */}
      {!isMobile && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3, duration: 0.8 }} className="desktop-only absolute bottom-5 left-1/2 -translate-x-1/2 z-[200] pointer-events-auto">
          <div className="glass-panel px-5 py-2.5 flex items-center gap-0 osiris-glow relative overflow-hidden" style={{ borderImage: 'linear-gradient(90deg, rgba(212,175,55,0.05), rgba(212,175,55,0.2), rgba(212,175,55,0.05)) 1', borderImageSlice: 1, borderWidth: '1px', borderStyle: 'solid' }}>

            {/* Animated scan line sweeping across the bar */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
              <div className="absolute top-0 bottom-0 w-[60px] bg-gradient-to-r from-transparent via-[var(--gold-primary)]/[0.07] to-transparent" style={{ animation: 'hud-scanline 4s ease-in-out infinite' }} />
            </div>

            {/* COORDINATES */}
            <div className="flex flex-col items-center min-w-[110px] px-3">
              <div className="hud-label">COORDINATES</div>
              <div ref={coordsDisplayRef} className="text-[10px] font-mono font-bold text-[var(--gold-primary)] tracking-wide tabular-nums">—</div>
            </div>

            <div className="w-px h-8 bg-gradient-to-b from-transparent via-[var(--border-primary)] to-transparent flex-shrink-0" />

            {/* LOCATION */}
            <div className="flex flex-col items-center min-w-[160px] max-w-[280px] px-3">
              <div className="hud-label">LOCATION</div>
              <div className="text-[9px] text-[var(--text-secondary)] font-mono truncate max-w-[280px]">{locationLabel || 'Hover over map...'}</div>
            </div>

            <div className="w-px h-8 bg-gradient-to-b from-transparent via-[var(--border-primary)] to-transparent flex-shrink-0" />

            {/* ZOOM */}
            <div className="flex flex-col items-center px-3">
              <div className="hud-label">ZOOM</div>
              <div className="text-[10px] font-mono font-bold text-[var(--gold-primary)] tabular-nums">{mapView.zoom.toFixed(1)}</div>
            </div>

            <div className="w-px h-8 bg-gradient-to-b from-transparent via-[var(--border-primary)] to-transparent flex-shrink-0" />

            {/* ACTIVE LAYERS */}
            <div className="flex flex-col items-center px-3 min-w-[60px]">
              <div className="hud-label">ACTIVE LAYERS</div>
              <div className="flex items-center gap-1">
                <Layers className="w-3 h-3 text-[var(--gold-primary)]" />
                <span className="text-[10px] font-mono font-bold text-[var(--gold-primary)] tabular-nums">{Object.values(activeLayers).filter(Boolean).length}</span>
              </div>
            </div>

            <div className="w-px h-8 bg-gradient-to-b from-transparent via-[var(--border-primary)] to-transparent flex-shrink-0" />

            {/* DATA FEEDS */}
            <div className="flex flex-col items-center px-3 min-w-[60px]">
              <div className="hud-label">FEEDS</div>
              <div className="flex items-center gap-1">
                <Activity className="w-3 h-3 text-[var(--cyan-primary)]" />
                <span className="text-[10px] font-mono font-bold text-[var(--cyan-primary)] tabular-nums">{Object.values(activeLayers).filter(Boolean).length}</span>
              </div>
            </div>

            <div className="w-px h-8 bg-gradient-to-b from-transparent via-[var(--border-primary)] to-transparent flex-shrink-0" />

            {/* THROUGHPUT */}
            <div className="flex flex-col items-center px-3 min-w-[70px]">
              <div className="hud-label">THROUGHPUT</div>
              <div className="flex items-center gap-1">
                <Database className="w-3 h-3 text-[var(--alert-green)]" />
                <DataThroughput data={data} />
              </div>
            </div>

          </div>
        </motion.div>
      )}

      {/* ── Scale Bar (desktop) ── */}
      <div className="desktop-only absolute bottom-[4.5rem] left-[20rem] z-[201] pointer-events-none">
        <ScaleBar zoom={mapView.zoom} latitude={mapView.latitude} />
      </div>

      {/* ── Region Dossier ── */}
      {(regionDossier || dossierLoading) && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="absolute top-16 md:top-20 left-2 right-2 md:left-1/2 md:right-auto md:-translate-x-1/2 z-[300] md:w-[480px] max-h-[65vh] overflow-y-auto styled-scrollbar">
          <div className="glass-panel p-5 osiris-glow">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-mono font-bold text-[var(--gold-primary)] tracking-wider">REGION DOSSIER</h2>
              <button onClick={() => { setRegionDossier(null); setDossierLoading(false); }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs">✕</button>
            </div>
            {dossierLoading ? (
              <div className="text-center py-8">
                <div className="w-5 h-5 border-2 border-[var(--gold-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <span className="text-[8px] font-mono text-[var(--text-muted)] tracking-widest">COMPILING INTEL...</span>
              </div>
            ) : regionDossier && (
              <div className="space-y-3">
                <div><div className="hud-label mb-0.5">LOCATION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.location?.display_name}</div></div>
                {regionDossier.country && (
                  <div className="grid grid-cols-2 gap-2">
                    <div><div className="hud-label mb-0.5">COUNTRY</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.flag} {regionDossier.country.name}</div></div>
                    <div><div className="hud-label mb-0.5">CAPITAL</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.capital}</div></div>
                    <div><div className="hud-label mb-0.5">POPULATION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.population?.toLocaleString()}</div></div>
                    <div><div className="hud-label mb-0.5">REGION</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.subregion || regionDossier.country.region}</div></div>
                    <div><div className="hud-label mb-0.5">LANGUAGES</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.languages?.join(', ')}</div></div>
                    <div><div className="hud-label mb-0.5">AREA</div><div className="text-xs text-[var(--text-primary)]">{regionDossier.country.area?.toLocaleString()} km²</div></div>
                  </div>
                )}
                {regionDossier.head_of_state && (<div><div className="hud-label mb-0.5">HEAD OF STATE</div><div className="text-xs text-[var(--gold-primary)]">{regionDossier.head_of_state.name}</div><div className="text-[8px] text-[var(--text-muted)]">{regionDossier.head_of_state.position}</div></div>)}
                {regionDossier.wikipedia && (<div><div className="hud-label mb-1">INTELLIGENCE BRIEF</div><div className="flex gap-3">{regionDossier.wikipedia.thumbnail && <img src={regionDossier.wikipedia.thumbnail} alt="" className="w-14 h-14 rounded object-cover flex-shrink-0" />}<p className="text-[8px] text-[var(--text-secondary)] leading-relaxed">{regionDossier.wikipedia.extract}</p></div></div>)}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Camera Viewer ── */}
      <CameraViewer
        camera={activeCamera}
        onClose={() => setActiveCamera(null)}
        onLocate={(lat, lng) => setFlyToLocation({ lat, lng, ts: Date.now() })}
      />

      <EntityDetailModal entity={detailEntity} onClose={() => setDetailEntity(null)} />

      {/* ── OVERLAYS ── */}
      <div className="vignette absolute inset-0 pointer-events-none z-[2]" />
      <div className="crt-scanlines absolute inset-0 pointer-events-none z-[3] opacity-[0.02]" />
      {/* Corner frames */}
      {['top-0 left-0','top-0 right-0','bottom-0 left-0','bottom-0 right-0'].map((pos, i) => (
        <div key={i} className={`absolute ${pos} w-16 h-16 pointer-events-none z-[1]`}>
          <div className={`absolute ${pos.includes('top') ? 'top-0' : 'bottom-0'} ${pos.includes('left') ? 'left-0' : 'right-0'} w-full h-[1px] bg-gradient-to-${pos.includes('left') ? 'r' : 'l'} from-[var(--gold-primary)]/30 to-transparent`} />
          <div className={`absolute ${pos.includes('top') ? 'top-0' : 'bottom-0'} ${pos.includes('left') ? 'left-0' : 'right-0'} w-[1px] h-full bg-gradient-to-${pos.includes('top') ? 'b' : 't'} from-[var(--gold-primary)]/30 to-transparent`} />
        </div>
      ))}

      {/* Keyboard Shortcuts Overlay */}
      <KeyboardShortcuts />

      {/* ── GLOBAL STATUS TICKER (bottom) ── */}
      <GlobalStatusBar />

      {/* Shortcut hint */}
      <div className="desktop-only absolute bottom-[26px] right-5 z-[200] pointer-events-none text-[6px] font-mono text-[var(--text-muted)]/40 tracking-widest">
        [?] SHORTCUTS · [F] FULLSCREEN · [S] SHARE · [R] RESET VIEW
      </div>


    </main>
  );
}
