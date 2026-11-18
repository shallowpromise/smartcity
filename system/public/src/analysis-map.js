import * as THREE from 'three';
import {CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';
import {flyCamera} from './scene.js';

const NS='http://www.w3.org/2000/svg';
export function streetOverview(svg, streets, choose) {
  const all=streets.flatMap(s=>s.polygons.flat(2));
  const xs=all.map(p=>p[0]), ys=all.map(p=>p[1]);
  const west=Math.min(...xs),east=Math.max(...xs),south=Math.min(...ys),north=Math.max(...ys);
  const scale=Math.min(366/((east-west)*.92455),150/(north-south));
  const project=([x,y])=>[190+(x-(west+east)/2)*scale*.92455,80+((south+north)/2-y)*scale];
  const paths=new Map();
  for(const s of streets) {
    const path=document.createElementNS(NS,'path');
    path.setAttribute('d',s.polygons.flatMap(p=>p.map(r=>'M'+r.map(pt=>project(pt).map(v=>v.toFixed(1)).join(',')).join('L')+'Z')).join(''));
    path.setAttribute('fill-rule','evenodd');
    if(choose)path.onclick=()=>choose(s.name);
    const title=document.createElementNS(NS,'title');title.textContent=s.name;path.append(title);
    svg.append(path);paths.set(s.name,path);
  }
  for(const s of streets) {
    const [x,y]=project(s.label), text=document.createElementNS(NS,'text');
    text.setAttribute('x',x);text.setAttribute('y',y+2.5);text.setAttribute('text-anchor','middle');
    text.textContent=s.name.replace('街道','');svg.append(text);
  }
  function update(selected,states){
    paths.forEach((path,name)=>{
      const fill=states.get(name)==='hit'?'#eda275':states.get(name)==='below'?'#9cced7':'#cbd9de';
      path.setAttribute('fill',fill);path.setAttribute('aria-current',String(name===selected));
    });
  }
  return {update,project};
}

export function districtFacilities(svg,streets,bbox,choose) {
  const {project,update}=streetOverview(svg,streets);
  update('',new Map());
  const [w,s,e,n]=bbox,[x,y]=project([w,n]),[right,bottom]=project([e,s]);
  const frame=document.createElementNS(NS,'rect');
  for(const [k,v] of Object.entries({x,y,width:right-x,height:bottom-y,fill:'none',stroke:'#57869f','stroke-dasharray':'3 2'}))frame.setAttribute(k,v);
  svg.append(frame);
  const pins=document.createElementNS(NS,'g');svg.append(pins);
  let cache='',selectedId='',dots=new Map();
  return (items,selected)=>{
    const located=items.filter(f=>f.xy),key=located.map(f=>f.id).join('|');
    if(key!==cache) {
      pins.replaceChildren();dots=new Map();cache=key;selectedId='';
      for(const f of located) {
        const [x,y]=project(f.xy),dot=document.createElementNS(NS,'circle');
        dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',2.2);
        const name=document.createElementNS(NS,'title');name.textContent=f.name;dot.append(name);
        dot.onclick=()=>choose(f.id);pins.append(dot);dots.set(f.id,dot);
      }
    }
    if(selected!==selectedId) {
      const old=dots.get(selectedId),current=dots.get(selected);
      if(old){old.setAttribute('r',2.2);old.removeAttribute('data-active');}
      if(current){current.setAttribute('r',4);current.setAttribute('data-active','');pins.append(current);}
      selectedId=selected;
    }
  };
}

export function createAnalysisMap(app,streets) {
  const group=new THREE.Group(), boundaries=new THREE.Group(), points=new THREE.Group();
  group.add(boundaries,points);app.scene.add(group);group.visible=false;
  const [west,south,east,north]=app.meta.bbox, [width,height]=app.meta.world;
  const inside=([lon,lat])=>lon>=west && lon<=east && lat>=south && lat<=north;
  function world([lon,lat],offset=6) {
    const x=((lon-west)/(east-west)-.5)*width,z=((north-lat)/(north-south)-.5)*height;
    return new THREE.Vector3(x,app.sampleElev(x,z)+offset,z);
  }
  const lines=new Map();
  for(const street of streets) {
    const vertices=[];
    for(const polygon of street.polygons) for(const ring of polygon) for(let i=1;i<ring.length;i++) {
      const a=ring[i-1],b=ring[i];
      const steps=Math.max(1,Math.ceil(Math.hypot((a[0]-b[0])*102922,(a[1]-b[1])*110852)/45));
      let prev=a;
      for(let j=1;j<=steps;j++) {
        const next=[a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps];
        if(inside(prev)&&inside(next)) vertices.push(world(prev),world(next));
        prev=next;
      }
    }
    if(!vertices.length)continue;
    const line=new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(vertices),
      new THREE.LineBasicMaterial({color:0x477287,depthTest:false,transparent:true,opacity:.75,toneMapped:false}));
    line.renderOrder=9;boundaries.add(line);lines.set(street.name,line);
  }
  let markerKey='', markers=[];
  function clearPoints() {
    for(const {pin} of markers) {points.remove(pin);pin.element.remove();}
    markers=[];markerKey='';
  }
  return {
    tab(tab) {
      group.visible=Boolean(tab);boundaries.visible=tab==='rain';
      points.visible=tab==='sites'||tab==='verify';
      if(!points.visible)clearPoints();
    },
    streets(selected,states) {
      for(const [name,line] of lines) {
        line.material.color.set(states.get(name)==='hit'?0xc45422:name===selected?0x005790:0x688b9d);
        line.material.opacity=name===selected?1:.72;
      }
    },
    markers(items,selected,choose,depth) {
      const inMap=items.filter(f=>f.xy && inside(f.xy));
      const key=inMap.map(f=>f.id+'@'+f.xy.join(',')).join('|');
      if(key!==markerKey) {
        clearPoints();markerKey=key;
        markers=inMap.map(f=>{
          const el=document.createElement('button');el.type='button';el.className='asset-pin '+f.kind;
          el.setAttribute('aria-label',f.name);el.title=f.name;el.onclick=e=>{e.stopPropagation();choose(f.id);};
          const pin=new CSS2DObject(el);pin.position.copy(world(f.xy,15));points.add(pin);
          return {f,pin};
        });
      }
      for(const {pin,f} of markers) {
        const active=f.id===selected;pin.element.classList.toggle('selected',active);
        pin.element.textContent=active?f.name:'';
        const cm=depth?.(f);
        pin.element.style.backgroundColor=cm>=50?'#943b53':cm>=15?'#995225':'';
      }
    },
    fly(xy) {
      if(!xy || !inside(xy))return;
      const p=world(xy);flyCamera(app.camera,app.controls,[p.x+320,p.y+520,p.z+640],[p.x,p.y,p.z],matchMedia('(prefers-reduced-motion: reduce)').matches?1:650);
    }
  };
}
const wetColors=['#70bada','#398dc0','#2368ab','#464c99','#822f75'];
const rgb=wetColors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
export function paintDepth(canvas, depth, meta, terrain) {
  const {nx,ny}=meta.model;
  if(canvas.width!==nx || canvas.height!==ny){canvas.width=nx;canvas.height=ny;}
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(nx,ny);
  for(let i=0;i<depth.length;i++) {
    const d=depth[i],level=d>=100?4:d>=50?3:d>=30?2:d>=15?1:d>=5?0:-1;
    const gray=terrain[i];const color=level<0?[gray-10,gray,gray-3]:rgb[level];
    image.data.set([...color,255],i*4);
  }
  ctx.putImageData(image,0,0);
}

export function drawPair(canvas,observed,model,times,idx) {
  const w=canvas.width=640,h=canvas.height=190,c=canvas.getContext('2d');
  c.clearRect(0,0,w,h);
  if(!observed.length && !model.length) {
    c.fillStyle='#425e70';c.font='22px sans-serif';c.textAlign='center';c.fillText('暂无同期实测记录',w/2,h*.55);return;
  }
  const max=Math.max(20,...model.filter(Number.isFinite),...observed.filter(Number.isFinite));
  const x=i=>40+(w-60)*times[i]/times.at(-1), y=v=>h-22-(h-45)*v/max;
  c.textAlign='left';c.font='16px sans-serif';c.fillStyle='#425e70';c.fillText(Math.ceil(max)+' cm',2,16);
  c.strokeStyle='#9fb2bd';c.beginPath();c.moveTo(40,h-22);c.lineTo(w-20,h-22);c.stroke();
  c.beginPath();c.moveTo(x(idx),15);c.lineTo(x(idx),h-22);c.stroke();
  for(const [series,color,dots] of [[model,'#15659a',false],[observed,'#a14d23',true]]) {
    c.lineWidth=3;c.strokeStyle=color;c.fillStyle=color;c.beginPath();let previous=false;
    series.forEach((v,i)=>{if(!Number.isFinite(v)){previous=false;return;} if(previous)c.lineTo(x(i),y(v));else c.moveTo(x(i),y(v));previous=true;});c.stroke();
    if(dots) series.forEach((v,i)=>{if(!Number.isFinite(v))return;c.beginPath();c.arc(x(i),y(v),3.5,0,2*Math.PI);c.fill();});
  }
}
