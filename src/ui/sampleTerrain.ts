/** A painted continent for the sample world, so the mapmaking tools have something to show. */
import { Terrain, TerrainEditor, emptyTerrain, fbm, grid } from '../core';

const ell = (lat: number, lng: number, cLat: number, cLng: number, rLat: number, rLng: number) => ((lat - cLat) / rLat) ** 2 + ((lng - cLng) / rLng) ** 2;

/** Distance (in degrees) from a point to a segment, in a flat lat/long approximation. */
function segDist(lat: number, lng: number, a: [number, number], b: [number, number]) {
  const [ay, ax] = a, [by, bx] = b;
  const k = Math.max(0, Math.min(1, ((lng - ax) * (bx - ax) + (lat - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(lng - (ax + k * (bx - ax)), lat - (ay + k * (by - ay)));
}

export function sampleTerrain(): Terrain {
  const ed = new TerrainEditor(emptyTerrain());
  const g = grid(ed.g.cellDeg);
  const ridge: [number, number][] = [[49.6, 7.5], [49.4, 10.5], [49.7, 13.0], [49.2, 16.5], [48.4, 19.5]];
  const gy0 = Math.round((90 - 54) / g.cellDeg), gy1 = Math.round((90 - 39) / g.cellDeg);
  const gx0 = Math.round((3 + 180) / g.cellDeg), gx1 = Math.round((24 + 180) / g.cellDeg);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const lat = 90 - (gy + 0.5) * g.cellDeg, lng = -180 + (gx + 0.5) * g.cellDeg;
      const n = fbm(gx / 18, gy / 18, 5, 21) - 0.5;
      // continent minus a southern gulf (Saltmere sits on its shore)
      let land = 1 - ell(lat, lng, 47.4, 13.8, 5.2, 9.5) + n * 0.9;
      land -= Math.max(0, 1 - ell(lat, lng, 44.55, 11.5, 1.75, 2.9)) * 1.6;
      land -= Math.max(0, 1 - ell(lat, lng, 52.6, 18.5, 1.6, 2.6)) * 1.4; // northern bay
      if (land <= 0) {
        if (land > -0.6) ed.setCell(gx, gy, -40 + land * 2500);
        continue;
      }
      // height: lowlands, a northern mountain range, south-eastern hills
      let d = Infinity;
      for (let i = 1; i < ridge.length; i++) d = Math.min(d, segDist(lat, lng, ridge[i - 1], ridge[i]));
      const ridged = 1 - Math.abs(2 * fbm(gx / 6, gy / 6, 4, 3) - 1);
      const mountains = Math.max(0, 1 - d / 1.1) ** 1.6 * (1800 + 1900 * ridged);
      const hills = Math.max(0, 1 - ell(lat, lng, 45.6, 17.2, 1.4, 2.6)) * (350 + 450 * fbm(gx / 4, gy / 4, 3, 8));
      const elev = 25 + land * 260 + mountains + hills + n * 120;
      // terrain types
      let biome = 1; // grassland
      if (elev > 2700) biome = 9; // ice on the high peaks
      else if (elev > 1700) biome = 10; // bare rock above the tree line
      else if (mountains > 450) biome = 4; // pine forest on the flanks
      else if (lat > 50.3 + (fbm(gx / 6, gy / 6, 3, 5) - 0.5) * 1.6) biome = fbm(gx / 9, gy / 9, 3, 2) > 0.5 ? 2 : 4;
      else if (ell(lat, lng, 47.6, 12.4, 1.1, 2.2) < 1 + (fbm(gx / 5, gy / 5, 3, 6) - 0.5) * 2) biome = 5; // farmland around Varn and Thornwick
      else if (ell(lat, lng, 45.9, 11.2, 0.6, 1.0) < 1 + (fbm(gx / 4, gy / 4, 3, 7) - 0.5) * 2.5) biome = 7; // marshes by the gulf
      else if (fbm(gx / 10, gy / 10, 3, 4) > 0.56) biome = 2;
      if (ell(lat, lng, 46.7, 15.6, 0.35, 0.55) < 1 + (fbm(gx / 3, gy / 3, 3, 9) - 0.5) * 1.5) biome = 3; // "Ashwood jungle": a deliberate clash with the climate (RC-8)
      ed.setCell(gx, gy, elev, biome);
    }
  }
  return ed.commit();
}
