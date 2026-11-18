import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareWalking, locateWalker, demoPosition, walkingBaseline, planWalk, randomDemoNode, walkingSteps} from '../public/src/walk-routing.js';
import {floodedSections} from '../public/src/road-router.js';

const read = name => JSON.parse(readFileSync(new URL('../public/data/' + name + '.json', import.meta.url)));
function fixture() {
  const world = [1000,800], grid = [50,40];
  const meta = {world, bbox:[0,0,1,1], model:{nx:50,ny:40,cell:20}};
  const pts = [[105,105],[305,105],[505,105],[105,305],[505,305],[105,545],[905,605],[905,705]];
  const xy = ([x,y]) => [x/world[0], 1-y/world[1]];
  const cell = ([x,y]) => Math.floor(y/20)*50 + Math.floor(x/20);
  const edges = [];
  for (const [a,b] of [[0,1],[1,2],[0,3],[3,4],[4,2],[3,5],[6,7]]) {
    const cells = new Set();
    for (let t=0;t<=100;t++) cells.add(cell(pts[a].map((v,i)=>v+(pts[b][i]-v)*t/100)));
    edges.push([a,b,0,1,[...cells]], [b,a,0,1,[...cells]]);
  }
  const graph = {profile:'walk',version:1, world, grid, turns:[],junctions:[],names:['人行道'],nodes:pts.map((p,i)=>[i,...p]),edges};
  const facility = (node,id,more={}) => ({id,name:id,xy:xy(pts[node]),kind:'indoor',cell:cell(pts[node]),availability:'needs_verification',...more});
  const catalog = {groundMask:Buffer.alloc(250,255).toString('base64'),facilities:[
    facility(2,'A'),facility(5,'B'),facility(0,'park',{kind:'outdoor'}),facility(0,'closed',{availability:'closed'}),
    facility(0,'missing',{xy:null}),facility(0,'unsupported',{cell:null})]};
  const model = prepareWalking(graph,catalog,meta), origin = locateWalker(model,xy(pts[0]));
  return {model, origin, depth:new Array(2000).fill(0), wet:cell([405,105]), cell, xy, pts, baseline:walkingBaseline(model,origin)};
}

test('all reachable indoor facilities are ranked by walking and access length after flood exclusions', () => {
  const {model,origin,depth,wet,baseline} = fixture();
  assert.deepEqual(model.targets.map(s=>s.id),['A','B']);
  assert.equal(baseline.ranked[0].estimatedM,400);
  assert.equal(planWalk(model,origin,baseline,depth,10).ranked[0].site.id,'A');
  depth[wet] = 10;
  const plan = planWalk(model,origin,baseline,depth,10);
  assert.deepEqual(plan.ranked.map(r=>r.site.id),['B','A']);
  assert.deepEqual(plan.ranked.map(r=>r.estimatedM),[440,800]);
  const alt = plan.ranked[1];
  assert.equal(alt.basePeak,10);
  assert.equal(alt.peak,0);
  assert.equal(floodedSections(model.net,alt.baseline,depth,10).hotspot.cm,10);
  assert.ok(alt.path.edges.every(e=>!model.net.edges[e][4].includes(wet)));
  assert.equal(alt.baselineEstimatedM,400);
  assert.equal(planWalk(model,origin,baseline,depth,15).ranked[0].site.id,'A');
  assert.ok(Math.abs(walkingSteps(model.net,alt.path).reduce((s,l)=>s+l.lengthM,0)-800)<1e-8);
});

test('unknown, flooded, disconnected, off-network, outside and zero-distance origins have explicit outcomes', () => {
  const {model,origin,depth,wet,baseline,xy,pts} = fixture();
  assert.equal(locateWalker(model,[10,10]).status,'outside');
  assert.equal(locateWalker(model,xy([700,380])).status,'off_network');
  depth[wet] = null;
  assert.equal(planWalk(model,origin,baseline,depth,10).ranked[0].site.id,'B');
  for (const s of model.targets) depth[s.cell] = 10;
  assert.equal(planWalk(model,origin,baseline,depth,10).status,'no_safe_route');
  depth[origin.cell] = NaN;
  assert.equal(planWalk(model,origin,baseline,depth,10).status,'unknown');
  depth[origin.cell] = 10;
  assert.equal(planWalk(model,origin,baseline,depth,10).status,'origin_flooded');
  depth.fill(0);
  const disconnected = locateWalker(model,xy(pts[6]));
  assert.equal(planWalk(model,disconnected,walkingBaseline(model,disconnected),depth,10).status,'disconnected');
  const atSite = locateWalker(model,xy(pts[2]));
  const path = planWalk(model,atSite,walkingBaseline(model,atSite),depth,10).ranked[0];
  assert.equal(path.site.id,'A');
  assert.ok(path.estimatedM<1e-8);
  assert.deepEqual(path.path.edges,[]);
  const offset = locateWalker(model,xy([155,105]));
  assert.equal(Math.round(walkingBaseline(model,offset).ranked[0].estimatedM),450);
  assert.equal(planWalk(model,origin,baseline,[],10).status,'unknown');
  model.mask[origin.cell>>3] &= ~(1<<(origin.cell%8));
  assert.equal(planWalk(model,origin,baseline,depth,10).status,'unmodeled_ground');
});

test('published walking graph and replay route use ground cells and select a real detour', () => {
  const meta = read('meta'), catalog = read('official/catalog'), graph = read('walk-network');
  const model = prepareWalking(graph,catalog,meta);
  assert.equal(model.targets.length,17);
  assert.ok(model.targets.every(s=>s.approaches.every(a=>a.offset<=120)));
  for (const e of graph.edges) assert.ok(e[4].every(c => model.mask[c>>3] & 1<<(c%8)));
  const replay = read('scenarios/replay-2309'), depth = Buffer.from(replay.frames.find(f=>f.t===240).depth,'base64');
  const idx = randomDemoNode(model,depth,10,null,()=>.3), start = demoPosition(model,idx);
  assert.equal(locateWalker(model,start.coordinates).node,idx);
  assert.notEqual(randomDemoNode(model,depth,10,idx,()=>.3),idx);
  const baseline = walkingBaseline(model,start);
  const row = planWalk(model,start,baseline,depth,10).ranked[0];
  assert.ok(row.basePeak>=10 && row.peak<10 && row.estimatedM>row.baselineEstimatedM);
  assert.equal(row.peak,Math.max(...row.path.edges.flatMap(e=>graph.edges[e][4].map(c=>depth[c]))));
  for (const id of ['replay-2309','design-5','design-50']) {
    const scn = id==='replay-2309' ? replay : read('scenarios/'+id);
    for (const f of scn.frames.filter((_,i)=>i%8===0)) {
      const values = Buffer.from(f.depth,'base64'), plan = planWalk(model,start,baseline,values,10);
      for (const [i,r] of plan.ranked.entries()) {
        assert.ok(r.peak<10 && values[r.site.cell]<10);
        assert.ok(i===0 || r.estimatedM>=plan.ranked[i-1].estimatedM);
        assert.equal(r.path.points.length,r.path.edges.length+1);
        assert.ok(Math.abs(r.estimatedM-(r.path.lengthM+r.access.offset))<1e-7);
      }
    }
  }
});
