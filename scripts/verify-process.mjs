import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8790';
const browser = await chromium.launch({headless:true, executablePath:process.argv.find(a => a.startsWith('--browser='))?.slice(10)});
const report = { errors:[], requests:[], views:[] };
try {
  let jobId = process.argv.find(a => a.startsWith('--existing-job='))?.slice(15);
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page = await browser.newPage({viewport, reducedMotion:'reduce'});
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(base)) report.requests.push(r.url()); });
    await page.goto(`${base}/#process`);
    await page.waitForFunction(() => document.querySelector('#process-engine').options.length === 2);
    assert.equal(await page.locator('#process-submit').isDisabled(), true);
    if (!jobId) {
      const jobs = await (await page.request.get(`${base}/api/jobs`)).json();
      const source = jobs.find(j => j.status === 'complete' && j.engineId === 'trellis-q4');
      assert.ok(source);
      await page.locator('#process-source').selectOption(source.id);
      await page.locator('#process-engine').selectOption('gltf-transform');
      const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/process') && r.request().method() === 'POST');
      await page.locator('#process-submit').click();
      const response = await responsePromise;
      assert.equal(response.status(),201);
      jobId = (await response.json()).id;
    }
    await page.waitForFunction(id => document.querySelector(`[data-inspect-job="${id}"]`)?.textContent.includes('complete'), jobId, {timeout:60000});
    await page.locator(`#process-jobs [data-inspect-job="${jobId}"]`).click();
    await page.locator('.result-metrics').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(await page.locator('.stage-history li').count() >= 5);
    await page.screenshot({path:`artifacts/process-${viewport.width}.png`,fullPage:true});
    const log = await page.request.get(`${base}/api/jobs/${jobId}/log`);
    assert.equal(log.status(),200);
    assert.match(await log.text(),/Writing GLB/);
    await page.locator('[data-preview-job]').click();
    await page.waitForFunction(() => document.querySelector('#model-viewer').loaded, null, {timeout:60000});
    assert.equal(await page.locator('#model-status').isHidden(),true);
    const bad = await page.request.post(`${base}/api/process`, {multipart:{engineId:'gltf-transform',sourceJobId:'../../bad'}});
    assert.equal(bad.status(),400);
    const blocked = await page.request.post(`${base}/api/process`, {multipart:{engineId:'unirig',sourceJobId:jobId}});
    assert.equal(blocked.status(),400);
    report.views.push({viewport,jobId,metricsVisible:true,modelLoaded:true});
    await page.close();
  }
  assert.deepEqual(report.errors,[]); assert.deepEqual(report.requests,[]);
} finally {
  await fs.writeFile('artifacts/process-report.json',JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify(report,null,2));
