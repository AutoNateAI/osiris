'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  Landmark,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Plane,
  Route,
  Search,
  Shield,
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
  radiusMiles: number;
  summary: string;
  layers: RegionLayer[];
};

type DataSection = {
  key: string;
  title: string;
  color: string;
  icon: typeof Database;
  records: any[];
  empty: string;
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
    radiusMiles: 55,
    summary: 'Local chamber business and event intelligence for Sikeston, Missouri.',
    layers: [
      { key: 'sikeston_businesses', label: 'Chamber Businesses', color: '#00D1B2', dataKey: 'sikeston_businesses', icon: BriefcaseBusiness },
      { key: 'sikeston_events', label: 'Chamber Events', color: '#FFB020', dataKey: 'sikeston_events', icon: CalendarDays },
      { key: 'sbir_recipients', label: 'SBIR/STTR', color: '#F2C94C', dataKey: 'sbir_recipients', icon: BriefcaseBusiness },
      { key: 'hud_pha_flows', label: 'HUD PHA', color: '#00AEEF', dataKey: 'hud_phas', icon: Landmark },
      { key: 'federal_power', label: 'Departments / Federal', color: '#D4AF37', dataKey: 'federal_power', icon: Building2 },
      { key: 'flights', label: 'Commercial Flights', color: '#00E5FF', dataKey: 'commercial_flights', icon: Plane },
      { key: 'private', label: 'Private Flights', color: '#00E676', dataKey: 'private_flights', icon: Plane },
      { key: 'jets', label: 'Private Jets', color: '#FF4081', dataKey: 'private_jets', icon: Plane },
      { key: 'military', label: 'Military Flights', color: '#FF3D3D', dataKey: 'military_flights', icon: Shield },
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
    radiusMiles: 55,
    summary: 'Local chamber business and event intelligence for Hopewell and the surrounding Virginia ecosystem.',
    layers: [
      { key: 'hopewell_businesses', label: 'Chamber Businesses', color: '#7CFF6B', dataKey: 'hopewell_businesses', icon: BriefcaseBusiness },
      { key: 'hopewell_events', label: 'Chamber Events', color: '#4FB3FF', dataKey: 'hopewell_events', icon: CalendarDays },
      { key: 'sbir_recipients', label: 'SBIR/STTR', color: '#F2C94C', dataKey: 'sbir_recipients', icon: BriefcaseBusiness },
      { key: 'hud_pha_flows', label: 'HUD PHA', color: '#00AEEF', dataKey: 'hud_phas', icon: Landmark },
      { key: 'federal_power', label: 'Departments / Federal', color: '#D4AF37', dataKey: 'federal_power', icon: Building2 },
      { key: 'flights', label: 'Commercial Flights', color: '#00E5FF', dataKey: 'commercial_flights', icon: Plane },
      { key: 'private', label: 'Private Flights', color: '#00E676', dataKey: 'private_flights', icon: Plane },
      { key: 'jets', label: 'Private Jets', color: '#FF4081', dataKey: 'private_jets', icon: Plane },
      { key: 'military', label: 'Military Flights', color: '#FF3D3D', dataKey: 'military_flights', icon: Shield },
    ],
  },
];

function fmt(value: number) {
  return Number(value || 0).toLocaleString();
}

function asArray(value: any) {
  return Array.isArray(value) ? value : [];
}

function clean(value: any) {
  if (value == null) return '';
  return String(value).trim();
}

function coordinates(item: any) {
  const lat = Number(item?.lat ?? item?.latitude);
  const lng = Number(item?.lng ?? item?.lon ?? item?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const h = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * earthMiles * Math.asin(Math.sqrt(h));
}

function inRegion(region: WatchedRegion, item: any) {
  const point = coordinates(item);
  if (!point) return matchesState(region, item);
  return distanceMiles(region.lat, region.lng, point.lat, point.lng) <= region.radiusMiles;
}

function matchesState(region: WatchedRegion, item: any) {
  const state = clean(region.state).toUpperCase();
  if (!state) return false;
  const values = [
    item?.state,
    item?.state_code,
    item?.recipient_state,
    item?.office_state,
    item?.district_state,
    item?.represented_state,
    item?.mailing_state,
    item?.physical_state,
  ].map((value) => clean(value).toUpperCase());
  return values.includes(state);
}

function textIncludesRegion(region: WatchedRegion, item: any) {
  const haystack = [
    item?.city,
    item?.address,
    item?.location,
    item?.venue,
    item?.full_address,
    item?.physical_address,
    item?.mailing_address,
  ].map(clean).join(' ').toLowerCase();
  return haystack.includes(region.name.toLowerCase()) || (!!region.state && haystack.includes(region.state.toLowerCase()));
}

function sectionRecords(region: WatchedRegion, data: any): DataSection[] {
  const chamberBusinessKey = region.id === 'sikeston-mo' ? 'sikeston_businesses' : 'hopewell_businesses';
  const chamberEventKey = region.id === 'sikeston-mo' ? 'sikeston_events' : 'hopewell_events';
  const chamberBusinesses = asArray(data?.[chamberBusinessKey]);
  const chamberEvents = asArray(data?.[chamberEventKey]);
  const sbir = asArray(data?.sbir_recipients).filter((item) => inRegion(region, item) || textIncludesRegion(region, item));
  const hud = asArray(data?.hud_phas).filter((item) => inRegion(region, item) || textIncludesRegion(region, item));
  const departments = asArray(data?.federal_power).filter((item) => matchesState(region, item) || inRegion(region, item));
  const flights = [
    ...asArray(data?.commercial_flights).map((item) => ({ ...item, flight_group: 'Commercial' })),
    ...asArray(data?.private_flights).map((item) => ({ ...item, flight_group: 'Private' })),
    ...asArray(data?.private_jets).map((item) => ({ ...item, flight_group: 'Private Jet' })),
    ...asArray(data?.military_flights).map((item) => ({ ...item, flight_group: 'Military' })),
  ].filter((item) => inRegion(region, item));

  return [
    { key: 'businesses', title: 'Chamber Businesses', color: '#00D1B2', icon: BriefcaseBusiness, records: chamberBusinesses, empty: 'Enable the chamber business layer to load local businesses.' },
    { key: 'events', title: 'Chamber Events', color: '#FFB020', icon: CalendarDays, records: chamberEvents, empty: 'Enable the chamber event layer to load upcoming local events.' },
    { key: 'sbir', title: 'SBIR/STTR Recipients', color: '#F2C94C', icon: BriefcaseBusiness, records: sbir, empty: 'Enable SBIR/STTR to load nearby award recipients.' },
    { key: 'hud', title: 'HUD PHA / Housing', color: '#00AEEF', icon: Landmark, records: hud, empty: 'Enable HUD PHA flows to load public housing data near this region.' },
    { key: 'departments', title: 'Departments / Federal Power', color: '#D4AF37', icon: Building2, records: departments, empty: 'Enable departments/federal power to load regional officials and agencies.' },
    { key: 'flights', title: 'Aircraft Over Region', color: '#00E5FF', icon: Plane, records: flights, empty: 'Enable flight layers to load aircraft currently over the region.' },
  ];
}

function itemTitle(item: any, sectionKey: string) {
  if (sectionKey === 'flights') return clean(item.callsign) || clean(item.registration) || 'Unknown aircraft';
  return clean(item.name) || clean(item.title) || clean(item.company) || clean(item.recipient_name) || clean(item.organization) || clean(item.agency_name) || clean(item.full_name) || 'Untitled record';
}

function itemSubtitle(item: any, sectionKey: string) {
  if (sectionKey === 'flights') {
    return [clean(item.flight_group), clean(item.model), clean(item.registration)].filter(Boolean).join(' · ') || 'Aircraft';
  }
  return clean(item.address) || clean(item.full_address) || clean(item.location) || clean(item.city) || clean(item.description) || clean(item.role) || clean(item.office) || '';
}

function itemMeta(item: any, sectionKey: string) {
  if (sectionKey === 'flights') {
    return [
      item.alt ? `${Math.round(Number(item.alt)).toLocaleString()}m` : '',
      item.speed_knots ? `${item.speed_knots} kt` : '',
      item.departure_name || item.departure ? `DEP ${item.departure_name || item.departure}` : 'DEP unknown',
      item.destination_name || item.destination ? `DEST ${item.destination_name || item.destination}` : 'DEST unknown',
      item.route_source ? `SRC ${item.route_source}` : '',
    ].filter(Boolean);
  }
  if (sectionKey === 'events') return [item.date, item.time, item.venue].map(clean).filter(Boolean);
  if (sectionKey === 'sbir') return [item.agency, item.award_year, item.award_amount ? `$${fmt(item.award_amount)}` : ''].map(clean).filter(Boolean);
  if (sectionKey === 'hud') return [item.city, item.state, item.annual_hud_funding ? `$${fmt(item.annual_hud_funding)}` : ''].map(clean).filter(Boolean);
  if (sectionKey === 'departments') return [item.branch, item.chamber, item.party, item.state].map(clean).filter(Boolean);
  const categories = Array.isArray(item.categories) ? item.categories : [];
  return [item.phone, item.website, ...categories.slice(0, 2)].map(clean).filter(Boolean);
}

function itemUrl(item: any, sectionKey: string) {
  if (sectionKey === 'flights') {
    const callsign = clean(item.callsign);
    return callsign ? `https://www.flightaware.com/live/flight/${callsign}` : '';
  }
  return clean(item.url) || clean(item.website) || clean(item.source_url) || clean(item.event_url) || clean(item.member_url);
}

function RegionDataCard({
  item,
  sectionKey,
  color,
  onLocate,
}: {
  item: any;
  sectionKey: string;
  color: string;
  onLocate?: (lat: number, lng: number, zoom?: number) => void;
}) {
  const point = coordinates(item);
  const url = itemUrl(item, sectionKey);
  const meta = itemMeta(item, sectionKey).slice(0, 5);

  return (
    <div className="rounded-lg border border-[var(--border-secondary)] bg-black/20 p-3 hover:border-[var(--gold-primary)]/35 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] font-mono text-[var(--text-primary)] truncate">{itemTitle(item, sectionKey)}</div>
          {itemSubtitle(item, sectionKey) && (
            <div className="mt-1 text-[9px] font-mono text-[var(--text-muted)] line-clamp-2">{itemSubtitle(item, sectionKey)}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {point && (
            <button
              onClick={() => onLocate?.(point.lat, point.lng, sectionKey === 'flights' ? 9 : 13)}
              className="p-1.5 rounded border border-[var(--gold-primary)]/30 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/10"
              title="Focus on map"
            >
              <MapPin className="w-3 h-3" />
            </button>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-white hover:border-white/30"
              title="Open source"
            >
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      {meta.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {meta.map((value, index) => (
            <span key={`${value}-${index}`} className="px-2 py-1 rounded border text-[8px] font-mono" style={{ color, borderColor: `${color}33`, background: `${color}12` }}>
              {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
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
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    layers: true,
    summary: true,
    businesses: true,
    events: true,
    sbir: false,
    hud: false,
    departments: false,
    flights: false,
  });
  const selected = REGIONS.find((region) => region.id === selectedId) || REGIONS[0];
  const sections = useMemo(() => sectionRecords(selected, data), [selected, data]);

  const visibleSections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sections;
    return sections.map((section) => ({
      ...section,
      records: section.records.filter((item) => `${itemTitle(item, section.key)} ${itemSubtitle(item, section.key)} ${itemMeta(item, section.key).join(' ')}`.toLowerCase().includes(needle)),
    }));
  }, [sections, query]);

  const regionStats = useMemo(() => {
    const stats = new Map<string, number>();
    REGIONS.forEach((region) => {
      stats.set(region.id, sectionRecords(region, data).reduce((sum, section) => sum + section.records.length, 0));
    });
    return stats;
  }, [data]);

  const selectedTotal = sections.reduce((sum, section) => sum + section.records.length, 0);
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

                <div className="grid grid-cols-2 gap-2">
                  {['city', 'county', 'state', 'country'].map((scope) => (
                    <button
                      key={scope}
                      className={`px-2 py-2 rounded border text-[9px] font-mono ${scope === 'city' ? 'border-[var(--gold-primary)]/40 text-[var(--gold-primary)] bg-[var(--gold-primary)]/10' : 'border-[var(--border-secondary)] text-[var(--text-muted)]'}`}
                    >
                      {scope.toUpperCase()}
                    </button>
                  ))}
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
                          <span>{region.scope.toUpperCase()} · {region.radiusMiles} MI</span>
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
                      <div className="mt-1 text-[10px] font-mono text-[var(--text-muted)]">{selected.country} · {fmt(selectedTotal)} regional records</div>
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
                  <div className="mt-3 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter regional records"
                      className="w-full bg-black/25 border border-[var(--border-secondary)] rounded-lg pl-9 pr-3 py-2 text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--gold-primary)]/40"
                    />
                  </div>
                </section>

                <section className="glass-panel-sm flex-1 min-h-0 flex flex-col">
                  <div className="px-4 py-3 border-b border-[var(--border-secondary)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-[var(--gold-primary)]" />
                      <span className="hud-text text-[11px]">REGION DATA</span>
                    </div>
                    <span className="text-[9px] font-mono text-[var(--text-muted)]">{fmt(selectedTotal)} scoped</span>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-4 space-y-3">
                    {visibleSections.map((section) => {
                      const Icon = section.icon;
                      const isExpanded = expanded[section.key] ?? false;
                      return (
                        <div key={section.key} className="rounded-lg border border-[var(--border-secondary)] bg-black/10 overflow-hidden">
                          <button
                            onClick={() => setExpanded((prev) => ({ ...prev, [section.key]: !isExpanded }))}
                            className="w-full px-3 py-3 flex items-center justify-between text-left"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Icon className="w-4 h-4 shrink-0" style={{ color: section.color }} />
                              <span className="text-[11px] font-mono tracking-[0.18em] text-[var(--text-primary)] truncate">{section.title}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="gotham-tag" style={{ fontSize: '8px', color: section.color }}>{fmt(section.records.length)}</span>
                              {isExpanded ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
                            </div>
                          </button>
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2 max-h-[360px] overflow-y-auto styled-scrollbar">
                              {section.records.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-[var(--border-secondary)] p-4 text-[10px] font-mono text-[var(--text-muted)]">{section.empty}</div>
                              ) : (
                                section.records.slice(0, 250).map((item, index) => (
                                  <RegionDataCard
                                    key={`${section.key}-${item.id || item.url || item.name || item.title || item.callsign || index}`}
                                    item={item}
                                    sectionKey={section.key}
                                    color={section.color}
                                    onLocate={onLocate}
                                  />
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </main>

              <aside className="col-span-12 lg:col-span-3 min-h-0 flex flex-col gap-3 overflow-y-auto styled-scrollbar pr-1">
                <section className={`glass-panel-sm shrink-0 flex flex-col ${expanded.layers ? 'max-h-[650px]' : ''}`}>
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
                    <div className="min-h-0 overflow-y-auto styled-scrollbar p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => setRegionLayers(selected, true)} className="px-3 py-2 rounded-lg border border-[var(--alert-green)]/30 text-[var(--alert-green)] text-[10px] font-mono hover:bg-[var(--alert-green)]/10 transition-colors">ENABLE REGION</button>
                        <button onClick={() => setRegionLayers(selected, false)} className="px-3 py-2 rounded-lg border border-[var(--alert-red)]/30 text-[var(--alert-red)] text-[10px] font-mono hover:bg-[var(--alert-red)]/10 transition-colors">DISABLE REGION</button>
                      </div>

                      {selected.layers.map((layer) => {
                        const Icon = layer.icon;
                        const rawCount = asArray(data?.[layer.dataKey]).length;
                        const enabled = Boolean(activeLayers[layer.key]);
                        return (
                          <div key={layer.key} className={`rounded-lg border p-3 bg-black/20 ${enabled ? 'border-[var(--gold-primary)]/35' : 'border-[var(--border-secondary)]'}`}>
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <Icon className="w-4 h-4 shrink-0" style={{ color: layer.color }} />
                                <div className="min-w-0">
                                  <div className="text-[12px] font-mono text-[var(--text-primary)]">{layer.label}</div>
                                  <div className="text-[9px] font-mono text-[var(--text-muted)]">{fmt(rawCount)} loaded globally</div>
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
                      {sections.map((section) => (
                        <div key={section.key}>
                          <div className="flex items-center justify-between text-[9px] font-mono text-[var(--text-secondary)]">
                            <span>{section.title}</span>
                            <span>{fmt(section.records.length)}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full" style={{ background: section.color, width: `${Math.max(3, section.records.length / Math.max(1, selectedTotal) * 100)}%` }} />
                          </div>
                        </div>
                      ))}
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
