// Rounded bezel displacement for translucent controls, following archisvaze/liquid-glass.
// Rebuild only when a control changes size. The live scene remains the optical backdrop.
const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const el = document.createElementNS(NS,tag);
  for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
  return el;
}

function displacement(w,h,radius) {
  const canvas = document.createElement('canvas');
  canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext('2d'), img=ctx.createImageData(w,h);
  const rim=Math.min(10,radius*.8);
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    const px=x+.5-w/2, py=y+.5-h/2;
    const qx=Math.abs(px)-(w/2-radius), qy=Math.abs(py)-(h/2-radius);
    const ax=Math.max(0,qx), ay=Math.max(0,qy), len=Math.hypot(ax,ay);
    const inside=radius-len-Math.min(0,Math.max(qx,qy));
    const slope=inside>=0 && inside<rim ? (1-inside/rim)**2 : 0;
    const nx=len ? ax/len : Number(qx>qy), ny=len ? ay/len : Number(qy>=qx);
    const i=(y*w+x)*4;
    img.data[i]=128+Math.sign(px)*nx*slope*124;
    img.data[i+1]=128+Math.sign(py)*ny*slope*124;
    img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  return canvas.toDataURL();
}

function glassFilter(defs, id, blur, strength) {
  const filter=svg('filter',{id,x:0,y:0,width:'100%',height:'100%','color-interpolation-filters':'sRGB'});
  const map=svg('feImage',{result:'bezel',width:'100%',height:'100%',preserveAspectRatio:'none'});
  filter.append(svg('feGaussianBlur',{in:'SourceGraphic',stdDeviation:blur,result:'soft'}),map,
    svg('feDisplacementMap',{in:'soft',in2:'bezel',scale:strength,xChannelSelector:'R',yChannelSelector:'G'}),
    svg('feColorMatrix',{type:'saturate',values:'1.12'}));
  defs.append(filter);
  return map;
}

export function mountGlass() {
  const reduce=matchMedia('(prefers-reduced-transparency:reduce), (prefers-contrast:more), (forced-colors:active)');
  if (!/Chrom(e|ium)\//.test(navigator.userAgent) || !CSS.supports('backdrop-filter','url(#lens)')) return;
  const root=svg('svg',{width:0,height:0,'aria-hidden':'true'});
  root.style.position='absolute';
  const defs=svg('defs',{}); root.append(defs); document.body.prepend(root);

  // Alert and dispatch rows are recreated on each frame. They share one stretchable
  // optical profile, so playback never creates a new filter or observation per row.
  const row=glassFilter(defs,'card-glass',2.2,7);
  const surfaces=document.querySelectorAll('.topbar,.map-tools,.view-presets,.timeline,.panel,.modal-card,.scenario-card,.stat,.mc-advice');
  const lenses=Array.from(surfaces,(el,i)=>{
    const id='surface-glass-'+i;
    const wide=el.matches('.panel,.modal-card');
    return {el,map:glassFilter(defs,id,wide ? 8 : 3.2,wide ? 12 : 8),id,size:''};
  });
  const refresh=()=>{
    if (!reduce.matches && !row.hasAttribute('href')) row.setAttribute('href',displacement(270,68,17));
    document.documentElement.style.setProperty('--row-optics',reduce.matches ? 'none' : 'url(#card-glass)');
    for (const lens of lenses) {
      const {el,map,id}=lens;
      if (reduce.matches) { el.style.removeProperty('--glass-optics'); continue; }
      const w=el.clientWidth,h=el.clientHeight;
      if (!w || !h) continue;
      const r=Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||12,w/2,h/2);
      if (lens.size!==[w,h,r].join()) {
        // Half-resolution profiles suffice for a low-frequency curved edge.
        map.setAttribute('href',displacement(Math.ceil(w/2),Math.ceil(h/2),r/2));
        lens.size=[w,h,r].join();
      }
      el.style.setProperty('--glass-optics','url(#'+id+')');
    }
  };
  let raf;
  const schedule=()=>{ cancelAnimationFrame(raf); raf=requestAnimationFrame(refresh); };
  const observer=new ResizeObserver(schedule);
  surfaces.forEach(el=>observer.observe(el)); reduce.addEventListener('change',schedule);
  schedule();
}
