import * as THREE from 'three';

/* 积水水面：随地形起伏的网格 + 深度着色 + 雨滴涟漪 + 菲涅尔 */
export function createWater(terrain, meta) {
  const nx = meta.model.nx, ny = meta.model.ny;
  const rnx = meta.terrain.nx, rny = meta.terrain.ny;
  const W = meta.world[0], H = meta.world[1];
  const tpos = terrain.geometry.attributes.position.array;
  const count = rnx * rny;
  const pos = new Float32Array(tpos);       // 复制地形顶点，仅改 y
  const baseY = new Float32Array(count);
  const dxArr = new Float32Array(count);
  const gxArr = new Float32Array(count);
  const gyArr = new Float32Array(count);
  const w00 = new Float32Array(count), w10 = new Float32Array(count);
  const w01 = new Float32Array(count), w11 = new Float32Array(count);
  for (let j = 0; j < rny; j++) {
    for (let i = 0; i < rnx; i++) {
      const k = j * rnx + i;
      baseY[k] = tpos[k * 3 + 1];
      const fx = (i / (rnx - 1)) * (nx - 1);
      const fy = (j / (rny - 1)) * (ny - 1);
      const ix = Math.min(nx - 2, Math.floor(fx)), iy = Math.min(ny - 2, Math.floor(fy));
      const tx = fx - ix, ty = fy - iy;
      gxArr[k] = ix; gyArr[k] = iy;
      w00[k] = (1 - tx) * (1 - ty); w10[k] = tx * (1 - ty);
      w01[k] = (1 - tx) * ty; w11[k] = tx * ty;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(dxArr, 1));
  const idxArr = new Uint32Array(terrain.geometry.index.array);
  geo.setIndex(new THREE.BufferAttribute(idxArr, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0.95 },
      uFogColor: { value: new THREE.Color(0x081421) },
      uFogDensity: { value: 0.000135 },
      uSun: { value: new THREE.Vector3(-0.55, 0.42, 0.72).normalize() },
    },
    vertexShader: /* glsl */`
      attribute float aDepth;
      varying float vDepth; varying vec3 vW;
      uniform float uTime;
      void main(){
        vec3 p = position;
        float w = clamp(aDepth*2.0,0.0,1.0);
        p.y += (sin(p.x*0.07 + uTime*2.1) + cos(p.z*0.06 + uTime*1.7))*0.055*w;
        vDepth = aDepth;
        vec4 wp = modelMatrix*vec4(p,1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: /* glsl */`
      varying float vDepth; varying vec3 vW;
      uniform float uTime; uniform float uOpacity;
      uniform vec3 uFogColor; uniform float uFogDensity; uniform vec3 uSun;
      float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
      void main(){
        float d = vDepth;
        if(d < 0.05) discard;
        vec3 shallow = vec3(0.14,0.52,0.60);
        vec3 mid = vec3(0.03,0.20,0.52);
        vec3 deep = vec3(0.02,0.07,0.34);
        vec3 purple = vec3(0.28,0.08,0.48);
        vec3 col = mix(shallow, mid, smoothstep(0.03,0.20,d));
        col = mix(col, deep, smoothstep(0.20,0.75,d));
        col = mix(col, purple, smoothstep(1.10,2.10,d));
        // 波纹
        float n = sin(vW.x*0.16 + uTime*1.6) * sin(vW.z*0.13 - uTime*1.2);
        n += 0.5*sin((vW.x+vW.z)*0.09 + uTime*2.2);
        col += vec3(0.03,0.08,0.11)*(n*0.5+0.5);
        // 雨滴涟漪
        vec2 cell = floor(vW.xz/4.0);
        vec2 f = fract(vW.xz/4.0)-0.5;
        float r = length(f);
        float ph = fract(uTime*0.55 + hash(cell));
        float ring = smoothstep(0.035,0.0,abs(r - ph*0.46))*(1.0-ph);
        col += vec3(0.32,0.55,0.68)*ring*0.30*clamp(d*6.0,0.0,1.0);
        // 浅水边缘泡沫
        float edge = (1.0-smoothstep(0.025,0.06,d));
        float foam = smoothstep(0.55,0.9, sin(vW.x*0.9+uTime*3.0)*sin(vW.z*0.8-uTime*2.6)*0.5+0.5);
        col += vec3(0.45,0.70,0.85)*edge*foam*0.18;
        // 菲涅尔天空反射
        vec3 V = normalize(cameraPosition - vW);
        float fres = pow(1.0-max(dot(V,vec3(0.0,1.0,0.0)),0.0), 3.0);
        col += vec3(0.10,0.24,0.34)*fres*0.40;
        float alpha = (smoothstep(0.05,0.16,d)*0.50 + smoothstep(0.20,0.80,d)*0.34);
        alpha *= uOpacity;
        float fog = 1.0-exp(-uFogDensity*uFogDensity*length(vW-cameraPosition)*length(vW-cameraPosition));
        col = mix(col,uFogColor,fog*0.45);
        gl_FragColor = vec4(col, clamp(alpha,0.0,0.92));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = 'flood-water';
  mesh.visible = false;

  let frameDepth = null;
  function update(depthU8, time) {
    mat.uniforms.uTime.value = time;
    let any = false;
    const arr = geo.attributes.position.array;
    const dattr = geo.attributes.aDepth.array;
    for (let k = 0; k < count; k++) {
      const ix = gxArr[k], iy = gyArr[k];
      const i0 = iy * nx + ix;
      const d = (depthU8[i0] * w00[k] + depthU8[i0 + 1] * w10[k] +
                 depthU8[i0 + nx] * w01[k] + depthU8[i0 + nx + 1] * w11[k]) / 100;
      dattr[k] = d;
      if (d > 0.008) any = true;
      arr[k * 3 + 1] = baseY[k] + d + 0.10;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aDepth.needsUpdate = true;
    mesh.visible = any;
    frameDepth = depthU8;
  }
  function setLayer(on) { mesh.visible = on && !!frameDepth && frameDepth.some((v) => v > 0); }
  return { mesh, update, setLayer };
}
