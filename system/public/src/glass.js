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

// One selected lens moves inside each group, including keyboard and programmatic changes.
export function syncGlassSelection(group) {
  const button = group.querySelector('button.active');
  if (!button?.offsetWidth) return;
  group.style.setProperty('--lens-x', `${button.offsetLeft}px`);
  group.style.setProperty('--lens-y', `${button.offsetTop}px`);
  group.style.setProperty('--lens-width', `${button.offsetWidth}px`);
  group.style.setProperty('--lens-height', `${button.offsetHeight}px`);
  group.classList.add('has-lens');
}

function mountControlFeedback() {
  const finePointer = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)');
  let button = null, frame = 0, x = 0, y = 0;
  function clear() {
    button?.classList.remove('glass-lit');
    button = null;
    cancelAnimationFrame(frame);
    frame = 0;
  }
  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !finePointer.matches || reduced.matches) return;
    const next = event.target.closest('button:enabled');
    if (button !== next) clear();
    if (!next) return;
    button = next;
    x = event.clientX;
    y = event.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const rect = button.getBoundingClientRect();
      button.style.setProperty('--light-x', `${x - rect.left}px`);
      button.style.setProperty('--light-y', `${y - rect.top}px`);
      button.classList.add('glass-lit');
    });
  }, {passive: true});
  document.addEventListener('pointerout', event => {
    if (button && !button.contains(event.relatedTarget)) clear();
  });
  window.addEventListener('blur', clear);
  reduced.addEventListener('change', clear);
  finePointer.addEventListener('change', clear);

  // On touch screens :active may be delayed until the browser recognizes a tap.
  let pressed = null;
  function release() {
    pressed?.classList.remove('glass-pressed');
    pressed = null;
  }
  document.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    release();
    pressed = event.target.closest('button:enabled');
    pressed?.classList.add('glass-pressed');
  }, {passive: true});
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, event => { if (event.isPrimary) release(); });
  }
  window.addEventListener('blur', release);
}

export function mountGlass() {
  const groups = document.querySelectorAll('[data-glass-group]');
  const layout = new ResizeObserver(() => groups.forEach(syncGlassSelection));
  for (const group of groups) {
    layout.observe(group);
    group.querySelectorAll('button').forEach(button => layout.observe(button));
    syncGlassSelection(group);
  }
  mountControlFeedback();
  const reduce=matchMedia('(prefers-reduced-transparency:reduce), (prefers-contrast:more), (forced-colors:active)');
  if (!/Chrom(e|ium)\//.test(navigator.userAgent) || !CSS.supports('backdrop-filter','url(#lens)')) return;
  const root=svg('svg',{width:0,height:0,'aria-hidden':'true'});
  root.style.position='absolute';
  const defs=svg('defs',{}); root.append(defs); document.body.prepend(root);

  // Siblings share the optical surface behind them. Updating a row never allocates a filter.
  const surfaces=document.querySelectorAll('.topbar,.map-tools,.view-presets,.timeline,.panel,.modal-card');
  const lenses=Array.from(surfaces,(el,i)=>{
    const id='surface-glass-'+i;
    const wide=el.matches('.panel,.modal-card');
    return {el,map:glassFilter(defs,id,wide ? 7 : 3.5,wide ? 18 : 14),id,size:''};
  });
  const refresh=()=>{
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
