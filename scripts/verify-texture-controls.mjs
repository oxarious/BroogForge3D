import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = process.env.BROOGFORGE_URL || 'http://127.0.0.1:8790';
const browser = await chromium.launch({ headless: true, executablePath: process.argv.find(arg => arg.startsWith('--browser='))?.slice(10) });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(`${base}/#textures`);
  await page.locator('#texture-start').click();
  await page.waitForFunction(() => document.querySelector('#texture-phase').textContent === 'ready', null, { timeout: 240000 });
  assert.equal(await page.locator('#texture-start').isEnabled(), false);
  assert.equal(await page.locator('#texture-stop').isEnabled(), true);
  const blocked = await page.request.post(`${base}/api/jobs`, { multipart: { engineId: 'trellis' } });
  assert.equal(blocked.ok(), false);
  assert.match((await blocked.json()).error, /Stop the texture backend/);
  const state = await (await page.request.get(`${base}/api/textures`)).json();
  assert.match(state.log, /Uvicorn running on http:\/\/127\.0\.0\.1:/);
  await page.locator('#texture-stop').click();
  await page.waitForFunction(() => document.querySelector('#texture-phase').textContent === 'stopped');
  assert.equal(await page.locator('#texture-generate').isEnabled(), false);
  assert.equal(await page.locator('#texture-start').isEnabled(), true);
  assert.deepEqual(errors, []);
  await fs.writeFile('artifacts/texture-controls-report.json', JSON.stringify({ at: new Date().toISOString(), start: true, localhostOnly: true, queueGuard: true, stop: true, errors }, null, 2));
  console.log('Texture start/stop, localhost binding and 3D queue guard passed.');
} finally {
  await page.request.post(`${base}/api/textures/stop`);
  await browser.close();
}
