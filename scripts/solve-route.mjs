// Example: node scripts/solve-route.mjs 7959603173 8516154909 replay-2309 240 15
import {readFileSync} from 'node:fs';
import {prepareNetwork,shortestPath,routeAtFrame} from '../system/public/src/road-router.js';

const load = name => JSON.parse(readFileSync(new URL('../system/public/data/'+name+'.json',import.meta.url)));
const [from,to,scenario,minutes,limit] = process.argv.slice(2);
if (!load('scenarios/index').some(s=>s.id===scenario) || !Number.isFinite(Number(limit)) || Number(limit)<=0) {
  throw Error('用法：node scripts/solve-route.mjs 起点OSM编号 终点OSM编号 情景ID 分钟 正阈值cm');
}
const net=prepareNetwork(load('road-network'),load('meta'));
const [a,b]=[from,to].map(id=>net.nodes.findIndex(n=>n[0]===Number(id)));
const frame=load('scenarios/'+scenario).frames.find(f=>f.t===Number(minutes));
if (a<0 || b<0 || !frame) throw Error('节点或情景分钟数超出数据范围');
const path=shortestPath(net,a,b), depth=Buffer.from(frame.depth,'base64');
const r=routeAtFrame(net,a,b,path,depth,Number(limit));
function describe(p,peakCm) {
  if (!p) return null;
  return {lengthM:Math.round(p.lengthM*10)/10,peakCm,
    segmentIds:p.edges.map(i=>{const [u,v,,way]=net.edges[i];return [way,net.nodes[u][0],net.nodes[v][0]].join('/');}),
    streets:[...new Set(p.edges.map(i=>net.names[net.edges[i][2]]).filter(Boolean))]};
}
console.log(JSON.stringify({scenario, minute:frame.t, cutoffCm:Number(limit),status:r.status,
  baseline:describe(path,r.baselinePeak),alternative:describe(r.alternative,r.alternativePeak),
  hotspot:r.hotspot},null,2));
