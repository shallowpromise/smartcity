import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x081421, 0.000135);
  scene.background = new THREE.Color(0x040a12);

  const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 1, 40000);
  camera.position.set(0, 1250, 1450);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 20, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.maxPolarAngle = 1.46;
  controls.minDistance = 220;
  controls.maxDistance = 5200;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;
  controls.enablePan = true;
  controls.addEventListener('start', () => cancelAnimationFrame(controls._flight));

  scene.add(new THREE.HemisphereLight(0x9fcfff, 0x07111f, 1.15));
  scene.add(new THREE.AmbientLight(0x2b5b86, 0.5));
  const sun = new THREE.DirectionalLight(0xffd9b0, 2.1);
  sun.position.copy(SUN_DIR).multiplyScalar(5000);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x4fc6ff, 0.65);
  rim.position.set(2600, 1200, -2800);
  scene.add(rim);

  // 天空穹顶
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x02060e) },
      uMid: { value: new THREE.Color(0x08203a) },
      uHorizon: { value: new THREE.Color(0x2a4b63) },
      uSun: { value: new THREE.Color(0xffb877) },
      uSunDir: { value: SUN_DIR.clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uTop,uMid,uHorizon,uSun,uSunDir;
      void main(){
        float h = clamp(vDir.y,-0.2,1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02,0.28,h));
        col = mix(col, uTop, smoothstep(0.18,0.85,h));
        float s = max(dot(normalize(vDir), normalize(uSunDir)),0.0);
        col += uSun * (pow(s,180.0)*0.9 + pow(s,12.0)*0.09);
        float band = smoothstep(0.02,0.0,abs(h-0.01));
        col += vec3(0.12,0.22,0.28)*band*0.35;
        gl_FragColor = vec4(col,1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(16000, 32, 20), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // 远景地面，遮住地形边缘
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60000, 60000),
    new THREE.MeshBasicMaterial({ color: 0x050d16, fog: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -12;
  scene.add(ground);

  // 星空
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 700; i++) {
    const r = 14000, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.75 + 0.1);
    starPos.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.75 + 1200, r * Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9dc8e8, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.55, depthWrite: false })));

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.52, 0.72, 0.78);
  composer.addPass(bloom);
  const fxaa = new ShaderPass(FXAAShader);
  fxaa.material.uniforms['resolution'].value.set(1 / (innerWidth * renderer.getPixelRatio()), 1 / (innerHeight * renderer.getPixelRatio()));
  composer.addPass(fxaa);
  composer.addPass(new OutputPass());

  function resize() {
    const w = innerWidth, h = innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    fxaa.material.uniforms['resolution'].value.set(1 / (w * renderer.getPixelRatio()), 1 / (h * renderer.getPixelRatio()));
  }
  addEventListener('resize', resize);

  return { renderer, scene, camera, controls, composer, sky, sun, bloom, resize };
}

/* 相机飞行动画 */
export function flyCamera(camera, controls, to, target = null, duration = 1600, onDone = null) {
  cancelAnimationFrame(controls._flight);
  const p0 = camera.position.clone();
  const t0 = controls.target.clone();
  const p1 = new THREE.Vector3(...to);
  const t1 = target ? new THREE.Vector3(...target) : t0.clone();
  const start = performance.now();
  function step(now) {
    const k = Math.min(1, (now - start) / duration);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(p0, p1, e);
    controls.target.lerpVectors(t0, t1, e);
    controls.update();
    if (k < 1) controls._flight = requestAnimationFrame(step);
    else if (onDone) onDone();
  }
  controls._flight = requestAnimationFrame(step);
}
