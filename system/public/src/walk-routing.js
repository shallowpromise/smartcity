import {edgeDepths,pathsToTargets,prepareNetwork,MinHeap} from './road-router.js';

const snapLimit = 120;
const validDepth = cm => Number.isFinite(cm) && cm >= 0;
const byDistance = (a,b) => a.estimatedM-b.estimatedM || a.path.lengthM-b.path.lengthM || a.site.id.localeCompare(b.site.id);

function project([lon,lat],meta) {
  const [w,s,e,n] = meta.bbox, [width,height] = meta.world;
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon<w || lon>=e || lat<=s || lat>n) return null;
  return [(lon-w)/(e-w)*width,(n-lat)/(n-s)*height];
}
function cellAt([x,y],net) {
  return Math.floor(y/net.world[1]*net.grid[1])*net.grid[0]+Math.floor(x/net.world[0]*net.grid[0]);
}

export function prepareWalking(data,catalog,meta) {
  if (data.profile!=='walk') throw Error('步行路网资料不匹配');
  const net=prepareNetwork(data,meta), targets=[], mask=Uint8Array.from(atob(catalog.groundMask),c=>c.charCodeAt(0));
  if (mask.length!==Math.ceil(net.grid[0]*net.grid[1]/8)) throw Error('地面水深覆盖资料不完整');
  const nodes=net.nodes;
  for (const f of catalog.facilities) {
    if (f.kind!=='indoor' || !f.xy || !Number.isInteger(f.cell) || f.cell<0 || f.cell>=net.grid[0]*net.grid[1] ||
        !(mask[f.cell>>3] & 1<<(f.cell%8)) ||
        !['needs_verification','open','verified_open'].includes(f.availability)) continue;
    const point=project(f.xy,meta);
    if (!point) continue;
    const nearby=[];
    for (let node=0; node<nodes.length; node++) {
      const dist=Math.hypot(nodes[node][1]-point[0],nodes[node][2]-point[1]);
      if (dist<=snapLimit) nearby.push({node,offset:dist});
    }
    nearby.sort((a,b)=>a.offset-b.offset);
    if (!nearby.length) continue;
    // Allow alternate approaches within one grid cell of the nearest reference match.
    const approaches=nearby.filter(a=>a.offset<=nearby[0].offset+meta.model.cell);
    targets.push({id:f.id,name:f.name,address:f.address,capacity:f.capacity,availability:f.availability,cell:f.cell,point,approaches});
  }
  const ends=[...new Set(targets.flatMap(f=>f.approaches.map(a=>a.node)))];
  const incoming=nodes.map(()=>[]);
  net.edges.forEach((edge,i)=>incoming[edge[1]].push(i));
  return {net,meta,mask,targets,ends,incoming};
}

export function locateWalker(model,coordinates) {
  const {net,meta}=model,point=project(coordinates,meta);
  if (!point) return {coordinates,status:'outside'};
  let nearest=-1,offset=Infinity;
  net.nodes.forEach(([,x,y],node)=>{
    const d=Math.hypot(point[0]-x,point[1]-y);
    if (d<offset) {offset=d;nearest=node;}
  });
  if (nearest<0 || offset>snapLimit) return {coordinates,point,status:'off_network'};
  return {coordinates,point,node:nearest,offset,cell:cellAt(point,net),status:'ready'};
}

export function demoPosition(model,node) {
  const [w,s,e,n]=model.meta.bbox,[width,height]=model.net.world;
  const point=model.net.nodes[node].slice(1);
  return {coordinates:[w+point[0]/width*(e-w),n-point[1]/height*(n-s)],point,node,offset:0,cell:cellAt(point,model.net),status:'ready'};
}

function rank(paths,sites,originOffset) {
  const ranked=[];
  for (const site of sites) {
    let best=null;
    for (const access of site.approaches) {
      const path=paths.get(access.node);
      if (!path) continue;
      const estimatedM=path.lengthM+access.offset+originOffset;
      if (!best || estimatedM<best.estimatedM) best={site,access,path,estimatedM};
    }
    if (best) ranked.push(best);
  }
  return ranked.sort(byDistance);
}

export function walkingBaseline(model,origin) {
  const paths=pathsToTargets(model.net,origin.node,model.ends);
  return {paths,ranked:rank(paths,model.targets,origin.offset)};
}

export function planWalk(model,origin,baseline,depth,limit) {
  const {net,mask}=model, empty={ranked:[]};
  if (origin?.status!=='ready') return {...empty,status:origin?.status||'no_location'};
  if (!depth || depth.length!==net.grid[0]*net.grid[1] || !Number.isFinite(limit) || limit<=0) return {...empty,status:'unknown'};
  const onGround=Boolean(mask[origin.cell>>3] & (1<<(origin.cell%8)));
  if (!onGround) return {...empty,status:'unmodeled_ground'};
  const snapCell=cellAt(net.nodes[origin.node].slice(1),net);
  const startValues=[depth[origin.cell],depth[snapCell]];
  if (startValues.some(v=>!validDepth(v))) return {...empty,status:'unknown'};
  if (startValues.some(v=>v>=limit)) return {...empty,status:'origin_flooded'};
  if (!baseline.ranked.length) return {...empty,status:'disconnected'};
  const sites=model.targets.filter(s=>validDepth(depth[s.cell]) && depth[s.cell]<limit);
  const ends=[...new Set(sites.flatMap(s=>s.approaches.map(a=>a.node)))];
  const {peak}=edgeDepths(net,depth);
  const safe=pathsToTargets(net,origin.node,ends,i=>peak(i)<limit);
  const ranked=rank(safe,sites,origin.offset);
  for (const row of ranked) {
    row.peak=row.path.edges.reduce((max,e)=>Math.max(max,peak(e)),depth[snapCell]);
    const ordinary=baseline.ranked.find(item=>item.site.id===row.site.id);
    row.baseline=ordinary.path;
    row.baselineAccess=ordinary.access;
    row.baselineEstimatedM=ordinary.estimatedM;
    row.basePeak=row.baseline.edges.reduce((max,e)=>Math.max(max,peak(e)),depth[snapCell]);
  }
  return {status:ranked.length?'ready':'no_safe_route',ranked,ordinary:baseline.ranked[0]};
}

// Reverse multi-source walking distances are used only to pick a meaningful random origin.
// The same access offsets, directions, ground cells and depth limits apply to the forward route.
function distancesToShelters(model,depth,limit) {
  const {net,incoming}=model,queue=new MinHeap();
  const distances=new Float64Array(net.nodes.length).fill(Infinity);
  const owners=new Int32Array(net.nodes.length).fill(-1);
  const peak=depth?edgeDepths(net,depth).peak:null;
  for (const [id,site] of model.targets.entries()) {
    if (depth && (!validDepth(depth[site.cell]) || depth[site.cell]>=limit)) continue;
    for (const {node,offset} of site.approaches) {
      const value=depth?.[cellAt(net.nodes[node].slice(1),net)];
      if ((depth && (!validDepth(value) || value>=limit)) || offset>=distances[node]) continue;
      distances[node]=offset;owners[node]=id;queue.push(offset,node);
    }
  }
  while (queue.items.length) {
    const [cost,node]=queue.pop();
    if (cost>distances[node]) continue;
    for (const e of incoming[node]) {
      const prev=net.edges[e][0],next=cost+net.lengths[e];
      if (next>=distances[prev] || (peak && !(peak(e)<limit))) continue;
      distances[prev]=next;owners[prev]=owners[node];queue.push(next,prev);
    }
  }
  return {distances,owners};
}

export function randomDemoNode(model,depth,limit,previous,rng=Math.random) {
  if (depth?.length!==model.net.grid[0]*model.net.grid[1]) return null;
  model.dryDistances??=distancesToShelters(model,null,limit);
  const dry=model.dryDistances,wet=distancesToShelters(model,depth,limit);
  const detours=[],changed=[],nearby=[],reachable=[];
  for (let i=0;i<wet.distances.length;i++) {
    const metres=wet.distances[i];
    if (i===previous || !Number.isFinite(metres)) continue;
    reachable.push(i);
    if (metres<180 || metres>1250) continue;
    nearby.push(i);
    if (metres-dry.distances[i]<20) continue;
    if (wet.owners[i]===dry.owners[i]) detours.push(i);
    else changed.push(i);
  }
  const pool=[detours,changed,nearby,reachable].find(group=>group.length);
  if (pool) return pool[Math.floor(rng()*pool.length)];
  return Number.isInteger(previous) && Number.isFinite(wet.distances[previous]) ? previous : null;
}

export function walkingSteps(net,path) {
  const directions=['东','东南','南','西南','西','西北','北','东北'],legs=[];
  for (const e of path.edges) {
    const [a,b,label]=net.edges[e],from=net.nodes[a],to=net.nodes[b],name=net.names[label];
    const dx=to[1]-from[1],dy=to[2]-from[2],heading=Math.atan2(dy,dx);
    const last=legs.at(-1);
    if (last && last.name===name && Math.cos(heading-last.heading)>0) {
      last.lengthM+=net.lengths[e];last.dx+=dx;last.dy+=dy;
      last.heading=Math.atan2(last.dy,last.dx);
    } else legs.push({name,heading,dx,dy,lengthM:net.lengths[e]});
  }
  return legs.map(l=>({name:l.name,lengthM:l.lengthM,direction:directions[(Math.round(l.heading/(Math.PI/4))+8)%8]}));
}
