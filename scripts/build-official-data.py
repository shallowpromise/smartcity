"""Import the supplied Shenzhen releases, geocode public names and sample modelled ground depth.
Run with the official archive, the frozen OSM reference and the original grid.npz.
Only the allowlisted public fields below are exported.
"""
import argparse
import base64
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
from zipfile import ZipFile
from io import BytesIO
import numpy as np
from openpyxl import load_workbook
import pdfplumber

DATA = Path(__file__).resolve().parents[1] / "system/public/data"
OUTPUT = DATA / "official"
SOURCES = {
    "indoor": ("室内应急避难场所名录", "深圳市应急管理局", "2026-07-23", "https://yjgl.sz.gov.cn/yjgl/yjgl/yjbncs/content/post_12905910.html", "原表标注 2026 年 4 月。容量为名录登记容量，开放与剩余名额需向属地核实。"),
    "outdoor": ("室外应急避难场所名录", "深圳市应急管理局", "2026-08-18", "https://yjgl.sz.gov.cn/gkmlpt/content/12/12941/post_12941225.html", "公开清单提供名称、类型和地址，未提供逐处容量或实时开放信息。"),
    "streets": ("街道积水降雨阈值", "深圳市气象局、深圳市应急管理局、深圳市水务局", "2026-06-12", "https://weather.sz.gov.cn/xingxigongkai/zhengcefagui/zcfgson/content/post_12840500.html", "半小时、1 小时、3 小时各自累计，达到任一条件即提示风险。阈值受历史样本及城市变化影响。"),
    "idf": ("中部流域暴雨强度公式", "深圳市气象局、深圳市规划和自然资源局、深圳市水务局", "2024-12", "https://weather.sz.gov.cn/qixiangfuwu/qihoufuwu/qihouguanceyupinggu/baoyuqiangdugongshi/content/post_11971465.html", "福田区采用中部流域。单一重现期取表 3，设计雨量为 q × 历时 / 167。"),
    "osm": ("街道边界、设施参考点与路网", "OpenStreetMap contributors", "2026-11-18", "https://www.openstreetmap.org/copyright", "WGS84，ODbL 1.0。场所按公开名称、门牌与街道边界匹配。坐标表示地物参考位置，实际入口待核。"),
    "model": ("福田积水模型与离线工况", "深澜 · 福田模型", "2026-11-18", "https://github.com/shallowpromise/smartcity", "约 32 m 网格，6 秒计算步长、10 分钟输出。水深与人口为推算值。"),
}
PENDING = [
    ("积涝点地面积水深度", "深圳市水务局", "https://opendata.sz.gov.cn/data/api/toApiDetails/29200_01403147", "待订阅站点及带时间的地面积水深度。水位高程需有地面基准才能换算。"),
    ("自动站实况格点雨量", "深圳市气象局", "https://opendata.sz.gov.cn/data/dataSet/toDataDetails/29200_03803658", "待订阅。当前可对照情景雨量。"),
    ("深圳河水文站水位", "深圳市政府数据开放平台", "https://opendata.sz.gov.cn/", "待获取测站、时序与垂直基准。当前采用假设边界工况。"),
    ("道路积水与路段速度", "深圳市政府数据开放平台", "https://opendata.sz.gov.cn/", "待授权。路由依据地面道路、方向、禁转和单帧模型积水。"),
    ("2026 测绘底座", "深圳市规划和自然资源局", "https://pnr.sz.gov.cn/xxgk/gggs/content/post_12759228.html", "DOM、LiDAR 及 LOD1.3 等成果按目录和使用许可申请。当前使用原有地形与建筑。"),
]
COVERAGE = {
    "indoor": ("official_directory","福田区 70 条，原表更新至 2026 年 4 月","按发布机关公开目录引用"),
    "outdoor": ("official_directory","福田区 55 条，2026 年 8 月发布","按发布机关公开目录引用"),
    "streets": ("official_threshold","福田区 10 个街道，2026 年版","按官方工作指引引用"),
    "idf": ("official_formula","深圳中部流域，2024 年版表 3","按发布机关公式引用"),
    "osm": ("geographic_reference","福田街道、设施和模型范围内地面路网，11 月 17–18 日快照","ODbL 1.0"),
    "model": ("modelled","26.7 km²，三套基准与六个比较工况，每组 8 小时、49 帧","模型与底图分别依各自来源署名"),
}


def clean(name):
    text = unicodedata.normalize("NFKC", name).strip()
    text = re.sub(r"^(深圳市)?(福田区)?", "", text)
    return re.sub(r"[\s()·、-]", "", text).replace("原名:", "").replace("校区", "")


def keys(text):
    # Retain campus and branch qualifiers; only use explicit former names as aliases.
    text = unicodedata.normalize("NFKC", text)
    former = re.search(r"\(原名[:：]([^)]*)\)", text)
    candidates = [text.split("(原名")[0]]
    if former:
        candidates.append(former[1])
    return {clean(n) for n in candidates if len(clean(n)) >= 3}


def inside(point, ring):
    x, y = point
    crossing = False
    for (u,v),(s,t) in zip(ring, ring[1:]):
        if (v>y) != (t>y) and x < (s-u)*(y-v)/(t-v)+u:
            crossing = not crossing
    return crossing


def street_for(point, streets):
    for s in streets:
        if any(inside(point, p[0]) and not any(inside(point,h) for h in p[1:]) for p in s["polygons"]):
            return s["name"]
    return None


def metres(a, b):
    return math.hypot((a[0]-b[0])*102922, (a[1]-b[1])*110852)


def address_text(text):
    return re.sub(r"\s", "", unicodedata.normalize("NFKC", text or "")).replace("號","号")


def read_reference(reference, rows, save):
    if reference.is_file():
        snapshot=json.loads(reference.read_text())
        return snapshot["streets"],snapshot["features"]
    names=set().union(*(keys(row["name"]) for row in rows))
    addresses=[address_text(row["address"]) for row in rows]
    features={}
    for path in sorted(reference.glob("map-*.json")):
        for q in json.loads(path.read_text())[0]:
            tags=q["tags"]
            aliases=set().union(*(keys(tags.get(k,"")) for k in ("name:zh","name","alt_name","old_name","official_name")))
            house=address_text(tags.get("addr:housenumber")).removesuffix("号")
            street=address_text(tags.get("addr:street"))
            is_address=house and street and any(street+house+"号" in a for a in addresses)
            if tags.get("railway") not in ("station","subway_entrance") and not (names & aliases) and not is_address:
                continue
            key=(q["type"],q["id"])
            if key not in features or q["sizeM"]>features[key]["sizeM"]:
                features[key]=q
    streets=json.loads((reference/"boundaries.json").read_text())
    features=list(features.values())
    if save:
        snapshot=dict(source="© OpenStreetMap contributors",license="ODbL 1.0",retrievedAt="2026-11-18",
                      sourceUrl="https://api.openstreetmap.org/api/0.6/",crs="WGS84",streets=streets,features=features)
        save.write_text(json.dumps(snapshot,ensure_ascii=False,separators=(",",":")))
    return streets,features


def main(archive, reference, grid, save_reference=None):
    OUTPUT.mkdir(exist_ok=True)
    def load(label):
        fname = next(n for n in package.namelist() if n.startswith("processed/") and label in n and n.endswith(".json"))
        return json.loads(package.read(fname))
    with ZipFile(archive) as package:
        indoor, outdoor, thresholds = [load(label) for label in ("室内","室外","阈值")]
        workbook=load_workbook(BytesIO(package.read(next(n for n in package.namelist() if n.endswith(".xlsx")))),read_only=True,data_only=True)
        public_rows={int(r[0]):r for r in workbook.active.values if r[1]=="福田区"}
        for r in indoor:
            source=public_rows[r["source_id"]]
            assert (address_text(source[4]),address_text(source[8]),float(source[9]),float(source[10]))==(
                address_text(r["name"]),address_text(r["address"]),r["capacity_people"],r["area_m2"])
        workbook.close()
        with pdfplumber.open(BytesIO(package.read(next(n for n in package.namelist() if "室外" in n and n.endswith(".pdf"))))) as doc:
            outdoor_rows={r[0]:r for page in doc.pages for table in page.extract_tables() for r in table
                          if len(r)>=5 and r[2]=="福田区" and (r[0] or "").isdigit()}
        assert len(outdoor_rows)==len(outdoor)
        for r in outdoor:
            official=outdoor_rows[str(r["source_id"])]
            assert all(address_text(official[col])==address_text(r[key]) for col,key in ((1,"name"),(3,"type"),(4,"address")))
        document = next(n for n in package.namelist() if n.endswith(".docx"))
        with ZipFile(BytesIO(package.read(document))) as doc:
            xml = ET.fromstring(doc.read("word/document.xml"))
            ns = {"w":"http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
            official_rows = {}
            for row in xml.findall(".//w:tr",ns):
                cols = ["".join(x.text or "" for x in c.findall(".//w:t",ns)) for c in row.findall("w:tc",ns)]
                if len(cols)==3 and "半小时雨量" in cols[1]:
                    official_rows[cols[0]] = (list(map(int,re.findall(r"≥(\d+)mm",cols[1]))),cols[2])
            for s in thresholds:
                assert official_rows[s["street"]] == ([s[k] for k in ("rain_30m_mm","rain_1h_mm","rain_3h_mm")],s["risk_note"])
    streets,candidates=read_reference(reference,indoor+outdoor,save_reference)
    assert (len(indoor),len(outdoor),len(thresholds),len(streets)) == (70,55,10,10)
    for s in streets:
        row = next(r for r in thresholds if r["street"]==s["name"])
        s.update(thresholds=[row[k] for k in ("rain_30m_mm","rain_1h_mm","rain_3h_mm")],note=row["risk_note"])
    index = defaultdict(list)
    address_index = defaultdict(list)
    for q in candidates:
        tags = q["tags"]
        if q["type"] == "node" and not (tags.get("amenity") or tags.get("leisure")):
            continue  # Bus stops can carry the same name as the nearby school or park.
        if tags.get("railway"): continue
        road=address_text(tags.get("addr:street"))
        number=address_text(tags.get("addr:housenumber")).removesuffix("号")
        if road and re.fullmatch(r"[0-9]+(?:-[0-9]+)?",number):
            address_index[road+number+"号"].append(q)
        for field in ("name:zh", "name", "alt_name", "old_name", "official_name"):
            for key in keys(q["tags"].get(field,"")):
                index[key].append(q)
    meta=json.loads((DATA/"meta.json").read_text()); west,south,east,north=meta["bbox"]; width,height=meta["world"]
    graph=json.loads((DATA/"road-network.json").read_text())
    g=np.load(grid); ny,nx=g["z"].shape; ground=~(g["b"].astype(bool)|g["w"].astype(bool))
    def locate(f,q,method):
        lon,lat=q["xy"]; f.update(xy=q["xy"],osm=q["type"]+"/"+str(q["id"]),geocodeStatus="osm_match",
                                  locationStreet=street_for(q["xy"],streets),geocodeMethod=method)
        if not(west<=lon<east and south<lat<=north): return
        x=(lon-west)/(east-west)*width; y=(north-lat)/(north-south)*height
        i,j=int(x/width*nx),int(y/height*ny)
        if ground[j,i]:
            cell=j*nx+i
        else:
            nearby=[(math.hypot((u+.5)*width/nx-x,(v+.5)*height/ny-y),v*nx+u) for v in range(max(0,j-2),min(ny,j+3)) for u in range(max(0,i-2),min(nx,i+3)) if ground[v,u]]
            nearest=min(nearby,default=(math.inf,None))
            cell=nearest[1] if nearest[0]<=48 else None
        f["inDomain"]=True
        if cell is not None:
            f["cell"]=cell
            f["sampleOffsetM"]=round(math.hypot((cell%nx+.5)*width/nx-x,(cell//nx+.5)*height/ny-y))
        near=min(graph["nodes"],key=lambda n:math.hypot(n[1]-x,n[2]-y))
        dist=math.hypot(near[1]-x,near[2]-y)
        if dist<=120:f.update(roadNode=near[0],roadOffsetM=round(dist))

    facilities=[]
    for kind,rows in (("indoor",indoor),("outdoor",outdoor)):
        for row in rows:
            f=dict(id=f"{kind}-{row['source_id']}",kind=kind,name=row["name"],address=row["address"],type=row.get("type") or "室内场所",
                   street=row.get("street"),community=row.get("community"),capacity=row.get("capacity_people"),area=row.get("area_m2"),
                   sourceUpdated=row["source_updated"],availability="needs_verification",geocodeStatus="geocode_failed",
                   geocodeMethod=None,fieldVerified=False,xy=None)
            hits={(q["type"],q["id"]):q for k in keys(row["name"]) for q in index[k]}
            method="name_and_street"
            official_address=address_text(row["address"])
            by_address={(q["type"],q["id"]):q for text,points in address_index.items() if text in official_address for q in points}
            located_by_address={k:q for k,q in by_address.items() if (area:=street_for(q["xy"],streets)) and (not f["street"] or f["street"]==area)}
            if hits.keys() & located_by_address.keys():
                hits={k:q for k,q in hits.items() if k in located_by_address}
                method="name_and_address"
            elif not hits and located_by_address:
                # A shared postal address for different sectors of a large park or campus is ambiguous.
                hits={k:q for k,q in located_by_address.items() if q["sizeM"]<=600}
                method="street_and_number"
            matches=[]
            for q in hits.values():
                street=street_for(q["xy"],streets)
                if street and (not f["street"] or street==f["street"]):
                    matches.append(q)
            venues=[q for q in matches if q["tags"].get("amenity") in ("school","college","kindergarten","community_centre") or q["tags"].get("leisure") in ("park","stadium","sports_centre")]
            if venues: matches=venues
            if matches and all(metres(q["xy"],matches[0]["xy"])<120 for q in matches):
                q=max(matches,key=lambda a: (a["tags"].get("amenity")=="school" or a["tags"].get("leisure")=="park",a["sizeM"]))
                locate(f,q,method)
            facilities.append(f)
    stations=[q for q in candidates if q["tags"].get("railway")=="station" and q["tags"].get("name")]
    for q in candidates:
        lon,lat=q["xy"]; tag=q["tags"]
        if tag.get("railway")!="subway_entrance" or not(west<lon<east and south<lat<north):continue
        nearest=min(stations,key=lambda s:metres(q["xy"],s["xy"]),default=None)
        ref=tag.get("ref") or tag.get("name") or str(q["id"])
        name=f"地铁出入口 {ref}"
        if nearest and metres(q["xy"],nearest["xy"])<=280:name=f"{nearest['tags']['name']}站附近 · {ref}"
        f=dict(id=f"metro-{q['id']}",kind="metro",type="地铁出入口",name=name,capacity=None,area=None,address=None,street=None,sourceUpdated="2026-11-18")
        locate(f,q,"mapped_entrance");facilities.append(f)
    out=dict(schemaVersion=1,retrievedAt="2026-11-18",archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest(),
             crs="WGS84",sources={k:dict(zip(("name","publisher","date","url","note"),v)) for k,v in SOURCES.items()},
             pending=[dict(zip(("name","publisher","url","note"),v)) for v in PENDING],streets=streets,facilities=facilities,
             groundMask=base64.b64encode(np.packbits(ground,bitorder="little").tobytes()).decode())
    for key,(kind,coverage,terms) in COVERAGE.items():
        out["sources"][key].update(dataKind=kind,timeCoverage=coverage,usage=terms,retrievedAt=out["retrievedAt"])
    def write(path,obj): path.write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":")))
    write(OUTPUT/"catalog.json",out)
    for scenario in ("replay-2309","design-5","design-50"):
        frames=json.loads((DATA/"scenarios"/(scenario+".json")).read_text())["frames"]
        fields=[base64.b64decode(v["depth"]) for v in frames]
        write(OUTPUT/(scenario+"-exposure.json"),{f["id"]:[d[f["cell"]] for d in fields] for f in facilities if "cell" in f})
    for kind in ("indoor","outdoor","metro"):
        fs=[f for f in facilities if f["kind"]==kind];print(kind,len(fs),sum(bool(f.get("xy")) for f in fs),"matched",sum("cell" in f for f in fs),"sampled",sum("roadNode" in f for f in fs),"road links")


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    for arg in ("archive","reference","grid"):p.add_argument(arg,type=Path)
    p.add_argument("--save-reference",type=Path,help="freeze the required public fields from a new map extract")
    a=p.parse_args();main(a.archive,a.reference,a.grid,a.save_reference)
