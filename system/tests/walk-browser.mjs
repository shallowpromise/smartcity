import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const out = new URL('../test-results/',import.meta.url);
const base = process.env.BASE_URL || 'http://127.0.0.1:8090/';
const browser = await chromium.launch({headless:true,executablePath:chromium.executablePath(),
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const ctx = await browser.newContext({viewport:{width:1366,height:820},reducedMotion:'reduce',
    permissions:['geolocation'], geolocation:{longitude:114.09332308,latitude:22.55573000,accuracy:12}});
  const page = await ctx.newPage(), errors=[];
  const $ = id => page.locator('#walk-'+id);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if (r.status()>=400) errors.push(r.status()+' '+r.url());});
  const coordsInRequest=[];
  page.on('request',r=>{if (/114\.09332|22\.55573/.test(r.url()+' '+(r.postData()||''))) coordsInRequest.push(r.url());});
  await page.addInitScript(()=>{
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    window.geoCalls=0;
    navigator.geolocation.getCurrentPosition=(success,fail,options)=>{
      window.geoCalls++;
      if (window.holdLocation) {window.geoSuccess=success;window.geoError=fail;return;}
      original(success,fail,options);
    };
  });
  await page.goto(new URL('?view=rain-nav&start=demo',base).href,{timeout:90000});
  await $('result').waitFor({timeout:75000});
  assert.equal(await page.evaluate(()=>window.geoCalls),0);
  assert.match(await $('position').innerText(),/模拟起点/);
  assert.match(await $('clock').innerText(),/04:00/);
  assert.match(await $('compare').innerText(),/已绕行/);
  assert.ok(parseInt(await $('peak').innerText())<10);
  assert.match(await $('availability').innerText(),/待核实/);
  assert.ok(await $('steps').locator('li').count()>=2);
  const screenshot = async name=>{
    await page.locator('.rain-nav-panel').evaluate(el=>el.scrollTop=0);
    await page.waitForFunction(()=>document.querySelector('.walk-origin-pin')?.getBoundingClientRect().width>0);
    await page.waitForTimeout(350);
    await page.screenshot({path:fileURLToPath(new URL(name,out))});
  };
  await mkdir(out,{recursive:true});
  await screenshot('rain-navigation-desktop.png');
  await page.setViewportSize({width:390,height:844});
  await screenshot('rain-navigation-mobile.png');
  const size = await page.locator('.rain-nav-panel').evaluate(el=>{
    const rect=el.getBoundingClientRect(), tabs=[...document.querySelectorAll('.nav-item')].map(b=>b.getBoundingClientRect());
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,overflow:el.scrollWidth-el.clientWidth,
      timeline:document.querySelector('.timeline').getBoundingClientRect().top,
      nav:tabs.every(t=>t.width>0 && t.left>=0 && t.right<=innerWidth)};
  });
  assert.ok(size.left>=0 && size.right<=390 && size.overflow<2 && size.top>180 && size.bottom<=size.timeline && size.nav,JSON.stringify(size));
  await $('fit').click();
  assert.equal(await page.locator('.rain-nav-panel').isVisible(),false);
  await page.locator('#btn-focus').click();
  await page.setViewportSize({width:1366,height:820});

  await $('scenario').selectOption('design-5');
  await page.waitForFunction(()=>document.querySelector('#walk-clock').textContent.includes('5 年一遇') && window.__app.idx===0);
  await $('geo').click();
  await page.waitForFunction(()=>document.querySelector('#walk-position').textContent.includes('精度约 12 米'));
  assert.match(await $('position').innerText(),/114\.09332.+22\.55573/);
  assert.equal(await $('options').locator('option').count(),2);
  const option = await $('options').locator('option').nth(1).getAttribute('value');
  await $('options').selectOption(option);
  assert.match(await $('rank').innerText(),/第 2 近/);
  await $('limit').selectOption('5');
  await page.locator('#timeline').fill('12');
  assert.match(await $('clock').innerText(),/02:00/);
  if (await $('result').isVisible()) assert.ok(parseInt(await $('peak').innerText())<5);
  await ctx.setGeolocation({longitude:120,latitude:30,accuracy:25});
  await $('geo').click();
  await page.getByText(/当前位置在福田中心片区模型范围外/).waitFor();
  assert.match(await $('position').innerText(),/120\.00000/);
  assert.equal(await $('result').isVisible(),false);
  assert.equal(await page.locator('.walk-origin-pin,.walk-dest-pin').count(),0);
  await page.evaluate(()=>{window.holdLocation=true;});
  await $('geo').click();
  await page.evaluate(()=>window.geoError({code:1}));
  await page.getByText(/未获定位权限/).waitFor();
  await $('geo').click();
  await page.evaluate(()=>window.geoError({code:3}));
  await page.getByText(/定位超时/).waitFor();
  await $('geo').click();
  await $('demo').click();
  const simulated=await $('position').innerText();
  await page.evaluate(()=>window.geoSuccess({coords:{longitude:120,latitude:30,accuracy:1}}));
  assert.equal(await $('position').innerText(),simulated);
  await $('geo').click();
  await page.locator('.nav-item[data-view="routes"]').click();
  await page.evaluate(()=>window.geoError({code:1}));
  await page.locator('#route-shelter').click();
  assert.equal(await $('notice').isVisible(),false);
  assert.equal(await $('result').isVisible(),false);
  assert.equal(await $('geo').isEnabled(),true);
  await $('demo').click();
  await $('clear').click();
  assert.equal(await $('result').isVisible(),false);
  assert.equal(await page.locator('.walk-dest-pin,.walk-origin-pin').count(),0);
  await $('example').click();
  await page.waitForFunction(()=>document.querySelector('#walk-clock').textContent.includes('9·7 复盘 · T+04:00') && !document.querySelector('#walk-result').hidden);
  assert.match(await $('position').innerText(),/模拟起点/);
  assert.deepEqual(coordsInRequest,[]);
  assert.deepEqual(errors,[]);
  console.log('PASS indoor rain navigation, real browser geolocation, privacy, stale callbacks, flood detours, facility selection and mobile map.');
} finally { await browser.close(); }
