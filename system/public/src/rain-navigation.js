import { createRouteMap } from './route-map.js';
import { floodedSections } from './road-router.js';
import { prepareWalking, locateWalker, demoPosition, walkingBaseline, planWalk, randomDemoNode, walkingSteps } from './walk-routing.js';
import { fmtT } from './utils.js';

const $ = id => document.getElementById('walk-' + id);
const distance = m => Math.round(m).toLocaleString('zh-CN') + ' 米';
const depthLabel = cm => cm === 255 ? '≥255 cm' : cm + ' cm';
const initialMessage = '选择起点后，地图会标出位置并查找附近的室内避难场所。';
const problems = {
  outside: '当前位置在福田中心片区模型范围外。可用随机模拟位置体验。',
  off_network: '位置周围 120 米内没有可匹配的地面步道。可重新定位或选择模拟位置。',
  unmodeled_ground: '定位点所在网格缺少地面积水数据，无法确认如何接入步道。可在附近地面重新定位或选择模拟位置。',
  disconnected: '与起点相连的步道无法到达已匹配的室内场所。',
  origin_flooded: '起点或接入步道已达到所选模型水深，当前无法规划步行路线。',
  unknown: '起点附近缺少可用水深资料，当前无法评估路线。',
  no_safe_route: '当前时刻没有符合所选水深条件的可达室内场所。',
};

export function createRainNavigation(app, fetchJSON) {
  const overlay = createRouteMap(app);
  const panel = document.querySelector('.rain-nav-panel');
  const usualMaxDistance = app.controls.maxDistance;
  let active = false, visit = 0, locationRequest = 0, locating = false;
  let model, pending, origin, baseline, plan, selected, preferredId;
  const threshold = () => Number($('limit').value);
  $('scenario').replaceChildren(...app.scenarios.map(s => new Option(s.short, s.id)));

  function notice(message = '') {
    $('notice').textContent = message;
    $('notice').hidden = !message;
  }

  function updateControls() {
    $('geo').disabled = !model || locating;
    $('demo').disabled = $('limit').disabled = $('scenario').disabled = !model;
    $('example').disabled = !model;
    $('clear').hidden = !origin && !locating;
    panel.setAttribute('aria-busy', String(locating || Boolean(!model && pending)));
  }

  function clearResult() {
    selected = null;
    $('result').hidden = true;
    $('options').replaceChildren();
    $('steps').replaceChildren();
    overlay.clearLines();
  }

  function reset() {
    locationRequest++;
    locating = false;
    origin = baseline = plan = preferredId = null;
    clearResult();
    notice();
    $('position').textContent = initialMessage;
    $('example').hidden = false;
    updateControls();
  }

  function locate() {
    if (!active || !origin?.point) return false;
    const points = [origin.point];
    if (selected) points.push(...selected.path.points, ...selected.baseline.points, selected.site.point);
    overlay.fit(points, panel);
    return true;
  }

  function markOrigin() {
    if (origin?.point) overlay.pin(origin.point, origin.kind === 'demo' ? '模拟起点' : '我的位置', false, 'walk-origin-pin');
  }

  function listSteps(row) {
    const legs = walkingSteps(model.net, row.path);
    const instructions = legs.map(l => '沿' + l.name + '向' + l.direction + '步行约 ' + distance(l.lengthM));
    if (origin.offset > 1) instructions.unshift('起点距步道约 ' + distance(origin.offset) + '，请现场确认接入位置。');
    instructions.push('到达场所附近步道，距' + row.site.name + '参考点约 ' + distance(row.access.offset) + '。请确认入口与开放情况。');
    $('steps').replaceChildren(...instructions.map(t => {
      const item = document.createElement('li');
      item.textContent = t;
      return item;
    }));
  }

  function present(row) {
    selected = row;
    const rank = plan.ranked.indexOf(row) + 1, limit = threshold();
    $('result').hidden = false;
    $('rank').textContent = rank === 1 ? '最近可达室内场所' : '可达室内场所 · 第 ' + rank + ' 近';
    $('availability').textContent = row.site.availability === 'needs_verification' ? '开放待核实' : '已标记开放';
    $('name').textContent = row.site.name;
    $('address').textContent = row.site.address || '地址待补充';
    $('distance').textContent = distance(row.path.lengthM);
    $('peak').textContent = depthLabel(row.peak);
    $('access').textContent = '估计全程 ' + distance(row.estimatedM) + '，含起点至步道约 ' + distance(origin.offset) +
      '、步道至场所参考点约 ' + distance(row.access.offset) + '。两端接驳及入口以现场为准。';
    $('options').value = row.site.id;
    $('count').textContent = '可达场所（' + plan.ranked.length + '）';
    const changed = row.baseline.edges.length !== row.path.edges.length || row.baseline.edges.some((e, i) => row.path.edges[i] !== e);
    const flooded = changed ? floodedSections(model.net, row.baseline, app.currentDepth, limit) : null;
    let explanation;
    if (!row.path.edges.length) explanation = '起点已在场所附近的接驳步道上。';
    else if (changed) {
      const reason = Number.isFinite(row.basePeak) ? '常规步道最高 ' + depthLabel(row.basePeak) : '常规步道含水深缺测段';
      explanation = reason + '，已绕行。比到同一场所的常规路线多约 ' +
        distance(Math.max(0, row.estimatedM - row.baselineEstimatedM)) + '。';
    } else explanation = '常规最短步道全程低于 ' + depthLabel(limit) + '，模型保留原路。';
    if (rank === 1 && plan.ordinary.site.id !== row.site.id) {
      const nearest = plan.ordinary.site;
      const other = plan.ranked.find(r => r.site.id === nearest.id);
      explanation += ' 常规距离最近的' + nearest.name + (other ? '绕行后估计需走 ' + distance(other.estimatedM) + '。' : '目前没有符合水深条件的路线。');
    }
    $('compare').textContent = explanation;
    $('key').querySelector('span').hidden = !changed;
    listSteps(row);
    overlay.clearLines();
    if (changed) overlay.line(row.baseline.points, 0xb26c14, true, 4, 10);
    if (row.path.edges.length) overlay.line(row.path.points, 0x00766d, false, 4, 12);
    for (const span of flooded?.flooded || []) overlay.line(span, 0xc02d45, false, 5.5, 13);
    if (flooded?.hotspot) overlay.pin(flooded.hotspot.point, depthLabel(flooded.hotspot.cm), true, 'walk-wet-pin');
    const start = row.path.points[0], end = row.path.points.at(-1);
    if (origin.offset > 5) overlay.pin(start, '', false, 'walk-road-dot');
    if (row.access.offset > 5) overlay.pin(row.site.point, '', false, 'walk-site-dot', row.site.name + '参考点');
    if (Math.hypot(origin.point[0]-end[0], origin.point[1]-end[1]) < 10) {
      overlay.pin(origin.point, (origin.kind === 'demo' ? '模拟起点' : '我的位置') + ' · 接驳点', false, 'walk-dest-pin');
    } else {
      markOrigin();
      overlay.pin(end, '避雨接驳点', false, 'walk-dest-pin', row.site.name);
    }
  }

  function frame() {
    if (!active || !app.scenario) return;
    $('clock').textContent = app.scenario.short + ' · ' + fmtT(app.scenario.frames[app.idx].t);
    $('scenario').value = app.scenario.id;
    $('example').hidden = Boolean(origin && (origin.kind !== 'demo' || app.scenario.frames[app.idx].t > 0));
    if (!model || !origin) return;
    const lastSite = selected?.site.id;
    plan = planWalk(model, origin, baseline, app.currentDepth, threshold());
    if (plan.status !== 'ready') {
      clearResult();
      markOrigin();
      if (lastSite) locate();
      notice(problems[plan.status]);
      return;
    }
    const row = plan.ranked.find(r => r.site.id === preferredId) || plan.ranked[0];
    if (preferredId !== row.site.id) preferredId = null;
    notice();
    $('options').replaceChildren(...plan.ranked.map((r, i) => new Option((i+1) + '. ' + r.site.name + ' · 约 ' + distance(r.estimatedM), r.site.id)));
    present(row);
    if (lastSite !== row.site.id) locate();
  }

  function setOrigin(position, kind, accuracy) {
    locating = false;
    origin = {...position, kind};
    preferredId = null;
    baseline = origin.status === 'ready' ? walkingBaseline(model, origin) : null;
    const [lon, lat] = origin.coordinates;
    const precision = Number.isFinite(accuracy) ? ' · 精度约 ' + distance(accuracy) : '';
    $('position').textContent = (kind === 'demo' ? '模拟起点' : '我的位置') + ' · 经 ' +
      lon.toFixed(5) + '°，纬 ' + lat.toFixed(5) + '°' + precision;
    updateControls();
    frame();
    locate();
  }

  function demo() {
    if (!active || !model || app.loading) return;
    const previous = origin?.node;
    reset();
    const node = randomDemoNode(model, app.currentDepth, threshold(), previous);
    if (node == null) { notice('当前情景下找不到可达场所的模拟起点。可切换时刻后再试。'); return; }
    setOrigin(demoPosition(model, node), 'demo');
  }

  function locateDevice() {
    reset();
    app.camera.clearViewOffset();
    app.flyPreset('overview');
    if (!window.isSecureContext || !navigator.geolocation) {
      notice('当前浏览器无法提供定位。请在 HTTPS 页面授权定位，或使用随机模拟位置。');
      return;
    }
    const request = locationRequest;
    locating = true;
    updateControls();
    notice('正在获取设备位置，请在浏览器中允许定位…');
    const failed = error => {
      if (!active || request !== locationRequest) return;
      locating = false;
      updateControls();
      notice(({1:'未获定位权限。请在浏览器中允许位置访问，或使用随机模拟位置。',
        3:'定位超时，可再次定位或使用随机模拟位置。'})[error?.code] || '暂时无法获取设备位置，可重试或选择模拟位置。');
    };
    try {
      navigator.geolocation.getCurrentPosition(({coords}) => {
        if (!active || request !== locationRequest) return;
        if (!Number.isFinite(coords?.longitude) || !Number.isFinite(coords?.latitude)) { failed(); return; }
        setOrigin(locateWalker(model, [coords.longitude, coords.latitude]), 'device', coords.accuracy);
      }, failed, {enableHighAccuracy:true, timeout:10000, maximumAge:0});
    } catch { failed(); }
  }

  async function showExample() {
    const token = visit, request = locationRequest;
    if (app.scenario.id !== 'replay-2309' && !await app.setScenario('replay-2309', true)) return;
    if (!active || token !== visit || request !== locationRequest || app.loading) return;
    const moment = app.scenario.frames.findIndex(f => f.t === 240);
    if (moment < 0) return;
    app.togglePlay(false);
    app.setFrame(moment);
    demo();
  }

  async function show(on, startDemo = false) {
    const token = ++visit;
    if (!on) {
      if (active) {
        locationRequest++;
        if (locating) reset();
        overlay.clearLines();
        app.camera.clearViewOffset();
        app.controls.maxDistance = usualMaxDistance;
      }
      active = overlay.group.visible = false;
      return;
    }
    active = overlay.group.visible = true;
    app.controls.maxDistance = 24000;
    $('retry').hidden = true;
    if (!origin && !locating) notice();
    frame();
    if (!model) {
      notice('正在载入福田步行路网与室内避难场所…');
      pending ??= Promise.all([fetchJSON('./data/walk-network.json'), fetchJSON('./data/official/catalog.json')])
        .then(([graph, catalog]) => prepareWalking(graph, catalog, app.meta))
        .finally(() => { pending = null; });
      updateControls();
      try { model = await pending; }
      catch {
        if (active && token === visit) { updateControls(); notice('步行路网或场所数据载入失败，请重试。'); $('retry').hidden = false; }
        return;
      }
      if (!active || token !== visit) return;
      notice();
    }
    updateControls();
    if (startDemo) await showExample();
    else if (origin) locate();
  }

  $('demo').onclick = demo;
  $('geo').onclick = locateDevice;
  $('example').onclick = showExample;
  $('clear').onclick = () => { reset(); app.camera.clearViewOffset(); app.flyPreset('overview'); };
  $('retry').onclick = () => show(true);
  $('options').onchange = () => {
    const row = plan?.ranked.find(r => r.site.id === $('options').value);
    if (!row) return;
    preferredId = row === plan.ranked[0] ? null : row.site.id;
    present(row);
    locate();
  };
  $('scenario').onchange = async () => {
    const token = visit;
    const changed = await app.setScenario($('scenario').value, true);
    if (active && visit === token && !changed) {
      $('scenario').value = app.scenario.id;
      notice('情景切换未完成，当前路线仍采用' + app.scenario.short + '。');
    }
  };
  $('limit').onchange = () => { frame(); locate(); };
  $('fit').onclick = () => {
    if (innerWidth <= 700 && !document.body.classList.contains('map-focused')) document.getElementById('btn-focus').click();
    else locate();
  };
  addEventListener('resize', locate);
  return {show, frame, locate, reset};
}
