'use client';

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  GraduationCap,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Star,
  GitFork,
  X,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/apiClient';

type UniversitySignal = {
  id: string;
  name: string;
  short_name?: string;
  city?: string;
  state?: string;
  lat?: number;
  lng?: number;
  repo_count?: number;
  arxiv_paper_count?: number;
  total_stars?: number;
  total_forks?: number;
  opportunity_score?: number;
  top_momentum_score?: number;
  last_scanned?: string;
  narrative?: string;
};

type RepoSignal = {
  id: string;
  university_id?: string;
  repo_full_name: string;
  name: string;
  html_url?: string;
  language?: string;
  topics?: string[];
  stars?: number;
  forks?: number;
  watchers?: number;
  open_issues?: number;
  momentum_score?: number;
  pushed_at?: string;
  description?: string;
};

type PaperSignal = {
  id: string;
  title: string;
  source_url?: string;
  pdf_url?: string;
  published_at?: string;
  categories?: string[];
  authors?: string[];
};

type RepoSnapshot = {
  id: string;
  repo_id: string;
  repo_full_name?: string;
  snapshot_at?: string;
  stars?: number;
  forks?: number;
  watchers?: number;
  open_issues?: number;
  momentum_score?: number;
};

function fmt(value: number | undefined) {
  return Number(value || 0).toLocaleString();
}

function shortDate(value?: string) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function metricDelta(snapshots: RepoSnapshot[], key: 'stars' | 'forks' | 'watchers' | 'momentum_score') {
  if (snapshots.length < 2) return 0;
  const oldest = snapshots[snapshots.length - 1];
  const newest = snapshots[0];
  return Number(newest[key] || 0) - Number(oldest[key] || 0);
}

function latestRepoPush(repos: RepoSignal[]) {
  return Math.max(0, ...repos.map((repo) => repo.pushed_at ? Date.parse(repo.pushed_at) || 0 : 0));
}

function SnapshotLineChart({ snapshots }: { snapshots: RepoSnapshot[] }) {
  const ordered = snapshots.slice().sort((a, b) => String(a.snapshot_at || '').localeCompare(String(b.snapshot_at || ''))).slice(-36);
  if (ordered.length < 2) {
    return <div className="h-[150px] flex items-center justify-center text-[10px] font-mono text-[var(--text-muted)] border border-dashed border-[var(--border-secondary)] rounded-lg">More snapshots needed for trend line.</div>;
  }
  const width = 300;
  const height = 126;
  const pad = 14;
  const xFor = (index: number) => pad + (index / Math.max(1, ordered.length - 1)) * (width - pad * 2);
  const yFor = (value: number, min: number, max: number) => {
    const span = Math.max(1, max - min);
    return height - pad - ((value - min) / span) * (height - pad * 2);
  };
  const stars = ordered.map((snap) => Number(snap.stars || 0));
  const momentum = ordered.map((snap) => Number(snap.momentum_score || 0));
  const starMin = Math.min(...stars);
  const starMax = Math.max(...stars);
  const momMin = Math.min(...momentum);
  const momMax = Math.max(...momentum);
  const starPoints = ordered.map((snap, index) => `${xFor(index)},${yFor(Number(snap.stars || 0), starMin, starMax)}`).join(' ');
  const momentumPoints = ordered.map((snap, index) => `${xFor(index)},${yFor(Number(snap.momentum_score || 0), momMin, momMax)}`).join(' ');

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-secondary)] bg-black/20 p-2">
      <div className="flex items-center justify-between text-[8px] font-mono text-[var(--text-muted)] mb-1">
        <span>{shortDate(ordered[0]?.snapshot_at)}</span>
        <div className="flex items-center gap-3">
          <span className="text-[#A3E635]">stars</span>
          <span className="text-[var(--cyan-primary)]">momentum</span>
        </div>
        <span>{shortDate(ordered[ordered.length - 1]?.snapshot_at)}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[150px]" role="img" aria-label="Repository trend line">
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1={pad} x2={width - pad} y1={pad + line * ((height - pad * 2) / 3)} y2={pad + line * ((height - pad * 2) / 3)} stroke="rgba(212,175,55,0.08)" strokeWidth="1" />
        ))}
        <polyline points={starPoints} fill="none" stroke="#A3E635" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <polyline points={momentumPoints} fill="none" stroke="var(--cyan-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {ordered.map((snap, index) => (
          <g key={snap.id || `${snap.snapshot_at}-${index}`}>
            <circle cx={xFor(index)} cy={yFor(Number(snap.stars || 0), starMin, starMax)} r="2.4" fill="#A3E635" />
            <circle cx={xFor(index)} cy={yFor(Number(snap.momentum_score || 0), momMin, momMax)} r="2" fill="var(--cyan-primary)" />
          </g>
        ))}
      </svg>
      <div className="flex items-center justify-between text-[8px] font-mono text-[var(--text-muted)]">
        <span>{fmt(stars[0])} to {fmt(stars[stars.length - 1])} stars</span>
        <span>{momentum[0]} to {momentum[momentum.length - 1]} momentum</span>
      </div>
    </div>
  );
}

function ResearchExplorerInner({ universities: mapUniversities = [], onLocate }: { universities?: UniversitySignal[]; onLocate?: (lat: number, lng: number, zoom?: number) => void }) {
  const [open, setOpen] = useState(false);
  const [universities, setUniversities] = useState<UniversitySignal[]>(mapUniversities);
  const [allRepos, setAllRepos] = useState<RepoSignal[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [repos, setRepos] = useState<RepoSignal[]>([]);
  const [papers, setPapers] = useState<PaperSignal[]>([]);
  const [snapshots, setSnapshots] = useState<RepoSnapshot[]>([]);
  const [activeRepoId, setActiveRepoId] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [schoolSort, setSchoolSort] = useState<'score' | 'latest' | 'repos' | 'papers'>('score');
  const [repoSort, setRepoSort] = useState<'latest' | 'momentum' | 'stars' | 'forks'>('latest');
  const [expandedSections, setExpandedSections] = useState({ repo: true, languages: true, papers: true });
  const toggleSection = (key: keyof typeof expandedSections) => setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const loadUniversities = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/university-research');
      const json = await res.json();
      const next = Array.isArray(json.universities) ? json.universities : [];
      setUniversities(next);
      setSelectedId((current) => current || next[0]?.id || '');
      authenticatedFetch('/api/university-research/repos?limit=2000')
        .then((r) => r.json())
        .then((repoJson) => setAllRepos(Array.isArray(repoJson.repos) ? repoJson.repos : []))
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mapUniversities.length) {
      setUniversities(mapUniversities);
      setSelectedId((current) => current || mapUniversities[0]?.id || '');
    }
  }, [mapUniversities]);

  useEffect(() => {
    if (!open) return;
    if (!universities.length || !allRepos.length) loadUniversities();
  }, [open, universities.length, allRepos.length, loadUniversities]);

  const selected = useMemo(
    () => universities.find((item) => item.id === selectedId) || universities[0],
    [universities, selectedId]
  );

  useEffect(() => {
    if (!open || !selected?.id) return;
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      authenticatedFetch(`/api/university-research/repos?university_id=${encodeURIComponent(selected.id)}&limit=300`).then((r) => r.json()),
      authenticatedFetch(`/api/university-research/papers?university_id=${encodeURIComponent(selected.id)}&limit=100`).then((r) => r.json()),
    ]).then(([repoJson, paperJson]) => {
      if (cancelled) return;
      const nextRepos = Array.isArray(repoJson.repos) ? repoJson.repos : [];
      setRepos(nextRepos);
      setPapers(Array.isArray(paperJson.papers) ? paperJson.papers : []);
      setActiveRepoId(nextRepos.slice().sort((a: RepoSignal, b: RepoSignal) => (b.pushed_at ? Date.parse(b.pushed_at) || 0 : 0) - (a.pushed_at ? Date.parse(a.pushed_at) || 0 : 0))[0]?.id || '');
    }).finally(() => {
      if (!cancelled) setDetailLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, selected?.id]);

  useEffect(() => {
    if (!open || !activeRepoId) {
      setSnapshots([]);
      return;
    }
    let cancelled = false;
    setSnapshotLoading(true);
    authenticatedFetch(`/api/university-research/snapshots?repo_id=${encodeURIComponent(activeRepoId)}&limit=120`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setSnapshots(Array.isArray(json.snapshots) ? json.snapshots : []);
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, activeRepoId]);

  const filteredUniversities = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const reposByUniversity = new Map<string, RepoSignal[]>();
    allRepos.forEach((repo) => {
      if (!repo.university_id) return;
      reposByUniversity.set(repo.university_id, [...(reposByUniversity.get(repo.university_id) || []), repo]);
    });
    const base = universities.slice().sort((a, b) => {
      if (schoolSort === 'latest') return latestRepoPush(reposByUniversity.get(b.id) || []) - latestRepoPush(reposByUniversity.get(a.id) || []);
      if (schoolSort === 'repos') return Number(b.repo_count || 0) - Number(a.repo_count || 0);
      if (schoolSort === 'papers') return Number(b.arxiv_paper_count || 0) - Number(a.arxiv_paper_count || 0);
      return Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0);
    });
    if (!needle) return base;
    return base.filter((item) => `${item.name} ${item.short_name || ''} ${item.city || ''} ${item.state || ''}`.toLowerCase().includes(needle));
  }, [universities, allRepos, schoolSort, query]);

  const totals = useMemo(() => ({
    repos: universities.reduce((sum, item) => sum + Number(item.repo_count || 0), 0),
    papers: universities.reduce((sum, item) => sum + Number(item.arxiv_paper_count || 0), 0),
    stars: universities.reduce((sum, item) => sum + Number(item.total_stars || 0), 0),
    forks: universities.reduce((sum, item) => sum + Number(item.total_forks || 0), 0),
  }), [universities]);

  const languageRows = useMemo(() => {
    const counts = new Map<string, number>();
    repos.forEach((repo) => {
      const key = repo.language || 'Unknown';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [repos]);

  const activeRepo = repos.find((repo) => repo.id === activeRepoId) || repos[0];
  const sortedRepos = useMemo(() => repos.slice().sort((a, b) => {
    if (repoSort === 'momentum') return Number(b.momentum_score || 0) - Number(a.momentum_score || 0);
    if (repoSort === 'stars') return Number(b.stars || 0) - Number(a.stars || 0);
    if (repoSort === 'forks') return Number(b.forks || 0) - Number(a.forks || 0);
    return (b.pushed_at ? Date.parse(b.pushed_at) || 0 : 0) - (a.pushed_at ? Date.parse(a.pushed_at) || 0 : 0);
  }), [repos, repoSort]);
  const selectedRepoCount = repos.length || selected?.repo_count || 0;

  const button = (
    <button
      onClick={() => setOpen(true)}
      className="glass-panel w-full px-3 py-3 flex items-center justify-between hover:border-[#A3E635]/40 transition-colors group"
    >
      <div className="flex items-center gap-2">
        <GraduationCap className="w-3.5 h-3.5 text-[#A3E635]" />
        <span className="hud-text text-[11px] text-[var(--text-primary)]">RESEARCH EXPLORER</span>
        <span className="gotham-tag gotham-tag--low" style={{ fontSize: '7px', padding: '1px 5px' }}>{universities.length || 100} SCHOOLS</span>
      </div>
      <Maximize2 className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[#A3E635]" />
    </button>
  );

  return (
    <>
      {button}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-4 z-[999] glass-panel bg-[#07090d]/95 backdrop-blur-2xl border border-[#A3E635]/30 rounded-xl flex flex-col overflow-hidden shadow-2xl shadow-[#A3E635]/10"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-secondary)] bg-[#111]">
              <div className="flex items-center gap-3 min-w-0">
                <GraduationCap className="w-5 h-5 text-[#A3E635]" />
                <span className="hud-text text-[16px] text-[var(--text-primary)]">UNIVERSITY RESEARCH EXPLORER</span>
                <span className="gotham-tag gotham-tag--low" style={{ fontSize: '9px' }}>FULL SCREEN</span>
                <span className="gotham-tag gotham-tag--info" style={{ fontSize: '8px' }}>{fmt(totals.repos)} REPOS</span>
                <span className="gotham-tag gotham-tag--info" style={{ fontSize: '8px' }}>{fmt(totals.papers)} PAPERS</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={loadUniversities} className="p-2 hover:bg-white/5 rounded transition-colors text-[var(--text-muted)] hover:text-[#A3E635]" title="Refresh">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                </button>
                <button onClick={() => setOpen(false)} className="p-2 hover:bg-white/5 rounded transition-colors text-[var(--text-muted)] hover:text-white" title="Close">
                  <Minimize2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-4 flex-1 min-h-0 p-5">
              <aside className="col-span-12 lg:col-span-3 min-h-0 flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['SCHOOLS', universities.length],
                    ['STARS', totals.stars],
                    ['FORKS', totals.forks],
                    ['PAPERS', totals.papers],
                  ].map(([label, value]) => (
                    <div key={label} className="glass-panel-sm p-2">
                      <div className="hud-label">{label}</div>
                      <div className="hud-value text-[15px] text-[#A3E635]">{fmt(Number(value))}</div>
                    </div>
                  ))}
                </div>
                <div className="glass-panel-sm px-3 py-2 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Filter universities"
                    className="bg-transparent outline-none flex-1 text-[11px] font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    ['score', 'Score'],
                    ['latest', 'Recent'],
                    ['repos', 'Repos'],
                    ['papers', 'Papers'],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setSchoolSort(id as typeof schoolSort)}
                      className={`px-2 py-1.5 rounded border text-[8px] font-mono tracking-widest transition-colors ${schoolSort === id ? 'border-[#A3E635]/40 bg-[#A3E635]/10 text-[#A3E635]' : 'border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar space-y-1 pr-1">
                  {filteredUniversities.map((item, index) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${selected?.id === item.id ? 'bg-[#A3E635]/10 border-[#A3E635]/40' : 'bg-white/[0.02] border-transparent hover:border-[var(--border-primary)]'}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-mono text-[var(--text-primary)] truncate">{item.short_name || item.name}</span>
                        <span className="text-[10px] font-mono font-bold text-[#A3E635] tabular-nums">{item.opportunity_score || 0}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[8px] font-mono text-[var(--text-muted)]">
                        <span>#{index + 1} {item.state || ''}</span>
                        <span>{item.repo_count || 0} repos · {item.arxiv_paper_count || 0} papers</span>
                      </div>
                    </button>
                  ))}
                </div>
              </aside>

              <main className="col-span-12 lg:col-span-6 min-h-0 flex flex-col gap-3">
                <section className="glass-panel-sm p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-[18px] font-mono tracking-wide text-[var(--text-primary)] truncate">{selected?.name || 'Select a university'}</h2>
                        <span className="gotham-tag gotham-tag--low" style={{ fontSize: '8px' }}>SCORE {selected?.opportunity_score || 0}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] font-mono text-[var(--text-muted)]">
                        <MapPin className="w-3 h-3" />
                        <span>{[selected?.city, selected?.state].filter(Boolean).join(', ') || 'Location pending'}</span>
                        <span>·</span>
                        <span>Updated {shortDate(selected?.last_scanned)}</span>
                      </div>
                    </div>
                    {selected?.lat && selected?.lng && (
                      <button
                        onClick={() => onLocate?.(Number(selected.lat), Number(selected.lng), 8)}
                        className="shrink-0 px-3 py-2 rounded-lg border border-[#A3E635]/30 text-[#A3E635] text-[10px] font-mono hover:bg-[#A3E635]/10 transition-colors flex items-center gap-1.5"
                      >
                        <MapPin className="w-3 h-3" />
                        MAP
                      </button>
                    )}
                  </div>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-secondary)] font-mono">{selected?.narrative || 'Research signal is ready for monitoring.'}</p>
                  <div className="grid grid-cols-4 gap-2 mt-4">
                    {[
                      ['REPOS', selectedRepoCount, Database],
                      ['PAPERS', selected?.arxiv_paper_count, BookOpen],
                      ['STARS', selected?.total_stars, Star],
                      ['FORKS', selected?.total_forks, GitFork],
                    ].map(([label, value, Icon]: any) => (
                      <div key={label} className="bg-black/20 border border-[var(--border-secondary)] rounded-lg p-2">
                        <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                          <Icon className="w-3 h-3" />
                          <span className="hud-label">{label}</span>
                        </div>
                        <div className="hud-value text-[14px] text-[#A3E635] mt-1">{fmt(Number(value || 0))}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="glass-panel-sm flex-1 min-h-0 flex flex-col">
                  <div className="px-4 py-3 border-b border-[var(--border-secondary)] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="w-4 h-4 text-[#A3E635]" />
                      <span className="hud-text text-[11px]">REPOSITORIES</span>
                      {detailLoading && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-muted)]" />}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[
                        ['latest', 'recent'],
                        ['momentum', 'momentum'],
                        ['stars', 'stars'],
                        ['forks', 'forks'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setRepoSort(id as typeof repoSort)}
                          className={`px-2 py-1 rounded border text-[8px] font-mono transition-colors ${repoSort === id ? 'border-[#A3E635]/40 bg-[#A3E635]/10 text-[#A3E635]' : 'border-[var(--border-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
                        >
                          {label}
                        </button>
                      ))}
                      <span className="ml-1 text-[9px] font-mono text-[var(--text-muted)]">{repos.length} loaded</span>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-3">
                    {!detailLoading && repos.length === 0 && (
                      <div className="h-full min-h-[220px] flex items-center justify-center text-[11px] font-mono text-[var(--text-muted)] border border-dashed border-[var(--border-secondary)] rounded-lg">
                        No repository records returned for this university yet.
                      </div>
                    )}
                    {sortedRepos.map((repo) => (
                      <button
                        key={repo.id}
                        onClick={() => setActiveRepoId(repo.id)}
                        className={`w-full text-left p-3 mb-2 rounded-lg border transition-colors ${activeRepo?.id === repo.id ? 'bg-[#A3E635]/10 border-[#A3E635]/40' : 'bg-black/20 border-[var(--border-secondary)] hover:border-[#A3E635]/25 hover:bg-white/[0.03]'}`}
                      >
                        <div className="flex items-start justify-between gap-3 min-w-0">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="text-[12px] font-mono text-[var(--text-primary)] truncate">{repo.repo_full_name}</div>
                              {repo.html_url && <ExternalLink className="w-3 h-3 text-[var(--text-muted)] shrink-0" />}
                            </div>
                            <div className="text-[9px] font-mono text-[var(--text-muted)] line-clamp-2 mt-1 leading-relaxed">{repo.description || 'No description'}</div>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {repo.language && <span className="px-1.5 py-0.5 rounded bg-[var(--cyan-primary)]/10 border border-[var(--cyan-primary)]/20 text-[var(--cyan-primary)] text-[8px] font-mono">{repo.language}</span>}
                              {(repo.topics || []).slice(0, 4).map((topic) => (
                                <span key={topic} className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-[var(--border-secondary)] text-[var(--text-secondary)] text-[8px] font-mono">{topic}</span>
                              ))}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 text-right shrink-0 min-w-[120px]">
                            <span className="rounded bg-[#A3E635]/10 px-2 py-1 text-[9px] font-mono text-[#A3E635]">MOMENTUM {repo.momentum_score || 0}</span>
                            <span className="rounded bg-[var(--gold-primary)]/10 px-2 py-1 text-[9px] font-mono text-[var(--gold-primary)]">{fmt(repo.stars)} ★</span>
                            <span className="rounded bg-[var(--cyan-primary)]/10 px-2 py-1 text-[9px] font-mono text-[var(--cyan-primary)]">{fmt(repo.forks)} forks</span>
                            <span className="rounded bg-white/[0.04] px-2 py-1 text-[9px] font-mono text-[var(--text-secondary)]">{fmt(repo.open_issues)} issues</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              </main>

              <aside className="col-span-12 lg:col-span-3 min-h-0 flex flex-col gap-3 overflow-y-auto styled-scrollbar pr-1">
                <section className="glass-panel-sm p-4 shrink-0">
                  <div className="flex items-center justify-between">
                    <button onClick={() => toggleSection('repo')} className="flex items-center gap-2 min-w-0 text-left">
                      <Activity className="w-4 h-4 text-[#A3E635]" />
                      <span className="hud-text text-[11px]">REPO SIGNAL</span>
                      {expandedSections.repo ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                    </button>
                    <div className="flex items-center gap-2">
                      {activeRepo?.html_url && (
                        <a href={activeRepo.html_url} target="_blank" rel="noopener noreferrer" className="text-[var(--text-muted)] hover:text-[#A3E635]">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                  {expandedSections.repo && (
                    <>
                      <div className="mt-3 text-[12px] font-mono text-[var(--text-primary)] truncate">{activeRepo?.repo_full_name || 'No repo selected'}</div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {[
                          ['STAR DELTA', metricDelta(snapshots, 'stars')],
                          ['FORK DELTA', metricDelta(snapshots, 'forks')],
                          ['WATCH DELTA', metricDelta(snapshots, 'watchers')],
                          ['MOMENTUM DELTA', metricDelta(snapshots, 'momentum_score')],
                        ].map(([label, value]) => (
                          <div key={label} className="bg-black/20 rounded-lg border border-[var(--border-secondary)] p-2">
                            <div className="hud-label">{label}</div>
                            <div className={`hud-value text-[12px] ${Number(value) >= 0 ? 'text-[#A3E635]' : 'text-[var(--alert-red)]'}`}>{Number(value) >= 0 ? '+' : ''}{fmt(Number(value))}</div>
                          </div>
                        ))}
                      </div>
                      {snapshotLoading ? <div className="mt-4 text-[10px] font-mono text-[var(--text-muted)]">Loading snapshots...</div> : <SnapshotLineChart snapshots={snapshots} />}
                    </>
                  )}
                </section>

                <section className="glass-panel-sm p-4 shrink-0">
                  <button onClick={() => toggleSection('languages')} className={`flex items-center gap-2 w-full text-left ${expandedSections.languages ? 'mb-3' : ''}`}>
                    <BarChart3 className="w-4 h-4 text-[var(--cyan-primary)]" />
                    <span className="hud-text text-[11px]">LANGUAGES</span>
                    {expandedSections.languages ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)] ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] ml-auto" />}
                  </button>
                  {expandedSections.languages && (
                    <div className="space-y-2">
                      {languageRows.map(([language, count]) => (
                        <div key={language}>
                          <div className="flex items-center justify-between text-[9px] font-mono text-[var(--text-secondary)]">
                            <span>{language}</span>
                            <span>{count}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div className="h-full bg-[var(--cyan-primary)]" style={{ width: `${count / Math.max(1, languageRows[0]?.[1] || 1) * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className={`glass-panel-sm shrink-0 flex flex-col ${expandedSections.papers ? 'h-[320px]' : ''}`}>
                  <button onClick={() => toggleSection('papers')} className={`px-4 py-3 flex items-center justify-between text-left ${expandedSections.papers ? 'border-b border-[var(--border-secondary)]' : ''}`}>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-[var(--cyan-primary)]" />
                      <span className="hud-text text-[11px]">ARXIV SIGNALS</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-[var(--text-muted)]">{papers.length}</span>
                      {expandedSections.papers ? <ChevronUp className="w-3.5 h-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                    </div>
                  </button>
                  {expandedSections.papers && (
                    <div className="flex-1 min-h-0 overflow-y-auto styled-scrollbar p-3">
                      {!detailLoading && papers.length === 0 && (
                        <div className="h-full min-h-[180px] flex items-center justify-center text-[11px] font-mono text-[var(--text-muted)] border border-dashed border-[var(--border-secondary)] rounded-lg">
                          No arXiv-linked papers returned for this university yet.
                        </div>
                      )}
                      {papers.map((paper) => (
                        <a key={paper.id} href={paper.source_url || paper.pdf_url || '#'} target="_blank" rel="noopener noreferrer" className="block p-3 mb-2 rounded-lg bg-black/20 border border-[var(--border-secondary)] hover:border-[var(--cyan-primary)]/35 hover:bg-white/[0.03] transition-colors">
                          <div className="flex items-start gap-2">
                            <ArrowUpRight className="w-3 h-3 text-[var(--cyan-primary)] mt-0.5 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-[10px] font-mono text-[var(--text-primary)] leading-snug">{paper.title}</div>
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                <span className="px-1.5 py-0.5 rounded bg-[var(--cyan-primary)]/10 border border-[var(--cyan-primary)]/20 text-[var(--cyan-primary)] text-[8px] font-mono">{shortDate(paper.published_at)}</span>
                                {(paper.categories || []).slice(0, 3).map((category) => (
                                  <span key={category} className="px-1.5 py-0.5 rounded bg-white/[0.03] border border-[var(--border-secondary)] text-[var(--text-secondary)] text-[8px] font-mono">{category}</span>
                                ))}
                              </div>
                              {paper.authors?.length ? <div className="mt-2 text-[8px] font-mono text-[var(--text-muted)] line-clamp-1">{paper.authors.slice(0, 4).join(', ')}</div> : null}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              </aside>
            </div>

            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 lg:hidden p-2 text-[var(--text-muted)]">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const ResearchExplorer = memo(ResearchExplorerInner);
export default ResearchExplorer;
