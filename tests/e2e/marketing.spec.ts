import { expect, test } from 'playwright/test';

const pages = [
  ['/', 'Decision support for every region you serve.'],
  ['/products/business-growth-navigator', 'Business Growth Navigator'],
  ['/products/church-community-intelligence', 'Church Community Intelligence'],
  ['/products/grant-intelligence', 'Grant Intelligence'],
  ['/products/economic-development-command-center', 'Economic Development Command Center'],
  ['/sales', 'Sell decisions, not dashboards.'],
  ['/blog', 'Ideas for regional opportunity intelligence.'],
  ['/blog/the-map-is-not-the-product', 'The Map Is Not the Product'],
  ['/login', 'Login to the intelligence command center.'],
];

test.describe('public marketing funnel', () => {
  for (const [path, heading] of pages) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Login' }).first()).toBeVisible();
    });
  }

  test('landing page communicates productized capability', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('One command center, packaged into products people can buy.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business Growth Navigator' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Grant Intelligence' })).toBeVisible();
    await expect(page.getByText('They buy the answer to a decision.')).toBeVisible();
  });
});
