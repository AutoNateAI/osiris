'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { FormEvent, useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Church,
  CircleDollarSign,
  Compass,
  GraduationCap,
  LineChart,
  LockKeyhole,
  Mail,
  Map,
  MonitorPlay,
  Network,
  Shield,
  Sparkles,
  Target,
  UserCircle,
  Users,
} from 'lucide-react';

type Product = {
  slug: string;
  name: string;
  eyebrow: string;
  audience: string;
  price: string;
  icon: typeof Building2;
  summary: string;
  promise: string;
  features: string[];
  workflow: string[];
  metrics: string[];
  color: string;
};

type Blog = {
  slug: string;
  title: string;
  category: string;
  date: string;
  read: string;
  excerpt: string;
  body: string[];
};

const products: Product[] = [
  {
    slug: 'business-growth-navigator',
    name: 'Business Growth Navigator',
    eyebrow: 'For chambers and small businesses',
    audience: 'Chamber members, local operators, business associations',
    price: '$49-$199/mo',
    icon: Building2,
    color: '#0f766e',
    summary: 'Turn a chamber directory into a living growth map of customers, partners, events, grants, and workforce programs.',
    promise: 'Help every local business answer: who should I meet, what should I apply for, and where is the next opportunity?',
    features: ['Chamber member maps', 'Partner recommendations', 'Grant and event matching', 'Outreach lists', 'Local market context'],
    workflow: ['Pick a region', 'Load chamber members', 'Overlay schools, grants, workforce, and events', 'Generate recommended actions'],
    metrics: ['Potential partners', 'Upcoming events', 'Nearby workforce programs', 'Relevant funding signals'],
  },
  {
    slug: 'church-community-intelligence',
    name: 'Church Community Intelligence',
    eyebrow: 'For churches and ministries',
    audience: 'Churches, ministries, faith-based nonprofits',
    price: '$29-$99/mo',
    icon: Church,
    color: '#7c3aed',
    summary: 'Show churches where need, partners, schools, nonprofits, and programs intersect across the region they serve.',
    promise: 'Move ministry planning from intuition to a clear service strategy grounded in local context.',
    features: ['Community need maps', 'School and nonprofit overlays', 'Partner discovery', 'Program recommendations', 'Service area planning'],
    workflow: ['Define service area', 'Map schools and nonprofits', 'Overlay needs and transportation context', 'Generate service opportunities'],
    metrics: ['Youth engagement gaps', 'Transportation barriers', 'Potential partners', 'Suggested programs'],
  },
  {
    slug: 'grant-intelligence',
    name: 'Grant Intelligence',
    eyebrow: 'For nonprofits and municipalities',
    audience: 'Grant writers, nonprofits, cities, counties',
    price: '$99-$499/mo',
    icon: CircleDollarSign,
    color: '#b45309',
    summary: 'Find funding opportunities, similar awards, eligible partners, and evidence signals for stronger grant narratives.',
    promise: 'Give grant teams the local proof, partner list, and precedent awards they need before the application starts.',
    features: ['Federal opportunity matching', 'Similar award research', 'Partner scoring', 'Budget range guidance', 'Narrative evidence packs'],
    workflow: ['Describe the program', 'Select a region', 'Match funding and precedent awards', 'Build partner and evidence lists'],
    metrics: ['Federal opportunities', 'Similar awards', 'Likely partners', 'Suggested budget bands'],
  },
  {
    slug: 'economic-development-command-center',
    name: 'Economic Development Command Center',
    eyebrow: 'For cities, counties, and EDOs',
    audience: 'Economic development organizations, municipalities, regional planners',
    price: '$500-$5,000+/mo',
    icon: LineChart,
    color: '#0369a1',
    summary: 'Recruit industries, analyze workforce fit, evaluate site context, and show funders where regional opportunity is forming.',
    promise: 'Help leaders decide which industries to recruit, which assets to promote, and which gaps to close first.',
    features: ['Industry recruitment signals', 'Workforce and education context', 'Federal funding overlays', 'Site selection support', 'Regional opportunity scoring'],
    workflow: ['Select a geography', 'Map regional assets', 'Score workforce and funding signals', 'Generate recruitment thesis'],
    metrics: ['Target industries', 'Employer clusters', 'Workforce readiness', 'Funding leverage'],
  },
];

const blogs: Blog[] = [
  {
    slug: 'the-map-is-not-the-product',
    title: 'The Map Is Not the Product',
    category: 'Strategy',
    date: 'June 2026',
    read: '5 min read',
    excerpt: 'The map is the interface. The product is decision support for organizations trying to act in a region.',
    body: [
      'Regional intelligence becomes valuable when it moves beyond showing layers and starts recommending action. A chamber directory is not just a list of businesses. It is a market.',
      'The winning workflow is simple: pick a region, load organizations, connect context, generate opportunities, and turn those opportunities into outreach, funding, partnerships, and programs.',
      'That is why the next phase of AutoNateAI focuses on opportunity scoring. Every business, church, school, nonprofit, and public agency becomes a node that can be evaluated against funding, workforce, education, partnership, and community signals.',
    ],
  },
  {
    slug: 'turning-chamber-directories-into-market-intelligence',
    title: 'Turning Chamber Directories Into Market Intelligence',
    category: 'Business Growth',
    date: 'June 2026',
    read: '6 min read',
    excerpt: 'A chamber directory can become a local growth engine when each member is scored against regional context.',
    body: [
      'Most chamber directories are static websites. They list members but do not explain where opportunities exist between those members.',
      'Business Growth Navigator turns those members into an opportunity graph. It asks which businesses share customers, which events create visibility, which grants may apply, and which workforce partners sit nearby.',
      'For a small business owner, that means a dashboard can move from browsing names to producing a recommended outreach list.',
    ],
  },
  {
    slug: 'grant-writing-needs-local-proof',
    title: 'Grant Writing Needs Local Proof',
    category: 'Grant Intelligence',
    date: 'June 2026',
    read: '4 min read',
    excerpt: 'Great grant narratives need proof of need, partner capacity, and precedent funding. Regional intelligence can assemble that fast.',
    body: [
      'Grant teams lose time hunting across disconnected sources: federal awards, local partners, schools, workforce boards, poverty indicators, and previous recipients.',
      'Grant Intelligence connects those sources around a specific place and program goal. The output is not just a search result. It is an evidence pack.',
      'The strongest product motion is helping users move from an idea to a fundable coalition.',
    ],
  },
  {
    slug: 'economic-development-is-a-decision-system',
    title: 'Economic Development Is a Decision System',
    category: 'Economic Development',
    date: 'June 2026',
    read: '7 min read',
    excerpt: 'Cities and counties need a system that connects workforce, employers, funding, sites, and industry fit.',
    body: [
      'Economic development teams are asked to make high-consequence decisions with fragmented data. Which industries should we recruit? Which employers need support? Which workforce gaps matter most?',
      'A command center can connect the assets that already exist with the opportunities a region should pursue next.',
      'The map helps leaders see the terrain, but the real product is the recommendation engine behind it.',
    ],
  },
];

const appScreenshots = [
  {
    title: 'Live command center',
    label: 'Portal',
    src: '/marketing/osiris-portal-map.png',
    description: 'The authenticated Osiris portal with regional, aviation, market, and intelligence layers active.',
  },
  {
    title: 'University Research Explorer',
    label: 'Research',
    src: '/marketing/osiris-research-explorer.png',
    description: 'Top universities, GitHub repositories, arXiv signals, language mix, and repo momentum in one explorer.',
  },
  {
    title: 'Region Watch Explorer',
    label: 'Regions',
    src: '/marketing/osiris-region-watch.png',
    description: 'Watched cities with businesses, chamber events, SBIR/STTR, HUD, departments, and local movement data.',
  },
  {
    title: 'Airport Flow Explorer',
    label: 'Aviation',
    src: '/marketing/osiris-airport-flows.png',
    description: 'Airport and route flow intelligence designed for state and national movement analysis.',
  },
];

const productShotBySlug: Record<string, string> = {
  'business-growth-navigator': '/marketing/osiris-region-watch.png',
  'church-community-intelligence': '/marketing/osiris-region-watch.png',
  'grant-intelligence': '/marketing/osiris-region-watch.png',
  'economic-development-command-center': '/marketing/osiris-portal-map.png',
};

function pathFromWindow() {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname.replace(/\/$/, '') || '/';
}

function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 bg-white/82 backdrop-blur-xl border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-5 py-4 flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-950 text-amber-300 flex items-center justify-center shadow-lg shadow-amber-200">
            <Target className="h-5 w-5" />
          </div>
          <div>
            <div className="font-mono text-sm tracking-[0.28em] text-slate-950">AUTONATEAI</div>
            <div className="text-xs text-slate-500">Regional Opportunity Intelligence</div>
          </div>
        </a>
        <nav className="hidden lg:flex items-center gap-6 text-sm text-slate-600">
          <a href="/products/business-growth-navigator" className="hover:text-slate-950">Products</a>
          <a href="/sales" className="hover:text-slate-950">Sales</a>
          <a href="/blog" className="hover:text-slate-950">Blog</a>
        </nav>
        <div className="flex items-center gap-2">
          <a href="/login" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-950 hover:text-slate-950">Login</a>
          <a href="/sales" className="hidden sm:inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Book demo</a>
        </div>
      </div>
    </header>
  );
}

function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="fixed inset-0 overflow-y-auto bg-[#f7f8fb] text-slate-950" style={{ colorScheme: 'light' }}>
      <MarketingNav />
      {children}
      <footer className="bg-slate-950 text-white">
        <div className="mx-auto max-w-7xl px-5 py-12 grid gap-8 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div>
            <div className="font-mono tracking-[0.26em] text-amber-300">AUTONATEAI</div>
            <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">Osiris powers regional opportunity intelligence for businesses, churches, grant teams, schools, and economic development leaders.</p>
          </div>
          <div>
            <div className="text-sm font-semibold">Products</div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              {products.map((product) => <a key={product.slug} href={`/products/${product.slug}`} className="block hover:text-white">{product.name}</a>)}
            </div>
          </div>
          <div>
            <div className="text-sm font-semibold">Company</div>
            <div className="mt-3 space-y-2 text-sm text-slate-300">
              <a href="/sales" className="block hover:text-white">Sales details</a>
              <a href="/blog" className="block hover:text-white">Blog</a>
              <a href="/login" className="block hover:text-white">Login</a>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ProductCard({ product }: { product: Product }) {
  const Icon = product.icon;
  return (
    <a href={`/products/${product.slug}`} className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm hover:-translate-y-1 hover:shadow-xl transition-all">
      <div className="flex items-center justify-between gap-3">
        <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: `${product.color}16`, color: product.color }}>
          <Icon className="h-6 w-6" />
        </div>
        <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-slate-950" />
      </div>
      <div className="mt-6 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{product.eyebrow}</div>
      <h3 className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{product.name}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{product.summary}</p>
      <div className="mt-5 text-sm font-semibold" style={{ color: product.color }}>{product.price}</div>
    </a>
  );
}

function DemoPanel() {
  return (
    <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-4 shadow-2xl shadow-slate-300">
      <div className="rounded-[1.5rem] bg-[#08111f] p-4 text-white overflow-hidden">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono tracking-[0.25em] text-amber-300">OSIRIS ENGINE</div>
            <div className="mt-1 text-lg font-semibold">Sikeston Opportunity Graph</div>
          </div>
          <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">LIVE</div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            ['Businesses', '359', '#2dd4bf'],
            ['Partners', '41', '#f59e0b'],
            ['Grants', '12', '#a78bfa'],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-2 text-3xl font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center gap-2 text-sm text-slate-300"><Sparkles className="h-4 w-4 text-amber-300" /> Recommended action</div>
          <p className="mt-3 text-sm leading-6 text-slate-200">ABC Manufacturing should meet the workforce board and two nearby schools. The region shows 3 matching grant signals and 5 upcoming chamber events.</p>
        </div>
        <div className="mt-4 h-48 rounded-2xl border border-cyan-300/20 bg-[radial-gradient(circle_at_25%_30%,rgba(45,212,191,.35),transparent_22%),radial-gradient(circle_at_70%_55%,rgba(245,158,11,.32),transparent_20%),linear-gradient(135deg,#0f172a,#020617)] relative overflow-hidden">
          <div className="absolute left-[18%] top-[28%] h-4 w-4 rounded-full bg-teal-300 shadow-lg shadow-teal-300/50 animate-pulse" />
          <div className="absolute left-[65%] top-[50%] h-5 w-5 rounded-full bg-amber-300 shadow-lg shadow-amber-300/50 animate-pulse" />
          <div className="absolute left-[45%] top-[68%] h-3 w-3 rounded-full bg-violet-300 shadow-lg shadow-violet-300/50 animate-pulse" />
          <svg className="absolute inset-0 h-full w-full opacity-70">
            <path d="M90 70 C160 120, 220 60, 320 105" fill="none" stroke="#67e8f9" strokeWidth="2" strokeDasharray="6 8" />
            <path d="M210 135 C270 100, 310 145, 390 82" fill="none" stroke="#fbbf24" strokeWidth="2" strokeDasharray="6 8" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function CapabilityPreview() {
  const modules = [
    { label: 'Region Watch', value: '2 cities', detail: 'Businesses, events, SBIR, HUD, aircraft', color: '#14b8a6' },
    { label: 'Research Explorer', value: '100 schools', detail: 'Repos, arXiv, momentum, languages', color: '#84cc16' },
    { label: 'Airport Flows', value: 'route graph', detail: 'Origin, destination, airport corridors', color: '#0ea5e9' },
    { label: 'Opportunity Engine', value: 'actions', detail: 'Partners, grants, outreach, programs', color: '#f59e0b' },
  ];

  return (
    <section className="mx-auto max-w-7xl px-5 py-16">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] items-center">
        <div>
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">See the capability</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-black tracking-tight text-slate-950">One command center, packaged into products people can buy.</h2>
          <p className="mt-5 text-lg leading-8 text-slate-600">Osiris already connects local businesses, chamber events, federal funding, public agencies, university research, and live movement data. The marketing site now frames that capability around customer decisions.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {modules.map((module) => (
              <div key={module.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{module.label}</div>
                <div className="mt-2 text-2xl font-black" style={{ color: module.color }}>{module.value}</div>
                <div className="mt-1 text-sm leading-6 text-slate-600">{module.detail}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-200">
          <div className="rounded-[1.5rem] bg-slate-950 p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="font-mono text-xs tracking-[0.22em] text-amber-300">AUTONATEAI OSIRIS</div>
              <div className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs text-emerald-300">6 feeds active</div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-[0.75fr_1.25fr]">
              <div className="space-y-2">
                {['Sikeston, MO', 'Hopewell, VA', 'University Research', 'Airport Flows'].map((item, index) => (
                  <div key={item} className={`rounded-xl border p-3 ${index === 1 ? 'border-teal-300/40 bg-teal-300/10' : 'border-white/10 bg-white/[0.04]'}`}>
                    <div className="text-sm font-semibold">{item}</div>
                    <div className="mt-1 text-xs text-slate-400">{index === 1 ? '520 records scoped' : 'signal ready'}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#07111f] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-slate-400">Selected node</div>
                    <div className="mt-1 text-lg font-bold">Hopewell Growth Opportunity</div>
                  </div>
                  <div className="rounded-full bg-amber-300/15 px-3 py-1 text-xs text-amber-200">Score 87</div>
                </div>
                <div className="mt-4 grid gap-2">
                  {[
                    ['Potential partners', '14', '#2dd4bf'],
                    ['Relevant grants', '3', '#fbbf24'],
                    ['Workforce pipelines', '2', '#a78bfa'],
                    ['Recommended outreach', '10', '#38bdf8'],
                  ].map(([label, value, color]) => (
                    <div key={label} className="rounded-xl bg-white/[0.04] border border-white/10 p-3 flex items-center justify-between">
                      <span className="text-sm text-slate-300">{label}</span>
                      <span className="font-black" style={{ color }}>{value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-xl bg-emerald-300/10 border border-emerald-300/20 p-3 text-sm leading-6 text-emerald-100">Recommended next step: schedule a workforce partnership meeting with the chamber, school district, and local employer cluster.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AppMediaShowcase({ compact = false }: { compact?: boolean }) {
  return (
    <section className={compact ? 'mx-auto max-w-7xl px-5 pb-16' : 'bg-white'}>
      <div className={compact ? '' : 'mx-auto max-w-7xl px-5 py-16'}>
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-bold text-slate-600">
              <MonitorPlay className="h-4 w-4 text-teal-700" /> Real Osiris capture
            </div>
            <h2 className="mt-4 text-4xl md:text-5xl font-black tracking-tight text-slate-950">Show the product, not just the promise.</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">These are live authenticated portal captures from the same Osiris surface customers will use: map layers, region watch, research signals, and route intelligence.</p>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-3 shadow-2xl shadow-slate-200">
            <video
              className="aspect-video w-full rounded-[1.35rem] object-cover"
              src="/marketing/osiris-demo.webm"
              autoPlay
              muted
              loop
              playsInline
              poster="/marketing/osiris-portal-map.png"
            />
          </div>
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {appScreenshots.map((shot) => (
            <a key={shot.src} href={shot.src} className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
              <div className="aspect-[16/10] overflow-hidden bg-slate-950">
                <img src={shot.src} alt={`${shot.title} screenshot`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
              </div>
              <div className="p-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-teal-700">{shot.label}</div>
                <h3 className="mt-2 text-xl font-black text-slate-950">{shot.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{shot.description}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function PersonaProof() {
  const rows = [
    ['Business owner', 'Who should I call this week?', '10 recommended outreach targets'],
    ['Church leader', 'Where can we serve with partners?', '3 program concepts and 6 partners'],
    ['Grant writer', 'What funding fits this idea?', '12 opportunities and 8 similar awards'],
    ['EDO director', 'What industries should we recruit?', '4 industry theses with workforce proof'],
  ];

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-5 py-16">
        <div className="max-w-3xl">
          <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">The buyer does not buy layers</div>
          <h2 className="mt-3 text-4xl md:text-5xl font-black tracking-tight">They buy the answer to a decision.</h2>
        </div>
        <div className="mt-8 overflow-hidden rounded-[2rem] border border-slate-200">
          {rows.map(([buyer, question, output], index) => (
            <div key={buyer} className={`grid gap-4 p-5 md:grid-cols-[0.8fr_1.1fr_1.1fr] ${index % 2 ? 'bg-slate-50' : 'bg-white'} border-b border-slate-200 last:border-b-0`}>
              <div className="font-black text-slate-950">{buyer}</div>
              <div className="text-slate-600">{question}</div>
              <div className="font-semibold text-teal-700">{output}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ConversionBand() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-16">
      <div className="rounded-[2rem] bg-slate-950 p-8 md:p-12 text-white overflow-hidden relative">
        <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-teal-300/20 blur-3xl" />
        <div className="absolute right-28 bottom-0 h-52 w-52 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-amber-300">Ready to package your region?</div>
            <h2 className="mt-3 text-4xl font-black tracking-tight">Pick a region. Pull organizations. Generate opportunities. Sell intelligence.</h2>
            <p className="mt-4 max-w-2xl text-slate-300 leading-7">The fastest path is one vertical, one region, one decision workflow. Then repeat it across cities, counties, and states.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/sales" className="rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950">Book demo</a>
            <a href="/login" className="rounded-full border border-white/25 px-6 py-3 text-sm font-black text-white hover:bg-white/10">Login</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProductCapabilityMock({ product }: { product: Product }) {
  const Icon = product.icon;
  const metricRows = product.metrics.map((metric, index) => ({
    metric,
    value: [87, 42, 14, 6][index] || 9,
  }));

  return (
    <div className="rounded-[2rem] bg-slate-950 p-4 text-white shadow-2xl shadow-slate-200">
      <div className="rounded-[1.5rem] border border-white/10 bg-[#08111f] p-5">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-2xl flex items-center justify-center" style={{ background: `${product.color}24`, color: product.color }}><Icon className="h-6 w-6" /></div>
          <div>
            <div className="font-mono text-xs tracking-[0.18em] text-amber-300">LIVE WORKFLOW</div>
            <div className="text-lg font-bold">{product.name}</div>
          </div>
        </div>
        <div className="mt-5 rounded-2xl bg-white/[0.04] border border-white/10 p-4">
          <div className="text-xs text-slate-400">Advisor prompt</div>
          <div className="mt-2 text-sm leading-6 text-slate-200">{product.workflow[product.workflow.length - 1]}</div>
        </div>
        <div className="mt-4 grid gap-3">
          {metricRows.map((row) => (
            <div key={row.metric} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300">{row.metric}</span>
                <span className="font-black" style={{ color: product.color }}>{row.value}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, row.value)}%`, background: product.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LandingPage() {
  return (
    <MarketingShell>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(45,212,191,.20),transparent_32%),radial-gradient(circle_at_80%_20%,rgba(245,158,11,.22),transparent_30%)]" />
        <div className="relative mx-auto max-w-7xl px-5 py-20 lg:py-24 grid gap-12 lg:grid-cols-[0.92fr_1.08fr] items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white/70 px-3 py-1 text-sm font-semibold text-teal-800">
              <Sparkles className="h-4 w-4" /> Regional Opportunity Intelligence
            </div>
            <h1 className="mt-6 text-5xl font-black tracking-tight text-slate-950 md:text-7xl">Decision support for every region you serve.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">AutoNateAI turns local organizations, funding, workforce, education, and community context into recommended actions. Osiris is the interface. Opportunity intelligence is the product.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/sales" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white hover:bg-slate-800">Book a sales walkthrough <ArrowRight className="h-4 w-4" /></a>
              <a href="/products/business-growth-navigator" className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 hover:border-slate-950">Explore products</a>
            </div>
            <div className="mt-8 grid max-w-xl grid-cols-3 gap-4 text-sm">
              {['Organizations', 'Opportunities', 'Actions'].map((item, index) => (
                <div key={item} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                  <div className="text-2xl font-black text-slate-950">{index + 1}</div>
                  <div className="mt-1 text-slate-600">{item}</div>
                </div>
              ))}
            </div>
          </div>
          <DemoPanel />
        </div>
      </section>

      <CapabilityPreview />
      <AppMediaShowcase />

      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Four sellable products</div>
            <h2 className="mt-2 text-4xl font-black tracking-tight text-slate-950">Same engine. Different buyer. Clear outcome.</h2>
          </div>
          <a href="/sales" className="text-sm font-bold text-slate-950 hover:underline">View sales details</a>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => <ProductCard key={product.slug} product={product} />)}
        </div>
      </section>

      <PersonaProof />

      <section className="bg-slate-50">
        <div className="mx-auto max-w-7xl px-5 py-16 grid gap-8 lg:grid-cols-3">
          {[
            ['Region', 'Pick a city, county, state, or custom service area.'],
            ['Opportunity Graph', 'Connect businesses, churches, schools, grants, agencies, and workforce assets.'],
            ['Decision Support', 'Generate recommended outreach, funding paths, partnerships, and next steps.'],
          ].map(([title, copy]) => (
            <div key={title} className="rounded-3xl border border-slate-200 bg-slate-50 p-8">
              <Network className="h-7 w-7 text-teal-700" />
              <h3 className="mt-5 text-2xl font-bold">{title}</h3>
              <p className="mt-3 leading-7 text-slate-600">{copy}</p>
            </div>
          ))}
        </div>
      </section>

      <ConversionBand />
    </MarketingShell>
  );
}

function ProductPage({ product }: { product: Product }) {
  const Icon = product.icon;
  const productShot = productShotBySlug[product.slug] || '/marketing/osiris-portal-map.png';
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-5 py-16 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-600 border border-slate-200">{product.eyebrow}</div>
          <h1 className="mt-5 text-5xl font-black tracking-tight text-slate-950">{product.name}</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">{product.promise}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="/sales" className="rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white">Talk to sales</a>
            <a href="/login" className="rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800">Login</a>
          </div>
        </div>
        <ProductCapabilityMock product={product} />
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200">
          <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="p-8 md:p-10">
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">From the live Osiris surface</div>
              <h2 className="mt-3 text-3xl font-black tracking-tight">The sales page now shows the actual interface buyers will see.</h2>
              <p className="mt-4 leading-7 text-slate-600">{product.summary}</p>
              <a href="/sales" className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-black text-white">Use this in a demo</a>
            </div>
            <div className="bg-slate-950 p-3">
              <img src={productShot} alt={`${product.name} Osiris screenshot`} className="aspect-video h-full w-full rounded-[1.25rem] object-cover" />
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16 grid gap-5 md:grid-cols-2">
        <div className="rounded-3xl bg-slate-950 p-8 text-white">
          <h2 className="text-3xl font-black">Workflow</h2>
          <div className="mt-6 space-y-4">
            {product.workflow.map((step, index) => (
              <div key={step} className="flex gap-4">
                <div className="h-8 w-8 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold text-amber-300">{index + 1}</div>
                <div className="pt-1 text-slate-200">{step}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-white p-8 border border-slate-200">
          <h2 className="text-3xl font-black">What users see</h2>
          <div className="mt-6 grid gap-3">
            {product.metrics.map((metric) => (
              <div key={metric} className="rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                <span className="font-semibold text-slate-700">{metric}</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">Scored</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="mx-auto max-w-7xl px-5 pb-16">
        <div className="rounded-[2rem] bg-white p-6 border border-slate-200 shadow-xl">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: `${product.color}16`, color: product.color }}><Icon className="h-7 w-7" /></div>
            <div>
              <div className="text-sm text-slate-500">{product.audience}</div>
              <div className="text-2xl font-black">{product.price}</div>
            </div>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {product.features.map((feature) => (
              <div key={feature} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: product.color }} /> {feature}
              </div>
            ))}
          </div>
        </div>
      </section>
      <ConversionBand />
    </MarketingShell>
  );
}

function SalesPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="rounded-[2rem] bg-slate-950 p-8 md:p-12 text-white overflow-hidden relative">
          <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-amber-300/20 blur-3xl" />
          <div className="relative max-w-3xl">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-amber-300">Sales details</div>
            <h1 className="mt-4 text-5xl font-black tracking-tight">Sell decisions, not dashboards.</h1>
            <p className="mt-5 text-lg leading-8 text-slate-300">AutoNateAI packages Osiris into productized intelligence for the organizations that need to act locally: businesses, churches, grant teams, schools, and economic development leaders.</p>
          </div>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {products.map((product) => <ProductCard key={product.slug} product={product} />)}
        </div>
        <div className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 grid gap-6 lg:grid-cols-3">
          {['Regional onboarding', 'Opportunity scoring', 'Advisor workflows'].map((title) => (
            <div key={title}>
              <Compass className="h-7 w-7 text-teal-700" />
              <h3 className="mt-4 text-xl font-black">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">Package the data around the customer decision, then produce recommended next steps they can act on immediately.</p>
            </div>
          ))}
        </div>
        <div className="mt-10">
          <AppMediaShowcase compact />
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[2rem] bg-white border border-slate-200 p-8">
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">Sales motion</div>
            <h2 className="mt-3 text-3xl font-black">Start with the buyer, then show the map.</h2>
            <div className="mt-6 space-y-4">
              {[
                ['Chamber', 'Show members who to meet, which grants fit, and which events create visibility.'],
                ['Church', 'Show where need, partners, schools, and service programs intersect.'],
                ['Grant team', 'Show fundable ideas, precedent awards, and coalition evidence.'],
                ['EDO', 'Show industry fit, workforce leverage, and recruitment thesis.'],
              ].map(([name, copy]) => (
                <div key={name} className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <div className="font-black">{name}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{copy}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[2rem] bg-slate-950 text-white p-8">
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-amber-300">Demo script</div>
            <h2 className="mt-3 text-3xl font-black">The 5-minute close</h2>
            <div className="mt-6 space-y-4">
              {['Choose the customer region', 'Show the organizations already loaded', 'Open an entity and reveal opportunity score', 'Generate partners, grants, and outreach', 'Save the action plan'].map((step, index) => (
                <div key={step} className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-white/10 text-amber-300 flex items-center justify-center font-black">{index + 1}</div>
                  <div className="pt-1 text-slate-200">{step}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <ConversionBand />
    </MarketingShell>
  );
}

function BlogAd({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-3xl bg-slate-950 text-white ${compact ? 'p-6' : 'p-8'} overflow-hidden relative`}>
      <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-teal-300/20 blur-2xl" />
      <div className="relative">
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">Build your opportunity graph</div>
        <p className="mt-3 text-sm leading-6 text-slate-300">Turn one local directory into a regional decision system.</p>
        <a href="/sales" className="mt-4 inline-flex rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-950">Book demo</a>
      </div>
    </div>
  );
}

function BlogListPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-5 py-16">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-slate-400">AutoNateAI Blog</div>
            <h1 className="mt-2 text-5xl font-black tracking-tight">Ideas for regional opportunity intelligence.</h1>
          </div>
          <BlogAd compact />
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <a href={`/blog/${blogs[0].slug}`} className="rounded-[2rem] bg-white p-8 border border-slate-200 shadow-sm hover:shadow-xl transition-shadow">
            <div className="text-sm font-bold uppercase tracking-[0.18em] text-teal-700">Featured article</div>
            <h2 className="mt-4 text-4xl font-black">{blogs[0].title}</h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">{blogs[0].excerpt}</p>
            <div className="mt-6 text-sm font-bold text-slate-950">Read article</div>
          </a>
          <div className="grid gap-4">
            {blogs.slice(1).map((blog) => (
              <a key={blog.slug} href={`/blog/${blog.slug}`} className="rounded-3xl border border-slate-200 bg-white p-6 hover:shadow-lg transition-shadow">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{blog.category} · {blog.read}</div>
                <h3 className="mt-2 text-2xl font-black">{blog.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{blog.excerpt}</p>
              </a>
            ))}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function BlogDetailPage({ blog }: { blog: Blog }) {
  const suggestions = blogs.filter((item) => item.slug !== blog.slug).slice(0, 3);
  return (
    <MarketingShell>
      <article className="mx-auto max-w-4xl px-5 py-16">
        <div className="text-sm font-bold uppercase tracking-[0.2em] text-teal-700">{blog.category} · {blog.date} · {blog.read}</div>
        <h1 className="mt-4 text-5xl font-black tracking-tight">{blog.title}</h1>
        <p className="mt-5 text-xl leading-8 text-slate-600">{blog.excerpt}</p>
        <div className="my-10"><BlogAd /></div>
        <div className="prose prose-slate max-w-none">
          {blog.body.map((paragraph) => <p key={paragraph} className="text-lg leading-9 text-slate-700">{paragraph}</p>)}
        </div>
        <div className="mt-12 border-t border-slate-200 pt-8">
          <h2 className="text-2xl font-black">Suggested next reads</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {suggestions.map((item) => (
              <a key={item.slug} href={`/blog/${item.slug}`} className="rounded-3xl bg-white border border-slate-200 p-5 hover:shadow-lg transition-shadow">
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">{item.category}</div>
                <div className="mt-2 font-black">{item.title}</div>
              </a>
            ))}
          </div>
        </div>
      </article>
    </MarketingShell>
  );
}

function LoginPage({
  email,
  password,
  mode,
  error,
  notice,
  setEmail,
  setPassword,
  setMode,
  signInWithGoogle,
  submitEmail,
  resetPassword,
}: any) {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-7xl px-5 py-16 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] items-center">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-semibold text-slate-600"><LockKeyhole className="h-4 w-4" /> Portal access</div>
          <h1 className="mt-5 text-5xl font-black tracking-tight">Login to the intelligence command center.</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600">Authenticated users go straight into the Osiris portal. New users can create access while we tighten packaging around productized regional intelligence.</p>
        </div>
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-xl">
          <button type="button" onClick={signInWithGoogle} className="w-full h-12 flex items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-slate-50 text-slate-950 hover:border-slate-950 transition-colors font-semibold">
            <UserCircle className="w-5 h-5" /> Continue with Google
          </button>
          <div className="my-5 flex items-center gap-3"><div className="h-px flex-1 bg-slate-200" /><span className="text-xs text-slate-400">OR</span><div className="h-px flex-1 bg-slate-200" /></div>
          <form onSubmit={submitEmail} className="space-y-4">
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Email</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="mt-1 w-full h-12 rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none focus:border-slate-950" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} className="mt-1 w-full h-12 rounded-2xl border border-slate-300 bg-white px-4 text-slate-950 outline-none focus:border-slate-950" />
            </label>
            <button type="submit" className="w-full h-12 rounded-2xl bg-slate-950 text-white font-bold hover:bg-slate-800">
              {mode === 'signin' ? 'Sign in' : 'Create access'}
            </button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="font-semibold text-teal-700">{mode === 'signin' ? 'Create account' : 'Use existing account'}</button>
            <button type="button" onClick={resetPassword} className="text-slate-500 hover:text-slate-950">Reset password</button>
          </div>
          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {notice && <p className="mt-4 text-sm text-emerald-700">{notice}</p>}
        </section>
      </section>
    </MarketingShell>
  );
}

export default function MarketingSite(props: any) {
  const path = pathFromWindow();
  const product = useMemo(() => {
    const slug = path.startsWith('/products/') ? path.split('/products/')[1] : '';
    return products.find((item) => item.slug === slug);
  }, [path]);
  const blog = useMemo(() => {
    const slug = path.startsWith('/blog/') ? path.split('/blog/')[1] : '';
    return blogs.find((item) => item.slug === slug);
  }, [path]);

  if (path === '/login') return <LoginPage {...props} />;
  if (product) return <ProductPage product={product} />;
  if (path === '/sales') return <SalesPage />;
  if (path === '/blog') return <BlogListPage />;
  if (blog) return <BlogDetailPage blog={blog} />;
  return <LandingPage />;
}
