import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const out = new URL('../test-results/', import.meta.url);
await mkdir(out, {recursive:true});
const browser = await chromium.launch({headless:true, executablePath:chromium.executablePath(), args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage({viewport:{width:1366,height:768}});
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
page.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
try {
  await page.goto('http://127.0.0.1:8088');
  await page.waitForFunction(()=>window.__app?.scenario && document.querySelector('#loader').style.display==='none', null, {timeout:60000});
  assert.equal(await page.evaluate(()=>window.__app.idx),0);
  assert.equal(await page.evaluate(()=>window.__app.playing),false);
  await page.screenshot({path:fileURLToPath(new URL('1366-initial.png',out))});
  await page.getByRole('button',{name:'查看峰值',exact:true}).click();
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>window.__app.scenario.frames[window.__app.idx].maxDepth),await page.evaluate(()=>Math.max(...window.__app.scenario.frames.map(f=>f.maxDepth))));
  const counts=await page.evaluate(()=>[document.querySelector('#stat-warn').textContent,document.querySelector('#warn-count').textContent]);
  assert.equal(counts[0],counts[1]+'处');
  await page.locator('.alert-item').first().click();
  await page.evaluate(()=>window.__app.setFrame(20));
  assert.match(await page.locator('#mc-sub').textContent(),/T\+03:20/);
  const depth=await page.evaluate(()=>window.__app.scenario.sensors.find(s=>s.id===window.__app.selectedId).series[20]);
  assert.equal(await page.locator('#mc-depth').textContent(),depth.toFixed(2)+'m');
  await page.screenshot({path:fileURLToPath(new URL('1366-detail.png',out))});
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{const a=window.__app; await Promise.all([a.setScenario('design-50'),a.setScenario('design-5'),a.setScenario('replay-2309')]);});
  assert.equal(await page.evaluate(()=>window.__app.scenario.id),'replay-2309');
  for(const layer of ['water','buildings','roads','sensors','rain','labels']){
    await page.locator(`[data-layer="${layer}"]`).click();
    assert.equal(await page.evaluate(key=>window.__app.layers[key],layer),false);
  }
  await page.locator('#speed-btn').click();
  await page.locator('#btn-demo-reset').click();
  await page.waitForTimeout(1200);
  const reset=await page.evaluate(()=>{const a=window.__app;return {id:a.scenario.id,idx:a.idx,speed:a.speed,playing:a.playing,layers:Object.values(a.layers),selected:a.selectedId};});
  assert.deepEqual(reset,{id:'replay-2309',idx:0,speed:1,playing:false,layers:[true,true,true,true,true,true],selected:null});
  await page.locator('#btn-play').click();
  await page.waitForFunction(()=>window.__app.idx>0);
  await page.locator('#btn-play').click();
  const paused=await page.evaluate(()=>window.__app.idx); await page.waitForTimeout(1500);
  assert.equal(await page.evaluate(()=>window.__app.idx),paused);
  await page.locator('#timeline').fill('30');
  assert.equal(await page.evaluate(()=>window.__app.idx),30);
  await page.locator('#timeline').press('ArrowRight');
  assert.equal(await page.evaluate(()=>window.__app.idx),31);
  for(const size of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(size);
    await page.evaluate(async()=>{await window.__app.resetDemo();window.__app.setFrame(36);});
    await page.waitForTimeout(2700);
    const bounds=await page.evaluate(()=>['.panel-left','.panel-right','.timeline','.map-tools','.scene-caption'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for(const r of bounds) assert.ok(r.x>=0 && r.y>=0 && r.right<=size.width && r.bottom<=size.height,JSON.stringify(r));
    assert.ok(bounds[0].bottom<bounds[2].y && bounds[1].bottom<bounds[2].y);
    await page.screenshot({path:fileURLToPath(new URL(`${size.width}-scene.png`,out))});
  }
  // Exercise all scenario/frame boundaries and repeat resets without creating new render resources.
  const before=await page.evaluate(()=>window.__app.renderer.info.memory.geometries);
  for(let n=0;n<3;n++)for(const id of ['design-50','design-5','replay-2309']){
    await page.evaluate(async id=>{await window.__app.setScenario(id);for(const i of [0,12,24,36,48])window.__app.setFrame(i);},id);
  }
  assert.equal(await page.evaluate(()=>window.__app.renderer.info.memory.geometries),before);
  await page.evaluate(()=>window.__app.resetDemo());
  assert.deepEqual(errors,[]);
  const unavailable = await browser.newPage();
  await unavailable.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type,...args) { return type === 'webgl2' ? null : getContext.call(this,type,...args); };
  });
  await unavailable.goto('http://127.0.0.1:8088');
  await unavailable.locator('#loader-retry').waitFor({state:'visible'});
  assert.match(await unavailable.locator('#loader-step').textContent(),/WebGL2/);
  await unavailable.close();
  const broken = await browser.newPage();
  await broken.route('**/data/meta.json',route=>route.fulfill({status:404,body:'missing'}));
  await broken.goto('http://127.0.0.1:8088');
  await broken.locator('#loader-retry').waitFor({state:'visible'});
  assert.match(await broken.locator('#loader-step').textContent(),/404/);
  await broken.close();
  console.log('PASS: initial render, peak, live detail, rapid switching, six layers, full reset, play/pause, timeline keyboard, both desktop sizes, repeated scenarios; no browser errors.');
} finally {await browser.close();}
