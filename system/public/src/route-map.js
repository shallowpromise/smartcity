import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { flyCamera } from './scene.js';

export function createRouteMap(app) {
  const group=new THREE.Group();
  group.visible=false;
  app.scene.add(group);
  const [width,height]=app.meta.world;

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

  function pin(point, label, peak = false, style = '', title = '') {
    const el = document.createElement('span');
    el.className = ['route-pin',peak?'peak-pin':'',style].filter(Boolean).join(' ');
    el.textContent = label;
    if (title) el.title = title;
    const pin = new CSS2DObject(el);
    if (peak) pin.center.set(.5,1.35);
    const x = point[0]-width/2, z = point[1]-height/2;
    pin.position.set(x,app.sampleElev(x,z)+7,z);
    group.add(pin);
  }

  function fit(points, panelElement) {
    if (!points.length) return;
    const panel = panelElement.getBoundingClientRect();
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom + 32;
    let left = 16, right = innerWidth - (innerWidth <= 700 && panel.width ? 16 : 68), bottom = document.querySelector('.timeline').getBoundingClientRect().top-32;
    if (panel.width) {
      if (innerWidth <= 700) bottom = Math.min(bottom, panel.top-10);
      else left = panel.right + 20;
    }
    const usableW = Math.max(100,right-left), usableH = Math.max(100,bottom-top);
    const camera = app.camera;
    camera.setViewOffset(innerWidth,innerHeight,(innerWidth-left-right)/2,(innerHeight-top-bottom)/2,innerWidth,innerHeight);
    const xs = points.map(p=>p[0]), zs = points.map(p=>p[1]);
    const dx = Math.max(...xs)-Math.min(...xs), dz = Math.max(...zs)-Math.min(...zs);
    const x = Math.min(...xs)+dx/2-width/2, z = Math.min(...zs)+dz/2-height/2;
    const altitude = Math.max(320, (innerHeight/2)/Math.tan(camera.fov*Math.PI/360) *
      Math.max((dx+100)/usableW,(dz+100)/usableH)*1.14);
    const y = app.sampleElev(x,z);
    flyCamera(camera,app.controls,[x,y+altitude,z+altitude*.12],[x,y,z],matchMedia('(prefers-reduced-motion:reduce)').matches ? 1 : 420);
  }

  return {group,clearLines,line,pin,fit};
}
