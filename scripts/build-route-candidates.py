"""Generate the fixed route comparisons for the bundled Futian flood scenarios."""
import argparse
import base64
from collections import defaultdict
import heapq
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
PAIRS = [
    ("红荔路片区", 8201901268, 564275538),
    ("福华三路片区", 7959990831, 7966386945),
    ("福中一路片区", 7962005294, 7962005425),
]


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


def read_network(source):
    nodes, roads, names = {}, defaultdict(dict), defaultdict(set)
    for way in json.loads(source.read_text())["elements"]:
        tags = way.get("tags", {})
        if tags.get("highway") not in STREETS or tags.get("area") == "yes":
            continue
        if any(tags.get(k, "no") != "no" for k in ("bridge", "tunnel")) or tags.get("layer", "0") != "0":
            continue
        if any(tags.get(k, "yes") not in {"yes", "permissive", "designated"} for k in ACCESS_KEYS):
            continue
        ids, geometry = way.get("nodes", []), way.get("geometry", [])
        if len(ids) != len(geometry):
            continue
        default = "yes" if tags.get("junction") == "roundabout" else "no"
        oneway = tags.get("oneway", default)
        if oneway not in {"yes", "1", "true", "no", "0", "false", "-1"}:
            continue
        points = [(round((p["lon"] - WEST) * 111320 * .92455, 2),
                   round((NORTH - p["lat"]) * 110852, 2)) for p in geometry]
        for a, b, p, q in zip(ids, ids[1:], points, points[1:]):
            if a == b or p == q or any(not (0 <= x < WIDTH and 0 <= z < HEIGHT) for x, z in (p, q)):
                continue
            nodes[a], nodes[b] = p, q
            name = tags.get("name", "")
            if name:
                names[a].add(name)
                names[b].add(name)
            edge = (math.dist(p, q), grid_cells(p, q), name)
            if oneway != "-1":
                roads[a][b] = edge
            if oneway not in {"yes", "1", "true"}:
                roads[b][a] = edge
    return nodes, roads, names


def shortest(roads, start, end, blocked):
    queue, distances, parents = [(0, start)], {start: 0}, {}
    while queue:
        distance, u = heapq.heappop(queue)
        if distance > distances[u]:
            continue
        if u == end:
            path = [u]
            while path[-1] != start:
                path.append(parents[path[-1]])
            return tuple(reversed(path))
        for v, (length, cells, _) in roads.get(u, {}).items():
            if not cells.isdisjoint(blocked):
                continue
            candidate = distance + length
            if candidate < distances.get(v, math.inf):
                distances[v], parents[v] = candidate, u
                heapq.heappush(queue, (candidate, v))
    return ()


def blocked_frames():
    yield set()  # Ordinary shortest path without water exclusions.
    for scenario in json.loads((DATA / "scenarios/index.json").read_text()):
        path = DATA / "scenarios" / (scenario["id"] + ".json")
        for frame in json.loads(path.read_text())["frames"]:
            depth = base64.b64decode(frame["depth"], validate=True)
            if len(depth) != NX * NY:
                raise ValueError(f"Grid size mismatch in {path} at {frame['t']} min")
            for limit in (10, 15, 30):
                yield {i for i, cm in enumerate(depth) if cm >= limit}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("osm", type=Path, help="Overpass JSON containing way node IDs, geometry and tags")
    args = parser.parse_args()
    nodes, roads, names = read_network(args.osm)
    alternatives = [dict() for pair in PAIRS]
    for blocked in blocked_frames():
        for (_, start, end), paths in zip(PAIRS, alternatives):
            path = shortest(roads, start, end, blocked)
            if path and path not in paths:
                edges = [roads[u][v] for u, v in zip(path, path[1:])]
                paths[path] = {
                    "points": [nodes[i] for i in path],
                    "lengthM": round(sum(e[0] for e in edges), 1),
                    "cells": sorted(set().union(*(e[1] for e in edges))),
                    "streets": list(dict.fromkeys(e[2] for e in edges if e[2])),
                }
    cases = []
    for (label, start, end), paths in zip(PAIRS, alternatives):
        if not paths:
            raise ValueError(f"Unconnected endpoints {start} {end}")
        cases.append({"label": label, "start": " / ".join(sorted(names[start])),
                      "end": " / ".join(sorted(names[end])), "osmNodes": [start, end],
                      "paths": list(paths.values())})
    data = {"world": META["world"], "grid": [NX, NY], "cases": cases}
    (DATA / "route-candidates.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
