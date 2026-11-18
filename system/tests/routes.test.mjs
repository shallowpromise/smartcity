import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compareRoutes } from '../public/src/route-comparison.js';

const read = name => JSON.parse(readFileSync(new URL('../public/data/' + name, import.meta.url)));
const routes = read('route-candidates.json');
const scenarios = read('scenarios/index.json').map(s => read('scenarios/' + s.id + '.json'));
const replay = scenarios.find(s => s.id === 'replay-2309');

test('threshold excludes equality, missing grid cells do not pass as dry', () => {
  const paths = [{lengthM: 100, cells: [0]}, {lengthM: 90, cells: [1]}];
  const result = compareRoutes(paths, [14, 15], 15);
  assert.equal(result.baseline.path, paths[1]);
  assert.equal(result.alternative.path, paths[0]);
  assert.equal(compareRoutes(paths, [15, 16], 15).alternative, undefined);
  assert.equal(compareRoutes(paths, [0], 15), null);
  assert.equal(compareRoutes(paths, [null, 0], 15), null);
});

test('candidate endpoints, lengths and sampled cells match the published grid', () => {
  const meta = read('meta.json');
  assert.deepEqual(routes.grid, [meta.model.nx, meta.model.ny]);
  assert.deepEqual(routes.world, meta.world);
  for (const c of routes.cases) {
    const reference = c.paths[0].points;
    for (const p of c.paths) {
      assert.deepEqual(p.points[0], reference[0]);
      assert.deepEqual(p.points.at(-1), reference.at(-1));
      const cells = new Set(p.cells);
      let length = 0;
      for (let i = 1; i < p.points.length; i++) {
        const [x,z] = p.points[i-1], [u,v] = p.points[i];
        const segment = Math.hypot(u-x, v-z);
        length += segment;
        const steps = Math.ceil(segment); // Independent 1 m samples along the polyline.
        for (let k = 0; k <= steps; k++) {
          const col = Math.floor((x + (u-x)*k/steps) / meta.world[0] * meta.model.nx);
          const row = Math.floor((z + (v-z)*k/steps) / meta.world[1] * meta.model.ny);
          assert.ok(cells.has(row * meta.model.nx + col));
        }
      }
      assert.ok(Math.abs(length - p.lengthM) < .06);
    }
  }
});

test('every shipped frame and threshold selects the shortest qualifying candidate', () => {
  for (const scenario of scenarios) for (const frame of scenario.frames) {
    const depth = Buffer.from(frame.depth, 'base64');
    for (const c of routes.cases) for (const threshold of [10, 15, 30]) {
      const result = compareRoutes(c.paths, depth, threshold);
      const eligible = c.paths.filter(p => p.cells.every(i => depth[i] < threshold));
      assert.equal(result.baseline.path.lengthM, Math.min(...c.paths.map(p => p.lengthM)));
      assert.equal(result.alternative?.path.lengthM, eligible.length ? Math.min(...eligible.map(p => p.lengthM)) : undefined);
    }
  }
});

test('replay exhibits unchanged route, detour and all candidates excluded', () => {
  const compare = (area, t) => compareRoutes(routes.cases[area].paths,
    Buffer.from(replay.frames.find(f => f.t === t).depth, 'base64'), 15);
  const dry = compare(0, 0);
  assert.equal(dry.alternative, dry.baseline);
  const wet = compare(0, 240);
  assert.deepEqual([wet.baseline.path.lengthM, wet.baseline.peakCm], [794.6, 47]);
  assert.deepEqual([wet.alternative.path.lengthM, wet.alternative.peakCm], [1065, 5]);
  assert.equal(compare(1, 360).alternative, undefined);
});
