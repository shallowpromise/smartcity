// Run from any directory: node system/tests/pages.mjs
// Verify a static server under the same subpath as GitHub project Pages.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../public/', import.meta.url));
const errors = [];
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (!url.pathname.startsWith('/smartcity/')) {res.writeHead(404).end();return;}
  const relative = decodeURIComponent(url.pathname.slice('/smartcity/'.length)) || 'index.html';
  const file = path.resolve(root,relative);
  if (!file.startsWith(root)) {res.writeHead(403).end();return;}
  try {
    const data = await readFile(file);
    const type = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css'}[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200,{'Content-Type':type});res.end(data);
  } catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:chromium.executablePath(),args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page = await browser.newPage({viewport:{width:1366,height:768}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',req=>errors.push(req.url()));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(`http://127.0.0.1:${server.address().port}/smartcity/`);
  await page.waitForFunction(()=>window.__app?.scenario && document.querySelector('#loader').style.display==='none',null,{timeout:60000});
  for(const id of ['design-50','design-5','replay-2309']) {
    assert.equal(await page.evaluate(id=>window.__app.setScenario(id),id),true);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: static /smartcity/ subpath, local Three.js, all three scenarios; no API server or failed requests.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
