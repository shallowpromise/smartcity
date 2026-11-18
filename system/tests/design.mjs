import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const out=new URL('../test-results/',import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.goto(process.env.BASE_URL||'http://127.0.0.1:8090');
 await page.waitForFunction(()=>window.__app?.scenario&&document.querySelector('#loader').style.display==='none',null,{timeout:60000});
 await page.evaluate(()=>window.__app.setFrame(21));
 const glass=[['.topbar',null],['.panel-left',null],...['.scenario-card','.stat','.alert-item','.dispatch-item'].map(s=>[s,'::before'])];
 await page.waitForFunction(selectors=>selectors.every(([s,pseudo])=>getComputedStyle(document.querySelector(s),pseudo).backdropFilter.includes('url(')),glass);
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
 for(const [width,height] of [[1366,768],[1920,1080]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(1500);
  const note=await page.locator('.model-note').boundingBox();const panel=await page.locator('.panel-left').boundingBox();
  assert.ok(note.y+note.height<=panel.y+panel.height, JSON.stringify({width,note,panel}));
  await page.screenshot({path:fileURLToPath(new URL(`design-${width}.png`,out))});
 }
 await page.locator('#btn-focus').click();
 await page.screenshot({path:fileURLToPath(new URL('design-focus.png',out))});
 await page.setViewportSize({width:900,height:780});
 await page.locator('[data-view="monitor"]').click();assert.equal(await page.locator('.panel-right').isVisible(),true);
 await page.locator('#btn-focus').click();assert.equal(await page.locator('.panel-right').isVisible(),false);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-contrast',value:'more'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await page.waitForFunction(()=>matchMedia('(prefers-contrast: more)').matches);
 for(const [selector,pseudo] of glass) assert.equal(await page.locator(selector).first().evaluate((el,p)=>getComputedStyle(el,p).backdropFilter,pseudo),'none');
 console.log('PASS: data note visible at both desktop sizes; focus mode, compact risk panel, increased contrast and reduced-motion styles.');
}finally{await browser.close();}
