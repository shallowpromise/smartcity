import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = new URL('../test-results/', import.meta.url);
const browser = await chromium.launch({headless:true, executablePath:chromium.executablePath(),
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport:{width:1366, height:768}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8090/');
  await page.waitForFunction(() => window.__app?.scenario && document.querySelector('#loader').style.display === 'none', null, {timeout:60000});
  const nav = page.getByRole('button', {name:'积水绕行', exact:true});
  // A missing optional dataset can be retried without reloading the city.
  const asset = '**/route-candidates.json';
  await page.route(asset, route => route.fulfill({status:503, body:'Unavailable'}));
  await nav.click();
  await page.getByText(/路线资料不可用/).waitFor();
  await page.unroute(asset);
  await nav.click();
  await page.getByText(/无需绕行/).waitFor();
  await page.locator('#route-example').click();
  assert.match(await page.locator('#route-time').innerText(), /T\+04:00/);
  assert.match(await page.locator('#route-base').innerText(), /47 cm/);
  assert.match(await page.locator('#route-alt').innerText(), /5 cm/);
  assert.match(await page.locator('#route-result').innerText(), /270 米/);
  await mkdir(out, {recursive:true});
  await page.locator('.route-pin').first().waitFor();
  await page.waitForTimeout(1100);
  await page.screenshot({path:fileURLToPath(new URL('routes-desktop.png',out))});
  await page.locator('#route-case').selectOption('1');
  await page.locator('#timeline').fill('36');
  await page.getByText('无符合条件的候选线', {exact:true}).waitFor();
  await page.locator('#route-limit').selectOption('30');
  await page.locator('[data-id="design-5"]').click();
  await page.waitForFunction(() => document.querySelector('#route-time').textContent.includes('T+00:00'));
  assert.match(await page.locator('#route-time').innerText(), /5 年一遇/);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#route-example').click();
  await page.getByText(/绕行增加 270 米/).waitFor();
  await page.locator('#route-locate').click();
  assert.equal(await page.locator('.route-panel').isVisible(), false);
  await page.getByRole('button', {name:'显示面板'}).click();
  assert.equal(await page.locator('.route-panel').isVisible(), true);
  await page.locator('[data-view="overview"]').click();
  assert.equal(await page.locator('.route-panel').isVisible(), false);
  await page.waitForFunction(() => ![...document.querySelectorAll('.route-pin')].some(el => el.getClientRects().length));
  assert.deepEqual(errors, []);
  console.log('PASS route data retry, replay, detour, blocked case, scenario changes, phone navigation and map focus.');
} finally { await browser.close(); }
