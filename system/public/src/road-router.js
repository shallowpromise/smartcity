// Edge-state Dijkstra: arriving from a different road can change which turns are legal.
export function prepareNetwork(data, meta) {
  if (data.version !== 1 || data.grid.join() !== [meta.model.nx, meta.model.ny].join() ||
      data.world.join() !== meta.world.join() || !data.nodes.length || !data.edges.length) {
    throw Error('路网与水深网格不匹配');
  }
  const {nodes, edges, grid, world} = data;
  const outgoing = nodes.map(() => []);
  const lengths = new Float64Array(edges.length);
  const forbidden = new Map();
  for (const [i, edge] of edges.entries()) {
    const [a,b] = edge, cells = edge[4];
    if (!nodes[a] || !nodes[b] || !cells.length || cells.some(c => !Number.isInteger(c) || c < 0 || c >= grid[0]*grid[1])) {
      throw Error('无效的路段或水深网格编号');
    }
    outgoing[a].push(i);
    lengths[i] = Math.hypot(nodes[a][1]-nodes[b][1], nodes[a][2]-nodes[b][2]);
  }
  for (const [a,b] of data.turns) {
    if (!forbidden.has(a)) forbidden.set(a, new Set());
    forbidden.get(a).add(b);
  }
  return {...data, world, outgoing, lengths, forbidden, labels:new Map(data.junctions)};
}

class MinHeap {
  items = [];
  push(cost, edge) {
    let i = this.items.length;
    while (i > 0) {
      const parent = (i-1) >> 1;
      if (this.items[parent][0] <= cost) break;
      this.items[i] = this.items[parent];
      i = parent;
    }
    this.items[i] = [cost,edge];
  }
  pop() {
    const root = this.items[0], last = this.items.pop();
    if (this.items.length) {
      let i = 0;
      for (;;) {
        let child = 2*i + 1;
        if (child >= this.items.length) break;
        if (child+1 < this.items.length && this.items[child+1][0] < this.items[child][0]) child++;
        if (last[0] <= this.items[child][0]) break;
        this.items[i] = this.items[child];
        i = child;
      }
      this.items[i] = last;
    }
    return root;
  }
}

export function shortestPath(net, start, end, allowed = () => true) {
  if (!net.nodes[start] || !net.nodes[end] || start === end) return null;
  const queue = new MinHeap(), distance = new Float64Array(net.edges.length).fill(Infinity);
  const previous = new Int32Array(net.edges.length);
  queue.push(0,-1);
  while (queue.items.length) {
    const [cost, incoming] = queue.pop();
    if (incoming >= 0 && distance[incoming] < cost) continue;
    const node = incoming < 0 ? start : net.edges[incoming][1];
    if (node === end) {
      const edges = [];
      for (let i = incoming; i >= 0; i = previous[i]) edges.push(i);
      edges.reverse();
      return {edges, lengthM:cost, points:[start, ...edges.map(i=>net.edges[i][1])].map(i=>net.nodes[i].slice(1))};
    }
    for (const edge of net.outgoing[node]) {
      if (incoming >= 0 && (net.edges[edge][1] === net.edges[incoming][0] || net.forbidden.get(incoming)?.has(edge))) continue;
      const next = cost + net.lengths[edge];
      if (next >= distance[edge] || !allowed(edge)) continue;
      distance[edge] = next;
      previous[edge] = incoming;
      queue.push(next,edge);
    }
  }
  return null;
}

// Split at grid boundaries to draw only the part of a road actually crossing a wet cell.
function sections(net, from, to) {
  const [x,z] = from, dx = to[0]-x, dz = to[1]-z;
  const cuts = [0,1];
  for (const [origin,delta,size] of [[x,dx,net.world[0]/net.grid[0]], [z,dz,net.world[1]/net.grid[1]]]) {
    const u = origin/size, v = (origin+delta)/size;
    for (let k = Math.floor(Math.min(u,v))+1; k < Math.max(u,v); k++) cuts.push((k*size-origin)/delta);
  }
  cuts.sort((a,b)=>a-b);
  const at = t => [x+t*dx,z+t*dz];
  const spans = [];
  for (let k = 1; k < cuts.length; k++) {
    if (cuts[k]-cuts[k-1] < 1e-10) continue;
    const p = at((cuts[k-1]+cuts[k])/2);
    const cell = Math.floor(p[1]/net.world[1]*net.grid[1])*net.grid[0] + Math.floor(p[0]/net.world[0]*net.grid[0]);
    spans.push({cell, points:[at(cuts[k-1]), at(cuts[k])], midpoint:p});
  }
  return spans;
}

export function routeAtFrame(net, start, end, baseline, depth, limit) {
  if (start === end) return {status:'same'};
  if (!baseline) return {status:'disconnected'};
  if (depth?.length !== net.grid[0]*net.grid[1]) return {status:'unknown'};
  const peaks = new Map();
  function peak(edge) {
    if (peaks.has(edge)) return peaks.get(edge);
    let value = 0;
    for (const i of net.edges[edge][4]) {
      if (!Number.isFinite(depth[i]) || depth[i] < 0) { value = NaN; break; }
      value = Math.max(value,depth[i]);
    }
    peaks.set(edge,value);
    return value;
  }
  const maxDepth = path => path.edges.reduce((m,e)=>Math.max(m,peak(e)),0);
  const baselinePeak = maxDepth(baseline);
  const alternative = baselinePeak < limit ? baseline : shortestPath(net,start,end,i=>peak(i)<limit);
  const flooded = [];
  let hotspot;
  for (const [k,edge] of baseline.edges.entries()) {
    const cells = net.edges[edge][4];
    if (!cells.some(c=>depth[c]>=limit)) continue;
    const [a,b] = baseline.points.slice(k,k+2);
    const name = net.names[net.edges[edge][2]] || '未名路段';
    for (const span of sections(net,a,b)) {
      const cm = depth[span.cell];
      if (cm >= limit) {
        flooded.push(span.points);
        if (!hotspot || cm > hotspot.cm) hotspot = {cm,name,point:span.midpoint};
      }
    }
    for (const p of [a,b]) {
      const cell = Math.floor(p[1]/net.world[1]*net.grid[1])*net.grid[0]+Math.floor(p[0]/net.world[0]*net.grid[0]);
      if (depth[cell] >= limit && (!hotspot || depth[cell]>hotspot.cm)) hotspot = {cm:depth[cell],name,point:p};
    }
  }
  let status = alternative === baseline ? 'clear' : alternative ? 'detour' : 'blocked';
  if (!alternative && [...peaks.values()].some(Number.isNaN) &&
      shortestPath(net,start,end,i=>!(peak(i)>=limit))) status = 'unknown';
  return {status, baseline, alternative, baselinePeak, alternativePeak:alternative ? maxDepth(alternative) : null, flooded, hotspot};
}
