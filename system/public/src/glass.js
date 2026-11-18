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

export function mountGlass() {
  const surfaces=[...document.querySelectorAll('.topbar,.map-tools,.view-presets,.timeline')];
  const reduce=matchMedia('(prefers-reduced-transparency:reduce), (prefers-contrast:more), (forced-colors:active)');
  if (!/Chrom(e|ium)\//.test(navigator.userAgent) || !CSS.supports('backdrop-filter','url(#lens)')) return;
  const root=svg('svg',{width:0,height:0,'aria-hidden':'true'});
  root.style.position='absolute';
  const defs=svg('defs',{}); root.append(defs); document.body.prepend(root);
  const lenses=surfaces.map((el,i)=>{
    const id='control-glass-'+i;
    const filter=svg('filter',{id,x:0,y:0,width:'100%',height:'100%','color-interpolation-filters':'sRGB'});
    const map=svg('feImage',{result:'bezel',preserveAspectRatio:'none'});
    filter.append(svg('feGaussianBlur',{in:'SourceGraphic',stdDeviation:'1.2',result:'soft'}),map,
      svg('feDisplacementMap',{in:'soft',in2:'bezel',scale:18,xChannelSelector:'R',yChannelSelector:'G'}),
      svg('feColorMatrix',{type:'saturate',values:'1.22'}));
    defs.append(filter);
    return {el,map,id,size:''};
  });
  const refresh=()=>{
    for (const lens of lenses) {
      const {el,map,id}=lens;
      if (reduce.matches) { el.style.removeProperty('--glass-optics'); continue; }
      const w=el.clientWidth,h=el.clientHeight;
      if (!w || !h) continue;
      const r=Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius)||12,w/2,h/2);
      if (lens.size!==[w,h,r].join()) {
        map.setAttribute('width',w);
        map.setAttribute('height',h);
        map.setAttribute('href',displacement(w,h,r));
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
