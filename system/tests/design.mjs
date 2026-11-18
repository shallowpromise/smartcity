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
 const glass=['.topbar','.panel-left','.timeline','.map-tools'];
 await page.waitForFunction(selectors=>selectors.every(s=>getComputedStyle(document.querySelector(s)).backdropFilter.includes('url(')),glass);
 for(const selector of ['.stat','.alert-item','.scenario-card']) {
  assert.equal(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).backdropFilter),'none');
 }
 async function checkLens(selector) {
  await page.waitForFunction(s=>{
   const group=document.querySelector(s), active=group.querySelector('button.active');
   if (!active?.offsetWidth) return false;
   const lens=getComputedStyle(group,'::before');
   const transform=new DOMMatrixReadOnly(lens.transform);
   return lens.content!=='none' && Math.abs(transform.m41-active.offsetLeft)<1 &&
    Math.abs(transform.m42-active.offsetTop)<1 && Math.abs(parseFloat(lens.width)-active.offsetWidth)<1;
  }, selector);
 }
 async function checkLayerButtons() {
  const sizes=await page.locator('.map-tools .tool').evaluateAll(buttons=>buttons.map(button=>{
   const {width,height}=button.getBoundingClientRect(),radius=getComputedStyle(button).borderTopLeftRadius;
   return {width,height,corner:parseFloat(radius)/(radius.endsWith('%')?100:width)};
  }));
  assert.equal(sizes.length,6);
  for(const {width,height,corner} of sizes) assert.ok(width>=44 && height===width && corner>=.20 && corner<.5);
 }
 await checkLayerButtons();
 const water=page.locator('.map-tools [data-layer="water"]');
 await water.focus();await page.keyboard.press('Enter');
 assert.equal(await water.getAttribute('aria-pressed'),'false');
 await checkLayerButtons();
 await page.keyboard.press('Enter');
 assert.equal(await water.getAttribute('aria-pressed'),'true');
 await checkLens('.main-nav');
 await page.locator('[data-view="simulate"]').focus();
 await page.keyboard.press('Enter');
 await checkLens('.main-nav');
 await page.locator('[data-id="design-5"]').click();
 await page.waitForFunction(()=>window.__app.scenario.id==='design-5');
 await checkLens('.scenario-tabs');
 assert.equal(await page.locator('[data-id="design-5"]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-id="replay-2309"]').click();
 await page.waitForFunction(()=>window.__app.scenario.id==='replay-2309');
 await page.evaluate(()=>window.__app.setFrame(21));
 await page.locator('#btn-peak').hover();
 await page.waitForFunction(()=>document.querySelector('#btn-peak').classList.contains('glass-lit'));
 await page.mouse.move(500,360);
 await page.waitForFunction(()=>!document.querySelector('#btn-peak').classList.contains('glass-lit'));
 assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),'light');
 for(const [width,height] of [[1366,768],[1920,1080]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(1500);
  await checkLens('.main-nav');
  const note=await page.locator('.model-note').boundingBox();const panel=await page.locator('.panel-left').boundingBox();
  assert.ok(note.y+note.height<=panel.y+panel.height, JSON.stringify({width,note,panel}));
  await page.screenshot({path:fileURLToPath(new URL(`design-${width}.png`,out))});
 }
 await page.locator('#btn-focus').click();
 await page.screenshot({path:fileURLToPath(new URL('design-focus.png',out))});
 await page.setViewportSize({width:900,height:780});
 await page.locator('[data-view="monitor"]').click();assert.equal(await page.locator('.panel-right').isVisible(),true);
 await page.locator('#btn-focus').click();assert.equal(await page.locator('.panel-right').isVisible(),false);
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-view=simulate]').click();
 await checkLayerButtons();
 await checkLens('.main-nav');await checkLens('.scenario-tabs');
 const side=await page.locator('.panel-left').boundingBox();
 const presets=await page.locator('.view-presets').boundingBox();
 assert.ok(side.y+side.height<presets.y);
 await page.screenshot({path:fileURLToPath(new URL('design-phone.png',out))});
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
 const focus=await page.locator('#btn-focus').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:focus.x+focus.width/2,y:focus.y+focus.height/2}]});
 await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('#btn-focus')).scale)<1);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>document.body.classList.contains('map-focused'));
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-contrast',value:'more'},{name:'prefers-reduced-motion',value:'reduce'}]});
 await page.waitForFunction(()=>matchMedia('(prefers-contrast: more)').matches);
 for(const selector of glass) assert.equal(await page.locator(selector).evaluate(el=>getComputedStyle(el).backdropFilter),'none');
 assert.equal(await page.locator('.main-nav').evaluate(el=>getComputedStyle(el,'::before').display),'none');
 await page.emulateMedia({reducedMotion:'reduce', contrast:'no-preference'});
 assert.equal(await page.locator('.main-nav').evaluate(el=>getComputedStyle(el,'::before').transitionDuration),'0s');
 console.log('PASS: shared optical surfaces, selection tracking, pointer highlights, desktop and phone layouts, focus mode, contrast and reduced motion.');
}finally{await browser.close();}
