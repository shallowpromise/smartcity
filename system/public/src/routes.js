import * as THREE from 'three';
import { createRouteMap } from './route-map.js';
import { prepareNetwork, shortestPath, routeAtFrame } from './road-router.js';
import { fmtT } from './utils.js';

const $ = id => document.getElementById(id);
const distance = m => Math.round(m).toLocaleString('zh-CN') + ' 米';
const cm = depth => !Number.isFinite(depth) ? '缺测' : (depth === 255 ? '≥255' : depth) + ' cm';
const example = [7959603173, 8516154909];

export function createRouteView(app, fetchJSON) {
  const {group,clearLines,line,pin,fit}=createRouteMap(app);
  let net, pending, result, baseline, picking, pointerDown, active = false;
  const from = $('route-from'), to = $('route-to'), limit = $('route-limit');
  const scenario = $('route-scenario'), choice=$('route-choice');
  let facility=null;
  const [width, height] = app.meta.world;
  const usualMaxDistance = app.controls.maxDistance;
  const hint = $('pick-hint');

  function frame() {
    if (!active || !net || !app.currentDepth) return;
    const start = Number(from.value), end = Number(to.value);
    const preference=facility?choice.value:'short';
    result = routeAtFrame(net,start,end,baseline,app.currentDepth,Number(limit.value),preference);
    const {status, alternative, hotspot} = result;
    const failure = {same:'请选择两个不同的路网节点。', disconnected:'这两个节点在当前有向路网上不可达。',
      blocked:'当前时刻没有满足水深条件的路线。', unknown:'路面水深资料不足。'};
    scenario.value = app.scenario.id;
    $('route-time').textContent = app.scenario.short + ' · ' + fmtT(app.scenario.frames[app.idx].t);
    $('route-base').textContent = baseline ? distance(baseline.lengthM) + ' · 最高 ' + cm(result.baselinePeak) : '—';
    $('route-alt').textContent = alternative ? distance(alternative.lengthM) + ' · 最高 ' + cm(result.alternativePeak) : '—';
    $('route-result').dataset.routeStatus=result.code||status;
    $('route-alt-label').textContent=preference==='low'?'低水深优先路线':'避水最短路线';
    $('route-result').textContent = failure[status] || (status === 'clear' ? '常规路线低于阈值，无需绕行。' :
      (hotspot?'避开'+hotspot.name:preference==='low'?'按水深与道路等级选线':'绕开缺测路段')+
      '，多走 ' + distance(Math.max(0,alternative.lengthM-baseline.lengthM)) + '。');
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

  function setFacility(f) {
    facility=f;
    $('route-transfer').hidden=$('route-choice-label').hidden=!f;
    $('route-transfer').textContent=f?'接驳目标 · '+f.name+'。道路节点距场所参考点 '+f.roadOffsetM+' m，实际入口与开放状态待核。':'';
    choice.value='short';
  }
  function destination(f) {
    const index=net?.nodes.findIndex(n=>n[0]===f.roadNode)??-1;
    if(index<0){$('route-result').textContent='场所接驳节点不可用。';return;}
    if(![...to.options].some(o=>o.value===String(index)))to.add(new Option(f.name+'附近道路',String(index)));
    to.value=String(index);
    setFacility(f);
    selectNodes();
  }

  function locate() {
    if (!active || !net) return;
    const points = [...(baseline?.points || []), ...(result?.alternative?.points || []),
      net.nodes[Number(from.value)].slice(1), net.nodes[Number(to.value)].slice(1)];
    fit(points,document.querySelector('.route-panel'));
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
    if(target===to)setFacility(null);
    if (!target.querySelector('option[value="'+best+'"]')) {
      const edge = net.edges.find(([a,b])=>a===best || b===best);
      target.add(new Option((net.names[edge[2]] || '地面道路')+' · '+net.nodes[best][0],String(best)));
    }
    target.value=String(best);
    setPicking(null);
    selectNodes();
  });

  function exampleNodes() {
    setFacility(null);
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
  from.onchange = () => selectNodes();
  to.onchange = () => {setFacility(null);selectNodes();};
  choice.onchange = () => {frame();locate();};
  scenario.onchange = async () => { await app.setScenario(scenario.value,true); scenario.value=app.scenario.id; };
  limit.onchange = () => { frame(); locate(); };
  $('route-example').onclick = showExample;
  $('route-locate').onclick = () => {
    if (innerWidth <= 700 && !document.body.classList.contains('map-focused')) $('btn-focus').click();
    locate();
  };
  addEventListener('resize', locate);
  return {show,frame,locate,showExample,destination,reset() { if (net) exampleNodes(); clearLines(); }};
}
