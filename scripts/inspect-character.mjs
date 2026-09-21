import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Provide a completed job ID');
const base = 'http://127.0.0.1:8790';
const directory = path.resolve('artifacts', `broog-${id}`);
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/oscar/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe' });
const report = { id, views: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-view="library"]').click();
  await page.locator(`[data-open-asset="${id}"]`).click();
  const model = page.locator('#model-viewer');
  await page.waitForFunction(() => document.querySelector('#model-viewer').loaded, null, { timeout: 60000 });
  for (const [name, orbit] of [['front', '0deg 90deg auto'], ['quarter', '35deg 80deg auto'], ['side', '90deg 90deg auto'], ['back', '180deg 90deg auto']]) {
    await model.evaluate((viewer, orbit) => { viewer.cameraOrbit = orbit; viewer.jumpCameraToGoal(); }, orbit);
    await page.waitForTimeout(500);
    const bytes = Buffer.from(await model.evaluate(async viewer => Array.from(new Uint8Array(await (await viewer.toBlob({mimeType:'image/png'})).arrayBuffer()))));
    const png = PNG.sync.read(bytes);
    let visible = 0;
    const colors = new Set();
    for (let i = 0; i < png.data.length; i += 16) {
      if (png.data[i + 3] > 20) visible++;
      colors.add(`${png.data[i]},${png.data[i+1]},${png.data[i+2]}`);
    }
    if (visible < 100 || colors.size < 30) throw new Error(`Blank ${name} render`);
    await fs.writeFile(path.join(directory, `${name}.png`), bytes);
    report.views.push({ name, visible, colors: colors.size });
  }
  await model.evaluate(viewer => { viewer.cameraOrbit = '0deg 90deg auto'; viewer.jumpCameraToGoal(); });
  await page.screenshot({ path: path.join(directory, 'dashboard.png'), fullPage: true });
  await model.evaluate(viewer => {
    const size = viewer.getDimensions();
    const center = viewer.getCameraTarget();
    const orbit = viewer.getCameraOrbit();
    viewer.cameraTarget = `${center.x}m ${center.y + size.y * 0.24}m ${center.z}m`;
    viewer.cameraOrbit = `0deg 90deg ${orbit.radius * 0.38}m`;
    viewer.jumpCameraToGoal();
  });
  await page.waitForTimeout(500);
  await model.screenshot({ path: path.join(directory, 'face.png') });
  const jobs = await (await fetch(`${base}/api/jobs`)).json();
  report.job = jobs.find(job => job.id === id);
  if (report.errors.length) throw new Error(report.errors.join('\n'));
} finally {
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(directory);
