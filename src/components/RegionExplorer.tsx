'use client';

import { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BriefcaseBusiness,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Route,
} from 'lucide-react';

type RegionLayer = {
  key: string;
  label: string;
  color: string;
  dataKey: string;
  icon: typeof BriefcaseBusiness;
};

type WatchedRegion = {
  id: string;
  name: string;
  scope: 'city' | 'county' | 'state' | 'country' | 'continent';
  state?: string;
  country: string;
  lat: number;
  lng: number;
  zoom: number;
  summary: string;
  layers: RegionLayer[];
};

const REGIONS: WatchedRegion[] = [
  {
    id: 'sikeston-mo',
    name: 'Sikeston',
    scope: 'city',
    state: 'MO',
    country: 'United States',
    lat: 36.8767,
    lng: -89.5879,
    zoom: 11,
    summary: 'Local chamber business and event intelligence for Sikeston, Missouri.',
    layers: [
      { key: 'sikeston_businesses', label: 'Businesses', color: '#00D1B2', dataKey: 'sikeston_businesses', icon: BriefcaseBusiness },
      { key: 'sikeston_events', label: 'Events', color: '#FFB020', dataKey: 'sikeston_events', icon: CalendarDays },
    ],
  },
  {
    id: 'hopewell-va',
    name: 'Hopewell',
    scope: 'city',
    state: 'VA',
    country: 'United States',
    lat: 37.3043,
    lng: -77.2872,
    zoom: 11,
    summary: 'Local chamber business and event intelligence for Hopewell and the surrounding Virginia ecosystem.',
    layers: [
      { key: 'hopewell_businesses', label: 'Businesses', color: '#7CFF6B', dataKey: 'hopewell_businesses', icon: BriefcaseBusiness },
      { key: 'hopewell_events', label: 'Events', color: '#4FB3FF', dataKey: 'hopewell_events', icon: CalendarDays },
    ],
  },
];

function fmt(value: number) {
  return Number(value || 0).toLocaleString();
}

function RegionExplorerInner({
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
  const [selectedId, setSelectedId] = useState(REGIONS[0].id);
  const [expanded, setExpanded] = useState({ layers: true, summary: true });
  const selected = REGIONS.find((region) => region.id === selectedId) || REGIONS[0];

  const regionStats = useMemo(() => {
    const stats = new Map<string, number>();
    REGIONS.forEach((region) => {
      stats.set(region.id, region.layers.reduce((sum, layer) => sum + (Array.isArray(data?.[layer.dataKey]) ? data[layer.dataKey].length : 0), 0));
    });
    return stats;
  }, [data]);

  const selectedTotal = selected.layers.reduce((sum, layer) => sum + (Array.isArray(data?.[layer.dataKey]) ? data[layer.dataKey].length : 0), 0);
  const enabledCount = selected.layers.filter((layer) => activeLayers[layer.key]).length;

  const setRegionLayers = (region: WatchedRegion, enabled: boolean) => {
    setActiveLayers((prev: any) => {
      const next = { ...prev };
      region.layers.forEach((layer) => { next[layer.key] = enabled; });
      return next;
    });
  };

  const toggleLayer = (key: string) => {
    setActiveLayers((prev: any) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="glass-panel w-full px-3 py-3 flex items-center justify-between hover:border-[var(--gold-primary)]/40 transition-colors group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
          <span className="hud-text text-[11px] text-[var(--text-primary)]">REGION WATCH</span>
          <span className="gotham-tag gotham-tag--info" style={{ fontSize: '7px', padding: '1px 5px' }}>{REGIONS.length} REGIONS</span>
        </div>
        <Maximize2 className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--gold-primary)]" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-4 z-[999] glass-panel bg-[#07090d]/95 backdrop-blur-2xl border border-[var(--gold-primary)]/30 rounded-xl flex flex-col overflow-hidden shadow-2xl shadow-[var(--gold-primary)]/10"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-secondary)] bg-[#111]">
              <div className="flex items-center gap-3 min-w-0">
                <Route className="w-5 h-5 text-[var(--gold-primary)]" />
                <span className="hud-text text-[16px] text-[var(--text-primary)]">REGION WATCH EXPLORER</span>
                <span className="gotham-tag gotham-tag--info" style={{ fontSize: '9px' }}>FULL SCREEN</span>
                <span className="gotham-tag gotham-tag--classified" style={{ fontSize: '8px' }}>{REGIONS.length} WATCHED</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 hover:bg-white/5 rounded transition-colors text-[var(--text-muted)] hover:text-white" title="Close">
                <Minimize2 className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 p-5">
              <aside className="col-span-12 lg:col-span-3 min-h-0 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="glass-panel-sm p-2">
                    <div className="hud-label">REGIONS</div>
                    <div className="hud-value text-[15px]">{REGIONS.length}</div>
                  </div>
                  <div className="glass-panel-sm p-2">
                    <div className="hud-label">ACTIVE</div>
                    <div className="hud-value text-[15px]">{enabledCount}/{selected.layers.length}</div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar space-y-1 pr-1">
                  {REGIONS.map((region) => {
                    const active = region.layers.some((layer) => activeLayers[layer.key]);
                    return (
                      <button
                        key={region.id}
                        onClick={() => setSelectedId(region.id)}
                        className={`w-full text-left px-3 py-3 rounded-lg border transition-colors ${selected.id === region.id ? 'bg-[var(--gold-primary)]/10 border-[var(--gold-primary)]/40' : 'bg-white/[0.02] border-transparent hover:border-[var(--border-primary)]'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-mono text-[var(--text-primary)] truncate">{region.name}, {region.state}</span>
                          <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${active ? 'text-[var(--alert-green)] border-[var(--alert-green)]/30 bg-[var(--alert-green)]/10' : 'text-[var(--text-muted)] border-[var(--border-secondary)]'}`}>
                            {active ? 'ON' : 'OFF'}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[8px] font-mono text-[var(--text-muted)]">
                          <span>{region.scope.toUpperCase()}</span>
                          <span>{fmt(regionStats.get(region.id) || 0)} records</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <main className="col-span-12 lg:col-span-6 min-h-0 flex flex-col gap-3">
                <section className="glass-panel-sm p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-[20px] font-mono tracking-wide text-[var(--text-primary)] truncate">{selected.name}, {selected.state}</h2>
                        <span className="gotham-tag gotham-tag--info" style={{ fontSize: '8px' }}>{selected.scope}</span>
                      </div>
                      <div className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">{selected.country} · {fmt(selectedTotal)} loaded records</div>
                    </div>
                    <button
                      onClick={() => onLocate?.(selected.lat, selected.lng, selected.zoom)}
                      className="shrink-0 px-3 py-2 rounded-lg border border-[var(--gold-primary)]/30 text-[var(--gold-primary)] text-[10px] font-mono hover:bg-[var(--gold-primary)]/10 transition-colors flex items-center gap-1.5"
                    >
                      <MapPin className="w-3 h-3" />
                      GO TO MAP
                    </button>
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-secondary)] font-mono">{selected.summary}</p>
                </section>

                <section className="glass-panel-sm flex-1 min-h-0 flex flex-col">
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, layers: !prev.layers }))}
                    className="px-4 py-3 border-b border-[var(--border-secondary)] flex items-center justify-between text-left"
                  >
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[var(--gold-primary)]" />
                      <span className="hud-text text-[11px]">REGION LAYERS</span>
                    </div>
                    {expanded.layers ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
                  </button>
                  {expanded.layers && (
                    <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setRegionLayers(selected, true)} className="px-3 py-2 rounded-lg border border-[var(--alert-green)]/30 text-[var(--alert-green)] text-[10px] font-mono hover:bg-[var(--alert-green)]/10 transition-colors">ENABLE REGION</button>
                        <button onClick={() => setRegionLayers(selected, false)} className="px-3 py-2 rounded-lg border border-[var(--alert-red)]/30 text-[var(--alert-red)] text-[10px] font-mono hover:bg-[var(--alert-red)]/10 transition-colors">DISABLE REGION</button>
                      </div>

                      {selected.layers.map((layer) => {
                        const Icon = layer.icon;
                        const count = Array.isArray(data?.[layer.dataKey]) ? data[layer.dataKey].length : 0;
                        const enabled = Boolean(activeLayers[layer.key]);
                        return (
                          <div key={layer.key} className={`rounded-lg border p-3 bg-black/20 ${enabled ? 'border-[var(--gold-primary)]/35' : 'border-[var(--border-secondary)]'}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <Icon className="w-4 h-4 shrink-0" style={{ color: layer.color }} />
                                <div className="min-w-0">
                                  <div className="text-[12px] font-mono text-[var(--text-primary)]">{selected.name} {layer.label}</div>
                                  <div className="text-[9px] font-mono text-[var(--text-muted)]">{fmt(count)} loaded records</div>
                                </div>
                              </div>
                              <button
                                onClick={() => toggleLayer(layer.key)}
                                className={`px-3 py-1.5 rounded border text-[9px] font-mono transition-colors ${enabled ? 'border-[var(--alert-green)]/30 text-[var(--alert-green)] bg-[var(--alert-green)]/10' : 'border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                              >
                                {enabled ? 'ON' : 'OFF'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </main>

              <aside className="col-span-12 lg:col-span-3 min-h-0 flex flex-col gap-3 overflow-y-auto styled-scrollbar pr-1">
                <section className="glass-panel-sm p-4">
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, summary: !prev.summary }))}
                    className="flex items-center justify-between w-full text-left"
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-[var(--gold-primary)]" />
                      <span className="hud-text text-[11px]">WATCH SUMMARY</span>
                    </div>
                    {expanded.summary ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
                  </button>
                  {expanded.summary && (
                    <div className="mt-4 space-y-2">
                      {selected.layers.map((layer) => {
                        const count = Array.isArray(data?.[layer.dataKey]) ? data[layer.dataKey].length : 0;
                        return (
                          <div key={layer.key}>
                            <div className="flex items-center justify-between text-[9px] font-mono text-[var(--text-secondary)]">
                              <span>{layer.label}</span>
                              <span>{fmt(count)}</span>
                            </div>
                            <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                              <div className="h-full" style={{ background: layer.color, width: `${Math.max(3, count / Math.max(1, selectedTotal) * 100)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const RegionExplorer = memo(RegionExplorerInner);
export default RegionExplorer;
