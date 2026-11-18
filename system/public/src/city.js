import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { SUN_DIR, DAY_FOG, FOG_DENSITY } from './scene.js';

const FOG = { color: new THREE.Color(DAY_FOG), density: FOG_DENSITY };

function fogChunk() {
  return /* glsl */`
    uniform vec3 uFogColor; uniform float uFogDensity;
    float fogFactor(vec3 wp){
      float d = length(wp - cameraPosition);
      return 1.0 - exp(-uFogDensity*uFogDensity*d*d);
    }`;
}

/* ------------------------------------------------------------------ 地形 */
export function buildTerrain(data, meta) {
  const { nx, ny, w, h } = data;
  const elev = new Int16Array(base64ToBuf(data.elev));
  const lc = new Uint8Array(base64ToBuf(data.landcover));
  const pos = new Float32Array(nx * ny * 3);
  const col = new Float32Array(nx * ny * 3);
  const colors = {
    0: [0.26, 0.48, 0.56],
    1: [0.28, 0.49, 0.33],
    2: [0.52, 0.55, 0.54],
    3: [0.58, 0.59, 0.58],
    4: [0.47, 0.50, 0.49],
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = (i / (nx - 1) - 0.5) * w;
      const z = (j / (ny - 1) - 0.5) * h;
      const y = elev[k] / 10;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      let c = colors[lc[k]] || colors[4];
      const t = Math.min(1, y / 130);
      c = [c[0] + t * 0.035, c[1] + t * 0.05, c[2] + t * 0.055];
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
  }
  const idx = [];
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    vertexColors: true,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uFogColor: { value: FOG.color },
      uFogDensity: { value: FOG.density },
    },
    vertexShader: /* glsl */`
      varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying float vY;
      void main(){
        vColor = color;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position,1.0);
        vW = wp.xyz; vY = wp.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${fogChunk()}
      varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying float vY;
      uniform vec3 uSun;
      void main(){
        vec3 n = normalize(vN);
        float ndl = max(dot(n, normalize(uSun)), 0.0);
        float sky = 0.5 + 0.5*n.y;
        vec3 col = vColor * (0.55 + 0.55*ndl) + vec3(0.02,0.06,0.09)*sky;
        // 5m 等高线
        float e = vY / 5.0;
        float fw = max(fwidth(e), 0.0006);
        float line = abs(fract(e) - 0.5) / fw;
        float contour = (1.0 - smoothstep(0.0, 1.15, line)) * smoothstep(1.0, 4.0, vY);
        col *= 1.0 - contour * 0.045;
        // 200m 数字网格
        vec2 g = abs(fract(vW.xz / 200.0) - 0.5) / max(fwidth(vW.xz / 200.0), vec2(0.0008));
        float grid = (1.0 - smoothstep(0.0, 1.0, min(g.x,g.y)));
        col *= 1.0 - grid * 0.018;
        float rim = pow(1.0 - max(dot(n, normalize(cameraPosition - vW)),0.0), 3.0);
        col += vec3(0.06,0.20,0.28)*rim*0.25;
        float f = fogFactor(vW);
        col = mix(col, uFogColor, f);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'terrain';
  mesh.userData.landcover = lc;
  mesh.userData.sampleElev = makeSampler(elev, nx, ny, w, h);
  return mesh;
}

function makeSampler(elev, nx, ny, w, h) {
  return function (wx, wz) {
    const fx = THREE.MathUtils.clamp((wx / w + 0.5) * (nx - 1), 0, nx - 1.001);
    const fz = THREE.MathUtils.clamp((wz / h + 0.5) * (ny - 1), 0, ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * nx + i;
    const a = elev[k] / 10, b = elev[k + 1] / 10, c = elev[k + nx] / 10, d = elev[k + nx + 1] / 10;
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

/* ------------------------------------------------------------------ 建筑 */
export function buildBuildings(data, meta, sampleElev) {
  const W = meta.world[0], H = meta.world[1];
  const positions = [], normals = [], colors = [], uvs = [], indices = [];
  let vi = 0;
  const tall = [];

  for (let bi = 0; bi < data.p.length; bi++) {
    const flat = data.p[bi];
    const height = Math.max(2.5, data.h[bi]);
    const name = data.n[bi] || '';
    let pts = [];
    for (let i = 0; i < flat.length; i += 2) {
      pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
    }
    if (pts.length < 3) continue;
    // 统一为逆时针（数据坐标系）
    let area2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      area2 += a.x * b.y - b.x * a.y;
    }
    if (area2 < 0) pts.reverse();
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const ground = Math.min(data.b[bi] ?? sampleElev(cx - W / 2, cz - H / 2), sampleElev(cx - W / 2, cz - H / 2) + 0.6) - 0.6;
    const y0 = ground, y1 = ground + height;
    const t = Math.min(1, height / 220);
    const seed = hash01(bi * 7.13 + 3.7);
    let baseCol = [0.52 - t * 0.12, 0.59 - t * 0.09, 0.62 + t * 0.05];
    baseCol = baseCol.map((v) => v * (0.85 + seed * 0.28));
    const roofCol = [baseCol[0] * 1.40, baseCol[1] * 1.28, baseCol[2] * 1.19];

    // 侧面
    let cum = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ax = a.x - W / 2, az = a.y - H / 2;
      const bx = b.x - W / 2, bz = b.y - H / 2;
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const nx = dz / len, nz = -dx / len;
      const u0 = cum / 4.2, u1 = (cum + len) / 4.2;
      const v1 = height / 3.6;
      const quad = [
        [ax, y0, az, u0, 0], [bx, y0, bz, u1, 0],
        [bx, y1, bz, u1, v1], [ax, y1, az, u0, v1],
      ];
      for (const q of quad) {
        positions.push(q[0], q[1], q[2]);
        normals.push(nx, 0, nz);
        colors.push(...baseCol);
        uvs.push(q[3], q[4]);
      }
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
      cum += len;
    }
    // 屋顶
    const roofStart = vi;
    for (const p of pts) {
      positions.push(p.x - W / 2, y1, p.y - H / 2);
      normals.push(0, 1, 0);
      colors.push(...roofCol);
      uvs.push(-1, -1);
      vi++;
    }
    const faces = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const f of faces) indices.push(roofStart + f[0], roofStart + f[2], roofStart + f[1]);

    if (height > 110) tall.push({ pts, y1, name, height, cx: cx - W / 2, cz: cz - H / 2 });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uFogColor: { value: FOG.color },
      uFogDensity: { value: FOG.density },
    },
    vertexShader: /* glsl */`
      varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){
        vColor=color; vN=normalize(mat3(modelMatrix)*normal); vUv=uv;
        vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz;
        gl_Position=projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */`
      ${fogChunk()}
      varying vec3 vColor; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      uniform vec3 uSun;
      void main(){
        vec3 n=normalize(vN);
        float ndl=max(dot(n,normalize(uSun)),0.0);
        float sky=0.5+0.5*n.y;
        vec3 col=vColor*(0.42+0.43*ndl+0.12*sky);
        if(vUv.x>=0.0){
          // Fine glazing fades into the facade as the camera pulls away.
          vec2 tile=fract(vUv);
          float pane=step(0.20,tile.x)*step(tile.x,0.82)*step(0.22,tile.y)*step(tile.y,0.82);
          float detail=1.0-smoothstep(0.25,1.0,max(fwidth(vUv.x),fwidth(vUv.y)));
          col=mix(col,col*vec3(0.72,0.81,0.90),pane*detail);
        }
        float f=fogFactor(vW);
        col=mix(col,uFogColor,f);
        gl_FragColor=vec4(col,1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'buildings';

  // 高层轮廓线
  const lp = [];
  for (const b of tall) {
    const { pts, y1 } = b;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], c = pts[(i + 1) % pts.length];
      lp.push(a.x - W / 2, y1 + 0.3, a.y - H / 2, c.x - W / 2, y1 + 0.3, c.y - H / 2);
      lp.push(a.x - W / 2, y1 - Math.min(40, b.height * 0.55), a.y - H / 2, a.x - W / 2, y1 + 0.3, a.y - H / 2);
    }
  }
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lgeo, new THREE.LineBasicMaterial({
    color: 0xd4e4ea, transparent: true, opacity: 0.14, blending: THREE.NormalBlending, depthWrite: false,
  }));
  mesh.add(lines);
  mesh.userData.tall = tall;
  return mesh;
}

/* ------------------------------------------------------------------ 道路 / 水系 / 绿地 */
export function buildVectors(data, meta, sampleElev) {
  const W = meta.world[0], H = meta.world[1];
  const group = new THREE.Group();
  group.name = 'vectors';

  // 道路
  const rp = [], rc = [];
  const clsColor = {
    motorway: [0.30, 0.55, 0.66], trunk: [0.27, 0.50, 0.62], primary: [0.24, 0.46, 0.58],
    secondary: [0.19, 0.38, 0.49], tertiary: [0.15, 0.32, 0.42], residential: [0.10, 0.22, 0.30],
    service: [0.07, 0.16, 0.22], motorway_link: [0.22, 0.42, 0.54], trunk_link: [0.22, 0.42, 0.54],
    primary_link: [0.22, 0.42, 0.54], secondary_link: [0.16, 0.33, 0.43], tertiary_link: [0.13, 0.27, 0.36],
  };
  for (const r of data.roads) {
    const pts = r.p;
    const w = Math.max(2.5, (r.w || 8) * 0.58);
    const c = clsColor[r.c] || [0.09, 0.18, 0.24];
    const cc = [0.72 + c[0] * 0.35, 0.73 + c[1] * 0.22, 0.68 + c[2] * 0.20];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x1 = pts[i] - W / 2, z1 = pts[i + 1] - H / 2;
      const x2 = pts[i + 2] - W / 2, z2 = pts[i + 3] - H / 2;
      const dx = x2 - x1, dz = z2 - z1;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const nx = -dz / len * w / 2, nz = dx / len * w / 2;
      const y1 = sampleElev(x1, z1) + 0.45, y2 = sampleElev(x2, z2) + 0.45;
      rp.push(x1 + nx, y1, z1 + nz, x1 - nx, y1, z1 - nz, x2 + nx, y2, z2 + nz);
      rp.push(x2 + nx, y2, z2 + nz, x1 - nx, y1, z1 - nz, x2 - nx, y2, z2 - nz);
      for (let k = 0; k < 6; k++) rc.push(...cc);
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  const roads = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false,
    blending: THREE.NormalBlending, side: THREE.DoubleSide,
  }));
  roads.name = 'roads';
  roads.renderOrder = 2;
  group.add(roads);

  // 绿地（矢量面，增强公园边界）
  const gp = [], gc = [];
  for (const g of data.green) {
    const pts = g.p;
    if (pts.length < 6) continue;
    // 三角扇（凸多边形近似即可）
    const x0 = pts[0] - W / 2, z0 = pts[1] - H / 2;
    const y = sampleElev(x0, z0) + 0.10;
    for (let i = 2; i < pts.length - 2; i += 2) {
      gp.push(x0, y, z0, pts[i] - W / 2, y, pts[i + 1] - H / 2, pts[i + 2] - W / 2, y, pts[i + 3] - H / 2);
      for (let k = 0; k < 3; k++) gc.push(0.24, 0.45, 0.28);
    }
  }
  if (gp.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    gg.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
    const green = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    }));
    green.name = 'green';
    group.add(green);
  }

  // 水系
  const wp = [];
  for (const w of data.water) {
    const pts = w.p;
    if (pts.length < 6) continue;
    const x0 = pts[0] - W / 2, z0 = pts[1] - H / 2;
    const y = Math.max(sampleElev(x0, z0) + 0.12, 0.25);
    for (let i = 2; i < pts.length - 2; i += 2) {
      wp.push(x0, y, z0, pts[i] - W / 2, y, pts[i + 1] - H / 2, pts[i + 2] - W / 2, y, pts[i + 3] - H / 2);
    }
  }
  // 河道作为带
  for (const r of data.rivers) {
    const pts = r.p, w = Math.max(6, r.w || 10);
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x1 = pts[i] - W / 2, z1 = pts[i + 1] - H / 2;
      const x2 = pts[i + 2] - W / 2, z2 = pts[i + 3] - H / 2;
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len * w / 2, nz = dx / len * w / 2;
      const y1 = Math.max(sampleElev(x1, z1) + 0.10, 0.2), y2 = Math.max(sampleElev(x2, z2) + 0.10, 0.2);
      wp.push(x1 + nx, y1, z1 + nz, x1 - nx, y1, z1 - nz, x2 + nx, y2, z2 + nz);
      wp.push(x2 + nx, y2, z2 + nz, x1 - nx, y1, z1 - nz, x2 - nx, y2, z2 - nz);
    }
  }
  if (wp.length) {
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
    const water = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({
      color: 0x6aaec1, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    }));
    water.name = 'base-water';
    water.renderOrder = 1;
    group.add(water);
  }
  return group;
}

/* ------------------------------------------------------------------ 树 */
export function buildTrees(terrain, count = 1500) {
  const elev = terrain.userData.sampleElev;
  const data = terrain.geometry.attributes.position.array;
  const lc = terrain.userData.landcover;
  const geo = new THREE.IcosahedronGeometry(8, 1);
  geo.scale(1, 1.35, 1);
  geo.translate(0, 11, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x7ba38a, roughness: 0.95, metalness: 0, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  let n = 0;
  const nx = terrain.userData.nx, ny = terrain.userData.ny, W = terrain.userData.w, H = terrain.userData.h;
  for (let tries = 0; tries < count * 4 && n < count; tries++) {
    const i = (Math.random() * (nx * ny)) | 0;
    // 只在绿色地表上种树
    if (lc[i] !== 1) continue;
    const x = data[i * 3], z = data[i * 3 + 2];
    const y = data[i * 3 + 1];
    const s = 0.55 + Math.random() * 1.15;
    m.makeScale(s, s, s);
    m.setPosition(x, y - 1, z);
    inst.setMatrixAt(n++, m);
  }
  inst.count = n;
  inst.instanceMatrix.needsUpdate = true;
  inst.name = 'trees';
  return inst;
}

/* ------------------------------------------------------------------ 标注 */
export function buildLabels(meta, buildingsData, sampleElev) {
  const W = meta.world[0], H = meta.world[1];
  const group = new THREE.Group();
  group.name = 'labels';
  const landmarks = [
    ['平安金融中心', 599, 'PING AN FINANCE CENTRE'],
    ['深圳会展中心', 35, 'SHENZHEN CONVENTION CENTER'],
    ['市民中心', 60, 'CIVIC CENTER'],
    ['赛格广场', 291.6, 'SEG PLAZA'],
    ['深业上城', 388.1, 'SHENYE UPPERHILLS'],
    ['莲花山公园', 106, 'LIANHUA HILL PARK'],
  ];
  const used = new Set();
  for (const [name, , sub] of landmarks) {
    const b = buildingsData.p.findIndex((p, i) => (buildingsData.n[i] || '').includes(name));
    if (b < 0) continue;
    const flat = buildingsData.p[b];
    let cx = 0, cz = 0;
    for (let i = 0; i < flat.length; i += 2) { cx += flat[i]; cz += flat[i + 1]; }
    cx /= flat.length / 2; cz /= flat.length / 2;
    const h = buildingsData.h[b];
    const el = document.createElement('div');
    el.className = 'land-label';
    el.innerHTML = `<b>${name}</b><span>${sub}</span>`;
    const obj = new CSS2DObject(el);
    obj.position.set(cx - W / 2, (buildingsData.b[b] || 0) + h + 12, cz - H / 2);
    group.add(obj);
    used.add(name);
  }
  // 主要道路名
  const roadNames = ['深南大道', '滨河大道', '北环大道', '红荔路', '益田路', '华强北路', '皇岗路', '彩田路'];
  for (const rn of roadNames) {
    const rs = buildingsData.roads || [];
    let best = null;
    for (const r of rs) {
      if ((r.n || '').includes(rn) && (!best || r.p.length > best.p.length)) best = r;
    }
    if (!best) continue;
    const p = best.p;
    const mid = (p.length / 2 | 0) & ~1;
    const x = p[mid] - W / 2, z = p[mid + 1] - H / 2;
    const el = document.createElement('div');
    el.className = 'road-label';
    el.textContent = rn;
    const obj = new CSS2DObject(el);
    obj.position.set(x, sampleElev(x, z) + 8, z);
    group.add(obj);
  }
  return group;
}

/* ------------------------------------------------------------------ helpers */
function hash01(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function base64ToBuf(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
