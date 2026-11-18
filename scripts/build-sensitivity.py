"""Recompute offline sensitivities from the original Futian model grid (NumPy).
Hydrology and export smoothing adapted from nannnnn-1/smartcity, f90e8cbe,
pipeline/05_hydrology.py. Baseline output is checked against the shipped grids.
"""
import argparse
import base64
import hashlib
import itertools
import json
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parents[1] / "system/public/data"
DURATION_MIN, FRAME_MIN = 480, 10
DT, CELL, N_MANNING = 6.0, 32.0, 0.07
AREA = CELL * CELL

def storm_50(minutes):
    """50 年一遇设计暴雨：单峰 + 尾峰，8h 约 340mm。"""
    t = minutes / 60.0
    r = (4.0
         + 100 * np.exp(-((t - 2.4) ** 2) / (2 * 0.72 ** 2))
         + 62 * np.exp(-((t - 4.6) ** 2) / (2 * 0.9 ** 2))
         + 10 * np.exp(-((t - 6.2) ** 2) / (2 * 1.2 ** 2)))
    return r


def make_rain(func, target_total):
    m = np.arange(0, DURATION_MIN + 1, 1.0)
    r = func(m)
    r = np.clip(r, 0, None)
    total = r.sum() / 60.0
    r *= target_total / total
    return r  # mm/h per minute


def smooth_depth(h, open_mask, passes=2):
    """亚网格平滑：把 32m 网格内不连续的积水斑块处理为连续水面，同时保持建筑不积水。"""
    w = open_mask.astype(np.float64)
    for _ in range(passes):
        hn = (4.0 * h * w
              + 2.0 * (np.roll(h * w, 1, 0) + np.roll(h * w, -1, 0)
                       + np.roll(h * w, 1, 1) + np.roll(h * w, -1, 1))
              + (np.roll(np.roll(h * w, 1, 0), 1, 1) + np.roll(np.roll(h * w, 1, 0), -1, 1)
                 + np.roll(np.roll(h * w, -1, 0), 1, 1) + np.roll(np.roll(h * w, -1, 0), -1, 1))) / 16.0
        wn = (4.0 * w
              + 2.0 * (np.roll(w, 1, 0) + np.roll(w, -1, 0) + np.roll(w, 1, 1) + np.roll(w, -1, 1))
              + (np.roll(np.roll(w, 1, 0), 1, 1) + np.roll(np.roll(w, 1, 0), -1, 1)
                 + np.roll(np.roll(w, -1, 0), 1, 1) + np.roll(np.roll(w, -1, 0), -1, 1))) / 16.0
        hn = np.divide(hn, wn, out=np.zeros_like(hn), where=wn > 1e-6)
        h = hn
    h[~open_mask] = 0.0
    h[h < 0.012] = 0.0
    return h


def run_model(z, cn, b, w, drain, pop, rain_min, south_stage=None, sensor_cells=()):
    ny, nx = z.shape
    nsteps = int(DURATION_MIN * 60 / DT) + 1
    h = np.zeros_like(z, dtype=np.float64)
    # 河道初始水深
    h[w] = 0.15
    S = 25400.0 / cn - 254.0
    P = np.zeros_like(z)
    Qprev = np.zeros_like(z)
    open_mask = (~b) & (~w)
    gy, gx = np.gradient(z, CELL)
    slope = np.hypot(gx, gy)
    drain_m = drain / 1000.0 / 3600.0 * DT
    # 建筑邻域权重
    openR = np.roll(open_mask, -1, axis=1).astype(float); openR[:, -1] = 0
    openL = np.roll(open_mask, 1, axis=1).astype(float); openL[:, 0] = 0
    openD = np.roll(open_mask, 1, axis=0).astype(float); openD[0, :] = 0
    openU = np.roll(open_mask, -1, axis=0).astype(float); openU[-1, :] = 0
    wsum = openR + openL + openD + openU
    wsum[wsum == 0] = 1

    frames = []
    next_frame = 0

    for step in range(nsteps):
        tsec = step * DT
        tmin = tsec / 60.0
        i0 = min(int(tmin), DURATION_MIN)
        rain = rain_min[i0]  # mm/h

        # 1) 产流
        if rain > 0:
            P += rain * DT / 3600.0
        Qcum = np.where(P > 0.2 * S, (P - 0.2 * S) ** 2 / (P + 0.8 * S), 0.0)
        dQ = np.maximum(Qcum - Qprev, 0.0) / 1000.0  # m
        Qprev = Qcum

        h[open_mask] += dQ[open_mask]
        # 建筑屋面产流按四邻域分摊到周边开敞格（屋面立管/散水）
        add = np.zeros_like(h)
        add += np.roll((dQ * b) * openR / wsum, 1, axis=1)
        add += np.roll((dQ * b) * openL / wsum, -1, axis=1)
        add += np.roll((dQ * b) * openD / wsum, -1, axis=0)
        add += np.roll((dQ * b) * openU / wsum, 1, axis=0)
        h += add * 0.92  # 少量屋面损失

        # 2) 排水
        rem = np.minimum(h, drain_m)
        rem[~open_mask] = 0
        h -= rem
        h[b] = 0.0
        h[w] = np.maximum(h[w], 0.0)

        # 3) 地表汇流（扩散波）
        eta = z + h
        eta[b] = z[b] + 8.0  # 建筑作为障碍
        # Prescribe head before computing the inward and outward Manning fluxes.
        # A dry/free outfall reproduces the archived solver. A stage applies only
        # to connected, open southern-edge cells below that absolute model datum.
        if south_stage is None:
            h[-1, :] = 0.0
        else:
            minimum = np.min(z[-1, open_mask[-1]])
            level = minimum + (south_stage - minimum) * min(tmin / 60.0, 1.0)
            h[-1, :] = np.maximum(level - z[-1, :], 0) * open_mask[-1, :]
        eta[-1, :] = z[-1, :] + h[-1, :]

        def flux(eta_i, h_i, eta_n, mask_n):
            dh = eta_i - eta_n
            pos = dh > 0
            hf = np.minimum(h_i, np.maximum(dh, 0))
            q = (1.0 / N_MANNING) * np.power(np.maximum(hf, 0), 5.0 / 3.0) * \
                np.sqrt(np.maximum(dh, 0) / CELL) * CELL * DT
            q[~pos] = 0
            q[~mask_n] = 0
            return q

        etaR = np.roll(eta, -1, axis=1); etaR[:, -1] = eta[:, -1] + 5
        etaL = np.roll(eta, 1, axis=1); etaL[:, 0] = eta[:, 0] + 5
        etaD = np.roll(eta, 1, axis=0); etaD[0, :] = eta[0, :] + 5
        etaU = np.roll(eta, -1, axis=0); etaU[-1, :] = eta[-1, :]
        mR = np.roll(open_mask, -1, axis=1); mR[:, -1] = False
        mL = np.roll(open_mask, 1, axis=1); mL[:, 0] = False
        mD = np.roll(open_mask, 1, axis=0); mD[0, :] = False
        mU = np.roll(open_mask, -1, axis=0); mU[-1, :] = False

        qR = flux(eta, h, etaR, mR)
        qL = flux(eta, h, etaL, mL)
        qD = flux(eta, h, etaD, mD)
        qU = flux(eta, h, etaU, mU)
        qout = qR + qL + qD + qU
        limit = 0.32 * h * AREA
        scale = np.ones_like(h)
        nz = qout > 0
        scale[nz] = np.minimum(1.0, limit[nz] / qout[nz])
        qR *= scale; qL *= scale; qD *= scale; qU *= scale
        qout = qR + qL + qD + qU

        qin = (np.roll(qR, 1, axis=1) + np.roll(qL, -1, axis=1) +
               np.roll(qD, -1, axis=0) + np.roll(qU, 1, axis=0))
        h += (qin - qout) / AREA
        h = np.maximum(h, 0.0)
        h = np.minimum(h, 5.0)
        h[~open_mask] = 0.0

        # 4) 输出帧（亚网格平滑后输出，避免 32m 网格的“椒盐”积水斑块）
        if tmin >= next_frame - 1e-6:
            hs = smooth_depth(h, open_mask, passes=2)
            # 陡坡上的薄层水不作为“积水”展示（仍参与水量平衡）
            hs[(slope > 0.055) & (hs < 0.30)] = 0.0
            depth_cm = np.clip(np.round(hs * 100), 0, 255).astype(np.uint8)
            frames.append({
                "t": int(round(tmin)),
                "rain": round(float(rain), 1),
                "depth": depth_cm,
                "pointsCm": [round(float(hs[cell])*100) for cell in sensor_cells],
                "maxDepth": round(float(hs.max()), 3),
                "areaHa": round(float(((hs > 0.15) * AREA).sum() / 10000), 1),
                "pop": int((pop * (hs > 0.30)).sum()),
                "warn": 0,
            })
            next_frame += FRAME_MIN

    return frames

# The rectangle is WGS84, west/south/east/north. All other inputs stay fixed.
BLOCK = [114.080, 22.538, 114.088, 22.544]
CASES = [
    ("drain70", "排水能力 70%", "design-50", {"drainFactor": 0.70}, "全域概化排水能力降至基准的 70%。"),
    ("block", "局部排水堵塞", "design-50", {"drainFactor": 0.20, "bbox": BLOCK}, "东经 114.080–114.088°、北纬 22.538–22.544° 矩形内排水能力降至 20%。"),
    ("stage25", "南侧较高水位", "design-50", {"southStageM": 2.5}, "南缘开敞网格的边界水位在首小时升至模型高程 2.50 m，随后维持。"),
    ("stage40", "南侧极端水位", "design-50", {"southStageM": 4.0}, "南缘开敞网格的边界水位在首小时升至模型高程 4.00 m，随后维持。"),
    ("idf5", "公式雨型 · 5 年", "design-5", {"returnYears": 5}, "中部流域表 3，3 小时交替区块设计雨型，居中峰值。随后 5 小时无雨。"),
    ("idf50", "公式雨型 · 50 年", "design-50", {"returnYears": 50}, "中部流域表 3，3 小时交替区块设计雨型，居中峰值。随后 5 小时无雨。"),
]


def formula_rain(period):
    a, b, n = {5: (5422.490, 21.140, .741), 50: (4367.217, 19.736, .621)}[period]
    durations = np.arange(0, 181, 10)
    totals = a / (durations + b) ** n / 167 * durations
    blocks = np.diff(totals)
    placement = [8] + [j for k in range(1, 10) for j in (8 + k, 8 - k) if 0 <= j < 18]
    rain = np.zeros(DURATION_MIN + 1)
    for j, amount in zip(placement, blocks):
        rain[10*j:10*j+10] = amount * 6
    return rain


def encode_runs(depth):
    pairs = bytearray()
    for value, group in itertools.groupby(depth.tobytes()):
        count = sum(1 for _ in group)
        while count:
            take = min(count, 255)
            pairs.extend([take, value])
            count -= take
    return base64.b64encode(pairs).decode()


def main(grid):
    g = np.load(grid)
    meta = json.loads((DATA / "meta.json").read_text())
    sensors = json.loads((DATA / "sensors.json").read_text())
    z, cn, drain = [g[k].astype(np.float64) for k in ("z", "cn", "drain")]
    b, w = [g[k].astype(bool) for k in ("b", "w")]
    ny, nx = z.shape
    width, height = meta["world"]
    cells = [(int(s["z"]/height*ny), int(s["x"]/width*nx)) for s in sensors]
    west, south, east, north = meta["bbox"]
    lon = west + (np.arange(nx)+.5)/nx * (east-west)
    lat = north - (np.arange(ny)+.5)/ny * (north-south)
    rain = make_rain(storm_50, 340.0)
    destination = DATA / "sensitivity"
    destination.mkdir(exist_ok=True)
    grid_hash = hashlib.sha256(Path(grid).read_bytes()).hexdigest()
    archive = json.loads((DATA / "scenarios/design-50.json").read_text())
    baseline = run_model(z, cn, b, w, drain, g["pop"], rain)
    for archived, frame in zip(archive["frames"], baseline, strict=True):
        if base64.b64decode(archived["depth"]) != frame["depth"].tobytes():
            raise ValueError(f"Baseline grid mismatch at minute {frame['t']}")
    print("All 49 baseline grids reproduced", flush=True)
    catalog = []
    for key, name, base, params, note in CASES:
        capacity = drain.copy()
        if "bbox" in params:
            mask = ((lat >= BLOCK[1]) & (lat <= BLOCK[3]))[:, None] & ((lon >= BLOCK[0]) & (lon <= BLOCK[2]))
            capacity[mask] *= params["drainFactor"]
        else:
            capacity *= params.get("drainFactor", 1)
        rain_input = formula_rain(params["returnYears"]) if "returnYears" in params else rain
        frames = run_model(z, cn, b, w, capacity, g["pop"], rain_input, params.get("southStageM"),cells)
        for f in frames:
            depth = f.pop("depth")
            f.pop("warn")
            f["depthRle"] = encode_runs(depth)
            f["pointsCm"] = {s["id"]: cm for s,cm in zip(sensors,f["pointsCm"],strict=True)}
        info = dict(id=key, name=name, baseScenario=base, parameters=params, note=note,
                    totalRainMm=round(float(rain_input.sum()/60), 2))
        out = dict(**info, grid=[nx, ny], gridSha256=grid_hash, stepSeconds=DT, frames=frames)
        (destination / (key+".json")).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        print(key, len(frames), max(f["maxDepth"] for f in frames), flush=True)
        catalog.append(info)
    (destination/"index.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("grid", help="data/processed/grid.npz from nannnnn-1/smartcity @ f90e8cbe")
    main(parser.parse_args().grid)
