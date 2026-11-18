"""Build the directed motor-vehicle graph for the bundled Futian flood scenarios."""
import argparse
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm", type=Path)
    parser.add_argument("--controls", type=Path, default=Path(__file__).with_name("traffic-controls.json"))
    args = parser.parse_args()
    graph = build(json.loads(args.osm.read_text()), json.loads(args.controls.read_text()))
    (DATA / "road-network.json").write_text(json.dumps(graph,ensure_ascii=False,separators=(",", ":")) + "\n")
    print(len(graph["nodes"]), "nodes,", len(graph["edges"]), "arcs,", len(graph["turns"]), "blocked transitions")
