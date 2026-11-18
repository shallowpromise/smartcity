// Minute rates are mm/h over [minute, minute+1). Incomplete windows stay missing.
export function accumulatedRain(rates, minute, window) {
  if (!Number.isInteger(minute) || minute < window || minute > rates.length) return null;
  let total = 0;
  for (const rate of rates.slice(minute-window, minute)) {
    if (!Number.isFinite(rate) || rate < 0) return null;
    total += rate / 60;
  }
  return Math.round(total * 1e6) / 1e6;
}

export function runoff(rain, cn) {
  const storage = 25400 / cn - 254;
  return rain <= 0.2 * storage ? 0 : (rain - 0.2*storage)**2 / (rain + 0.8*storage);
}

export function designRain(years, duration) {
  const [a,b,n] = years === 5 ? [5422.490,21.140,.741] : [4367.217,19.736,.621];
  const q = a / (duration+b)**n;
  return {q, mm: q*duration/167, hourly: q*60/167};
}

export function decodeDepthRuns(base64, size) {
  const bytes=atob(base64), result=new Uint8Array(size);
  let at=0;
  if (bytes.length%2) throw Error('水深编码长度有误');
  for(let i=0;i<bytes.length;i+=2) {
    const count=bytes.charCodeAt(i);
    if (!count || at+count>size) throw Error('水深编码越界');
    result.fill(bytes.charCodeAt(i+1),at,at+count);
    at+=count;
  }
  if(at!==size) throw Error('水深网格不完整');
  return result;
}

export function exposure(series, times, limit=15) {
  let first=null, last=null, begin=null, longest=0, peak=0;
  for(let i=0;i<series.length;i++) {
    peak=Math.max(peak,series[i]);
    if(series[i]<limit) {begin=null; continue;}
    begin??=times[i]; first??=times[i]; last=times[i];
    longest=Math.max(longest,last-begin);
  }
  return {first,last,longest,peak};
}

export function gridAt([lon,lat],meta) {
  const [w,s,e,n]=meta.bbox, {nx,ny}=meta.model;
  if(lon<w || lon>=e || lat<=s || lat>n) return null;
  return Math.floor((n-lat)/(n-s)*ny)*nx+Math.floor((lon-w)/(e-w)*nx);
}

export function groundAt(xy,meta,mask) {
  const cell=gridAt(xy,meta);
  if(cell===null)return null;
  const {nx,ny}=meta.model,[w,s,e,n]=meta.bbox,[width,height]=meta.world;
  const x=(xy[0]-w)/(e-w)*nx,y=(n-xy[1])/(n-s)*ny;
  const eligible=k=>!mask||Boolean(mask[k>>3] & (1<<(k&7)));
  const distance=k=>Math.hypot((k%nx+.5-x)*width/nx,(Math.floor(k/nx)+.5-y)*height/ny);
  if(eligible(cell))return {cell,offset:distance(cell)};
  let nearest=null;
  for(let j=Math.max(0,Math.floor(y)-2);j<Math.min(ny,Math.floor(y)+3);j++) {
    for(let i=Math.max(0,Math.floor(x)-2);i<Math.min(nx,Math.floor(x)+3);i++) {
      const k=j*nx+i,d=distance(k);
      if(eligible(k)&&d<=48&&(!nearest||d<nearest.offset))nearest={cell:k,offset:d};
    }
  }
  return nearest;
}

export function validateObservations(input) {
  if(input?.schemaVersion!==1 || input.quantity!=='surface_depth' || !['cm','m'].includes(input.unit) ||
     input.crs!=='WGS84' || typeof input.sourceName!=='string' || !input.sourceName.trim() ||
     !Array.isArray(input.stations)) throw Error('须提供有来源、单位且采用 WGS84 的地面积水深度记录。');
  const ids=new Set();
  const stations=input.stations.map(s=>{
    if(!s || typeof s.id!=='string' || !s.id || ids.has(s.id) || typeof s.name!=='string' || !s.name ||
       !Number.isFinite(s.longitude) || Math.abs(s.longitude)>180 || !Number.isFinite(s.latitude) ||
       Math.abs(s.latitude)>90 || !Array.isArray(s.records)) throw Error('站点编号、名称、坐标或记录无效。');
    ids.add(s.id);
    const timestamps=new Set();
    const records=s.records.map(r=>{
      if(typeof r?.time!=='string' || !/(Z|[+-]\d\d:\d\d)$/.test(r.time) || !Number.isFinite(Date.parse(r.time)) ||
         (r.value!==null && (!Number.isFinite(r.value) || r.value<0))) throw Error('记录须含带时区的时间与非负水深，缺测填 null。');
      const time=Date.parse(r.time);
      if(timestamps.has(time)) throw Error('同站同一时间的记录重复。');
      timestamps.add(time);
      return {time,cm:r.value===null ? null : r.value*(input.unit==='m'?100:1)};
    });
    return {id:s.id,name:s.name,xy:[s.longitude,s.latitude],records};
  });
  return {sourceName:input.sourceName,sourceUrl:input.sourceUrl||null,stations};
}

export function validateStreetRain(input,names) {
  if(input?.quantity!=='accumulated_rain' || input.schemaVersion!==1 || input.unit!=='mm' ||
     typeof input.sourceName!=='string' || !input.sourceName.trim() || !Array.isArray(input.streets) || !input.streets.length)
    throw Error('须提供有来源的街道累计雨量，单位 mm。');
  const stations=new Map();
  for(const s of input.streets) {
    const values=[s.rain30mMm,s.rain1hMm,s.rain3hMm];
    if(!names.includes(s.street)||stations.has(s.street)||typeof s.observedAt!=='string' ||
       !/(Z|[+-]\d\d:\d\d)$/.test(s.observedAt)||!Number.isFinite(Date.parse(s.observedAt)) ||
       values.some(v=>v!==null && (!Number.isFinite(v)||v<0))) throw Error('街道、观测时间或雨量无效。');
    const known=values.filter(Number.isFinite);
    if(known.some((v,i)=>i>0 && v<known[i-1]))throw Error('同一结束时刻，长窗口的累计量不能小于短窗口。');
    stations.set(s.street,{time:s.observedAt,values});
  }
  return {sourceName:input.sourceName,stations};
}

// Compare only the part of the event observed at the same location and time.
// A saturated exported byte is a lower bound and cannot support an exact error.
export function compareObservation(station,scenario,meta,depthAt,threshold=15,groundMask) {
  const point=groundAt(station.xy,meta,groundMask),cell=point?.cell??null;
  const frames=scenario.frames, start=Date.parse(scenario.startTime), step=scenario.stepMin;
  const bins=frames.map(()=>[]);
  const contemporaneous=scenario.id==='replay-2309'?station.records:[];
  for(const r of contemporaneous) {
    const minute=(r.time-start)/60000;
    if(r.cm===null || minute<0 || minute>scenario.duration) continue;
    const i=Math.round(minute/step);
    if(frames[i] && Math.abs(minute-frames[i].t)<=step/2) bins[i].push(r.cm);
  }
  const observed=bins.map(b=>b.length ? b.reduce((a,v)=>a+v,0)/b.length : null);
  const simulated=frames.map((_,i)=>{
    const cm=cell===null?null:depthAt(i)[cell];
    return cm===255?null:cm;
  });
  const pairs=[];
  let hit=0,miss=0,falseAlarm=0,absolute=0,modelPeak=null,obsPeak=null;
  for(let i=0;i<frames.length;i++) {
    const o=observed[i],m=simulated[i];
    if(o===null || m===null) continue;
    pairs.push(i);absolute+=Math.abs(m-o);
    if(m>=threshold && o>=threshold) hit++;
    else if(m<threshold && o>=threshold) miss++;
    else if(m>=threshold && o<threshold) falseAlarm++;
    if(modelPeak===null || m>simulated[modelPeak]) modelPeak=i;
    if(obsPeak===null || o>observed[obsPeak]) obsPeak=i;
  }
  return {station,cell,offset:point?.offset??null,observed,simulated,paired:pairs.length,absolute,mae:pairs.length?absolute/pairs.length:null,
    peakError:pairs.length?simulated[modelPeak]-observed[obsPeak]:null,
    peakTimeError:pairs.length?frames[modelPeak].t-frames[obsPeak].t:null,hit,miss,falseAlarm};
}
