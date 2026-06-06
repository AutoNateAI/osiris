'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  MapPinned,
  Plane,
  Route,
  Search,
  X,
} from 'lucide-react';

type Airport = {
  code: string;
  name: string;
  lat: number;
  lng: number;
  state: string;
  country: string;
  inbound: number;
  outbound: number;
};

type RouteFlow = {
  key: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  count: number;
};

const STATES = [
  'USA', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DC', 'DE', 'FL', 'GA', 'HI', 'IA', 'ID', 'IL', 'IN', 'KS',
  'KY', 'LA', 'MA', 'MD', 'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH', 'NJ', 'NM', 'NV', 'NY',
  'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
];

const STATE_BOXES: Record<string, [number, number, number, number]> = {
  AL: [30.1, 35.2, -88.5, -84.8], AK: [51.2, 71.5, -179.2, -129.9], AZ: [31.2, 37.1, -114.9, -109.0], AR: [33.0, 36.6, -94.7, -89.6],
  CA: [32.4, 42.1, -124.5, -114.1], CO: [36.9, 41.1, -109.1, -102.0], CT: [40.9, 42.1, -73.8, -71.7], DC: [38.7, 39.0, -77.2, -76.8],
  DE: [38.4, 39.9, -75.8, -75.0], FL: [24.4, 31.1, -87.7, -80.0], GA: [30.3, 35.1, -85.7, -80.8], HI: [18.8, 22.3, -160.4, -154.7],
  IA: [40.3, 43.6, -96.7, -90.1], ID: [42.0, 49.1, -117.3, -111.0], IL: [36.9, 42.6, -91.6, -87.0], IN: [37.7, 41.8, -88.2, -84.7],
  KS: [36.9, 40.1, -102.1, -94.5], KY: [36.4, 39.2, -89.6, -81.9], LA: [28.8, 33.1, -94.1, -88.8], MA: [41.2, 42.9, -73.6, -69.9],
  MD: [37.9, 39.8, -79.5, -75.0], ME: [43.0, 47.5, -71.2, -66.8], MI: [41.6, 48.4, -90.5, -82.1], MN: [43.4, 49.4, -97.3, -89.5],
  MO: [35.9, 40.7, -95.8, -89.0], MS: [30.1, 35.1, -91.7, -88.0], MT: [44.3, 49.1, -116.1, -104.0], NC: [33.8, 36.7, -84.4, -75.4],
  ND: [45.8, 49.1, -104.1, -96.5], NE: [39.9, 43.1, -104.1, -95.3], NH: [42.7, 45.4, -72.7, -70.6], NJ: [38.8, 41.4, -75.6, -73.9],
  NM: [31.3, 37.1, -109.1, -103.0], NV: [35.0, 42.1, -120.1, -114.0], NY: [40.4, 45.1, -79.8, -71.8], OH: [38.3, 42.4, -84.9, -80.5],
  OK: [33.6, 37.1, -103.1, -94.4], OR: [41.9, 46.4, -124.7, -116.4], PA: [39.6, 42.6, -80.6, -74.6], RI: [41.1, 42.1, -71.9, -71.0],
  SC: [32.0, 35.3, -83.4, -78.5], SD: [42.4, 45.9, -104.1, -96.4], TN: [34.9, 36.7, -90.4, -81.6], TX: [25.7, 36.6, -106.7, -93.4],
  UT: [36.9, 42.1, -114.1, -109.0], VA: [36.5, 39.5, -83.8, -75.1], VT: [42.7, 45.1, -73.5, -71.4], WA: [45.4, 49.1, -124.9, -116.9],
  WI: [42.4, 47.4, -92.9, -86.7], WV: [37.1, 40.7, -82.7, -77.7], WY: [40.9, 45.1, -111.1, -104.0],
};

function fmt(value: number) {
  return Number(value || 0).toLocaleString();
}

function airportState(lat: any, lng: any) {
  const y = Number(lat);
  const x = Number(lng);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return '';
  for (const [state, [minLat, maxLat, minLng, maxLng]] of Object.entries(STATE_BOXES)) {
    if (y >= minLat && y <= maxLat && x >= minLng && x <= maxLng) return state;
  }
  return '';
}

function airportCode(value: any) {
  return String(value || '').trim().toUpperCase();
}

function buildAirportFlows(flights: any[], scope: string) {
  const airports = new Map<string, Airport>();
  const routes = new Map<string, RouteFlow>();
  let enriched = 0;

  flights.forEach((flight) => {
    const from = airportCode(flight.departure);
    const to = airportCode(flight.destination);
    if (!from || !to) return;

    const fromState = airportState(flight.departure_lat, flight.departure_lng);
    const toState = airportState(flight.destination_lat, flight.destination_lng);
    const fromCountry = flight.departure_country || '';
    const toCountry = flight.destination_country || '';
    const isUsRoute = fromCountry === 'US' || toCountry === 'US' || fromState || toState;
    if (scope === 'USA' && !isUsRoute) return;
    if (scope !== 'USA' && fromState !== scope && toState !== scope) return;

    enriched += 1;
    if (!airports.has(from)) {
      airports.set(from, {
        code: from,
        name: flight.departure_name || from,
        lat: Number(flight.departure_lat),
        lng: Number(flight.departure_lng),
        state: fromState,
        country: fromCountry,
        inbound: 0,
        outbound: 0,
      });
    }
    if (!airports.has(to)) {
      airports.set(to, {
        code: to,
        name: flight.destination_name || to,
        lat: Number(flight.destination_lat),
        lng: Number(flight.destination_lng),
        state: toState,
        country: toCountry,
        inbound: 0,
        outbound: 0,
      });
    }
    airports.get(from)!.outbound += 1;
    airports.get(to)!.inbound += 1;

    const key = `${from}-${to}`;
    const existing = routes.get(key);
    if (existing) existing.count += 1;
    else routes.set(key, {
      key,
      from,
      to,
      fromName: flight.departure_name || from,
      toName: flight.destination_name || to,
      count: 1,
    });
  });

  const airportRows = Array.from(airports.values()).sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound));
  const routeRows = Array.from(routes.values()).sort((a, b) => b.count - a.count);
  return { airports: airportRows, routes: routeRows, enriched };
}

function AirportFlowExplorerInner({
  data,
  activeLayers,
  setActiveLayers,
  onLocate,
}: {
  data: any;
  activeLayers: Record<string, boolean>;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  onLocate?: (lat: number, lng: number, zoom?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('USA');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({ airports: true, routes: true });
  const flights = Array.isArray(data?.commercial_flights) ? data.commercial_flights : [];
  const flow = useMemo(() => buildAirportFlows(flights, scope), [flights, scope]);
  const filteredAirports = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return flow.airports;
    return flow.airports.filter((airport) => `${airport.code} ${airport.name} ${airport.state}`.toLowerCase().includes(needle));
  }, [flow.airports, query]);
  const filteredRoutes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return flow.routes;
    return flow.routes.filter((route) => `${route.from} ${route.to} ${route.fromName} ${route.toName}`.toLowerCase().includes(needle));
  }, [flow.routes, query]);
  const totalInbound = flow.airports.reduce((sum, airport) => sum + airport.inbound, 0);
  const totalOutbound = flow.airports.reduce((sum, airport) => sum + airport.outbound, 0);

  const enableCommercialFlights = () => {
    setActiveLayers((prev: any) => ({ ...prev, flights: true }));
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="glass-panel w-full px-3 py-3 flex items-center justify-between hover:border-[var(--cyan-primary)]/40 transition-colors group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Plane className="w-3.5 h-3.5 text-[var(--cyan-primary)]" />
          <span className="hud-text text-[11px] text-[var(--text-primary)]">AIRPORT FLOWS</span>
          <span className="gotham-tag gotham-tag--info" style={{ fontSize: '7px', padding: '1px 5px' }}>{flow.routes.length} ROUTES</span>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--cyan-primary)]" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.aside
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            className="fixed top-4 right-4 bottom-4 z-[999] w-[min(540px,calc(100vw-2rem))] glass-panel bg-[#07090d]/96 backdrop-blur-2xl border border-[var(--cyan-primary)]/25 rounded-xl overflow-hidden shadow-2xl shadow-[var(--cyan-primary)]/10 flex flex-col"
          >
            <div className="px-5 py-4 border-b border-[var(--border-secondary)] bg-[#111] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Route className="w-5 h-5 text-[var(--cyan-primary)]" />
                <span className="hud-text text-[15px] text-[var(--text-primary)]">AIRPORT FLOW EXPLORER</span>
                <span className="gotham-tag gotham-tag--info" style={{ fontSize: '8px' }}>{scope}</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 rounded hover:bg-white/5 text-[var(--text-muted)] hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b border-[var(--border-secondary)] space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="glass-panel-sm p-2">
                  <div className="hud-label">AIRPORTS</div>
                  <div className="hud-value text-[15px]">{fmt(flow.airports.length)}</div>
                </div>
                <div className="glass-panel-sm p-2">
                  <div className="hud-label">ROUTES</div>
                  <div className="hud-value text-[15px]">{fmt(flow.routes.length)}</div>
                </div>
                <div className="glass-panel-sm p-2">
                  <div className="hud-label">ENRICHED</div>
                  <div className="hud-value text-[15px]">{fmt(flow.enriched)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setScope('USA')}
                  className={`px-3 py-2 rounded border text-[10px] font-mono ${scope === 'USA' ? 'border-[var(--cyan-primary)]/40 bg-[var(--cyan-primary)]/10 text-[var(--cyan-primary)]' : 'border-[var(--border-secondary)] text-[var(--text-muted)]'}`}
                >
                  WHOLE USA
                </button>
                <select
                  value={scope === 'USA' ? '' : scope}
                  onChange={(event) => setScope(event.target.value || 'USA')}
                  className="bg-black/25 border border-[var(--border-secondary)] rounded px-3 py-2 text-[10px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--cyan-primary)]/40"
                >
                  <option value="">STATE FILTER</option>
                  {STATES.filter((state) => state !== 'USA').map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter airports or routes"
                  className="w-full bg-black/25 border border-[var(--border-secondary)] rounded-lg pl-9 pr-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--cyan-primary)]/40"
                />
              </div>

              {!activeLayers.flights && (
                <button onClick={enableCommercialFlights} className="w-full px-3 py-2 rounded-lg border border-[var(--cyan-primary)]/35 text-[var(--cyan-primary)] text-[10px] font-mono hover:bg-[var(--cyan-primary)]/10 transition-colors">
                  ENABLE COMMERCIAL FLIGHTS
                </button>
              )}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-4 space-y-3">
              <section className="glass-panel-sm overflow-hidden">
                <button onClick={() => setExpanded((prev) => ({ ...prev, airports: !prev.airports }))} className="w-full px-4 py-3 border-b border-[var(--border-secondary)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPinned className="w-4 h-4 text-[var(--cyan-primary)]" />
                    <span className="hud-text text-[11px]">AIRPORT NODES</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-mono text-[var(--text-muted)]">
                    {fmt(filteredAirports.length)}
                    {expanded.airports ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
                {expanded.airports && (
                  <div className="p-3 space-y-2 max-h-[380px] overflow-y-auto styled-scrollbar">
                    {filteredAirports.length === 0 && (
                      <div className="rounded-lg border border-dashed border-[var(--border-secondary)] p-4 text-[10px] font-mono text-[var(--text-muted)]">
                        No enriched airport routes loaded for this scope yet. Enable commercial flights and let route enrichment finish.
                      </div>
                    )}
                    {filteredAirports.slice(0, 80).map((airport) => {
                      const total = airport.inbound + airport.outbound;
                      return (
                        <div key={airport.code} className="rounded-lg border border-[var(--border-secondary)] bg-black/20 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-[13px] font-mono text-[var(--text-primary)]">{airport.code}</div>
                              <div className="mt-1 text-[9px] font-mono text-[var(--text-muted)] truncate">{airport.name}</div>
                            </div>
                            {Number.isFinite(airport.lat) && Number.isFinite(airport.lng) && (
                              <button onClick={() => onLocate?.(airport.lat, airport.lng, 8)} className="p-1.5 rounded border border-[var(--cyan-primary)]/30 text-[var(--cyan-primary)] hover:bg-[var(--cyan-primary)]/10">
                                <MapPinned className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="rounded bg-[var(--cyan-primary)]/10 border border-[var(--cyan-primary)]/20 px-2 py-1">
                              <div className="hud-label">TOTAL</div>
                              <div className="hud-value text-[11px]">{fmt(total)}</div>
                            </div>
                            <div className="rounded bg-[var(--alert-green)]/10 border border-[var(--alert-green)]/20 px-2 py-1">
                              <div className="hud-label flex items-center gap-1"><ArrowDownToLine className="w-3 h-3" /> IN</div>
                              <div className="hud-value text-[11px] text-[var(--alert-green)]">{fmt(airport.inbound)}</div>
                            </div>
                            <div className="rounded bg-[var(--gold-primary)]/10 border border-[var(--gold-primary)]/20 px-2 py-1">
                              <div className="hud-label flex items-center gap-1"><ArrowUpFromLine className="w-3 h-3" /> OUT</div>
                              <div className="hud-value text-[11px] text-[var(--gold-primary)]">{fmt(airport.outbound)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="glass-panel-sm overflow-hidden">
                <button onClick={() => setExpanded((prev) => ({ ...prev, routes: !prev.routes }))} className="w-full px-4 py-3 border-b border-[var(--border-secondary)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-[var(--gold-primary)]" />
                    <span className="hud-text text-[11px]">ROUTE CORRIDORS</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-mono text-[var(--text-muted)]">
                    {fmt(filteredRoutes.length)}
                    {expanded.routes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
                {expanded.routes && (
                  <div className="p-3 space-y-2 max-h-[380px] overflow-y-auto styled-scrollbar">
                    {filteredRoutes.slice(0, 100).map((route) => (
                      <div key={route.key} className="rounded-lg border border-[var(--border-secondary)] bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[12px] font-mono text-[var(--text-primary)]">{route.from} → {route.to}</div>
                            <div className="mt-1 text-[8px] font-mono text-[var(--text-muted)] truncate">{route.fromName} to {route.toName}</div>
                          </div>
                          <span className="rounded bg-[var(--gold-primary)]/10 border border-[var(--gold-primary)]/20 px-2 py-1 text-[9px] font-mono text-[var(--gold-primary)]">{fmt(route.count)} flights</span>
                        </div>
                        <div className="mt-3 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className="h-full bg-[var(--gold-primary)]" style={{ width: `${Math.max(5, route.count / Math.max(1, filteredRoutes[0]?.count || 1) * 100)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="px-4 py-3 border-t border-[var(--border-secondary)] bg-black/20 grid grid-cols-2 gap-2 text-[9px] font-mono">
              <div className="text-[var(--alert-green)]">ARRIVAL SIGNAL {fmt(totalInbound)}</div>
              <div className="text-[var(--gold-primary)] text-right">DEPARTURE SIGNAL {fmt(totalOutbound)}</div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}

const AirportFlowExplorer = memo(AirportFlowExplorerInner);
export default AirportFlowExplorer;
