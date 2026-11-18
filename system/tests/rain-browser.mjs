import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: chromium.executablePath(),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8090');
  await page.waitForFunction(() => window.__app?.scenario && document.querySelector('#loader').style.display === 'none', null, { timeout: 60000 });
  await page.locator('#timeline').fill('21');
  await page.locator('#depth-details summary').click();
  assert.match(await page.locator('#wet-median').innerText(), /9 cm/);
  assert.match(await page.locator('#wet-count').innerText(), /26,112 格中，1,861 格达到 5 cm，4 格达到 50 cm/);

  // Hold the camera, water and seed positions fixed. Only the rendered rain layer changes.
  const sample = await page.evaluate(() => {
    const { renderer, scene, camera, rain } = window.__app;
    const gl = renderer.getContext();
    function pixels(rate) {
      rain.update(0, rate, true);
      renderer.render(scene, camera);
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return data;
    }
    const dry = pixels(0);
    const zeroHidden = !rain.lines.visible;
    const wet = pixels(31.2);
    const moderate = rain.lines.geometry.instanceCount;
    rain.update(0, 80, true);
    let darker = 0;
    for (let i = 0; i < dry.length; i += 4) {
      if (dry[i] - wet[i] >= 24) darker++;
    }
    return { zeroHidden, moderate, heavy: rain.lines.geometry.instanceCount, darker };
  });
  assert.ok(sample.zeroHidden && sample.heavy > sample.moderate, JSON.stringify(sample));
  assert.ok(sample.darker > 800, JSON.stringify(sample));
  await page.locator('[data-layer="rain"]').click();
  await page.waitForFunction(() => !window.__app.rain.lines.visible && window.__app.water.mesh.material.uniforms.uRain.value === 0);
  assert.equal(await page.evaluate(() => window.__app.water.mesh.visible), true);
  await page.locator('[data-layer="rain"]').click();
  await page.waitForFunction(() => window.__app.rain.lines.visible && window.__app.water.mesh.material.uniforms.uRain.value > 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => window.__app.water.mesh.material.uniforms.uRain.value === 0);
  assert.deepEqual(errors, []);
  console.log('PASS: visible rain on the same map frame, layer switch, reduced motion and published grid statistics.', sample);
} finally {
  await browser.close();
}
