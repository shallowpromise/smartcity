import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { flyCamera } from './scene.js';
import { prepareNetwork, shortestPath, routeAtFrame } from './road-router.js';
import { fmtT } from './utils.js';

const $ = id => document.getElementById(id);
const distance = m => Math.round(m).toLocaleString('zh-CN') + ' 米';
const cm = depth => !Number.isFinite(depth) ? '缺测' : (depth === 255 ? '≥255' : depth) + ' cm';
const example = [7959603173, 8516154909];

export function createRouteView(app, fetchJSON) {
  const group = new THREE.Group();
  app.scene.add(group);
  let net, pending, result, baseline, picking, pointerDown, active = false;
  const from = $('route-from'), to = $('route-to'), limit = $('route-limit');
  const scenario = $('route-scenario');
  const [width, height] = app.meta.world;
  const usualMaxDistance = app.controls.maxDistance;
  const hint = $('pick-hint');

  function clearLines() {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
      child.element?.remove();
    }

  }

  // A terrain-following ribbon with constant map width, raised over the flood surface.
  function line(points, color, dashed, halfWidth = 4, order = 11) {
    const vertices = [];
    const add = (x, z) => vertices.push(x, app.sampleElev(x, z) + 7, z);
    let along = 0;
    for (let i = 1; i < points.length; i++) {
      const [x,z] = points[i-1], [u,v] = points[i];
      const dx = u-x, dz = v-z, length = Math.hypot(dx,dz);
      if (!length) continue;
      const nx = -dz/length*halfWidth, nz = dx/length*halfWidth;
      const steps = Math.ceil(length/8);
      for (let k = 0; k < steps; k++) {
        if (dashed && Math.floor((along + k*length/steps)/22)%2) continue;
        const a = x-width/2+dx*k/steps, b = z-height/2+dz*k/steps;
        const c = a+dx/steps, d = b+dz/steps;
        add(a+nx,b+nz); add(a-nx,b-nz); add(c+nx,d+nz);
        add(a-nx,b-nz); add(c-nx,d-nz); add(c+nx,d+nz);
      }
      along += length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
    const mesh = new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,fog:false}));
    mesh.renderOrder = order;
    group.add(mesh);
  }

  function pin(point, label, peak = false) {
    const el = document.createElement('span');
    el.className = peak ? 'route-pin peak-pin' : 'route-pin';
    el.textContent = label;
    const pin = new CSS2DObject(el);
    if (peak) pin.center.set(.5,1.35);
    const x = point[0]-width/2, z = point[1]-height/2;
    pin.position.set(x,app.sampleElev(x,z)+7,z);
    group.add(pin);
  }

  function frame() {
    if (!active || !net || !app.currentDepth) return;
    const start = Number(from.value), end = Number(to.value);
    result = routeAtFrame(net,start,end,baseline,app.currentDepth,Number(limit.value));
    const {status, alternative, hotspot} = result;
    const failure = {same:'请选择两个不同的路网节点。', disconnected:'这两个节点在当前有向路网上不可达。',
      blocked:'当前时刻没有满足水深条件的路线。', unknown:'路面水深资料不足。'};
    scenario.value = app.scenario.id;
    $('route-time').textContent = app.scenario.short + ' · ' + fmtT(app.scenario.frames[app.idx].t);
    $('route-base').textContent = baseline ? distance(baseline.lengthM) + ' · 最高 ' + cm(result.baselinePeak) : '—';
    $('route-alt').textContent = alternative ? distance(alternative.lengthM) + ' · 最高 ' + cm(result.alternativePeak) : '—';
    $('route-result').textContent = failure[status] || (status === 'clear' ? '常规路线低于阈值，无需绕行。' :
      '避开' + (hotspot?.name || '风险路段') + '，多走 ' + distance(alternative.lengthM-baseline.lengthM) + '。');
    const streets = alternative && [...new Set(alternative.edges.map(i=>net.names[net.edges[i][2]]).filter(Boolean))];
    $('route-streets').textContent = streets?.length ? '途经 ' + streets.join('、') : '';
    clearLines();
    if (baseline && baseline !== alternative) line(baseline.points,0xaa570a,true);
    if (alternative) line(alternative.points,0x007d76,false);
    for (const segment of result.flooded || []) line(segment,0xc31f42,false,6,13);
    if (hotspot) pin(hotspot.point,'积水 ' + cm(hotspot.cm),true);
    pin(net.nodes[start].slice(1),'起');
    if (end !== start) pin(net.nodes[end].slice(1),'终');
  }

  function selectNodes(fit = true) {
    baseline = shortestPath(net, Number(from.value), Number(to.value));
    frame();
    if (fit) locate();
  }

  function locate() {
    if (!active || !net) return;
    const panel = document.querySelector('.route-panel').getBoundingClientRect();
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom + 32;
    let left = 16, right = innerWidth - (innerWidth <= 700 && panel.width ? 16 : 68), bottom = document.querySelector('.timeline').getBoundingClientRect().top-32;
    if (panel.width) {
      if (innerWidth <= 700) bottom = Math.min(bottom, panel.top-10);
      else left = panel.right + 20;
    }
    const usableW = Math.max(100,right-left), usableH = Math.max(100,bottom-top);
    const camera = app.camera;
    camera.setViewOffset(innerWidth,innerHeight,(innerWidth-left-right)/2,(innerHeight-top-bottom)/2,innerWidth,innerHeight);
    const points = [...(baseline?.points || []), ...(result?.alternative?.points || []),
      net.nodes[Number(from.value)].slice(1), net.nodes[Number(to.value)].slice(1)];
    const xs = points.map(p=>p[0]), zs = points.map(p=>p[1]);
    const dx = Math.max(...xs)-Math.min(...xs), dz = Math.max(...zs)-Math.min(...zs);
    const x = Math.min(...xs)+dx/2-width/2, z = Math.min(...zs)+dz/2-height/2;
    const altitude = Math.max(320, (innerHeight/2)/Math.tan(camera.fov*Math.PI/360) *
      Math.max((dx+100)/usableW,(dz+100)/usableH)*1.14);
    const y = app.sampleElev(x,z);
    flyCamera(camera,app.controls,[x,y+altitude,z+altitude*.12],[x,y,z],matchMedia('(prefers-reduced-motion:reduce)').matches ? 1 : 420);
  }

  function setPicking(target) {
    picking = target;
    hint.hidden = !target;
    document.body.classList.toggle('route-picking',Boolean(target));
    if (target) hint.querySelector('span').textContent = '点击地面道路选择' + (target === from ? '起点' : '终点');
  }
  hint.querySelector('button').onclick = () => setPicking(null);
  addEventListener('keydown', e => { if (picking && e.key === 'Escape') setPicking(null); });
  for (const button of document.querySelectorAll('[data-pick]')) {
    button.onclick = () => setPicking(button.dataset.pick === 'from' ? from : to);
  }
  const canvas = app.renderer.domElement;
  canvas.addEventListener('pointerdown', e => { pointerDown = [e.clientX,e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!picking || !pointerDown || Math.hypot(e.clientX-pointerDown[0],e.clientY-pointerDown[1])>5) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({x:2*e.clientX/innerWidth-1,y:1-2*e.clientY/innerHeight}, app.camera);
    const hit = ray.intersectObject(app.terrain,false)[0];
    let best = -1, nearest = 120;
    if (hit) net.nodes.forEach(([,x,z], i) => {
      const d = Math.hypot(x-width/2-hit.point.x,z-height/2-hit.point.z);
      if (d<nearest) { nearest=d; best=i; }
    });
    if (best<0) { hint.querySelector('span').textContent='附近 120 米内无可选节点，请点近一些。'; return; }
    const target = picking;
    if (!target.querySelector('option[value="'+best+'"]')) {
      const edge = net.edges.find(([a,b])=>a===best || b===best);
      target.add(new Option((net.names[edge[2]] || '地面道路')+' · '+net.nodes[best][0],String(best)));
    }
    target.value=String(best);
    setPicking(null);
    selectNodes();
  });

  function exampleNodes() {
    [from.value,to.value] = example.map(osm=>String(net.nodes.findIndex(n=>n[0]===osm)));
    limit.value='15';
  }
  async function showExample() {
    if (!net || app.loading) return;
    if (app.scenario.id !== 'replay-2309' && !await app.setScenario('replay-2309',true)) return;
    if (!active || app.scenario.id !== 'replay-2309') return;
    app.togglePlay(false);
    exampleNodes();
    selectNodes(false);
    app.setFrame(app.scenario.frames.findIndex(f=>f.t===240));
    locate();
  }

  async function show(on) {
    active = on;
    group.visible = on;
    setPicking(null);
    if (!on) {
      app.camera.clearViewOffset();
      app.controls.maxDistance = usualMaxDistance;
      return;
    }
    app.controls.maxDistance = 24000;
    if (!net) {
      $('route-result').textContent = '加载福田地面路网…';
      try {
        pending ??= fetchJSON('./data/road-network.json').then(data=>prepareNetwork(data,app.meta));
        const network = await pending;
        if (!net) {
          net = network;
          const sorted = [...net.junctions].sort((a,b)=>a[1].localeCompare(b[1],'zh-CN'));
          const groups = new Map();
          for (const [id,name] of sorted) {
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name).push(id);
          }
          const options = sorted.map(([id,name]) => {
            const ids = groups.get(name);
            let label = name;
            if (ids.length > 1) {
              const [,x,z] = net.nodes[id];
              const dx = x - ids.reduce((sum,i)=>sum+net.nodes[i][1],0)/ids.length;
              const dz = z - ids.reduce((sum,i)=>sum+net.nodes[i][2],0)/ids.length;
              const side = ['东','东南','南','西南','西','西北','北','东北'][(Math.round(Math.atan2(dz,dx)/(Math.PI/4))+8)%8];
              label += '（' + side + '侧 ' + (ids.indexOf(id)+1) + '）';
            }
            const option = new Option(label, String(id));
            option.title = name + ' · OSM ' + net.nodes[id][0];
            return option;
          });
          from.replaceChildren(...options);
          to.replaceChildren(...options.map(option=>option.cloneNode(true)));
          exampleNodes();
          scenario.replaceChildren(...app.scenarios.map(s=>new Option(s.short,s.id)));
          document.querySelectorAll('.route-panel [disabled]').forEach(el=>el.disabled=false);
        }
      } catch {
        pending=null;
        $('route-result').textContent='路网资料不可用，请再点“积水绕行”重试。';
        return;
      }
    }
    if (active) selectNodes();
  }
  from.onchange = to.onchange = () => selectNodes();
  scenario.onchange = async () => { await app.setScenario(scenario.value,true); scenario.value=app.scenario.id; };
  limit.onchange = () => { frame(); locate(); };
  $('route-example').onclick = showExample;
  $('route-locate').onclick = () => {
    if (innerWidth <= 700 && !document.body.classList.contains('map-focused')) $('btn-focus').click();
    locate();
  };
  addEventListener('resize', locate);
  return {show,frame,locate,showExample,reset() { if (net) exampleNodes(); clearLines(); }};
}
