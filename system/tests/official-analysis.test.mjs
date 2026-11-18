import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {accumulatedRain, designRain, runoff, decodeDepthRuns, exposure, groundAt, validateObservations, validateStreetRain, compareObservation} from '../public/src/analysis-math.js';
import {prepareNetwork, shortestPath, routeAtFrame} from '../public/src/road-router.js';

const read=name=>JSON.parse(readFileSync(new URL('../public/data/'+name+'.json',import.meta.url)));
const catalog=read('official/catalog'),meta=read('meta'),size=meta.model.nx*meta.model.ny;
const network=prepareNetwork(read('road-network'),meta);

test('public directory retains all facilities, provenance, honest missing data and valid road joins',()=>{
  assert.equal(catalog.streets.length,10);
  assert.equal(new Set(catalog.facilities.map(f=>f.id)).size,catalog.facilities.length);
  assert.deepEqual(catalog.streets.find(s=>s.name==='福田街道').thresholds,[30,45,70]);
  assert.ok(catalog.streets.every(s=>s.polygons.length&&s.thresholds.length===3&&s.note));
  for(const [kind,count] of Object.entries({indoor:70,outdoor:55,metro:241}))assert.equal(catalog.facilities.filter(f=>f.kind===kind).length,count);
  const ids=new Set(network.nodes.map(n=>n[0]));
  for(const f of catalog.facilities){
    if(f.kind!=='metro')assert.equal(f.availability,'needs_verification');
    if(f.kind==='outdoor')assert.equal(f.capacity,null);
    assert.ok(Object.keys(f).every(k=>!/phone|mobile|contact|联系人|电话/i.test(k)));
    if(!f.xy){assert.equal(f.geocodeStatus,'geocode_failed');assert.equal(f.cell,undefined);}
    else assert.ok(f.osm&&f.geocodeMethod);
    if(f.roadNode)assert.ok(ids.has(f.roadNode)&&f.roadOffsetM<=120);
  }
  for(const id of ['replay-2309','design-5','design-50']){
    const sc=read('scenarios/'+id),data=read('official/'+id+'-exposure');
    const grids=sc.frames.map(f=>Buffer.from(f.depth,'base64'));
    const mask=Buffer.from(catalog.groundMask,'base64');
    for(const f of catalog.facilities){
      if(f.cell==null){assert.equal(data[f.id],undefined);continue;}
      assert.equal(groundAt(f.xy,meta,mask).cell,f.cell);
      assert.deepEqual(data[f.id],grids.map(d=>d[f.cell]));
    }
  }
});

test('rainfall needs a complete window, wet durations preserve breaks, and losses conserve rainfall',()=>{
  assert.equal(accumulatedRain(Array(180).fill(60),29,30),null);
  assert.equal(accumulatedRain(Array(180).fill(60),180,180),180);
  assert.equal(accumulatedRain([60,null],2,2),null);
  assert.deepEqual(exposure([15,15,0,16,18,20],[0,10,20,30,40,50]),{first:0,last:50,longest:20,peak:20});
  assert.equal(runoff(0,96),0);
  assert.deepEqual([58,96].map(c=>runoff(100,c).toFixed(1)),['16.2','88.3']);
  const street={street:'福田街道',observedAt:'2026-11-18T10:00:00+08:00',rain30mMm:30,rain1hMm:null,rain3hMm:92};
  const file={schemaVersion:1,quantity:'accumulated_rain',unit:'mm',sourceName:'test',streets:[street]};
  assert.deepEqual(validateStreetRain(file,[street.street]).stations.get(street.street).values,[30,null,92]);
  assert.throws(()=>validateStreetRain({...file,streets:[{...street,rain3hMm:2}]},[street.street]));
});

test('all comparative scenarios align with the 49 published baseline times and report computed model fields',()=>{
  const index=read('sensitivity/index');
  assert.deepEqual(index.map(x=>x.id).sort(),['block','drain70','idf5','idf50','stage25','stage40']);
  for(const info of index){
    const other=read('sensitivity/'+info.id),sc=read('scenarios/'+info.baseScenario);
    assert.deepEqual(other.frames.map(f=>f.t),sc.frames.map(f=>f.t));
    assert.equal(other.frames.length,49);
    let changed=false;
    for(const [i,f] of other.frames.entries()){
      const depth=decodeDepthRuns(f.depthRle,size),base=Buffer.from(sc.frames[i].depth,'base64');
      changed ||= !base.equals(depth);
      assert.equal(Object.keys(f.pointsCm).length,16);
      assert.ok(f.maxDepth>=0&&f.areaHa>=0&&f.pop>=0);
    }
    assert.ok(changed);
    if(other.parameters.returnYears)assert.ok(Math.abs(designRain(other.parameters.returnYears,180).mm-other.totalRainMm)<.006);
  }
  assert.throws(()=>decodeDepthRuns('AgA=',3));
});

test('observation checks use only paired station/event frames, exclude missing and saturated depths',()=>{
  const geo={bbox:[0,0,2,2],world:[64,64],model:{nx:2,ny:2}};
  const start='2023-09-07T18:00:00+08:00';
  const shape={schemaVersion:1,quantity:'surface_depth',crs:'WGS84',sourceName:'test',unit:'m',stations:[{
    id:'s',name:'station',longitude:.5,latitude:1.5,records:[.20,.10,.30,null].map((value,i)=>({time:new Date(Date.parse(start)+i*600000).toISOString(),value}))}]};
  const station=validateObservations(shape).stations[0];
  const event={id:'replay-2309',startTime:start,stepMin:10,duration:30,frames:[0,10,20,30].map(t=>({t}))};
  const fields=i=>[[10,0,0,0],[20,0,0,0],[255,0,0,0],[0,0,0,0]][i];
  const result=compareObservation(station,event,geo,fields);
  assert.equal(result.simulated[2],null);
  assert.deepEqual([result.paired,result.mae,result.peakError,result.peakTimeError,result.hit,result.miss,result.falseAlarm],[2,10,0,10,0,1,1]);
  assert.equal(compareObservation(station,{...event,id:'design-5'},geo,fields).mae,null);
  assert.equal(compareObservation({...station,xy:[-1,0]},event,geo,fields).paired,0);
  assert.equal(compareObservation(station,event,geo,fields,15,new Uint8Array([0])).paired,0);
  assert.equal(groundAt(station.xy,geo,new Uint8Array([2])).cell,1);
  const bad=structuredClone(shape);bad.stations[0].records[0].time='2023-09-07T18:00:00';
  assert.throws(()=>validateObservations(bad));
  bad.stations[0].records=[shape.stations[0].records[0],shape.stations[0].records[0]];
  assert.throws(()=>validateObservations(bad));
});

test('lower water preference can choose a longer, drier path, keeping distances geometric and all closures binding',()=>{
  const d={version:1,world:[40,40],grid:[2,2],nodes:[[10,1,1],[11,20,1],[12,35,1],[13,18,23]],names:['路'],
    edges:[[0,1,0,12,[0]],[1,2,0,12,[0]],[0,3,0,14,[2]],[3,2,0,14,[2]]],wayClasses:{12:'primary',14:'residential'},turns:[],junctions:[]};
  const net=prepareNetwork(d,{world:d.world,model:{nx:2,ny:2}}),base=shortestPath(net,0,2);
  const quick=routeAtFrame(net,0,2,base,[13,0,1,0],15,'short');
  const dry=routeAtFrame(net,0,2,base,[13,0,1,0],15,'low');
  assert.equal(quick.alternativePeak,13);assert.equal(dry.alternativePeak,1);
  assert.ok(dry.alternative.lengthM>quick.alternative.lengthM);
  assert.equal(dry.alternative.lengthM,net.lengths[2]+net.lengths[3]);
  assert.equal(routeAtFrame(net,0,2,base,[15,0,15,0],15,'low').code,'no_safe_route');
});
