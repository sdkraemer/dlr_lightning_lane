import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const base = process.env.BROWSER_BASE_URL ?? 'http://localhost:3000';
let missing = false;
await page.route('**/api/dashboard', async route => {
  const response = await route.fetch();
  const data = await response.json();
  const [first, second] = data.parkHours;
  first.slots = missing ? [] : first.slots.filter(s => s.value >= '08:15' && s.value < '12:10');
  second.slots = second.slots.filter(s => s.value >= '09:00' && s.value < '11:00');
  data.attractions.push({ id: 'fixture-other-park', name: 'Other park ride', park_id: second.parkId, park_name: 'Disney California Adventure' });
  await route.fulfill({ response, json: data });
});
const options = label => page.getByLabel(label, { exact: true }).locator('option:not([disabled])').evaluateAll(items => items.map(item => item.value));
try {
  await page.goto(base);
  await page.getByRole('button', { name: '＋ Add booking', exact: true }).click();
  await page.getByLabel('Attraction', { exact: true }).selectOption('fixture-space');
  assert.deepEqual(await options('Start hour'), ['08', '09', '10', '11', '12']);
  await page.getByLabel('Start hour', { exact: true }).selectOption('08');
  assert.deepEqual(await options('Start minute'), ['15', '20', '25', '30', '35', '40', '45', '50', '55']);
  for (const label of ['Start', 'Earliest', 'Latest']) {
    await page.getByLabel(label + ' hour', { exact: true }).selectOption('12');
    assert.deepEqual(await options(label + ' minute'), ['00', '05']);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByLabel('Attraction', { exact: true }).selectOption('fixture-other-park');
  assert.deepEqual(await options('Start hour'), ['09', '10']);
  for (const label of ['Start', 'Earliest', 'Latest'])
    assert.equal(await page.getByLabel(label + ' hour', { exact: true }).inputValue(), '');
  missing = true;
  await page.reload();
  await page.getByRole('button', { name: '＋ Add booking', exact: true }).click();
  await page.getByLabel('Attraction', { exact: true }).selectOption('fixture-space');
  await page.getByText('Park hours are unavailable for today.', { exact: false }).waitFor();
  assert.equal(await page.getByLabel('Start hour', { exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Save booking', exact: true }).isDisabled(), true);
  console.log('Park-hours UI passed: partial-hour minutes, all three pickers, park switching, missing hours and mobile overflow.');
} finally { await browser.close(); }
