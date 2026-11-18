import * as THREE from 'three';

/* 降雨粒子：CPU 更新的线段雨幕，始终跟随相机 */
export function createRain(scene) {
  const COUNT = 7000;
  const RANGE = 3600, HEIGHT = 1500;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(COUNT * 6);
  const data = [];
  for (let i = 0; i < COUNT; i++) {
    const x = (Math.random() - 0.5) * RANGE;
    const z = (Math.random() - 0.5) * RANGE;
    const y = Math.random() * HEIGHT;
    const len = 22 + Math.random() * 55;
    const speed = 900 + Math.random() * 700;
    data.push({ x, z, y, len, speed });
    pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
    pos[i * 6 + 3] = x + 0.22 * len; pos[i * 6 + 4] = y - len; pos[i * 6 + 5] = z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x7197b0, transparent: true, opacity: 0.28,
    blending: THREE.NormalBlending, depthWrite: false,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.name = 'rain';
  scene.add(lines);

  let intensity = 0.6;
  let enabled = true;
  function update(dt, camera, rainRate, on = true) {
    enabled = on;
    if (!enabled) { lines.visible = false; return; }
    intensity += ((rainRate > 0.3 ? Math.min(1, 0.15 + rainRate / 45) : 0) - intensity) * Math.min(1, dt * 2);
    lines.visible = intensity > 0.02;
    mat.opacity = 0.05 + intensity * 0.22;
    if (!lines.visible) return;
    lines.position.x = camera.position.x;
    lines.position.z = camera.position.z;
    const p = geo.attributes.position.array;
    const move = dt * 0.85;
    for (let i = 0; i < COUNT; i++) {
      const d = data[i];
      d.y -= d.speed * move;
      if (d.y < -10) {
        d.y = HEIGHT + Math.random() * 200;
        d.x = (Math.random() - 0.5) * RANGE;
        d.z = (Math.random() - 0.5) * RANGE;
      }
      p[i * 6] = d.x; p[i * 6 + 1] = d.y; p[i * 6 + 2] = d.z;
      p[i * 6 + 3] = d.x + 0.22 * d.len; p[i * 6 + 4] = d.y - d.len; p[i * 6 + 5] = d.z;
    }
    geo.attributes.position.needsUpdate = true;
  }
  function setVisible(v) { enabled = v; lines.visible = v; }
  return { lines, update, setVisible };
}
