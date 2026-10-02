import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const base = process.env.BROWSER_BASE_URL ?? 'http://localhost:3000';
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(base);
  await page
    .getByRole('button', { name: '＋ Add booking', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: '＋ Add booking', exact: true })
    .click();
  await page
    .getByLabel('Attraction', { exact: true })
    .selectOption('fixture-space');
  await page.getByLabel('Start', { exact: true }).fill('23:00');
  await page.getByLabel('End', { exact: true }).fill('23:55');
  await page.getByLabel('Earliest', { exact: true }).fill('23:10');
  await page.getByLabel('Latest', { exact: true }).fill('23:30');
  await page.getByRole('button', { name: 'Save booking', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Space Mountain', exact: true })
    .waitFor();
  let result = await page.request.get(base + '/api/dashboard');
  let data = await result.json();
  assert.equal(data.bookings.length, 1);
  assert.equal(data.pollingNeeded, true);
  const crossOrigin = await page.request.post(base + '/api/bookings', {
    headers: { origin: 'https://evil.example' },
    data: { action: 'state', id: data.bookings[0].id, state: 'completed' },
  });
  assert.equal(crossOrigin.status(), 403);
  await page
    .getByRole('button', { name: 'Update booking', exact: true })
    .click();
  await page.getByLabel('Start', { exact: true }).fill('23:15');
  await page.getByRole('button', { name: 'Save booking', exact: true }).click();
  await page.getByText('Booking in target', { exact: true }).waitFor();
  result = await page.request.get(base + '/api/dashboard');
  data = await result.json();
  assert.equal(data.pollingNeeded, false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByText('Paused', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByText('Booking in target', { exact: true }).waitFor();
  mkdirSync('data/screenshots', { recursive: true });
  await page.screenshot({
    path: 'data/screenshots/mobile.png',
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'data/screenshots/desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('heading', { name: 'No bookings yet' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: create/edit, satisfied target, pause/resume, completion, CSRF, mobile overflow; no page errors.'
  );
} finally {
  await browser.close();
}
