import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installTimeline, validateScenario } from '../public/src/timeline.js';
import { levelOf, riskThresholds } from '../public/src/utils.js';
const read = async name => JSON.parse(await readFile(new URL(`../public/data/${name}.json`, import.meta.url), 'utf8'));
const meta = await read('meta');
const sensors = await read('sensors');
const scenarios = await read('scenarios/index');
const data = new Map(await Promise.all(scenarios.map(async s => [s.id, await read(`scenarios/${s.id}`)])));
function harness(fetcher) {
  const calls = [];
  const app = {meta, sensors, scenarios, layers:{water:true}, playing:false, speed:1,
    water:{mesh:{visible:false}, update(depth){calls.push(['water', depth]);}}};
  const ui = {setPlaying(){}, setLoading(...args){calls.push(['loading', ...args]);}, setScenario(s){calls.push(['scenario', s.id]);}, renderFrame(s,i){calls.push(['frame',s.id,i]);}, toast(){}};
  installTimeline(app, ui, fetcher || (async url => data.get(url.split('/').at(-1).replace('.json',''))));
  return {app,calls};
}
test('all three real scenarios have matching grid, time and sensor sequences', () => {
  for (const s of scenarios) assert.equal(validateScenario(data.get(s.id),s.id,meta,sensors).frames.length,49);
});
test('first frame and every selected frame update water, sensors and UI together', async () => {
  const {app,calls} = harness(); await app.setScenario(scenarios[0].id);
  assert.equal(calls.filter(c=>c[0]==='water').length,1);
  app.setFrame(20); assert.equal(app.idx,20);
  assert.equal(app.frameSensors[0].depth,app.scenario.sensors[0].series[20]);
  assert.deepEqual(calls.at(-1),['frame',scenarios[0].id,20]);
  app.setFrame(NaN); assert.equal(app.idx,20);
  app.setFrame(900); assert.equal(app.idx,48);
  app.togglePlay(true); assert.equal(app.idx,0); assert.equal(app.playing,true);
});
test('out-of-order requests cannot overwrite the last choice even if fetch ignores abort', async () => {
  const deferred=[];
  const {app}=harness(url=>new Promise(resolve=>deferred.push({url,resolve})));
  const a=app.setScenario(scenarios[0].id), b=app.setScenario(scenarios[1].id);
  deferred[1].resolve(data.get(scenarios[1].id)); await b;
  deferred[0].resolve(data.get(scenarios[0].id)); assert.equal(await a,false);
  assert.equal(app.scenario.id,scenarios[1].id); assert.equal(app.loading,false);
});
test('failed switch keeps previous scene paused and reports error',async()=>{
  let fail=false;
  const {app,calls}=harness(async()=>{if(fail)throw new Error('offline');return data.get(scenarios[0].id);});
  await app.setScenario(scenarios[0].id); app.setFrame(12); app.togglePlay(true); fail=true;
  assert.equal(await app.setScenario(scenarios[1].id),false);
  assert.equal(app.idx,12); assert.equal(app.scenario.id,scenarios[0].id); assert.equal(app.playing,false);
  assert.equal(calls.at(-1).at(-1),true);
});
test('invalid grid and series fail before replacing scene',()=>{
  const s=structuredClone(data.get(scenarios[0].id)); s.frames[0].depth='AA==';
  assert.throws(()=>validateScenario(s,s.id,meta,sensors),/网格/);
  s.frames[0]=data.get(s.id).frames[0]; s.sensors[0].series.pop();
  assert.throws(()=>validateScenario(s,s.id,meta,sensors),/时间序列/);
});
test('missing depths are unknown, existing type-adjusted thresholds stay unchanged',()=>{
  assert.equal(levelOf(null).key,'unknown'); assert.equal(levelOf(0).key,'none');
  assert.equal(levelOf(.04,'underpass').key,'blue'); assert.equal(levelOf(.04,'road').key,'none');
  assert.equal(riskThresholds('river')[0],.05*1.6);
});
