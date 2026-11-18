import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createScene, flyCamera } from './scene.js';
import { buildTerrain, buildBuildings, buildVectors, buildTrees, buildLabels } from './city.js';
import { createWater } from './water.js';
import { createRain } from './rain.js';
import { createSensors } from './markers.js';
import { ui } from './ui.js';
import { mountGlass } from './glass.js';
import { createRouteView } from './routes.js';
import { createRainNavigation } from './rain-navigation.js';
import { createAnalysis } from './analysis-view.js';
import { mountRunoff } from './runoff-card.js';
import { installTimeline } from './timeline.js';

const app = {
  meta: null, sensors: [], scenario: null, idx: 0, playing: false, speed: 1,
  currentDepth: null, layers: { water: true, buildings: true, roads: true, sensors: true, rain: true, labels: true },
  selectedId: null,
};

const loaderBar = document.getElementById('loader-bar');
const loaderStep = document.getElementById('loader-step');
function progress(p, text) {
  loaderBar.style.width = `${p}%`;
  if (text) loaderStep.textContent = text;
}

const fetchJSON = (u, options = {}) => fetch(u, { cache: 'no-cache', ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) }).then((r) => {
  if (!r.ok) throw new Error(`${u} ${r.status}`);
  return r.json();
});

async function boot() {
  try {
    if (!document.createElement('canvas').getContext('webgl2')) throw new Error('此浏览器无法使用 WebGL2，请启用硬件加速后刷新，或使用支持 WebGL2 的浏览器');
    progress(6, '加载空间元数据…');
    const meta = await fetchJSON('./data/meta.json');
    app.meta = meta;

    progress(12, '加载数字高程模型与地表覆盖…');
    const terrainData = await fetchJSON('./data/terrain.json');
    progress(28, '加载 3,800+ 建筑体块与路网…');
    const [buildings, vectors, sensors, scenarios] = await Promise.all([
      fetchJSON('./data/buildings.json'),
      fetchJSON('./data/vectors.json'),
      fetchJSON('./data/sensors.json'),
      fetchJSON('./data/scenarios/index.json'),
    ]);
    app.sensors = sensors;
    if (!scenarios.length) throw new Error('情景目录为空');
    app.scenarios = scenarios;

    progress(42, '初始化三维渲染引擎…');
    const { renderer, scene, camera, controls, composer } = createScene(document.getElementById('scene-wrap'));
    window.__camera = camera;
    app.renderer = renderer; app.scene = scene; app.camera = camera; app.controls = controls;

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(innerWidth, innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    document.getElementById('labels').appendChild(labelRenderer.domElement);
    app.labelRenderer = labelRenderer;
    addEventListener('resize', () => labelRenderer.setSize(innerWidth, innerHeight));
    renderer.domElement.addEventListener('webglcontextlost', e => {
      e.preventDefault(); app.togglePlay(false); app.contextLost = true;
      document.getElementById('loader').style.display = 'grid';
      document.getElementById('loader').classList.remove('done');
      loaderStep.textContent = '三维渲染已中断，请刷新页面重新加载。';
      document.getElementById('loader-retry').hidden = false;
    });

    progress(52, '构建地形与城市基底…');
    const terrain = buildTerrain(terrainData, meta);
    terrain.userData.nx = terrainData.nx;
    terrain.userData.ny = terrainData.ny;
    terrain.userData.w = terrainData.w;
    terrain.userData.h = terrainData.h;
    scene.add(terrain);
    app.terrain = terrain;
    const sampleElev = terrain.userData.sampleElev;
    app.sampleElev = sampleElev;

    progress(64, '构建建筑体块与日间立面…');
    const buildingsMesh = buildBuildings(buildings, meta, sampleElev);
    scene.add(buildingsMesh);
    app.buildings = buildingsMesh;

    progress(72, '铺设道路、水系与绿地…');
    const vectorsGroup = buildVectors(vectors, meta, sampleElev);
    scene.add(vectorsGroup);
    app.vectors = vectorsGroup;
    const trees = buildTrees(terrain, 950);
    scene.add(trees);
    app.trees = trees;

    const labels = buildLabels(meta, { p: buildings.p, n: buildings.n, h: buildings.h, b: buildings.b, roads: vectors.roads }, sampleElev);
    scene.add(labels);
    app.labels = labels;

    progress(80, '生成积水水面与雨幕…');
    const water = createWater(terrain, meta);
    scene.add(water.mesh);
    app.water = water;
    const rain = createRain(scene);
    app.rain = rain;

    progress(88, '加载虚拟监测点…');
    const sensorView = createSensors(sensors, meta, sampleElev, (s) => {
      if (!app.loading) ui.openSensor(s);
    });
    scene.add(sensorView.group);
    app.sensorView = sensorView;

    progress(94, '装载暴雨情景与预警规则…');
    app.routeView = createRouteView(app,fetchJSON);
    app.rainNav = createRainNavigation(app,fetchJSON);
    app.analysis = createAnalysis(app,fetchJSON,view=>ui.setView(view));
    mountRunoff();
    ui.init(app);
    ui.setScenarios(scenarios);
    await app.setScenario(scenarios[0].id, false);

    camera.position.set(1250, 1030, 1580);
    controls.target.set(-260, 20, 60);
    controls.update();

    mountGlass();
    progress(100, '数字孪生底座就绪');
    setTimeout(() => {
      document.getElementById('loader').classList.add('done');
      setTimeout(() => {
        document.getElementById('loader').style.display = 'none';
        app.togglePlay(false);
        const params = new URLSearchParams(location.search);
        if (params.get('view') === 'analysis') {
          ui.setView('analysis',params.get('tab'));
        } else if (params.get('view') === 'rain-nav') {
          ui.setView('rain-nav',params.get('start'));
        } else if (params.get('view') === 'routes') {
          ui.setView('routes').then(() => app.routeView.showExample());
        }
      }, 700);
    }, 450);

    let last = performance.now();

    const clock = { t: 0 };
    function loop(now) {
      if (app.contextLost) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      clock.t += dt;
      controls.update();
      if (app.playing) {
        app.elapsed += dt * app.speed;
        if (app.elapsed >= 1.25) {
          app.elapsed = 0;
          const max = app.scenario.frames.length - 1;
          if (app.idx >= max) {
            app.togglePlay(false);
            ui.toast('情景推演结束 · 可拖动时间轴回看峰值过程');
          } else {
            app.setFrame(app.idx + 1);
          }
        }
      }
      // 水面和雨幕随时间演化。
      if (app.water?.mesh.visible) app.water.mesh.material.uniforms.uTime.value = clock.t;
      const rainRate = app.scenario ? app.scenario.frames[app.idx].rain : 0;
      const rainStrength = app.rain.update(dt, rainRate, app.layers.rain);
      app.water.mesh.material.uniforms.uRain.value = rainStrength;
      if (app.sensorView) app.sensorView.update(app.frameSensors || [], app.selectedId, clock.t);
      updateCompass();
      app.labelRenderer.render(scene, camera);
      composer.render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    loaderStep.textContent = `加载失败：${e.message}。请检查网络后重新加载；若使用本地文件，请通过 node server.mjs 启动。`;
    document.getElementById('loader-retry').hidden = false;
    loaderBar.style.background = '#ff4d5e';
  }
}

function updateCompass() {
  const n = document.getElementById('compass-needle');
  const alt = document.getElementById('cam-alt');
  if (!n || !app.camera) return;
  const dx = app.camera.position.x - app.controls.target.x;
  const dz = app.camera.position.z - app.controls.target.z;
  const ang = Math.atan2(dx, dz);
  n.style.transform = `rotate(${ang}rad)`;
  if (alt) alt.textContent = `H ${Math.round(app.camera.position.y)}m`;
}

installTimeline(app, ui, fetchJSON);

app.resetDemo = async function () {
  if (!await app.setScenario(app.scenarios[0].id)) return;
  app.setSpeed(1); ui.speed = 1; ui.dom.speed.textContent = '1×';
  ui.closeModal(); app.selectedId = null;
  for (const key of Object.keys(app.layers)) app.toggleLayer(key, true);
  document.querySelectorAll('[data-layer]').forEach(b => { b.classList.add('active'); b.setAttribute('aria-pressed', 'true'); });
  app.routeView.reset();
  app.rainNav.reset();
  ui.setView('overview');
  document.querySelectorAll('.panel').forEach(p => p.scrollTop = 0);
  app.flyPreset('initial');
  ui.toast('已重置推演至 9·7 复盘 / T+00:00 / 暂停 / 1×');
};

app.selectSensor = function (id) { app.selectedId = id; };

app.flySensor = function (id) {
  const w = app.sensorView.getWorld(id);
  if (!w) return;
  const [x, y, z] = w;
  flyCamera(app.camera, app.controls, [x + 620, y + 520, z + 820], [x, y + 20, z], 1500);
};

app.flyPreset = function (key) {
  const c = app.camera, ctr = app.controls;
  if (key === 'initial') flyCamera(c, ctr, [1250, 1030, 1580], [-260, 20, 60], 900);
  if (key === 'overview') flyCamera(c, ctr, [0, 1380, 1900], [0, 0, 0], 1500);
  if (key === 'cbd') flyCamera(c, ctr, [-1450, 430, 2620], [-2056, 300, 1840], 1500);
  if (key === 'hqb') flyCamera(c, ctr, [1520, 440, 1480], [1133, 120, 843], 1500);
  if (key === 'lhs') flyCamera(c, ctr, [-1200, 520, 520], [-1542, 100, -487], 1500);
  if (key === 'hotspot') {
    const s = app.sensors.find((x) => x.id === app.selectedId) ||
      [...app.sensors].sort((a, b) => {
        const da = (app.scenario.sensors.find((x) => x.id === a.id)?.series[app.idx] ?? -1);
        const db = (app.scenario.sensors.find((x) => x.id === b.id)?.series[app.idx] ?? -1);
        return db - da;
      })[0];
    app.flySensor(s.id);
  }
};

app.toggleLayer = function (key, on) {
  app.layers[key] = on;
  if (key === 'water') {
    if (on && app.currentDepth) app.water.update(app.currentDepth, performance.now() / 1000);
    else app.water.mesh.visible = false;
  }
  if (key === 'buildings') app.buildings.visible = on;
  if (key === 'roads') {
    const r = app.vectors.getObjectByName('roads');
    if (r) r.visible = on;

  }
  if (key === 'sensors') app.sensorView.group.visible = on;
  if (key === 'rain') app.rain.setVisible(on);
  if (key === 'labels') {
    app.labels.visible = on;
    document.body.classList.toggle('hide-labels', !on);
  }
};

document.getElementById('loader-retry').onclick = () => location.reload();
boot();
window.__app = app;
