import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { flyCamera } from './scene.js';
import { compareRoutes } from './route-comparison.js';
import { fmtT } from './utils.js';

const $ = id => document.getElementById(id);
const distance = m => m.toLocaleString('zh-CN', {maximumFractionDigits: 1}) + ' m';

export function createRouteView(app, fetchJSON) {
  const group = new THREE.Group();
  app.scene.add(group);
  let cases, loading, active = false, drawn, frameCase;
  const select = $('route-case'), limit = $('route-limit');
  const width = app.meta.world[0], height = app.meta.world[1];

  function clearLines() {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
      child.element?.remove();
    }
    drawn = null;
  }

  // A terrain-following ribbon with constant map width, raised over the flood surface.
  function line(path, color, dashed) {
    const vertices = [];
    const add = (x, z) => vertices.push(x, app.sampleElev(x, z) + (dashed ? 6 : 8), z);
    let along = 0;
    for (let i = 1; i < path.points.length; i++) {
      const [x,z] = path.points[i-1], [u,v] = path.points[i];
      const dx = u-x, dz = v-z, length = Math.hypot(dx,dz);
      if (!length) continue;
      const nx = -dz/length*6, nz = dx/length*6;
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
    const mesh = new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
    mesh.renderOrder = dashed ? 10 : 11;
    group.add(mesh);
  }

  function endpoint(point, label) {
    const el = document.createElement('span');
    el.className = 'route-pin';
    el.textContent = label;
    const pin = new CSS2DObject(el);
    const x = point[0]-width/2, z = point[1]-height/2;
    pin.position.set(x,app.sampleElev(x,z)+24,z);
    group.add(pin);
  }

  function frame() {
    if (!active || !cases || !app.currentDepth) return;
    const routeCase = cases[Number(select.value)];
    const result = compareRoutes(routeCase.paths,app.currentDepth,Number(limit.value));
    if (!result) {
      clearLines();
      $('route-base').textContent = $('route-alt').textContent = '—';
      $('route-streets').textContent = '';
      $('route-result').textContent = '路线与当前水深数据不匹配';
      return;
    }
    const {baseline, alternative} = result;
    const same = baseline === alternative;
    $('route-ends').textContent = routeCase.start + ' → ' + routeCase.end;
    $('route-time').textContent = app.scenario.short + ' · ' + fmtT(app.scenario.frames[app.idx].t);
    $('route-base').textContent = distance(baseline.path.lengthM) + ' · 最高 ' + baseline.peakCm + ' cm';
    $('route-alt').textContent = alternative ? distance(alternative.path.lengthM) + ' · 最高 ' + alternative.peakCm + ' cm' : '无符合条件的候选线';
    $('route-result').textContent = !alternative ? '当前所有候选线均达到排除水深。' :
      same ? '常规路线沿线水深低于阈值，无需绕行。' :
      '绕行增加 ' + Math.round(alternative.path.lengthM - baseline.path.lengthM) + ' 米。';
    $('route-streets').textContent = alternative ? '途经 ' + (alternative.path.streets.join('、') || '未命名道路') : '';
    if (drawn && frameCase === routeCase && drawn.alternative?.path === alternative?.path) return;
    clearLines();
    if (!same) line(baseline.path,0xffb35a,true);
    if (alternative) line(alternative.path,0x54f3e0,false);
    endpoint(baseline.path.points[0],'起'); endpoint(baseline.path.points.at(-1),'终');
    drawn = result; frameCase = routeCase;
  }

  function locate() {
    if (!cases) return;
    const pts = cases[Number(select.value)].paths.flatMap(p => p.points);
    const xs = pts.map(p=>p[0]-width/2), zs = pts.map(p=>p[1]-height/2);
    const x = (Math.max(...xs)+Math.min(...xs))/2, z = (Math.max(...zs)+Math.min(...zs))/2;
    const span = Math.max(650, (Math.max(...xs)-Math.min(...xs))/Math.min(1,app.camera.aspect),
      Math.max(...zs)-Math.min(...zs));
    flyCamera(app.camera,app.controls,[x,span*1.45,z+span*.7],[x,app.sampleElev(x,z),z],900);
  }

  async function show(on) {
    active = on;
    group.visible = on;
    if (!on) return;
    if (!cases) {
      $('route-result').textContent='正在加载候选路线…';
      try {
        loading ??= fetchJSON('./data/route-candidates.json');
        const data = await loading;
        if (data.grid.join() !== [app.meta.model.nx,app.meta.model.ny].join() ||
            data.world.join() !== app.meta.world.join() || !data.cases.length) throw Error();
        for (const c of data.cases) {
          if (!c.label || !c.start || !c.end || !Array.isArray(c.paths) || !c.paths.length ||
              !c.paths.every(p => p.points?.length >= 2 && p.points.every(point =>
                point.length === 2 && point.every(Number.isFinite)) && Array.isArray(p.streets)) ||
              !compareRoutes(c.paths, app.currentDepth, 15)) throw Error('路线资料无效');
        }
        cases = data.cases;
        select.replaceChildren(...cases.map((c,i)=>new Option(c.label,String(i))));
        select.disabled = limit.disabled = $('route-example').disabled = $('route-locate').disabled = false;
      } catch {
        loading = null;
        $('route-result').textContent='路线资料不可用。请再次点击“积水绕行”重试。';
        return;
      }
    }
    if (active) { frame(); locate(); }
  }
  select.onchange = () => { frame(); locate(); };
  limit.onchange = frame;
  $('route-locate').onclick = () => {
    if (matchMedia('(max-width:700px)').matches && !document.body.classList.contains('map-focused')) {
      $('btn-focus').click();
    }
    locate();
  };
  $('route-example').onclick = async () => {
    if (app.loading || !cases) return;
    if (app.scenario.id !== 'replay-2309' && !await app.setScenario('replay-2309', true)) return;
    if (!active || app.scenario.id !== 'replay-2309') return;
    const example = cases.findIndex(c => c.label === '红荔路片区');
    const index = app.scenario.frames.findIndex(f => f.t === 240);
    if (example < 0 || index < 0) return;
    app.togglePlay(false);
    select.value = String(example);
    limit.value = '15';
    app.setFrame(index);
    locate();
  };
  return {show,frame,reset() { select.selectedIndex=0; limit.value='15'; clearLines(); }};
}
