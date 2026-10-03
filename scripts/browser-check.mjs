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
  await page.getByLabel('Start hour', { exact: true }).selectOption('23');
  await page.getByLabel('Start minute', { exact: true }).selectOption('00');
  assert.deepEqual(await page.getByLabel('Start minute', { exact: true }).locator('option:not([disabled])').evaluateAll(options => options.map(option => option.value)),
    ['00','05','10','15','20','25','30','35','40','45','50','55']);
  assert.equal(await page.getByLabel('End', { exact: true }).count(), 0);
  await page.getByLabel('Earliest hour', { exact: true }).selectOption('23');
  await page.getByLabel('Earliest minute', { exact: true }).selectOption('10');
  await page.getByLabel('Latest hour', { exact: true }).selectOption('23');
  await page.getByLabel('Latest minute', { exact: true }).selectOption('30');
  for (const label of ['Earliest', 'Latest']) {
    assert.deepEqual(await page.getByLabel(label + ' minute', { exact: true }).locator('option:not([disabled])').evaluateAll(options => options.map(option => option.value)),
      ['00','05','10','15','20','25','30','35','40','45','50','55']);
  }
  await page.getByRole('button', { name: 'Save booking', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Space Mountain', exact: true })
    .waitFor();
  let result = await page.request.get(base + '/api/dashboard');
  let data = await result.json();
  assert.equal(data.bookings.length, 1);
  assert.equal(data.bookings[0].reserved_end - data.bookings[0].reserved_start, 3_600_000);
  assert.equal(data.pollingNeeded, true);
  const crossOrigin = await page.request.post(base + '/api/bookings', {
    headers: { origin: 'https://evil.example' },
    data: { action: 'state', id: data.bookings[0].id, state: 'completed' },
  });
  assert.equal(crossOrigin.status(), 403);
  await page
    .getByRole('button', { name: 'Update booking', exact: true })
    .click();
  await page.getByLabel('Start minute', { exact: true }).selectOption('15');
  await page.getByRole('button', { name: 'Save booking', exact: true }).click();
  await page.getByText('Booking in target', { exact: true }).waitFor();
  result = await page.request.get(base + '/api/dashboard');
  data = await result.json();
  assert.equal(data.pollingNeeded, false);
  assert.equal(data.bookings[0].reserved_end - data.bookings[0].reserved_start, 3_600_000);
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
  await page.getByRole('button', { name: 'Update booking', exact: true }).click();
  for (const label of ['Earliest', 'Latest']) {
    await page.getByLabel(label + ' hour', { exact: true }).selectOption('');
    assert.equal(await page.getByLabel(label + ' minute', { exact: true }).isDisabled(), true);
  }
  await page.getByRole('button', { name: 'Save booking', exact: true }).click();
  await page.getByText('No target', { exact: true }).waitFor();
  result = await page.request.get(base + '/api/dashboard');
  data = await result.json();
  assert.equal(data.bookings[0].target_earliest_start, null);
  assert.equal(data.bookings[0].target_latest_start, null);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('heading', { name: 'No bookings yet' }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Browser checks passed: create/edit, satisfied target, pause/resume, completion, CSRF, mobile overflow; no page errors.'
  );
} finally {
  await browser.close();
}
