import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const out=new URL('../test-results/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.env.BASE_URL || 'http://127.0.0.1:8090/';
try {
  const page=await browser.newPage({viewport:{width:1366,height:800},reducedMotion:'reduce'});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
  const $=s=>page.locator(s);
  const section=async key=>{
    await $('[data-analysis="'+key+'"]').click();
    await $('[data-section="'+key+'"]').waitFor();
  };
  const upload=(selector,data)=>$(selector).setInputFiles({name:'local-test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.goto(new URL('?view=analysis&tab=rain',base).href,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#an-street option')?.value,null,{timeout:60000});
  assert.equal(await $('#an-street-map path').count(),10);
  assert.match(await $('#an-rain-status').innerText(),/无实时雨量/);
  await $('#an-rain-mode').selectOption('scenario');
  await page.evaluate(()=>window.__app.setFrame(21));
  assert.equal(await $('#an-rain-rows td').count(),12);
  assert.match(await $('#an-rain-status').innerText(),/情景雨量/);
  await $('details').filter({has:$('#street-file')}).locator('summary').click();
  await upload('#street-file',{schemaVersion:1,quantity:'accumulated_rain',unit:'mm',sourceName:'集成测试',streets:[
    {street:'福田街道',observedAt:'2023-09-07T22:00:00+08:00',rain30mMm:30,rain1hMm:45,rain3hMm:null}]});
  await page.waitForFunction(()=>document.querySelector('#street-message').textContent.includes('1 个'));
  assert.match(await $('#an-rain-rows').innerText(),/已达 · \+0/);
  assert.equal(await $('#an-rain-rows [data-hit=true]').count(),2);
  await $('#street-clear').click();
  await $('#an-play').click();assert.equal(await $('#an-play').getAttribute('aria-pressed'),'true');await $('#an-play').click();

  await section('sites');
  assert.match(await $('#site-count').innerText(),/125 条符合筛选/);
  const facilities=await page.evaluate(async()=>{const r=await fetch('./data/official/catalog.json');return (await r.json()).facilities;});
  const f=facilities.find(x=>x.kind==='indoor'&&x.roadNode&&x.cell!=null);
  await $('#site-kind').selectOption('indoor');await $('#site-search').fill(f.name);
  await $('#site-select').selectOption(f.id);
  assert.match(await $('#site-info').innerText(),/待属地确认/);
  await $('#site-route').click();
  await $('#route-transfer').waitFor();
  assert.ok((await $('#route-transfer').innerText()).includes(f.name));
  await $('#route-choice').selectOption('low');assert.match(await $('#route-alt-label').innerText(),/低水深优先/);
  await $('button[data-view=analysis]').click();await section('sites');await $('#site-search').fill('');
  await $('#site-kind').selectOption('outdoor');await $('#site-capacity').selectOption('500');
  assert.match(await $('#site-count').innerText(),/0 条符合筛选/);
  await $('#site-capacity').selectOption('');await $('#site-kind').selectOption('metro');
  assert.match(await $('#site-count').innerText(),/241 条符合筛选/);
  await $('#site-kind').selectOption('indoor');
  const outside=facilities.find(x=>x.kind==='indoor'&&x.xy&&!x.inDomain);
  await $('#site-select').selectOption(outside.id);await $('#site-fly').click();
  assert.equal(await $('#site-area').evaluate(d=>d.open),true);
  assert.equal(await $('#site-area-map circle[data-active] title').textContent(),outside.name);
  const missing=facilities.find(x=>x.kind==='indoor'&&!x.xy);
  await $('#site-select').selectOption(missing.id);
  assert.equal(await $('#site-fly').isDisabled(),true);assert.equal(await $('#site-route').isDisabled(),true);

  await section('compare');await page.evaluate(()=>window.__app.setFrame(24));
  await $('#an-variant').selectOption('stage40');
  await page.waitForFunction(()=>document.querySelector('#variant-caption').textContent==='南侧极端水位');
  assert.equal(await $('#variant-stats tr').count(),4);
  assert.equal(await $('#base-field').evaluate(v=>v.width),192);
  const stamp=await $('#an-clock').innerText();assert.ok(stamp.includes('04:00'));
  await $('.analysis-panel').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:fileURLToPath(new URL('analysis-desktop.png',out))});
  await $('#an-variant').selectOption('idf5');
  await page.waitForFunction(()=>document.querySelector('#variant-caption').textContent.includes('5 年') && window.__app.scenario.id==='design-5');
  assert.ok((await $('#an-clock').innerText()).includes('04:00'));

  await section('verify');
  assert.match(await $('#verify-summary').innerText(),/设计降雨工况/);
  await $('#an-scenario').selectOption('replay-2309');
  await page.waitForFunction(()=>document.querySelector('#verify-summary').textContent.includes('未验证'));
  const sample={schemaVersion:1,quantity:'surface_depth',unit:'cm',crs:'WGS84',sourceName:'集成测试',stations:[
    {id:'local-station',name:'本次导入站点',longitude:f.xy[0],latitude:f.xy[1],records:[
      {time:'2023-09-07T18:00:00+08:00',value:12},{time:'2023-09-07T18:10:00+08:00',value:35},{time:'2023-09-07T18:20:00+08:00',value:null}]}]};
  await upload('#verify-file',sample);
  await page.waitForFunction(()=>document.querySelector('#verify-summary').textContent.includes('样本 2 对'));
  assert.ok((await $('#verify-coverage').innerText()).includes('集成测试'));
  await $('#verify-fly').click();await $('.asset-pin.observed').waitFor({state:'attached'});await $('.asset-pin.model-cell').waitFor({state:'attached'});
  await $('#verify-clear').click();assert.match(await $('#verify-summary').innerText(),/未验证/);
  await section('sources');assert.equal(await $('#an-sources a').count(),6);assert.equal(await $('#an-pending a').count(),5);

  await page.setViewportSize({width:390,height:844});await section('rain');
  await $('.analysis-panel').evaluate(el=>el.scrollTop=0);
  const dimensions=await page.evaluate(()=>{
    const p=document.querySelector('.analysis-panel'),r=p.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,topbar:document.querySelector('.topbar').getBoundingClientRect().bottom,
      timeline:document.querySelector('.timeline').getBoundingClientRect().top,overflow:p.scrollWidth-p.clientWidth};
  });
  assert.ok(dimensions.left>=0&&dimensions.right<=390&&dimensions.top>=dimensions.topbar&&dimensions.bottom<=dimensions.timeline&&dimensions.overflow<=1,JSON.stringify(dimensions));
  await page.screenshot({path:fileURLToPath(new URL('analysis-mobile.png',out))});
  await $('button[data-view=overview]').click();await $('#depth-details summary').click();
  assert.match(await $('[data-runoff-cn="58"] output').innerText(),/16.2 mm/);
  const idx=await page.evaluate(()=>window.__app.idx);
  await $('#runoff-rain').selectOption('200');
  assert.equal(await page.evaluate(()=>window.__app.idx),idx);
  assert.deepEqual(errors,[]);
  console.log('PASS street observations, 125 shelters, 241 entrances, routing handoff, paired depth fields, observation matching, sources, runoff and mobile layout.');
} finally {await browser.close();}
