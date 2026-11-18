import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const SUN_DIR = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();

export const DAY_FOG = 0xb8cfdb;
export const FOG_DENSITY = 0.000085;

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(DAY_FOG, FOG_DENSITY);
  scene.background = new THREE.Color(DAY_FOG);

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

  scene.add(new THREE.HemisphereLight(0xe6f3ff, 0xa5baa8, 1.25));
  scene.add(new THREE.AmbientLight(0xdfe7ee, 0.45));
  const sun = new THREE.DirectionalLight(0xfff2da, 1.8);
  sun.position.copy(SUN_DIR).multiplyScalar(5000);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xcbe1f5, 0.35);
  rim.position.set(2600, 1200, -2800);
  scene.add(rim);

  // 天空穹顶
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x9fc6e2) },
      uMid: { value: new THREE.Color(0xc9dce9) },
      uHorizon: { value: new THREE.Color(0xe5e9ea) },
      uSun: { value: new THREE.Color(0xfff2dd) },
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
    new THREE.MeshBasicMaterial({ color: 0xb8c9cd, fog: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -12;
  scene.add(ground);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
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

  return { renderer, scene, camera, controls, composer, sky, sun, resize };
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
