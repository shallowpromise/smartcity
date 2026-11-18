import {fmtT,b64ToU8} from './utils.js';
import {accumulatedRain,designRain,decodeDepthRuns,exposure,validateObservations,validateStreetRain,compareObservation,gridAt} from './analysis-math.js';
import {createAnalysisMap,streetOverview,districtFacilities,paintDepth,drawPair} from './analysis-map.js';

const $=id=>document.getElementById(id);
const windows=[30,60,180];
const kinds={indoor:'室内场所',outdoor:'室外场所',metro:'地铁出入口'};
const number=(v,unit='',digits=1)=>Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:digits})+unit:'—';
const water=v=>v===255?'≥255 cm':number(v,' cm');
const delta=(v,unit='',digits=1)=>(v>0?'+':'')+number(v,unit,digits);
const nearMetres=(a,b)=>Math.hypot((a[0]-b[0])*102922,(a[1]-b[1])*110852);
function node(tag,text,cls) {
  const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;
}
function rows(el,values) {
  const dl=node('dl');
  for(const [k,v] of values) dl.append(node('dt',k),node('dd',v));
  el.replaceChildren(dl);
}
function options(el,list) {
  const previous=el.value;
  el.replaceChildren(...list.map(([id,label])=>new Option(label,id)));
  if([...el.options].some(o=>o.value===previous))el.value=previous;
}
function safeLink(url,label) {
  try {
    const u=new URL(url);
    if(!['https:','http:'].includes(u.protocol))return node('span',label);
    const a=node('a',label);a.href=u.href;a.target='_blank';a.rel='noopener';return a;
  } catch {return node('span',label);}
}

export function createAnalysis(app,fetchJSON,changeView) {
  const storage=new Map();
  function load(path) {
    if(!storage.has(path))storage.set(path,fetchJSON('./data/'+path).catch(e=>{storage.delete(path);throw e;}));
    return storage.get(path);
  }
  let active=false,tab='rain',request=0,ready=false,catalog,map,overview,manifest,variant,exposureData,exposureId;
  let selectedVariant='drain70',selectedFacility='',selectedStation='',facilityList=[],facilityIndex,facilityOverview;
  let observations={stations:[]},compared=[],pairedScenario=null,flatTerrain,groundMask;
  let decodedComparison=new Map(),streetRain=null;
  const street=$('an-street'),facilitySelect=$('site-select'),stationSelect=$('verify-station');
  const tabs=[...document.querySelectorAll('[data-analysis]')];
  const sections=[...document.querySelectorAll('[data-section]')];
  const status=$('an-status');
  function message(text,retry=false) {
    status.hidden=!text;status.textContent=text;
    if(retry){const b=node('button','重新加载');b.onclick=()=>activate(tab);status.append(' ',b);}
  }
  function sourceArticle(s,kind) {
    const a=node('article');a.append(node('strong',s.name),node('p',[kind,s.publisher,s.date].filter(Boolean).join(' · ')));
    if(s.timeCoverage)a.append(node('p',s.timeCoverage+' · '+s.usage));
    a.append(node('p',s.note),safeLink(s.url,'查看来源 ↗'));
    return a;
  }
  function initCatalog(data) {
    catalog=data;facilityIndex=new Map(data.facilities.map(f=>[f.id,f]));
    groundMask=b64ToU8(data.groundMask);
    const names=data.streets.map(s=>[s.name,s.name]);
    options(street,names);street.value='福田街道';
    options($('site-street'),[['','全部街道'],...names,['unknown','街道待定位']]);
    options($('an-scenario'),app.scenarios.map(s=>[s.id,s.short]));
    $('an-guide-source').href=data.sources.streets.url;$('idf-source').href=data.sources.idf.url;
    $('an-sources').replaceChildren(...Object.entries(data.sources).map(([key,s])=>sourceArticle(s,key==='model'?'预计算模型':key==='osm'?'地理参考':'官方发布')));
    $('an-pending').replaceChildren(...data.pending.map(s=>sourceArticle(s,'待接入')));
    map=createAnalysisMap(app,data.streets);
    overview=streetOverview($('an-street-map'),data.streets,name=>{street.value=name;rainFrame();});
    facilityOverview=districtFacilities($('site-area-map'),data.streets,app.meta.bbox,chooseFacility);
    idf();
  }
  function idf() {
    const years=Number($('idf-period').value),minutes=Number($('idf-duration').value);
    const r=designRain(years,minutes);
    $('idf-result').textContent=minutes+' 分钟设计雨量 '+number(r.mm,' mm')+'，平均强度 '+number(r.hourly,' mm/h')+'。';
  }
  $('idf-period').onchange=$('idf-duration').onchange=idf;
  function rainFrame() {
    const sc=app.scenario,t=sc.frames[app.idx].t,sim=$('an-rain-mode').value==='scenario';
    const modeled=windows.map(m=>accumulatedRain(sc.rain,t,m));
    const states=new Map();
    const values=s=>sim?modeled:(streetRain?.stations.get(s.name)?.values ?? [null,null,null]);
    for(const s of catalog.streets) {
      const current=values(s);
      states.set(s.name,current.some((r,i)=>r!==null && r>=s.thresholds[i])?'hit':current.every(Number.isFinite)?'below':'unknown');
    }
    const s=catalog.streets.find(s=>s.name===street.value),current=values(s);
    $('an-rain-rows').replaceChildren(...windows.map((minutes,i)=>{
      const tr=node('tr'),v=current[i],threshold=s.thresholds[i],hit=v!==null&&v>=threshold;
      const gap=v===null?'—':hit?'已达 · +'+number(v-threshold):number(threshold-v);
      for(const label of [[ '30 分钟','1 小时','3 小时'][i],number(v),number(threshold),gap]) tr.append(node('td',label));
      tr.lastChild.dataset.hit=hit;return tr;
    }));
    const hits=[...states.values()].filter(v=>v==='hit').length;
    $('an-rain-status').textContent=sim?'情景雨量 · 橙色为达到阈值的街道（'+hits+'/10）。使用统一降雨输入，历时不足留空。单位 mm。':
      streetRain?'本地观测 · '+streetRain.sourceName+' · '+(streetRain.stations.get(s.name)?.time||'该街道无记录')+'。单位 mm。':
      '无实时雨量。灰色表示实况缺测。可切换到情景雨量查看模拟余量。单位 mm。';
    $('an-risk-note').textContent=s.note;overview.update(s.name,states);map.streets(s.name,states);
  }
  street.onchange=$('an-rain-mode').onchange=()=>{if(ready)rainFrame();};
  let rainUpload=0;
  $('street-file').onchange=async e=>{
    const file=e.target.files[0],token=++rainUpload;
    if(!file)return;
    try {
      if(file.size>1024*1024)throw Error('街道雨量文件应小于 1 MB。');
      const data=validateStreetRain(JSON.parse(await file.text()),catalog.streets.map(s=>s.name));
      if(token!==rainUpload)return;
      streetRain=data;$('an-rain-mode').value='observed';$('street-clear').hidden=false;
      $('street-message').textContent='已读取 '+data.stations.size+' 个街道的累计雨量。';
      if(ready&&tab==='rain')rainFrame();
    } catch(err){if(token===rainUpload)$('street-message').textContent='导入失败 · '+err.message;}
    finally{e.target.value='';}
  };
  $('street-clear').onclick=()=>{rainUpload++;streetRain=null;$('street-clear').hidden=true;$('street-message').textContent='已清除本地雨量。';rainFrame();};

  function siteFilters(resetTypes=false) {
    const kind=$('site-kind').value,area=$('site-street').value,min=Number($('site-capacity').value);
    const query=$('site-search').value.trim().toLowerCase();
    const byKind=catalog.facilities.filter(f=>kind?f.kind===kind:f.kind!=='metro');
    if(resetTypes)options($('site-type'),[['','全部类型'],...[...new Set(byKind.map(f=>f.type))].sort().map(t=>[t,t])]);
    const type=$('site-type').value;
    facilityList=byKind.filter(f=>(!type||f.type===type)&&(!min||(f.capacity!==null&&f.capacity>=min))&&
      (!area||(f.street||f.locationStreet||'unknown')===area)&&
      (!query||[f.name,f.address,f.community,f.street,f.locationStreet].filter(Boolean).join(' ').toLowerCase().includes(query)));
    options(facilitySelect,facilityList.map(f=>[f.id,f.name+' · '+kinds[f.kind]]));
    if(!facilityList.some(f=>f.id===selectedFacility))selectedFacility=facilityList[0]?.id||'';
    facilitySelect.value=selectedFacility;facilitySelect.disabled=!selectedFacility;
    if(ready)siteFrame();
  }
  for(const id of ['site-street','site-capacity','site-type']) $(id).onchange=()=>siteFilters();
  $('site-kind').onchange=()=>siteFilters(true);$('site-search').oninput=()=>siteFilters();
  function chooseFacility(id) {selectedFacility=id;facilitySelect.value=id;siteFrame();}
  facilitySelect.onchange=()=>chooseFacility(facilitySelect.value);
  function siteFrame() {
    const f=facilityIndex.get(selectedFacility), sc=app.scenario, times=sc.frames.map(v=>v.t);
    const value=f=>exposureData?.[f.id]?.[app.idx]??null;
    $('site-count').textContent=facilityList.length+' 条符合筛选 · '+facilityList.filter(f=>f.xy).length+' 条已匹配位置 · '+facilityList.filter(f=>exposureData?.[f.id]).length+' 条有模型采样。';
    $('site-fly').disabled=!f?.xy;$('site-route').disabled=!f?.roadNode;
    $('site-fly').textContent=f?.xy&&!f.inDomain?'在全区图定位':'定位参考点';
    facilityOverview(facilityList,selectedFacility);
    const info=$('site-info');info.replaceChildren();
    if(f) {
      const metrics=[],series=exposureData?.[f.id];
      const meta=catalog.sources[f.kind==='metro'?'osm':f.kind];
      metrics.push(['位置',f.address||'见地理参考坐标'],['街道',f.street||f.locationStreet||'未提供']);
      if(f.kind!=='metro')metrics.push(['登记容量',number(f.capacity,' 人')],['登记面积',number(f.area,' m²')],['开放状态','候选场所 · 待属地确认']);
      const methods={name_and_street:'名称与街道',name_and_address:'名称与门牌',street_and_number:'街路与门牌',mapped_entrance:'地图出入口'};
      if(f.kind!=='metro')metrics.push(['名录资料日期',f.sourceUpdated]);
      metrics.push(['地理匹配',f.xy?f.xy.map(x=>x.toFixed(5)).join(', ')+' · WGS84':'地址未匹配到唯一地物'],['定位依据',f.xy?(methods[f.geocodeMethod]+' · 现场待核'):'待定位'],['当前水深',series?water(value(f)):(f.xy?(f.inDomain?'无合格地面采样格':'位于模型范围外'):'缺少定位')]);
      if(series) {
        const e=exposure(series,times);
        metrics.push(['首次达到 15 cm',e.first===null?'全程未达':fmtT(e.first)],['最长连续超阈跨度',e.first===null?'—':e.longest+' 分钟'],['全程峰值',water(e.peak)],['采样位置','地面格中心距参考点 '+f.sampleOffsetM+' m']);
      }
      rows(info,metrics);info.prepend(node('h4',f.name));
      const p=node('p',undefined,'an-note');p.append(meta.date+' 发布/整理 · ',safeLink(meta.url,meta.name));
      if(f.osm)p.append(' · ',safeLink('https://www.openstreetmap.org/'+f.osm,'OSM 定位依据'));
      info.append(p);
      $('site-route-note').textContent=f.roadNode?'接驳点距场所参考点 '+f.roadOffsetM+' m。仅计算至地面道路，具体入口、实时通行与开放状态需核实。':
        f.kind==='metro'?'此处评估出入口周边地面水深，站内运营状态需另行核实。':'接驳计算需要模型范围内的定位和 120 m 内的地面路网节点。';
    } else {info.textContent='没有符合筛选的记录。';$('site-route-note').textContent='';}
    const ranked=facilityList.filter(f=>Number.isFinite(value(f))).sort((a,b)=>value(b)-value(a));
    $('site-ranking').replaceChildren(...ranked.slice(0,5).map(f=>{const b=node('button',f.name);b.append(node('small',water(value(f))));b.onclick=()=>chooseFacility(f.id);return b;}));
    if(!ranked.length)$('site-ranking').textContent='当前筛选无可采样设施。';
    map.markers(facilityList,selectedFacility,chooseFacility,value);
  }
  $('site-fly').onclick=()=>{
    const f=facilityIndex.get(selectedFacility);
    if(f?.inDomain)map.fly(f.xy);
    else if(f?.xy){$('site-area').open=true;$('site-area').scrollIntoView({block:'nearest'});}
  };
  $('site-route').onclick=async()=>{
    const f=facilityIndex.get(selectedFacility);
    if(!f?.roadNode)return;
    await changeView('routes');
    if(document.body.dataset.view==='routes')app.routeView.destination(f);
  };

  function halfArea(frames) {
    const peak=Math.max(...frames.map(f=>f.areaHa)),i=frames.findIndex(f=>f.areaHa===peak);
    if(!peak)return '无积水';
    const end=frames.slice(i+1).find(f=>f.areaHa<=peak/2);
    return end?(end.t-frames[i].t)+' 分钟':'期末未减半';
  }
  function compareFrame() {
    const sc=app.scenario,i=app.idx,base=sc.frames[i],other=variant.frames[i];
    if(!flatTerrain) {
      const {nx,ny}=app.meta.model,[w,h]=app.meta.world;
      flatTerrain=Uint8Array.from({length:nx*ny},(_,k)=>Math.round(225-Math.min(38,app.sampleElev(((k%nx+.5)/nx-.5)*w,((Math.floor(k/nx)+.5)/ny-.5)*h)*.25)));
    }
    if(!decodedComparison.has(i))decodedComparison.set(i,decodeDepthRuns(other.depthRle,flatTerrain.length));
    paintDepth($('base-field'),app.currentDepth,app.meta,flatTerrain);
    paintDepth($('variant-field'),decodedComparison.get(i),app.meta,flatTerrain);
    $('base-caption').textContent=sc.short+' · 基准';$('variant-caption').textContent=variant.name;
    $('variant-params').textContent=variant.note+' 累计降雨为基准 '+number(sc.totalRain,' mm')+'、工况 '+number(variant.totalRainMm,' mm')+'。';
    const stats=[['最深水深',base.maxDepth*100,other.maxDepth*100,' cm'],['积水 >15 cm',base.areaHa,other.areaHa,' ha'],['暴露人口',base.pop,other.pop,' 人']];
    const table=$('variant-stats');
    table.replaceChildren(...stats.map(([label,b,v,unit])=>{
      const tr=node('tr');[label,number(b,unit),number(v,unit),delta(v-b,unit)].forEach(s=>tr.append(node('td',s)));return tr;
    }));
    const rec=node('tr');
    ['面积峰后减半',halfArea(sc.frames),halfArea(variant.frames),'—'].forEach(v=>rec.append(node('td',v)));table.append(rec);
    const list=app.sensors.map(s=>({s,d:other.pointsCm[s.id]-Math.round(sc.sensors.find(v=>v.id===s.id).series[i]*100)}))
      .filter(x=>x.d!==0).sort((a,b)=>Math.abs(b.d)-Math.abs(a.d));
    const rank=$('variant-rank');rank.replaceChildren(...list.slice(0,5).map(({s,d})=>{
      const row=node('div',s.name,'an-pair');row.append(node('small',delta(d,' cm')));return row;}));
    if(!list.length)rank.textContent='本帧虚拟点的厘米级读数一致。';
  }
  $('an-variant').onchange=()=>{selectedVariant=$('an-variant').value;activate('compare');};

  function comparisons() {
    const sc=app.scenario;
    if(pairedScenario===sc)return;
    const grids=new Map();
    const depthAt=i=>{if(!grids.has(i))grids.set(i,b64ToU8(sc.frames[i].depth));return grids.get(i);};
    compared=observations.stations.map(s=>compareObservation(s,sc,app.meta,depthAt,15,groundMask));
    pairedScenario=sc;
  }
  function chooseStation(id) {
    selectedStation=id;stationSelect.value=id;verifyFrame();
  }
  stationSelect.onchange=()=>chooseStation(stationSelect.value);
  $('verify-fly').onclick=()=>map.fly(observations.stations.find(s=>s.id===selectedStation)?.xy);
  function verifyFrame() {
    comparisons();
    const matched=compared.filter(s=>s.paired),count=matched.reduce((n,s)=>n+s.paired,0);
    const errors=matched.reduce((n,s)=>n+s.absolute,0);
    $('verify-summary').textContent=app.scenario.id==='replay-2309'?'已验证 '+matched.length+' 站 · 同期样本 '+count+' 对 · 整体 MAE '+(count?number(errors/count,' cm'):'未验证'):'设计降雨工况 · 请选择 9·7 复盘核对同期实测。';
    if(!compared.some(s=>s.station.id===selectedStation))selectedStation=matched[0]?.station.id||compared[0]?.station.id||'';
    options(stationSelect,compared.length?compared.map(v=>[v.station.id,v.station.name+(v.paired?'':' · 未验证')]):[['','暂无实测站']]);
    stationSelect.value=selectedStation;stationSelect.disabled=!compared.length;
    const selected=compared.find(s=>s.station.id===selectedStation);
    $('verify-fly').disabled=!selected||gridAt(selected.station.xy,app.meta)===null;
    const points=observations.stations.map(s=>({...s,kind:'observed'}));
    if(selected?.cell!=null) {
      const [w,s,e,n]=app.meta.bbox,{nx,ny}=app.meta.model,k=selected.cell;
      points.push({id:'grid:'+selected.station.id,name:'匹配模型格',kind:'model-cell',xy:[w+(k%nx+.5)/nx*(e-w),n-(Math.floor(k/nx)+.5)/ny*(n-s)]});
    }
    map.markers(points,selectedStation,id=>{if(!id.startsWith('grid:'))chooseStation(id);});
    const coverage=$('verify-coverage');
    if(selected) {
      const s=selected.station;
      const t=s.records.filter(r=>r.cm!==null).map(r=>r.time);
      const range=t.length?new Date(t.reduce((a,b)=>Math.min(a,b))).toISOString()+' 至 '+new Date(t.reduce((a,b)=>Math.max(a,b))).toISOString():'无有效观测';
      coverage.replaceChildren('来源：',safeLink(observations.sourceUrl,observations.sourceName),'。'+(selected.cell===null?'未匹配到模型范围内的有效地面格。':'网格 '+selected.cell+'，格心距站点 '+Math.round(selected.offset)+' m。')+'覆盖 '+range+'。');
    } else coverage.textContent='尚未接入实测积涝点序列。地图原有 16 个点位均为模型辅助选址的虚拟点。';
    drawPair($('verify-chart'),selected?.observed||[],selected?.simulated||[],app.scenario.frames.map(f=>f.t),app.idx);
    const confirmed=selected?.paired>0,ratio=confirmed&&(selected.hit+selected.miss)>0?100*selected.hit/(selected.hit+selected.miss):null;
    rows($('verify-metrics'),[['平均绝对误差',number(selected?.mae,' cm')],['峰值偏差（模 − 测）',confirmed?delta(selected.peakError,' cm'):'—'],
      ['峰现偏差（模 − 测）',confirmed?delta(selected.peakTimeError,' 分钟'):'—'],['命中 / 漏报 / 空报',confirmed?[selected.hit,selected.miss,selected.falseAlarm].join(' / '):'—'],
      ['超阈帧命中率',number(ratio,'%')]]);
    $('verify-clear').hidden=!observations.stations.length;
  }
  let upload=0;
  $('verify-file').onchange=async e=>{
    const f=e.target.files[0],token=++upload;
    if(!f)return;
    try {
      if(f.size>20*1024*1024)throw Error('请选择 20 MB 以内的地面积水观测文件。');
      const imported=validateObservations(JSON.parse(await f.text()));
      if(!imported.stations.length)throw Error('文件中没有实测站点。');
      if(token!==upload)return;
      observations=imported;pairedScenario=null;selectedStation='';
      $('verify-message').textContent='已载入 '+imported.stations.length+' 个站点，文件仅在当前页面使用。';
      if(active&&tab==='verify'&&ready)verifyFrame();
    } catch(err){if(token===upload)$('verify-message').textContent='导入失败 · '+err.message;}
    finally {e.target.value='';}
  };
  $('verify-clear').onclick=()=>{
    upload++;observations={stations:[]};pairedScenario=null;selectedStation='';
    $('verify-message').textContent='本次观测记录已清除。';verifyFrame();
  };

  function frame() {
    if(!active || !ready || !app.scenario)return;
    $('an-clock').textContent=app.scenario.short+' · '+fmtT(app.scenario.frames[app.idx].t);
    $('an-scenario').value=app.scenario.id;
    if(tab==='sites' && exposureId!==app.scenario.id){activate(tab);return;}
    if(tab==='compare' && variant.baseScenario!==app.scenario.id){activate(tab);return;}
    if(tab==='rain')rainFrame();
    if(tab==='sites')siteFrame();
    if(tab==='compare')compareFrame();
    if(tab==='verify')verifyFrame();
  }
  async function activate(next) {
    tab=next;const token=++request;ready=false;
    tabs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.analysis===tab)));
    sections.forEach(s=>s.hidden=true);
    $('an-scenario-label').hidden=tab==='compare'||tab==='sources';
    $('an-play').hidden=tab==='sources';
    map?.tab(null);message('正在读取研判资料…');
    try {
      if(!catalog){const data=await load('official/catalog.json');if(token!==request)return;if(!catalog)initCatalog(data);}
      if(tab==='sites') {
        const id=app.scenario.id,data=await load('official/'+id+'-exposure.json');
        if(token!==request)return;
        if(app.scenario.id!==id)return activate('sites');
        exposureData=data;exposureId=id;siteFilters(true);
      }
      if(tab==='compare') {
        manifest=await load('sensitivity/index.json');if(token!==request)return;
        options($('an-variant'),manifest.map(v=>[v.id,v.name]));$('an-variant').value=selectedVariant;
        const next=await load('sensitivity/'+selectedVariant+'.json');if(token!==request)return;
        if(app.scenario.id!==next.baseScenario) {
          const idx=app.idx;
          if(!await app.setScenario(next.baseScenario))throw Error('基准情景读取失败');
          if(token!==request)return;
          app.setFrame(idx);
        }
        if(next.frames.length!==app.scenario.frames.length || next.frames.some((f,i)=>f.t!==app.scenario.frames[i].t))throw Error('基准与工况时间轴不一致');
        if(variant!==next)decodedComparison=new Map();
        variant=next;
      }
      if(token!==request)return;
      message('');ready=true;
      sections.find(s=>s.dataset.section===tab).hidden=false;
      map.tab(tab);frame();
    } catch(err){if(token===request){ready=false;map?.tab(null);message('研判资料读取失败 · '+err.message,true);}}
  }
  tabs.forEach(b=>b.onclick=()=>activate(b.dataset.analysis));
  $('an-scenario').onchange=async()=>{
    const ok=await app.setScenario($('an-scenario').value,true);
    $('an-scenario').value=app.scenario.id;if(!ok)message('情景切换失败，已保留原数据。',true);
  };
  return {
    frame,
    show(on,target) {
      active=on;
      if(!on){request++;ready=false;map?.tab(null);return;}
      return activate(tabs.some(b=>b.dataset.analysis===target)?target:tab);
    },
    nearby(sensor) {
      if(!observations.stations.length)return null;
      comparisons();
      return compared.filter(v=>v.paired).map(v=>({v,d:nearMetres([sensor.lon,sensor.lat],v.station.xy)}))
        .filter(item=>item.d<=200).sort((a,b)=>a.d-b.d)[0]||null;
    },
  };
}
