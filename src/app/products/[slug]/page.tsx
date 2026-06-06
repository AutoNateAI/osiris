const productSlugs = [
  'business-growth-navigator',
  'church-community-intelligence',
  'grant-intelligence',
  'economic-development-command-center',
];

export function generateStaticParams() {
  return productSlugs.map((slug) => ({ slug }));
}

export default function ProductRoute() {
  return null;
}
