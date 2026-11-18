// Distances are metres. The exported frame is an unsigned centimetre grid.
export function compareRoutes(paths, depth, thresholdCm) {
  if (!depth?.length || !Number.isFinite(thresholdCm) || !Array.isArray(paths) || !paths.length) return null;
  const ranked = [];
  for (const path of paths) {
    if (!path?.cells?.length || !Number.isFinite(path.lengthM) || path.lengthM <= 0) return null;
    let peakCm = 0;
    for (const cell of path.cells) {
      if (!Number.isInteger(cell) || cell < 0 || cell >= depth.length) return null;
      const cm = depth[cell];
      if (!Number.isFinite(cm) || cm < 0) return null;
      peakCm = Math.max(peakCm, cm);
    }
    ranked.push({ path, peakCm });
  }
  ranked.sort((a, b) => a.path.lengthM - b.path.lengthM);
  return { baseline: ranked[0], alternative: ranked.find(route => route.peakCm < thresholdCm) };
}
