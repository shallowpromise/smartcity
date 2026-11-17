export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

export function b64ToU8(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64ToI16(b64) {
  const u8 = b64ToU8(b64);
  return new Int16Array(u8.buffer, u8.byteOffset, u8.length >> 1);
}

export function fmtClock(iso, addMin = 0) {
  const d = new Date(new Date(iso).getTime() + addMin * 60000);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
export function fmtT(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function num(v, digits = 0) {
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const LEVELS = [
  { key: 'purple', name: '紫色', long: '紫色预警', min: 1.00, color: '#c77dff' },
  { key: 'red', name: '红色', long: '红色预警', min: 0.50, color: '#ff4d5e' },
  { key: 'orange', name: '橙色', long: '橙色预警', min: 0.30, color: '#ff9f43' },
  { key: 'yellow', name: '黄色', long: '黄色预警', min: 0.15, color: '#ffd166' },
  { key: 'blue', name: '蓝色', long: '蓝色预警', min: 0.05, color: '#4da3ff' },
];
export function levelOf(depth, type = 'road') {
  if (!Number.isFinite(depth)) return { key: 'unknown', name: '暂无数据', long: '暂无数据', color: '#8b9dae' };
  const adj = riskFactor(type);
  for (const l of LEVELS) if (depth >= l.min * adj) return l;
  return { key: 'none', name: '正常', long: '正常', min: 0, color: '#35d0a5' };
}
export function levelColor(key) {
  return ({ purple: '#c77dff', red: '#ff4d5e', orange: '#ff9f43', yellow: '#ffd166', blue: '#4da3ff' })[key] || '#35d0a5';
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const riskFactor = type => type === 'underpass' ? 0.62 : type === 'river' ? 1.6 : 1;
export const riskThresholds = (type = 'road') => [...LEVELS].reverse().map(l => l.min * riskFactor(type));
