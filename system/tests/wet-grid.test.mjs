import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {wetGridStats} from '../public/src/utils.js';

test('only wet cells enter the median, with inclusive thresholds and saturation', () => {
  assert.deepEqual(wetGridStats([0,4]), {wet:0,deep:0,median:null,saturated:false});
  assert.deepEqual(wetGridStats([0,4,5,50]), {wet:2,deep:1,median:27.5,saturated:false});
  assert.deepEqual(wetGridStats([5,254,255]), {wet:3,deep:2,median:254,saturated:false});
  assert.deepEqual(wetGridStats([254,255]), {wet:2,deep:2,median:254.5,saturated:true});
});

test('published 9·7 replay statistics at T+03:30', () => {
  const file=new URL('../public/data/scenarios/replay-2309.json',import.meta.url);
  const frame=JSON.parse(readFileSync(file)).frames.find(f=>f.t===210);
  assert.equal(frame.maxDepth,0.593);
  assert.deepEqual(wetGridStats(Buffer.from(frame.depth,'base64')),{wet:1861,deep:4,median:9,saturated:false});
});
