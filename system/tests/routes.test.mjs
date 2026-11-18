import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {prepareNetwork,shortestPath,routeAtFrame} from '../public/src/road-router.js';

const read = name => JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url)));
const net=prepareNetwork(read('road-network'),read('meta'));
const id=osm=>net.nodes.findIndex(n=>n[0]===osm);
const [start,end]=[7959603173,8516154909].map(id);
const path=shortestPath(net,start,end);
const replay=read('scenarios/replay-2309');
const compare=(a,b,t,limit)=>routeAtFrame(net,a,b,shortestPath(net,a,b),Buffer.from(replay.frames[t/10].depth,'base64'),limit);
test('Fuhua example avoids the flagged street with a modest distance increase',()=>{
  const r=compare(start,end,240,15);
  assert.equal(r.status,'detour');
  assert.deepEqual([Math.round(r.baseline.lengthM),Math.round(r.alternative.lengthM),r.baselinePeak,r.alternativePeak],[1196,1251,49,2]);
  assert.equal(r.hotspot.name,'福华一路');
  assert.ok(r.flooded.length>0);
  assert.deepEqual(r.alternative.points[0],path.points[0]);
  assert.deepEqual(r.alternative.points.at(-1),path.points.at(-1));
  assert.equal(compare(start,end,0,15).status,'clear');
  assert.equal(compare(id(7959990831),id(7966386945),360,15).status,'blocked');
});
test('all scenario frames return continuous directed, turn-compliant paths below threshold',()=>{
  for(const s of read('scenarios/index')) for(const f of read('scenarios/'+s.id).frames){
    const depth=Buffer.from(f.depth,'base64');
    for(const limit of [10,15,30]){
      const r=routeAtFrame(net,start,end,path,depth,limit);
      if(!r.alternative) continue;
      let prev=-1,u=start;
      for(const e of r.alternative.edges){
        assert.equal(net.edges[e][0],u);assert.ok(!net.forbidden.get(prev)?.has(e));
        assert.ok(net.edges[e][4].every(c=>depth[c]<limit));
        prev=e;u=net.edges[e][1];
      }
      assert.equal(u,end);assert.ok(r.alternative.lengthM>=path.lengthM);
    }
  }
});
test('one-way edges, turn bans, missing water and equality at the threshold',()=>{
  const data={version:1,world:[40,40],grid:[2,2],nodes:[[10,1,1],[11,21,1],[12,21,21],[13,1,21]],
    names:['街'],edges:[[0,1,0,1,[0,1]],[1,2,0,2,[1,3]],[0,3,0,3,[0,2]],[3,2,0,4,[2,3]]],turns:[[0,1]],junctions:[]};
  const n=prepareNetwork(data,{world:data.world,model:{nx:2,ny:2}});
  const p=shortestPath(n,0,2);
  assert.deepEqual(p.edges,[2,3]);
  assert.equal(shortestPath(n,2,0),null);
  assert.equal(routeAtFrame(n,0,2,p,[0,0,15,0],15).status,'blocked');
  assert.equal(routeAtFrame(n,0,2,p,[0,0,null,0],15).status,'unknown');
  assert.equal(routeAtFrame(n,2,0,null,[0,0,0,0],15).status,'disconnected');
  assert.equal(routeAtFrame(n,0,0,null,[0,0,0,0],15).status,'same');
});
