import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { levelOf, levelColor } from './utils.js';

/* 监测点：光柱 + 脉冲环 + 悬浮标签 */
export function createSensors(sensors, meta, sampleElev, onPick) {
  const W = meta.world[0], H = meta.world[1];
  const group = new THREE.Group();
  group.name = 'sensors';
  const items = [];
  const hitMeshes = [];

  for (const s of sensors) {
    const x = s.x - W / 2, z = s.z - H / 2;
    const y = sampleElev(x, z);
    const g = new THREE.Group();
    g.position.set(x, y, z);

    // 光柱
    const beamGeo = new THREE.CylinderGeometry(1.2, 3.0, 110, 8, 1, true);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(0x35d0a5) }, uTime: { value: 0 }, uPulse: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; uniform vec3 uColor; uniform float uTime; uniform float uPulse;
        void main(){
          float a = pow(1.0-vUv.y, 2.2)*0.55 + 0.05;
          float scan = smoothstep(0.0,0.05,abs(fract(vUv.y*3.0-uTime*0.5)-0.5)-0.44);
          a += scan*0.25;
          gl_FragColor=vec4(uColor*(1.2+uPulse*0.3), a*uPulse);
        }`,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 55;
    g.add(beam);

    // 地面脉冲环
    const ringGeo = new THREE.RingGeometry(12, 15, 40);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x35d0a5, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1.2;
    g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(20, 21.5, 48), ringMat.clone());
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = 1.0;
    ring2.material.opacity = 0.3;
    g.add(ring2);

    // 顶部标记
    const pin = new THREE.Mesh(new THREE.OctahedronGeometry(5.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
    pin.position.y = 116;
    g.add(pin);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(13, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x35d0a5, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.position.y = 116;
    g.add(halo);

    // 标签
    const el = document.createElement('div');
    el.className = 'st-label';
    el.style.setProperty('--c', '#35d0a5');
    el.innerHTML = `<div class="st-dot"></div><div class="st-name">${s.name}</div><div class="st-val">0 cm</div>`;
    const label = new CSS2DObject(el);
    label.position.set(0, 140, 0);
    g.add(label);

    // 拾取
    const hit = new THREE.Mesh(new THREE.SphereGeometry(38, 8, 6),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hit.position.y = 50;
    hit.userData.sensor = s;
    g.add(hit);
    hitMeshes.push(hit);

    group.add(g);
    items.push({ s, g, beam, ring, ring2, pin, halo, label, el, x, y, z, depth: 0 });
  }

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  function onDown(e) {
    if (e.target !== document.querySelector('#scene-wrap canvas')) return;
    down = { x: e.clientX, y: e.clientY };
  }
  function onUp(e) {
    if (!down || !group.visible) { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, window.__camera);
    const hits = raycaster.intersectObjects(hitMeshes, false);
    if (hits.length) onPick(hits[0].object.userData.sensor);
  }
  addEventListener('pointerdown', onDown);
  addEventListener('pointerup', onUp);

  function update(frameSensors, selectedId, time) {
    // 按当前深度排序，控制标签数量
    const ranked = [...frameSensors].sort((a, b) => b.depth - a.depth);
    const showLabels = new Set(ranked.filter((x, i) => x.depth >= 0.10 || i < 3).slice(0, 7).map((x) => x.id));
    for (const it of items) {
      const fs = frameSensors.find((x) => x.id === it.s.id);
      const depth = fs?.depth ?? null;
      const lv = levelOf(depth, it.s.type);
      const c = lv.color;
      it.depth = depth;
      it.beam.material.uniforms.uColor.value.set(c);
      it.beam.material.uniforms.uTime.value = time;
      it.beam.material.uniforms.uPulse.value = lv.key === 'none' ? 0.45 : 1;
      it.ring.material.color.set(c);
      it.ring2.material.color.set(c);
      it.pin.material.color.set(c);
      it.halo.material.color.set(c);
      const pulse = 1 + Math.sin(time * (lv.key === 'none' ? 1 : 3.2) + it.x * 0.01) * (lv.key === 'none' ? 0.04 : 0.16);
      it.ring.scale.setScalar(pulse);
      it.ring2.scale.setScalar(1 + (pulse - 1) * 0.7);
      it.el.style.setProperty('--c', c);
      it.el.querySelector('.st-val').textContent = depth == null ? '暂无数据' : `${Math.round(depth * 100)} cm`;
      it.el.classList.toggle('off', !showLabels.has(it.s.id));
      it.el.classList.toggle('sel', selectedId === it.s.id);
      it.pin.rotation.y = time * 1.2;
    }
  }

  function setLayer(v) { group.visible = v; }
  function getWorld(id) {
    const it = items.find((x) => x.s.id === id);
    return it ? [it.x, it.y, it.z] : null;
  }
  return { group, update, setLayer, getWorld, items };
}
