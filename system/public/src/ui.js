import { levelOf, riskThresholds, levelColor, fmtClock, fmtT, num, clamp } from './utils.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const TYPE = { road: '道路', underpass: '下穿通道', community: '社区', river: '河道' };
const SPEEDS = [1, 2, 4, 8];

function setupCanvas(canvas, h) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  const hh = h || canvas.clientHeight || 80;
  canvas.width = Math.max(1, w * dpr);
  canvas.height = Math.max(1, hh * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h: hh };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRain(canvas, rain, curMin, totalMin) {
  const { ctx, w, h } = setupCanvas(canvas, canvas.clientHeight || 78);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(10, ...rain);
  const n = rain.length;
  const bw = w / n;
  const padB = 12;
  const usable = h - padB - 4;
  for (let i = 0; i < n; i++) {
    const v = rain[i];
    if (v <= 0.2) continue;
    const bh = Math.max(1, (v / max) * usable);
    const x = i * bw;
    const t = v / max;
    const g = ctx.createLinearGradient(0, h - padB - bh, 0, h - padB);
    g.addColorStop(0, t > 0.55 ? 'rgba(126,230,255,.95)' : 'rgba(77,163,255,.75)');
    g.addColorStop(1, 'rgba(77,163,255,.10)');
    ctx.fillStyle = g;
    ctx.fillRect(x, h - padB - bh, Math.max(0.6, bw * 0.7), bh);
  }
  // 强度包络
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = i * bw + bw / 2;
    const y = h - padB - (rain[i] / max) * usable;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.strokeStyle = 'rgba(142,230,255,.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // 当前时刻
  if (curMin != null && totalMin) {
    const x = (curMin / totalMin) * w;
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 2); ctx.lineTo(x, h - padB + 2); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x, 2, 2.2, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(120,170,210,.18)';
  ctx.beginPath(); ctx.moveTo(0, h - padB + 0.5); ctx.lineTo(w, h - padB + 0.5); ctx.stroke();
}

function drawTimeline(canvas, rainFrames, curIdx) {
  const { ctx, w, h } = setupCanvas(canvas, canvas.clientHeight || 42);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(5, ...rainFrames);
  const n = rainFrames.length;
  const step = w / (n - 1);
  // 面积
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(95,215,255,.28)');
  g.addColorStop(1, 'rgba(95,215,255,0)');
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) ctx.lineTo(i * step, h - (rainFrames[i] / max) * (h - 4) - 2);
  ctx.lineTo(w, h); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const y = h - (rainFrames[i] / max) * (h - 4) - 2;
    i ? ctx.lineTo(i * step, y) : ctx.moveTo(i * step, y);
  }
  ctx.strokeStyle = 'rgba(142,230,255,.55)'; ctx.lineWidth = 1; ctx.stroke();
  // 已播放区域
  const x = curIdx * step;
  ctx.fillStyle = 'rgba(95,215,255,.06)';
  ctx.fillRect(0, 0, x, h);
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, 3, 2.4, 0, 7); ctx.fill();
}

function drawSensor(canvas, series, thr, curIdx) {
  const { ctx, w, h } = setupCanvas(canvas, canvas.clientHeight || 110);
  ctx.clearRect(0, 0, w, h);
  const max = Math.max(0.2, ...series, thr[2] * 1.05) * 1.12;
  const n = series.length;
  const step = w / (n - 1);
  // 阈值线
  thr.forEach((t, i) => {
    const y = h - (t / max) * (h - 10) - 5;
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = ['rgba(255,209,102,.4)', 'rgba(255,159,67,.4)', 'rgba(255,77,94,.4)'][i];
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    ctx.setLineDash([]);
  });
  // 面积
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(95,215,255,.36)');
  g.addColorStop(1, 'rgba(95,215,255,0)');
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let i = 0; i < n; i++) ctx.lineTo(i * step, h - (series[i] / max) * (h - 10) - 5);
  ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < n; i++) ctx.lineTo(i * step, h - (series[i] / max) * (h - 10) - 5);
  ctx.strokeStyle = '#7ee6ff'; ctx.lineWidth = 1.5; ctx.stroke();
  // 当前
  const x = curIdx * step, y = h - (series[curIdx] / max) * (h - 10) - 5;
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(140,180,210,.65)'; ctx.font = '8px Bahnschrift, sans-serif';
  ctx.fillText(`${Math.round(max * 100)}cm`, 2, 9);
}

function trendArrow(d) {
  if (d > 0.02) return `<span style="color:#ff9f43">▲ ${(d * 100).toFixed(0)}</span>`;
  if (d < -0.02) return `<span style="color:#35d0a5">▼ ${Math.abs(d * 100).toFixed(0)}</span>`;
  return '<span style="color:#6f8ba3">— 平稳</span>';
}

function adviceFor(s, depth, lv) {
  const t = TYPE[s.type] || '监测点';
  if (depth < 0.05) return `${s.name}当前无有效积水，维持 5 分钟/次滚动监测；检查雨量计、水位计与视频在线状态。`;
  if (s.type === 'underpass') return `立即启动${s.name}泵站，封闭隧道双向交通，设置水位标尺与警示屏；水位超过 30cm 严禁车辆通行，超过 50cm 组织人员撤离。`;
  if (s.type === 'river') return `加密${s.name}河道水位与流速监测，联动上游水库泄洪调度；关注河水倒灌与堤岸险情，提前转移低洼岸线人员。`;
  if (s.type === 'community') return `通知${s.street || ''}网格员排查低洼院落、地下车库与独居老人；必要时启动人员转移，布设沙袋与移动泵。`;
  if (lv.key === 'purple' || lv.key === 'red') return `立即对${s.name}实施交通管制，部署移动泵车抽排，清理雨水篦子；通过诱导屏发布绕行信息。`;
  return `加密${s.name}巡查频次，预置抢险班组与移动泵车，检查雨水口堵塞与管网液位，做好信息报送。`;
}

export const ui = {
  app: null,
  scn: null,
  idx: 0,
  speed: 1,
  playing: false,
  modalSensor: null,

  init(app) {
    this.app = app;
    this.dom = {
      tabs: $('scenario-tabs'), name: $('scenario-name'), desc: $('scenario-desc'), tag: $('scenario-tag'),
      rainChart: $('rain-chart'), rainPeak: $('rain-peak'), simClock: $('sim-clock'),
      play: $('btn-play'), reset: $('btn-reset'), speed: $('speed-btn'),
      statMax: $('stat-max'), statArea: $('stat-area'), statWarn: $('stat-warn'), statPop: $('stat-pop'),
      statMaxTrend: $('stat-max-trend'), statWarnTrend: $('stat-warn-trend'),
      warnCount: $('warn-count'), alerts: $('alert-list'), dispatch: $('dispatch-list'),
      timeline: $('timeline'), timelineChart: $('timeline-chart'), tlRain: $('tl-rain-now'),
      confidence: $('confidence'), confidenceBar: $('confidence-bar'), modelNote: $('model-note-text'),
      modal: $('sensor-modal'), mcName: $('mc-name'), mcSub: $('mc-sub'), mcLevel: $('mc-level'),
      mcDepth: $('mc-depth'), mcTrend: $('mc-trend'), mcGround: $('mc-ground'), mcThr: $('mc-thr'),
      mcCanvas: $('mc-canvas'), mcAdvice: $('mc-advice'), toast: $('toast'),
    };
    $('btn-focus').onclick = () => {
      const focused = document.body.classList.toggle('map-focused');
      $('btn-focus').setAttribute('aria-pressed', String(focused));
      $('btn-focus').textContent = focused ? '显示面板' : '专注地图';
      this.app.routeView?.locate();
    };
    // 事件
    this.dom.play.onclick = () => this.app.togglePlay();
    this.dom.reset.onclick = () => { this.app.togglePlay(false); this.app.setFrame(0); this.toast('已暂停并回到情景起点'); };
    $('btn-demo-reset').onclick = () => this.app.resetDemo();
    $('btn-peak').onclick = () => {
      this.app.togglePlay(false);
      const peak = this.scn.frames.reduce((best, f, i, frames) => f.maxDepth > frames[best].maxDepth ? i : best, 0);
      this.app.setFrame(peak); this.app.selectedId = null; this.app.flyPreset('hotspot');
    };
    this.dom.speed.onclick = () => {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
      this.dom.speed.textContent = `${this.speed}×`;
      this.app.setSpeed(this.speed);
    };
    this.dom.timeline.oninput = (e) => { this.app.togglePlay(false); this.app.setFrame(+e.target.value); };
    document.querySelectorAll('.tool[data-layer]').forEach((b) => {
      b.onclick = () => {
        const on = b.classList.toggle('active');
        b.setAttribute('aria-pressed', String(on));
        this.app.toggleLayer(b.dataset.layer, on);
      };
    });
    document.querySelectorAll('.view-presets button').forEach((b) => {
      b.onclick = () => this.app.flyPreset(b.dataset.cam);
    });
    $('btn-cam-reset').onclick = () => this.app.flyPreset('initial');
    $('btn-full').onclick = async () => {
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen(); }
      catch { this.toast('当前浏览器不支持全屏，请手动最大化窗口'); }
    };
    $('modal-close').onclick = () => this.closeModal();
    $('mc-close2').onclick = () => this.closeModal();
    $('mc-locate').onclick = () => {
      if (this.modalSensor) this.app.flySensor(this.modalSensor.id);
      this.closeModal();
    };
    this.dom.modal.addEventListener('click', (e) => { if (e.target === this.dom.modal) this.closeModal(); });
    document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => this.setView(b.dataset.view));
    addEventListener('keydown', e => {
      if (e.code === 'Tab' && this.modalSensor) {
        const buttons = [...this.dom.modal.querySelectorAll('button')];
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
      if (e.code === 'Escape') { this.closeModal(); return; }
      if (!this.scn || this.app.loading || e.target.matches('input,textarea,button,select,[contenteditable]')) return;
      if (e.code === 'Space') { e.preventDefault(); this.app.togglePlay(); }
      if (['ArrowRight', 'ArrowLeft'].includes(e.code)) {
        e.preventDefault(); this.app.togglePlay(false); this.app.setFrame(this.idx + (e.code === 'ArrowRight' ? 1 : -1));
      }
    });
    addEventListener('resize', () => { if (this.scn) { this.drawCharts(this.scn, this.idx); if (this.modalSensor) this.updateSensor(); } });
    this.tickClock();
    setInterval(() => this.tickClock(), 1000);
  },

  tickClock() {
    const d = new Date();
    const t = d.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
    const date = d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' });
    const week = '日一二三四五六'[new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' })).getDay()];
    const ct = $('clock-time'), cd = $('clock-date');
    if (ct) ct.textContent = t;
    if (cd) cd.textContent = `${date.replaceAll('/', '-')} 星期${week}`;
  },

  setScenarios(list) {
    this.scenarios = list;
    this.dom.tabs.innerHTML = '';
    for (const s of list) {
      const b = el('button', '', `${s.short}<b>${s.tag}</b>`);
      b.dataset.id = s.id;
      b.onclick = () => this.app.setScenario(s.id, true);
      this.dom.tabs.appendChild(b);
    }
  },

  setScenario(scn) {
    this.scn = scn;
    this.idx = 0;
    this.dom.tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.id === scn.id));
    this.dom.name.textContent = scn.name;
    this.dom.desc.textContent = scn.desc;
    this.dom.tag.textContent = scn.tag;
    this.dom.tag.style.color = scn.color;
    this.dom.tag.style.borderColor = scn.color + '55';
    this.dom.tag.style.background = scn.color + '12';
    this.dom.rainPeak.textContent = `峰值 ${Number.isFinite(scn.maxRain) ? scn.maxRain.toFixed(0) : '暂无数据'} mm/h · 累计 ${Number.isFinite(scn.totalRain) ? scn.totalRain.toFixed(0) : '暂无数据'} mm`;
    this.dom.confidence.textContent = '预计算情景';
    this.dom.modelNote.textContent = '预计算模型与虚拟点位，未经实测率定。仅供课程展示，不用于真实防汛决策。';
    this.dom.timeline.max = String(scn.frames.length - 1);
    this.dom.timeline.value = '0';
    const ticks = document.querySelectorAll('.tl-ticks span');
    const total = scn.duration;
    ticks.forEach((t, i) => { t.textContent = fmtT(total * i / (ticks.length - 1)); });

  },

  drawCharts(scn, idx) {
    const total = scn.duration;
    drawRain(this.dom.rainChart, scn.rain, (idx / (scn.frames.length - 1)) * total, total);
    drawTimeline(this.dom.timelineChart, scn.frames.map((f) => f.rain), idx);
  },

  renderFrame(scn, idx) {
    this.scn = scn; this.idx = idx;
    const f = scn.frames[idx];
    const prev = scn.frames[Math.max(0, idx - 1)];
    const t = f.t;
    this.dom.simClock.textContent = fmtT(t);
    this.dom.timeline.value = String(idx);
    this.dom.tlRain.innerHTML = `${f.rain.toFixed(1)} <i>mm/h</i>`;
    this.dom.statMax.innerHTML = `${f.maxDepth.toFixed(2)}<i>m</i>`;
    this.dom.statArea.innerHTML = `${f.areaHa.toFixed(1)}<i>ha</i>`;

    this.dom.statPop.innerHTML = Number.isFinite(f.pop) ? `${num(f.pop)}<i>人</i>` : '暂无数据';
    const dMax = f.maxDepth - prev.maxDepth;
    this.dom.statMaxTrend.innerHTML = dMax > 0.005 ? `▲ 较上一时刻 +${(dMax * 100).toFixed(0)}cm`
      : dMax < -0.005 ? `▼ 较上一时刻 ${(dMax * 100).toFixed(0)}cm` : '— 与上一时刻持平';
    this.dom.statMaxTrend.style.color = dMax > 0.005 ? '#ff9f43' : dMax < -0.005 ? '#35d0a5' : '#5c7d95';
    // 告警
    const list = this.app.sensors.map(meta => {
      const ss = scn.sensors.find(x => x.id === meta.id);
      const depth = ss?.series[idx] ?? null;
      const previous = ss?.series[Math.max(0, idx - 1)] ?? null;
      return { ...meta, depth, previous, level: levelOf(depth, meta.type) };
    }).sort((a, b) => (b.depth ?? -1) - (a.depth ?? -1));
    const active = list.filter(x => !['none', 'unknown'].includes(x.level.key));
    const missing = list.filter(x => x.level.key === 'unknown').length;
    const previousCount = list.filter(x => !['none', 'unknown'].includes(levelOf(x.previous, x.type).key)).length;
    const dW = active.length - previousCount;
    this.dom.statWarn.innerHTML = `${active.length}<i>处</i>`;
    this.dom.statWarnTrend.textContent = missing ? `${missing} 处暂无数据` : dW > 0 ? `▲ 新增 ${dW} 处` : dW < 0 ? `▼ 解除 ${-dW} 处` : '— 数量持平';
    this.dom.warnCount.textContent = active.length;
    $('scene-summary').textContent = `${scn.short || scn.name} · ${fmtT(t)} · 模型结果`;
    this.dom.timeline.setAttribute('aria-valuetext', fmtT(t));
    this.dom.alerts.innerHTML = '';
    if (!active.length && missing < list.length) {
      this.dom.alerts.appendChild(el('div', 'alert-empty', '<b>当前无有效积水告警</b>当前有数据点位低于演示预警阈值。'));
    }
    if (missing) this.dom.alerts.appendChild(el('div', 'alert-empty', `${missing} 个点位暂无数据，不纳入风险统计。`));
    {
      for (const s of list) {
        const div = el('button', 'alert-item');
        div.style.setProperty('--c', s.level.color);
        div.innerHTML = `<i class="lv"></i>
          <div class="ai-main"><div class="ai-name">${s.name}</div>
          <div class="ai-meta"><span>${s.street || ''}</span><span>${TYPE[s.type] || ''}</span></div></div>
          <div class="ai-depth">${s.depth == null ? '—' : Math.round(s.depth * 100)}<i>cm</i><span>${s.level.name}</span></div>`;
        div.onclick = () => this.openSensor(s);
        this.dom.alerts.appendChild(div);
      }
    }
    if (missing === list.length) this.dom.dispatch.textContent = '暂无点位数据，无法生成建议。';
    else this.renderDispatch(list, active, f);
    if (this.modalSensor) this.updateSensor();

    // 图表游标
    this.drawCharts(scn, idx);
    // 顶部按钮状态
    this.dom.play.classList.toggle('playing', this.playing);
  },

  renderDispatch(list, active, f) {
    this.dom.dispatch.innerHTML = '';
    const items = [];
    if (!active.length) {
      items.push({ p: 'P3', c: '#35d0a5', title: '维持常态监测', body: '当前有数据点位未触发演示阈值。处置建议仅作课程示意，未接入实际调度。', team: '指挥中心', eta: '持续' });
    } else {
      const max = active[0];
      const lv = max.level.key;
      if (lv === 'purple' || lv === 'red' || max.depth >= 0.7) {
        items.push({ p: 'P0', c: '#ff4d5e', title: `高风险响应建议 · ${max.street || ''}`, body: `以${max.name}为中心实施交通管制与人员疏导，调派大流量泵车与抢险队伍，同步关闭下穿隧道与地下空间入口。`, team: '区三防指挥部', eta: '立即' });
      } else if (max.depth >= 0.35) {
        items.push({ p: 'P1', c: '#ff9f43', title: `重点布防 · ${max.name}`, body: '预置移动泵车与抢险班组，清理雨水篦子，布设警示标志与诱导屏，做好封闭准备。', team: '排水抢险队', eta: '15 分钟' });
      } else {
        items.push({ p: 'P2', c: '#ffd166', title: '加密巡查 · 低洼路段', body: '对蓝色/黄色预警点加密巡查，核查管网液位与雨水口堵塞情况，及时报送现场照片。', team: '市政巡查组', eta: '30 分钟' });
      }
      for (const s of active.slice(0, 3)) {
        if (items.length >= 4) break;
        const under = s.type === 'underpass';
        items.push({
          p: s.depth >= 0.5 ? 'P0' : s.depth >= 0.3 ? 'P1' : 'P2',
          c: s.depth >= 0.5 ? '#ff4d5e' : s.depth >= 0.3 ? '#ff9f43' : '#ffd166',
          title: `${under ? '封闭' : '处置'} · ${s.name}`,
          body: under ? '启动隧道泵站，双向封闭，禁止车辆通行；水位超过 30cm 时组织滞留人员撤离。' : '设置警示与绕行标志，部署移动泵抽排，排查周边雨水口与管网。',
          team: under ? '交警 + 排水抢险队' : '排水抢险队',
          eta: under ? '10 分钟' : '20 分钟',
        });
      }
    }
    for (const it of items) {
      const div = el('div', 'dispatch-item');
      div.style.setProperty('--c', it.c);
      div.innerHTML = `<div class="di-top"><span class="p">${it.p}</span><span class="di-title">${it.title}</span></div>
        <div class="di-body">${it.body}</div>
        <div class="di-meta"><span>责任：<b>${it.team}</b></span><span>时限：<b>${it.eta}</b></span></div>`;
      this.dom.dispatch.appendChild(div);
    }
  },

  openSensor(s) {
    if (this.app.loading) return;
    this.modalSensor = this.app.sensors.find(x => x.id === s.id) || s;
    this._returnFocus = document.activeElement;
    this.app.selectSensor(s.id);
    this.app.flySensor(s.id);
    this.dom.modal.classList.add('open');
    this.dom.modal.setAttribute('aria-hidden', 'false');
    this.updateSensor();
    $('modal-close').focus();
  },

  updateSensor() {
    const s = this.modalSensor;
    const ss = this.scn.sensors.find(x => x.id === s.id);
    const depth = ss?.series[this.idx] ?? null;
    const lv = levelOf(depth, s.type);
    this.dom.mcName.textContent = s.name;
    this.dom.mcSub.textContent = `${this.scn.short} · ${fmtT(this.scn.frames[this.idx].t)} · 虚拟点位 / 模型水深`;
    $('mc-location').textContent = `${s.street || '暂无街道数据'} · ${TYPE[s.type] || '点位'} · ${Number.isFinite(s.lon) && Number.isFinite(s.lat) ? `${s.lon.toFixed(4)}°E, ${s.lat.toFixed(4)}°N` : '暂无坐标'}`;
    this.dom.mcLevel.textContent = lv.long;
    this.dom.mcLevel.style.setProperty('--c', lv.color);
    this.dom.mcDepth.innerHTML = depth == null ? '暂无数据' : `${depth.toFixed(2)}<i>m</i>`;
    const prev = ss?.series[Math.max(0, this.idx - 2)];
    this.dom.mcTrend.innerHTML = depth == null || !Number.isFinite(prev) ? '暂无数据' : trendArrow(depth - prev);
    this.dom.mcGround.innerHTML = Number.isFinite(s.ground) ? `${s.ground.toFixed(2)}<i>m</i>` : '暂无数据';
    this.dom.mcThr.innerHTML = `${(riskThresholds(s.type)[0] * 100).toFixed(1)}<i>cm</i>`;
    this.dom.mcAdvice.textContent = depth == null ? '暂无模型水深，无法生成处置建议。' : adviceFor(s, depth, lv);
    const hasSeries = ss?.series.every(Number.isFinite);
    $('mc-chart-note').textContent = hasSeries ? `模型水深过程 · ${fmtT(0)} — ${fmtT(this.scn.duration)} · 虚线为演示黄 / 橙 / 红阈值` : '过程线含缺测值，暂无完整曲线';
    if (hasSeries) drawSensor(this.dom.mcCanvas, ss.series, riskThresholds(s.type).slice(1, 4), this.idx);
    else { const {ctx, w, h} = setupCanvas(this.dom.mcCanvas); ctx.clearRect(0, 0, w, h); }
  },

  closeModal() {
    this.modalSensor = null;
    this.dom.modal.classList.remove('open');
    this.dom.modal.setAttribute('aria-hidden', 'true');
    if (this._returnFocus?.isConnected) this._returnFocus.focus();
  },

  setView(view) {
    document.body.classList.remove('map-focused');
    $('btn-focus').setAttribute('aria-pressed', 'false');
    $('btn-focus').textContent = '专注地图';
    document.body.dataset.view = view;
    const ready = this.app.routeView.show(view === 'routes');
    document.querySelectorAll('.nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.view === view);
      b.setAttribute('aria-pressed', String(b.dataset.view === view));
    });
    const target = { monitor: this.dom.alerts, simulate: this.dom.tabs, dispatch: this.dom.dispatch }[view];
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return ready;
  },

  setLoading(loading, message = '', error = false) {
    const status = $('scenario-status');
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('error', error);
    document.getElementById('app').classList.toggle('scenario-loading', loading);
    [this.dom.play, this.dom.reset, this.dom.speed, this.dom.timeline, $('btn-peak')].forEach(b => b.disabled = loading);
    this.dom.tabs.setAttribute('aria-busy', String(loading));
  },

  setPlaying(b) {
    this.playing = b;
    this.dom.play.classList.toggle('playing', b);
    this.dom.play.setAttribute('aria-label', b ? '暂停推演' : '播放推演');
    this.dom.play.setAttribute('aria-pressed', String(b));
  },

  toast(msg) {
    this.dom.toast.textContent = msg;
    this.dom.toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.dom.toast.classList.remove('show'), 2400);
  },
};
