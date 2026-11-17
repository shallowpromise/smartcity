/**
 * 深澜 · 城市积水风险智慧预警平台
 * 零依赖 Node.js 服务：静态资源 + 情景数据 API + 预警规则引擎
 * 启动：node server.mjs  (默认 http://127.0.0.1:8088)
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 8088);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.mp4': 'video/mp4',
};

const LEVELS = [
  { key: 'red', name: '红色预警', min: 0.50, color: '#ff4d5e' },
  { key: 'orange', name: '橙色预警', min: 0.30, color: '#ff9f43' },
  { key: 'yellow', name: '黄色预警', min: 0.15, color: '#ffd166' },
  { key: 'blue', name: '蓝色预警', min: 0.05, color: '#4da3ff' },
];

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
}
function json(res, obj, code = 200) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}
async function readJson(p) { return JSON.parse(await fsp.readFile(p, 'utf8')); }

const scenarioCache = new Map();
async function getScenario(id) {
  if (scenarioCache.has(id)) return scenarioCache.get(id);
  const safe = String(id).replace(/[^a-z0-9_-]/gi, '');
  const p = path.join(PUBLIC, 'data', 'scenarios', `${safe}.json`);
  const data = await readJson(p);
  scenarioCache.set(id, data);
  return data;
}

function levelOf(depth, type) {
  const adj = type === 'underpass' ? 0.66 : type === 'river' ? 1.4 : 1;
  for (const l of LEVELS) if (depth >= l.min * adj) return l;
  return { key: 'none', name: '正常', min: 0, color: '#35d0a5' };
}

function warningsAt(scn, t) {
  const idx = Math.max(0, Math.min(scn.frames.length - 1, Math.round(t)));
  const list = scn.sensors.map((s) => {
    const depth = s.series[idx] ?? 0;
    const prev = s.series[Math.max(0, idx - 2)] ?? depth;
    const lv = levelOf(depth, s.type);
    return {
      id: s.id, name: s.name, type: s.type, depth: +depth.toFixed(3),
      trend: +(depth - prev).toFixed(3), level: lv.key, levelName: lv.name,
      color: lv.color, lon: s.lon, lat: s.lat,
    };
  }).sort((a, b) => b.depth - a.depth);
  return { time: scn.times[idx], index: idx, count: list.filter(x => x.level !== 'none').length, list };
}

function dispatchAt(scn, t) {
  const warn = warningsAt(scn, t);
  const out = [];
  const active = warn.list.filter(x => x.level !== 'none');
  for (const s of active.slice(0, 4)) {
    if (s.depth >= 0.45) out.push({
      priority: 'P0', title: `封闭 ${s.name}`, action: '立即实施交通管制，下穿/低洼路段双向封闭，部署移动泵车抽排。',
      team: '交警 + 排水抢险队', eta: '10 分钟内', sensor: s.id, color: '#ff4d5e',
    });
    else if (s.depth >= 0.25) out.push({
      priority: 'P1', title: `预置抢险力量 · ${s.name}`, action: '泵车与抢险班组前置待命，清理雨水口，布设警示与诱导标志。',
      team: '排水抢险队', eta: '20 分钟内', sensor: s.id, color: '#ff9f43',
    });
    else out.push({
      priority: 'P2', title: `巡查 ${s.name}`, action: '加密巡查频次，核查雨水篦子堵塞与管网液位，做好信息报送。',
      team: '市政巡查组', eta: '30 分钟内', sensor: s.id, color: '#ffd166',
    });
  }
  if (!out.length) out.push({
    priority: 'P3', title: '维持常态监测', action: '当前无有效积水预警，保持 5 分钟/次滚动监测并关注后续降雨。',
    team: '指挥中心', eta: '持续', sensor: null, color: '#35d0a5',
  });
  return { time: warn.time, items: out };
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/health') return json(res, { ok: true, service: 'shenlan-flood', time: new Date().toISOString() });
  if (p === '/api/scenes') {
    const idx = await readJson(path.join(PUBLIC, 'data', 'scenarios', 'index.json'));
    return json(res, idx);
  }
  const m = p.match(/^\/api\/scenario\/([\w-]+)$/);
  if (m) {
    try { return json(res, await getScenario(m[1])); }
    catch { return json(res, { error: 'scenario not found' }, 404); }
  }
  if (p === '/api/warnings') {
    const id = url.searchParams.get('scenario') || 'replay-2309';
    const t = Number(url.searchParams.get('t') || 0);
    try { return json(res, warningsAt(await getScenario(id), t)); }
    catch { return json(res, { error: 'scenario not found' }, 404); }
  }
  if (p === '/api/dispatch') {
    const id = url.searchParams.get('scenario') || 'replay-2309';
    const t = Number(url.searchParams.get('t') || 0);
    try { return json(res, dispatchAt(await getScenario(id), t)); }
    catch { return json(res, { error: 'scenario not found' }, 404); }
  }
  return json(res, { error: 'not found' }, 404);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const abs = path.normalize(path.join(PUBLIC, rel));
    if (!abs.startsWith(PUBLIC)) return send(res, 403, 'forbidden');
    const stat = await fsp.stat(abs).catch(() => null);
    if (!stat || stat.isDirectory()) return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': ext === '.json' ? 'no-cache' : 'public, max-age=3600' };
    const ae = req.headers['accept-encoding'] || '';
    if ((ext === '.json' || ext === '.js' || ext === '.css' || ext === '.svg') && ae.includes('gzip')) {
      const raw = await fsp.readFile(abs);
      const gz = zlib.gzipSync(raw, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      return send(res, 200, gz, headers);
    }
    res.writeHead(200, headers);
    fs.createReadStream(abs).pipe(res);
  } catch (e) {
    console.error(e);
    send(res, 500, 'internal error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  深澜 · 城市积水风险智慧预警平台`);
  console.log(`  http://${HOST}:${PORT}\n`);
});
