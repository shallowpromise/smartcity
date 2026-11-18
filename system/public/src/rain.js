import * as THREE from 'three';

// A near-camera rain layer with widths in CSS pixels, including at city-wide zoom.
// Each instance is one tapered drop; time is animated on the GPU.
export function createRain(scene) {
  const capacity = 1000;
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0,
  ], 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const seeds = new Float32Array(capacity * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  geometry.setAttribute('drop', new THREE.InstancedBufferAttribute(seeds, 3));

  const uniforms = {
    viewport: { value: new THREE.Vector2() }, seconds: { value: 0 }, strength: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    vertexShader: `
      attribute vec3 drop;
      uniform vec2 viewport;
      uniform float seconds, strength;
      varying vec2 ribbon;
      varying float weight;
      void main() {
        float layer = drop.z;
        float lengthPx = mix(13.0, 35.0, layer) * (0.70 + 0.8 * strength);
        float speed = mix(280.0, 650.0, layer) * (0.80 + 0.45 * strength);
        float period = viewport.y + 100.0;
        float fall = fract(drop.y + seconds * speed / period);
        vec2 head = vec2(fract(drop.x - fall * 0.18 * period / viewport.x) * (viewport.x + 16.0) - 8.0,
                         fall * period - 46.0);
        vec2 direction = normalize(vec2(-0.18, 1.0));
        vec2 normal = vec2(direction.y, -direction.x);
        vec2 pixel = head - direction * (1.0 - position.y) * lengthPx
                    + normal * position.x * mix(0.95, 1.90, layer);
        gl_Position = vec4(pixel / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
        ribbon = position.xy;
        weight = mix(0.53, 1.0, layer);
      }`,
    fragmentShader: `
      uniform float strength;
      varying vec2 ribbon;
      varying float weight;
      void main() {
        float body = 1.0 - smoothstep(0.30, 1.0, abs(ribbon.x));
        float tail = smoothstep(0.0, 0.68, ribbon.y) * (1.0 - smoothstep(0.92, 1.0, ribbon.y));
        float glint = smoothstep(0.06, 0.72, ribbon.x);
        vec3 color = mix(vec3(0.012,0.052,0.109), vec3(0.82,0.94,1.0), glint);
        gl_FragColor = vec4(color, body * tail * weight * (0.52 + 0.42 * strength));
      }`,
  });
  const lines = new THREE.Mesh(geometry, material);
  lines.name = 'rain';
  lines.frustumCulled = false;
  lines.renderOrder = 7; // Above the water, below route highlights.
  lines.visible = false;
  scene.add(lines);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function update(dt, rainRate, on) {
    const strength = Math.min(1, Math.max(0, rainRate) / 80);
    lines.visible = on && strength > 0;
    if (!lines.visible) return 0;
    const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
    uniforms.viewport.value.set(width, height);
    uniforms.strength.value = strength;
    const density = Math.sqrt(strength) * (reducedMotion.matches ? 0.45 : 1);
    geometry.instanceCount = Math.min(capacity, Math.ceil(width * height / 2100 * density));
    if (!reducedMotion.matches) uniforms.seconds.value += dt;
    return reducedMotion.matches ? 0 : strength;
  }
  return { lines, update, setVisible(on) { if (!on) lines.visible = false; } };
}
