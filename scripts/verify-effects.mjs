import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output=new URL('../artifacts/flux/qa/',import.meta.url);await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Users/oscar/AppData/Local/ms-playwright/chromium-1217/chrome-win64/chrome.exe',headless:true});
const errors=[],report=[];
try{
  for(const [width,height] of [[1440,900],[393,852]]){
    const page=await browser.newPage({viewport:{width,height}});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto('http://127.0.0.1:8790/effects/');
    await page.waitForSelector('#scene.ready');await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const canvas=page.locator('#scene canvas');
    const first=await canvas.screenshot();const png=PNG.sync.read(first);let foreground=0;
    for(let i=0;i<png.data.length;i+=16){if(Math.max(png.data[i],png.data[i+1],png.data[i+2])-Math.min(png.data[i],png.data[i+1],png.data[i+2])>15||png.data[i]<180)foreground++;}
    assert.ok(foreground>1000,'Sculpture should have nonblank rendered pixels');
    await page.screenshot({path:new URL(`${width}-form.png`,output).pathname.replace(/^\/C:/,'C:')});
    if(width>700){await page.mouse.move(1100,500);await page.waitForTimeout(350);assert.notDeepEqual(await canvas.screenshot(),first);}
    await page.locator('[data-finish="ion"]').click();assert.equal(await page.locator('#finish-name').textContent(),'Ion blue');
    await page.locator('[data-chapter="1"]').click();await page.waitForTimeout(1800);
    assert.ok(Number(await canvas.getAttribute('data-progress'))>.45);
    await page.screenshot({path:new URL(`${width}-field.png`,output).pathname.replace(/^\/C:/,'C:')});
    await page.locator('[data-chapter="2"]').click();await page.waitForTimeout(1800);
    assert.ok(Number(await canvas.getAttribute('data-progress'))>.95);
    await page.screenshot({path:new URL(`${width}-flow.png`,output).pathname.replace(/^\/C:/,'C:')});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(800);
    await page.locator('#open-settings').click();assert.equal(await page.locator('#settings').evaluate(d=>d.open),true);
    await page.locator('#still').check();await page.keyboard.press('Escape');await page.waitForTimeout(350);
    const still=await canvas.screenshot();await page.waitForTimeout(450);assert.deepEqual(await canvas.screenshot(),still,'Still mode should stop changing pixels');
    await page.locator('#open-settings').click();const download=page.waitForEvent('download');await page.locator('#export').click();assert.equal((await download).suggestedFilename(),'broog-flux-preset.json');await page.keyboard.press('Escape');
    await page.locator('#collection').scrollIntoViewIfNeeded();await page.waitForTimeout(300);
    await page.screenshot({path:new URL(`${width}-collection.png`,output).pathname.replace(/^\/C:/,'C:')});
    await page.locator('[data-study="carbon"]').click();await page.waitForTimeout(450);assert.equal(await page.locator('#finish-name').textContent(),'Carbon black');
    report.push({width,height,foreground,canvas:await canvas.evaluate(c=>({...c.dataset}))});await page.close();
  }
  const reduced=await browser.newPage({reducedMotion:'reduce'});await reduced.goto('http://127.0.0.1:8790/effects/');await reduced.waitForSelector('#scene.ready');assert.equal(await reduced.locator('#pause').getAttribute('aria-pressed'),'true');await reduced.close();
  assert.deepEqual(errors,[]);await fs.writeFile(new URL('report.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,report}));
}finally{await browser.close();}
