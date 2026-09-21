import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const base = process.env.BROOGFORGE_URL || 'http://127.0.0.1:8790';
await fs.mkdir('artifacts', {recursive:true});
const browserPath = process.argv.find(arg=>arg.startsWith('--browser='))?.slice(10);
const browser = await chromium.launch({ headless: true, ...(browserPath ? {executablePath:browserPath} : {}) });
const report = { base, at: new Date().toISOString(), pages: [], errors: [], remoteRequests: [] };
try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport, reducedMotion:'reduce' });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith(base)) report.remoteRequests.push(req.url()); });
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#connection').textContent.includes('Connected') || document.querySelector('#engine-select').options.length > 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`Horizontal overflow at ${viewport.width}`);
    await page.screenshot({ path:`artifacts/studio-${viewport.width}.png`, fullPage:true });
    const stats = { viewport, overflow, modelChecked: false };
    const complete = (await (await page.request.get(`${base}/api/jobs`)).json()).find(j=>j.status==='complete');
    if (complete) {
      // Select the real completed asset through the library, not a simulated generation.
      await page.locator('[data-view="library"]').click();
      await page.locator('#asset-library button').first().click();
      const model = page.locator('#model-viewer');
      await model.waitFor({state:'visible'});
      await page.waitForFunction(() => document.querySelector('#model-viewer').loaded, null, {timeout:60000});
      const pixels = await page.evaluate(async () => {
        const viewer = document.querySelector('#model-viewer');
        const blob = await viewer.toBlob({mimeType:'image/png'});
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      });
      const png = PNG.sync.read(Buffer.from(pixels));
      let visible = 0; const colors = new Set();
      for (let i=0;i<png.data.length;i+=16) { if (png.data[i+3] > 20) visible++; colors.add(`${png.data[i]},${png.data[i+1]},${png.data[i+2]}`); }
      if (visible < 100 || colors.size < 30) throw new Error('3D canvas appears blank');
      await fs.writeFile(`artifacts/model-${viewport.width}.png`, Buffer.from(pixels));
      await model.evaluate(el => { el.setAttribute('auto-rotate-delay','0'); el.setAttribute('rotation-per-second','45deg'); });
      await page.locator('#rotate-model').click();
      if (await model.getAttribute('auto-rotate') === null) throw new Error('Auto-rotation did not activate');
      await page.waitForTimeout(2000);
      const rotated = await model.evaluate(async el => Array.from(new Uint8Array(await (await el.toBlob({mimeType:'image/png'})).arrayBuffer())));
      const after = PNG.sync.read(Buffer.from(rotated));
      let changed = 0;
      for (let i=0;i<Math.min(after.data.length,png.data.length);i+=16) if (Math.abs(after.data[i]-png.data[i])>12) changed++;
      if (changed < 100) throw new Error('3D rotation did not visibly change the canvas');
      await page.locator('#rotate-model').click();
      await page.locator('#reset-camera').click();
      await page.screenshot({path:`artifacts/generated-${viewport.width}.png`,fullPage:true});
      Object.assign(stats,{modelChecked:true,visibleSamples:visible,uniqueColors:colors.size,rotationChangedSamples:changed});
    }
    await page.locator('[data-view="engines"]').click();
    await page.locator('#engine-list').waitFor({state:'visible'});
    await page.screenshot({path:`artifacts/engines-${viewport.width}.png`,fullPage:true});
    await page.locator('[data-view="textures"]').click();
    await page.waitForFunction(() => document.querySelector('#texture-phase').textContent !== 'Connecting');
    await page.waitForFunction(() => document.querySelector('#texture-history').options.length > 0);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`Texturing overflow at ${viewport.width}`);
    const textureState = await (await page.request.get(`${base}/api/textures`)).json();
    if (textureState.jobs.some(job => job.status === 'complete')) {
      await page.locator('#texture-preview').waitFor({state:'visible'});
      await page.waitForFunction(() => document.querySelector('#texture-preview').naturalWidth === 512);
    }
    if (textureState.phase === 'stopped' && await page.locator('#texture-generate').isEnabled()) throw new Error('Projection enabled with backend stopped');
    await page.screenshot({path:`artifacts/textures-${viewport.width}.png`,fullPage:true});
    await page.locator('[data-view="studio"]').click();
    await page.locator('#image-input').setInputFiles(path.resolve('vendor/trellis.cpp/assets/showcase/chest/chest.png'));
    await page.locator('#reference-preview').waitFor({state:'visible'});
    await page.locator('#clear-image').click();
    if (await page.locator('#generate').isEnabled()) throw new Error('Generate enabled without reference');
    report.pages.push(stats); await page.close();
  }
  if (report.errors.length) throw new Error(report.errors.join('\n'));
  if (report.remoteRequests.length) throw new Error('Unexpected remote requests');
} finally {
  await fs.writeFile('artifacts/ui-report.json',JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify(report,null,2));
