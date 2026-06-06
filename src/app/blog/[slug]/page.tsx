const blogSlugs = [
  'the-map-is-not-the-product',
  'turning-chamber-directories-into-market-intelligence',
  'grant-writing-needs-local-proof',
  'economic-development-is-a-decision-system',
];

export function generateStaticParams() {
  return blogSlugs.map((slug) => ({ slug }));
}

export default function BlogDetailRoute() {
  return null;
}
