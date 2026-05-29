'use client';

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plane, Satellite, Activity, Globe, Radio, Eye,
  Shield, Sun, AlertTriangle, Camera, Flame, Target,
  CloudLightning, Radiation, Tv, Anchor, Ship, Newspaper,
  ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Landmark, Users,
  BriefcaseBusiness,
} from 'lucide-react';

interface LayerPanelProps {
  data: any;
  activeLayers: any;
  setActiveLayers: React.Dispatch<React.SetStateAction<any>>;
  sbirYearRange?: { start: number; end: number };
  setSbirYearRange?: React.Dispatch<React.SetStateAction<{ start: number; end: number }>>;
}

const LAYER_GROUPS = [
  {
    label: 'USA INFRA',
    icon: Landmark,
    color: '#F2C94C',
    layers: [
      { key: 'hud_pha_flows', label: 'HUD PHA Flows', icon: Landmark, color: '#00AEEF', dataKey: 'hud_phas,hud_pha_awards,hud_state_totals' },
      { key: 'sbir_recipients', label: 'SBIR/STTR Recipients', icon: BriefcaseBusiness, color: '#F2C94C', dataKey: 'sbir_recipients' },
      { key: 'federal_power_house', label: 'U.S. Representatives', icon: Users, color: '#FFFFFF', dataKey: 'federal_power', countFilter: (p: any) => p.branch === 'congress' && p.chamber === 'House' },
      { key: 'federal_power_senate', label: 'U.S. Senators', icon: Users, color: '#D4AF37', dataKey: 'federal_power', countFilter: (p: any) => p.branch === 'congress' && p.chamber === 'Senate' },
      { key: 'federal_power_judicial', label: 'Federal Judges', icon: Landmark, color: '#B388FF', dataKey: 'federal_power', countFilter: (p: any) => p.branch === 'judicial' },
      { key: 'federal_power_white_house', label: 'White House Staff', icon: Users, color: '#FFD700', dataKey: 'federal_power', countFilter: (p: any) => p.branch === 'white_house' },
      { key: 'power_edges', label: 'Power Loop Edges', icon: Radio, color: '#B388FF', dataKey: '' },
      { key: 'power_edges_democrat', label: 'Democratic Loop', icon: Radio, color: '#2F80ED', dataKey: '' },
      { key: 'power_edges_republican', label: 'Republican Loop', icon: Radio, color: '#EB5757', dataKey: '' },
    ],
  },
  {
    label: 'AVIATION',
    icon: Plane,
    color: '#00E5FF',
    layers: [
      { key: 'flights', label: 'Commercial', icon: Plane, color: '#00E5FF', dataKey: 'commercial_flights' },
      { key: 'private', label: 'Private', icon: Plane, color: '#00E676', dataKey: 'private_flights' },
      { key: 'jets', label: 'Private Jets', icon: Plane, color: '#FF69B4', dataKey: 'private_jets' },
      { key: 'military', label: 'Military', icon: Shield, color: '#FF3D3D', dataKey: 'military_flights' },
    ],
  },
  {
    label: 'MARITIME & SPACE',
    icon: Ship,
    color: '#00BCD4',
    layers: [
      { key: 'maritime', label: 'Maritime / Naval', icon: Ship, color: '#00BCD4', dataKey: 'maritime_ships,maritime_ports,maritime_chokepoints' },
      { key: 'satellites', label: 'Satellites', icon: Satellite, color: '#D4AF37', dataKey: 'satellites' },
    ],
  },
  {
    label: 'SURVEILLANCE',
    icon: Camera,
    color: '#39FF14',
    layers: [
      { key: 'cctv', label: 'CCTV Cameras', icon: Camera, color: '#39FF14', dataKey: 'cameras' },
      { key: 'live_news', label: 'Live News Feeds', icon: Tv, color: '#FF4081', dataKey: 'live_feeds' },
    ],
  },
  {
    label: 'NATURAL HAZARDS',
    icon: Activity,
    color: '#FF9500',
    layers: [
      { key: 'earthquakes', label: 'Earthquakes (24h)', icon: Activity, color: '#FF9500', dataKey: 'earthquakes' },
      { key: 'fires', label: 'Active Fires', icon: Flame, color: '#FF6B00', dataKey: 'fires' },
      { key: 'weather', label: 'Severe Weather', icon: CloudLightning, color: '#E040FB', dataKey: 'weather_events' },
    ],
  },
  {
    label: 'THREATS & INFRA',
    icon: AlertTriangle,
    color: '#FF3D3D',
    layers: [
      { key: 'infrastructure', label: 'Nuclear Facilities', icon: Radiation, color: '#76FF03', dataKey: 'infrastructure' },
      { key: 'global_incidents', label: 'Global Incidents', icon: AlertTriangle, color: '#FF3D3D', dataKey: 'gdelt' },
      { key: 'gps_jamming', label: 'GPS Jamming', icon: Radio, color: '#FF4444', dataKey: 'gps_jamming' },
    ],
  },
  {
    label: 'DISPLAY',
    icon: Sun,
    color: '#448AFF',
    layers: [
      { key: 'day_night', label: 'Day / Night Cycle', icon: Sun, color: '#448AFF', dataKey: '' },
    ],
  },
];

// Flat list for backward compat
const ALL_LAYERS = LAYER_GROUPS.flatMap(g => g.layers);

function LayerPanel({ data, activeLayers, setActiveLayers, sbirYearRange, setSbirYearRange }: LayerPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    LAYER_GROUPS.forEach(g => { initial[g.label] = false; });
    return initial;
  });

  const toggle = (key: string) => setActiveLayers((prev: any) => ({ ...prev, [key]: !prev[key] }));
  const getCount = (layer: any): number | null => {
    const dk = layer.dataKey;
    if (!dk) return null;
    let total = 0;
    let found = false;
    for (const k of dk.split(',')) {
      if (data[k] && Array.isArray(data[k])) {
        total += layer.countFilter ? data[k].filter(layer.countFilter).length : data[k].length;
        found = true;
      }
    }
    return found ? total : null;
  };
  const totalEntities = ALL_LAYERS.reduce((s: number, l: any) => s + (getCount(l) || 0), 0);
  const activeCount = Object.values(activeLayers).filter(Boolean).length;

  const toggleGroup = (groupLabel: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
  };

  const toggleAllInGroup = (group: typeof LAYER_GROUPS[0]) => {
    const allActive = group.layers.every(l => activeLayers[l.key]);
    setActiveLayers((prev: any) => {
      const next = { ...prev };
      group.layers.forEach(l => { next[l.key] = !allActive; });
      return next;
    });
  };
  const yearOptions = Array.from({ length: 21 }, (_, i) => 2010 + i);

  return (
    <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, duration: 0.6 }} className="glass-panel p-3 pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Eye className="w-3.5 h-3.5 text-[var(--gold-primary)]" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[var(--alert-green)] animate-osiris-pulse" />
          </div>
          <span className="hud-text text-[12px] text-[var(--text-primary)] tracking-widest">DATA LAYERS</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`gotham-tag ${activeCount > 10 ? 'gotham-tag--critical' : activeCount > 5 ? 'gotham-tag--high' : 'gotham-tag--low'}`} style={{ fontSize: '8px', padding: '1px 6px' }}>
            {activeCount}/{ALL_LAYERS.length}
          </span>
          <span className="gotham-tag gotham-tag--info" style={{ fontSize: '7px', padding: '1px 5px' }}>{totalEntities.toLocaleString()} ENT</span>
        </div>
      </div>

      {/* Groups */}
      <div className="space-y-1">
        {LAYER_GROUPS.map((group) => {
          const isExpanded = expandedGroups[group.label];
          const groupActiveCount = group.layers.filter(l => activeLayers[l.key]).length;
          const allActive = groupActiveCount === group.layers.length;
          const GroupIcon = group.icon;

          return (
            <div key={group.label}>
              {/* Group Header */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/[0.03] transition-colors"
                >
                  <GroupIcon className="w-3 h-3 flex-shrink-0" style={{ color: group.color }} />
                  <span className="text-[9px] font-mono tracking-[0.15em] text-[var(--text-secondary)] font-bold flex-1 text-left">{group.label}</span>
                  <span className="text-[8px] font-mono tabular-nums" style={{ color: groupActiveCount > 0 ? group.color : 'var(--text-muted)' }}>
                    {groupActiveCount}/{group.layers.length}
                  </span>
                  {isExpanded ? (
                    <ChevronUp className="w-3 h-3 text-[var(--text-muted)]" />
                  ) : (
                    <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
                  )}
                </button>
                {/* Toggle all in group */}
                <button
                  onClick={() => toggleAllInGroup(group)}
                  className="p-1 rounded hover:bg-white/[0.05] transition-colors"
                  title={allActive ? 'Disable all' : 'Enable all'}
                >
                  {allActive ? (
                    <ToggleRight className="w-3.5 h-3.5" style={{ color: group.color }} />
                  ) : (
                    <ToggleLeft className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  )}
                </button>
              </div>

              {/* Layer items */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="ml-2 pl-2 border-l border-[var(--border-secondary)]/40 space-y-px">
                      {group.layers.map((layer) => {
                        const Icon = layer.icon;
                        const isActive = activeLayers[layer.key];
                        const count = getCount(layer);
                        return (
                          <div key={layer.key}>
                          <button
                            onClick={() => toggle(layer.key)}
                            className={`w-full flex items-center gap-2.5 px-2 py-[5px] rounded-md transition-all duration-200 group ${
                              isActive
                                ? 'bg-white/[0.04] border border-white/[0.06]'
                                : 'border border-transparent hover:bg-white/[0.02]'
                            }`}
                          >
                            {/* Color dot indicator */}
                            <div
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-300 ${isActive ? 'scale-100' : 'scale-50 opacity-30'}`}
                              style={{
                                backgroundColor: layer.color,
                                boxShadow: isActive ? `0 0 6px ${layer.color}60` : 'none',
                              }}
                            />
                            <Icon
                              className="w-3.5 h-3.5 flex-shrink-0 transition-colors duration-200"
                              style={{ color: isActive ? layer.color : 'var(--text-muted)' }}
                            />
                            <span className={`text-[11px] font-mono tracking-wide flex-1 text-left transition-colors duration-200 ${
                              isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'
                            }`}>
                              {layer.label}
                            </span>
                            {count !== null && (
                              <span
                                className="text-[9px] font-mono tabular-nums font-bold transition-colors duration-200"
                                style={{ color: isActive ? layer.color : 'var(--text-muted)' }}
                              >
                                {count.toLocaleString()}
                              </span>
                            )}
                            {/* Toggle switch */}
                            <div className={`layer-toggle ${isActive ? 'active' : ''}`} />
                          </button>
                          {layer.key === 'sbir_recipients' && setSbirYearRange && sbirYearRange && (
                            <div className="ml-6 mr-2 mb-2 grid grid-cols-2 gap-2">
                              <label className="text-[8px] font-mono text-[var(--text-muted)] tracking-widest">
                                START
                                <select
                                  value={sbirYearRange.start}
                                  onChange={(e) => {
                                    const start = Number(e.target.value);
                                    setSbirYearRange((prev) => ({ start, end: Math.max(start, prev.end) }));
                                  }}
                                  className="mt-1 w-full bg-black/40 border border-[var(--border-secondary)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)]"
                                >
                                  {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                                </select>
                              </label>
                              <label className="text-[8px] font-mono text-[var(--text-muted)] tracking-widest">
                                END
                                <select
                                  value={sbirYearRange.end}
                                  onChange={(e) => {
                                    const end = Number(e.target.value);
                                    setSbirYearRange((prev) => ({ start: Math.min(prev.start, end), end }));
                                  }}
                                  className="mt-1 w-full bg-black/40 border border-[var(--border-secondary)] rounded px-2 py-1 text-[10px] text-[var(--text-primary)]"
                                >
                                  {yearOptions.map((year) => <option key={year} value={year}>{year}</option>)}
                                </select>
                              </label>
                            </div>
                          )}
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export default memo(LayerPanel);
