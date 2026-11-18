import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const out=new URL('../test-results/',import.meta.url);
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath(),
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.env.BASE_URL || 'http://127.0.0.1:8090/';
try {
  const page=await browser.newPage({viewport:{width:1366,height:768}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('?view=routes',base).href,{timeout:60000});
  await page.getByText(/避开福华一路，多走 55 米/).waitFor({timeout:60000});
  assert.match(await page.locator('#route-base').innerText(),/49 cm/);
  assert.match(await page.locator('#route-alt').innerText(),/2 cm/);
  assert.equal(await page.locator('.peak-pin').innerText(),'积水 49 cm');
  await page.waitForFunction(()=>/url/.test(getComputedStyle(document.querySelector('.topbar')).backdropFilter));
  await mkdir(out,{recursive:true});
  await page.waitForTimeout(850);
  const panel=await page.locator('.route-panel').boundingBox();
  for(const pin of await page.locator('.route-pin').all()){
    const b=await pin.boundingBox();assert.ok(b.x>=panel.x+panel.width && b.x+b.width<=1366 && b.y>76 && b.y<657,JSON.stringify(b));
  }
  await page.screenshot({path:fileURLToPath(new URL('routes-desktop.png',out))});
  await page.locator('#route-scenario').selectOption('design-5');
  await page.getByText(/无需绕行/).waitFor();
  await page.locator('#route-to').selectOption(await page.locator('#route-from').inputValue());
  await page.getByText(/不同的路网节点/).waitFor();
  await page.locator('#route-example').click();
  await page.getByText(/避开福华一路，多走 55 米/).waitFor();
  await page.locator('[data-pick=to]').click();
  await page.locator('#pick-hint').waitFor(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pick-hint').isVisible(),false);
  await page.locator('[data-pick=to]').click();
  const point=await page.getByText('起',{exact:true}).boundingBox();
  await page.mouse.click(point.x+point.width/2,point.y+point.height/2);
  await page.waitForFunction(()=>document.querySelector('#pick-hint').hidden);
  await page.locator('#route-example').click();
  await page.getByText(/避开福华一路，多走 55 米/).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.waitForFunction(()=>window.__app.camera.position.y>2000 && window.__app.camera.view.fullWidth===390);
  await page.waitForTimeout(800);
  await page.screenshot({path:fileURLToPath(new URL('routes-mobile.png',out))});
  await page.locator('#route-locate').click();
  assert.equal(await page.locator('.route-panel').isVisible(),false);
  await page.getByRole('button',{name:'显示面板'}).click();
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-contrast',value:'more'}]});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.topbar')).backdropFilter==='none');
  await page.locator('[data-view=overview]').click();
  assert.equal(await page.locator('.route-panel').isVisible(),false);
  assert.deepEqual(errors,[]);
  console.log('PASS live route graph, road hotspot, pin framing, endpoint selection, mobile layout and accessible glass.');
} finally { await browser.close(); }
