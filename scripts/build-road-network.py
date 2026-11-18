"""Build the directed motor or walking graph for the bundled Futian flood scenarios."""
import argparse
import base64
from collections import defaultdict
import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "system/public/data"
META = json.loads((DATA / "meta.json").read_text())
WIDTH, HEIGHT = META["world"]
NX, NY = META["model"]["nx"], META["model"]["ny"]
WEST, _, _, NORTH = META["bbox"]
STREETS = {"primary", "secondary", "tertiary", "residential", "unclassified", "living_street"}
ACCESS_KEYS = ("access", "vehicle", "motor_vehicle", "motorcar")
def grid_cells(start, end):
    """Collect every cell traversed by a segment, including the two endpoint cells."""
    x, z = start
    dx, dz = end[0] - x, end[1] - z
    cuts = {0, 1}
    for origin, delta, size in ((x, dx, WIDTH / NX), (z, dz, HEIGHT / NY)):
        if delta:
            low, high = sorted((origin, origin + delta))
            for k in range(math.floor(low / size) + 1, math.ceil(high / size)):
                cuts.add((k * size - origin) / delta)
    order = sorted(cuts)
    samples = [0, 1] + [(a + b) / 2 for a, b in zip(order, order[1:])]
    return {int((x + t * dx) / WIDTH * NX) + NX * int((z + t * dz) / HEIGHT * NY)
            for t in samples}


def build(archive, controls):
    elements = controls["elements"]
    denied = {e["id"] for e in elements if e["type"] == "node" and
              next((e["tags"][k] for k in reversed(ACCESS_KEYS) if k in e["tags"]), None)
              not in {"yes", "designated", "permissive"}}
    coords, arcs, street_names, road_classes = {}, [], defaultdict(set), {}
    skipped_barriers = set()
    for way in archive["elements"]:
        tags = way.get("tags", {})
        if tags.get("highway") not in STREETS or tags.get("area") == "yes":
            continue
        if any(tags.get(k, "no") != "no" for k in ("bridge", "tunnel")) or tags.get("layer", "0") != "0":
            continue
        if any(tags.get(k, "yes") not in {"yes", "permissive", "designated"} for k in ACCESS_KEYS):
            continue
        if any(k + ":conditional" in tags for k in (*ACCESS_KEYS, "oneway")):
            continue
        ids, geom = way.get("nodes", []), way.get("geometry", [])
        if len(ids) != len(geom):
            continue
        direction = tags.get("oneway", "yes" if tags.get("junction") == "roundabout" else "no")
        if direction not in {"yes", "true", "1", "no", "false", "0", "-1"}:
            continue
        points = [(round((p["lon"] - WEST) * 111320 * .92455, 2),
                   round((NORTH - p["lat"]) * 110852, 2)) for p in geom]
        name = tags.get("name", "")
        for a, b, p, q in zip(ids, ids[1:], points, points[1:]):
            if a == b or p == q or any(not(0 <= x < WIDTH and 0 <= z < HEIGHT) for x,z in (p,q)):
                continue
            if a in denied or b in denied:
                skipped_barriers.update({a,b} & denied)
                continue
            coords[a], coords[b] = p, q
            road_classes[way["id"]] = tags["highway"]
            if name:
                street_names[a].add(name)
                street_names[b].add(name)
            cells = sorted(grid_cells(p,q))
            if direction != "-1":
                arcs.append((a,b,way["id"],name,cells))
            if direction not in {"yes", "1", "true"}:
                arcs.append((b,a,way["id"],name,cells))

    ids = sorted(coords)
    index = {n:i for i,n in enumerate(ids)}
    names = sorted({e[3] for e in arcs})
    name_id = {s:i for i,s in enumerate(names)}
    outgoing, incoming = defaultdict(list), defaultdict(list)
    edges = []
    for i,(a,b,way,name,cells) in enumerate(arcs):
        outgoing[a].append(i)
        incoming[b].append(i)
        edges.append([index[a],index[b],name_id[name],way,cells])

    forbidden, applied, incomplete, unmatched = set(), [], [], []
    uncertain_vias = set()
    for rel in (e for e in elements if e["type"] == "relation"):
        members = {m["role"]:m["ref"] for m in rel["members"]}
        before, after, via = (members.get(k) for k in ("from","to","via"))
        rule = rel["tags"].get("restriction")
        if not all((before,after,via)) or not rule or not any(
                m["role"] == "via" and m["type"] == "node" for m in rel["members"]):
            incomplete.append(rel["id"])
            # Where the queried relation identifies a via node but lacks a leg,
            # conservatively omit affected turns through that node.
            if via in index and any(m["role"] == "via" and m["type"] == "node" for m in rel["members"]):
                uncertain_vias.add(via)
                for i in incoming[via]:
                    for j in outgoing[via]:
                        if (not before or arcs[i][2] == before) and (not after or arcs[j][2] == after or (rule or "").startswith("only_")):
                            forbidden.add((i,j))
            continue
        added = []
        for i in incoming[via]:
            if arcs[i][2] != before:
                continue
            for j in outgoing[via]:
                matches = arcs[j][2] == after
                if rule == "no_u_turn" and before == after:
                    matches = matches and arcs[i][0] == arcs[j][1]
                if (rule.startswith("only_") and not matches) or (rule.startswith("no_") and matches):
                    added.append((i,j))
        forbidden.update(added)
        (applied if added else unmatched).append(rel["id"])

    return {
        "version": 1, "world": META["world"], "grid": [NX,NY],
        "nodes": [[n,*coords[n]] for n in ids], "names": names, "edges": edges, "wayClasses": road_classes,
        "turns": sorted(forbidden),
        "junctions": [[index[n]," / ".join(sorted(street_names[n]))] for n in ids if len(street_names[n]) >= 2],
        "coverage": {"roadSnapshot":archive.get("osm3s",{}).get("timestamp_osm_base"),
                     "controlsDate":controls["retrieved"], "barrierNodesExcluded":sorted(skipped_barriers),
                     "restrictionsApplied":applied, "restrictionsIncomplete":incomplete,
                     "restrictionsUnmatched":unmatched, "uncertainViaNodes":sorted(uncertain_vias)}
    }


def build_walk(archive, controls):
    """Public surface walking links, retaining only true shared OSM junctions."""
    permitted = {"yes", "permissive", "designated", "official"}
    footways = {"footway", "pedestrian", "path", "steps", "living_street", "residential", "unclassified"}
    arterial = {"primary", "secondary", "tertiary", "cycleway", "service"}
    forbidden = set()
    for entry in controls["elements"] + [e for e in archive["elements"] if e["type"] == "node"]:
        if entry["type"] != "node":
            continue
        t = entry.get("tags", {})
        access = t.get("foot", t.get("access"))
        if (access is not None and access not in permitted) or (
                t.get("barrier") not in (None, "bollard", "cycle_barrier", "kerb", "entrance") and access not in permitted):
            forbidden.add(entry["id"])
    west, south, east, north = META["bbox"]
    # A zero stored for a building or river cell is not an observed dry footpath.
    mask = base64.b64decode(json.loads((DATA/"official/catalog.json").read_text())["groundMask"])
    coords, arcs, splits = {}, [], {}
    for way in archive["elements"]:
        t = way.get("tags", {})
        kind = t.get("highway")
        sidewalk = any(t.get(k) in ("yes","both","left","right") for k in ("sidewalk","sidewalk:left","sidewalk:right","sidewalk:both"))
        signed_foot_access = sidewalk or t.get("foot") in permitted or (kind == "service" and t.get("service") == "alley")
        if kind not in footways and not (kind in arterial and signed_foot_access):
            continue
        if (t.get("foot", t.get("access","yes")) not in permitted or t.get("area") == "yes"
                or t.get("motorroad") == "yes" or t.get("sidewalk") == "separate"
                or t.get("layer","0") != "0" or t.get("level","0") != "0"
                or any(t.get(k,"no") != "no" for k in ("bridge","tunnel","indoor","conveying"))
                or any(k in t for k in ("access:conditional","foot:conditional","oneway:foot:conditional","foot:forward:conditional","foot:backward:conditional"))):
            continue
        direction = t.get("oneway:foot","no")
        if direction not in ("yes","1","true","no","0","false","-1"):
            continue
        forward = direction != "-1" and t.get("foot:forward","yes") in permitted
        backward = direction not in ("yes","1","true") and t.get("foot:backward","yes") in permitted
        if not (forward or backward):
            continue
        ids, geom = way.get("nodes",[]), way.get("geometry",[])
        if len(ids) != len(geom):
            continue
        points = [(round((p["lon"]-west)/(east-west)*WIDTH,2),round((north-p["lat"])/(north-south)*HEIGHT,2)) for p in geom]
        generic = {"crossing":"人行横道","steps":"地面台阶","sidewalk":"人行道","pedestrian":"步行街"}.get(t.get("footway",kind),"地面步道")
        name = t.get("name:zh") or t.get("name") or generic
        for a,b,p,q in zip(ids,ids[1:],points,points[1:]):
            if a==b or p==q or a in forbidden or b in forbidden or any(not (0<=x<WIDTH and 0<=y<HEIGHT) for x,y in (p,q)):
                continue
            pieces=math.ceil(math.dist(p,q)/32)
            previous,point=a,p
            for step in range(1,pieces+1):
                if step==pieces:
                    current,next_point=b,q
                else:
                    key=(min(a,b),max(a,b),step if a<b else pieces-step)
                    current=splits.setdefault(key,-len(splits)-1)
                    next_point=tuple(round(v+(u-v)*step/pieces,2) for v,u in zip(p,q))
                cells=sorted(grid_cells(point,next_point))
                if all(mask[k>>3] & (1<<(k%8)) for k in cells):
                    coords[previous],coords[current]=point,next_point
                    if forward: arcs.append((previous,current,name,way["id"],cells))
                    if backward: arcs.append((current,previous,name,way["id"],cells))
                previous,point=current,next_point
    ids=sorted(coords)
    indexes={osm:i for i,osm in enumerate(ids)}
    names=sorted({a[2] for a in arcs})
    labels={name:i for i,name in enumerate(names)}
    return dict(version=1,profile="walk",world=META["world"],grid=[NX,NY],
                nodes=[[osm,*coords[osm]] for osm in ids],names=names,turns=[],junctions=[],
                edges=[[indexes[a],indexes[b],labels[name],way,cells] for a,b,name,way,cells in arcs],
                coverage={"roadSnapshot":archive.get("osm3s",{}).get("timestamp_osm_base"),"controlsDate":controls["retrieved"],
                          "source":"© OpenStreetMap contributors","license":"ODbL 1.0"})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm", type=Path)
    parser.add_argument("--controls", type=Path, default=Path(__file__).with_name("traffic-controls.json"))
    parser.add_argument("--walking", action="store_true", help="build the separate surface pedestrian profile")
    args = parser.parse_args()
    builder = build_walk if args.walking else build
    graph = builder(json.loads(args.osm.read_text()), json.loads(args.controls.read_text()))
    filename = "walk-network.json" if args.walking else "road-network.json"
    (DATA / filename).write_text(json.dumps(graph,ensure_ascii=False,separators=(",", ":")) + "\n")
    print(len(graph["nodes"]), "nodes,", len(graph["edges"]), "arcs,", len(graph["turns"]), "blocked transitions")
