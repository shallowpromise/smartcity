import { b64ToU8, clamp } from './utils.js';

// Validate core spatial/time data before replacing the currently displayed scene.
export function validateScenario(scn, id, meta, sensors) {
  if (scn?.id !== id || !Array.isArray(scn.frames) || scn.frames.length < 2)
    throw new Error('情景标识或时间帧无效');
  if (!Number.isFinite(scn.duration) || scn.duration <= 0 || !Array.isArray(scn.rain) || !scn.rain.length || scn.rain.some(v => !Number.isFinite(v) || v < 0))
    throw new Error('情景时长或降雨过程无效');
  const size = meta.model.nx * meta.model.ny;
  for (const [i, f] of scn.frames.entries()) {
    if (!['t', 'rain', 'maxDepth', 'areaHa'].every(k => Number.isFinite(f[k]) && f[k] >= 0) ||
        (i && f.t <= scn.frames[i - 1].t) || b64ToU8(f.depth).length !== size)
      throw new Error(`第 ${i + 1} 帧时间、水深网格或统计字段无效`);
  }
  if (scn.frames[0].t !== 0 || scn.frames.at(-1).t !== scn.duration) throw new Error('时间轴与情景时长不一致');
  if (!Array.isArray(scn.sensors)) throw new Error('缺少点位序列');
  const ids = new Set();
  for (const ss of scn.sensors) {
    if (ids.has(ss.id) || !sensors.some(s => s.id === ss.id) || !Array.isArray(ss.series) ||
        ss.series.length !== scn.frames.length || ss.series.some(v => v !== null && (!Number.isFinite(v) || v < 0)))
      throw new Error(`点位 ${ss.id} 的标识或时间序列无效`);
    ids.add(ss.id);
  }
  return scn;
}

export function installTimeline(app, ui, fetchJSON) {
  let request = 0;
  let pending;
  const cache = new Map();
  app.loading = false;
  app.elapsed = 0;

  app.setFrame = function (i) {
    if (!app.scenario || app.loading || !Number.isFinite(i)) return;
    app.idx = clamp(Math.round(i), 0, app.scenario.frames.length - 1);
    app.elapsed = 0;
    const f = app.scenario.frames[app.idx];
    let depth = app._depthCache.get(app.idx);
    if (!depth) { depth = b64ToU8(f.depth); app._depthCache.set(app.idx, depth); }
    app.currentDepth = depth;
    if (app.layers.water) app.water.update(depth, performance.now() / 1000);
    else app.water.mesh.visible = false;
    app.frameSensors = app.sensors.map(s => ({ id: s.id, depth: app.scenario.sensors.find(ss => ss.id === s.id)?.series[app.idx] ?? null }));
    ui.renderFrame(app.scenario, app.idx);
    app.routeView?.frame();
  };

  app.togglePlay = function (force) {
    const play = force == null ? !app.playing : force;
    if (play && (app.loading || !app.scenario)) return;
    if (play && app.idx === app.scenario.frames.length - 1) app.setFrame(0);
    app.playing = play;
    app.elapsed = 0;
    ui.setPlaying(play);
  };
  app.setSpeed = s => { if ([1, 2, 4, 8].includes(s)) app.speed = s; };
  app.setScenario = async function (id, userAction = false) {
    if (!app.scenarios.some(s => s.id === id)) throw new Error('未知情景');
    const token = ++request;
    pending?.abort();
    pending = new AbortController();
    app.togglePlay(false);
    app.loading = true;
    ui.setLoading(true, `正在加载 ${app.scenarios.find(s => s.id === id).short}…`);
    try {
      const scn = cache.get(id) || validateScenario(await fetchJSON(`./data/scenarios/${id}.json`, { signal: pending.signal }), id, app.meta, app.sensors);
      if (token !== request) return false;
      cache.set(id, scn);
      app.scenario = scn;
      app._depthCache = new Map();
      app.loading = false;
      ui.setScenario(scn);
      app.setFrame(0);
      ui.setLoading(false);
      if (userAction) ui.toast(`已切换情景：${scn.name} · 点击播放开始推演`);
      return true;
    } catch (e) {
      if (token !== request) return false;
      app.loading = false;
      ui.setLoading(false, `加载失败：${e.message}。${app.scenario ? '保留上一情景，请重新选择重试。' : '请检查数据文件并刷新。'}`, true);
      if (!app.scenario) throw e;
      return false;
    }
  };
}
