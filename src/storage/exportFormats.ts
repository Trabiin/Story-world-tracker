/** PL-4: open export formats. JSON for everything, GeoJSON (lat/long) for map features and layer regions. */
import { World, WorldIndex } from '../core';
import { normalizeWorld } from './newWorld';
import { TerrainJson, terrainFromJson, terrainToJson } from './terrainCodec';

export const JSON_FORMAT = 'story-world-tracker';
/** 2: terrain is included (base64 tiles, see TerrainJson). */
export const JSON_FORMAT_VERSION = 2;

export function worldToJson(world: World): string {
  const out = { ...world, terrain: terrainToJson(world.terrain) };
  return JSON.stringify({ format: JSON_FORMAT, version: JSON_FORMAT_VERSION, exportedAt: new Date().toISOString(), world: out }, null, 2);
}

export function worldFromJson(text: string): World {
  const parsed = JSON.parse(text);
  if (parsed?.format !== JSON_FORMAT || !parsed.world) throw new Error('This is not a Story World Tracker JSON export.');
  if (parsed.version > JSON_FORMAT_VERSION) throw new Error('This export is from a newer version of the app.');
  const terrainJson = parsed.world.terrain as TerrainJson | undefined;
  const w = normalizeWorld({ ...parsed.world, terrain: undefined } as World);
  w.terrain = terrainFromJson(terrainJson);
  return w;
}

/** GeoJSON FeatureCollection of places (RFC 7946: coordinates are [longitude, latitude]). */
export function placesToGeoJson(world: World): string {
  const ix = new WorldIndex(world);
  // Places drawn as map features (rivers, lakes, roads, areas) are exported with their real shape.
  const drawn = new Set(world.mapFeatures.map((f) => f.placeId).filter(Boolean));
  const features: unknown[] = world.places
    .filter((p) => !p.isPlaceholder && !drawn.has(p.id))
    .map((p) => {
      const loc = ix.locationOf(p.id);
      return loc
        ? {
            type: 'Feature',
            id: p.id,
            geometry: { type: 'Point', coordinates: [loc.lng, loc.lat] },
            properties: {
              name: p.name,
              kind: p.kind,
              aliases: p.aliases,
              parentId: p.parentId ?? null,
              positionInherited: !p.location,
              start: p.start ?? null,
              end: p.end ?? null,
              notes: p.notes,
            },
          }
        : null;
    })
    .filter(Boolean);
  for (const f of world.mapFeatures) {
    if (f.points.length < 2) continue;
    const ring = f.points.map((p) => [p.lng, p.lat]);
    features.push({
      type: 'Feature',
      id: f.id,
      geometry: f.shape === 'line' ? { type: 'LineString', coordinates: ring } : { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
      properties: {
        name: f.name,
        kind: f.kind,
        placeId: f.placeId ?? null,
        joinsId: f.joinsId ?? null,
        start: f.start ?? null,
        end: f.end ?? null,
        notes: f.notes,
      },
    });
  }
  // LY-6: each border version of each region, with the dates it applies.
  for (const r of world.regions) {
    const layer = world.regionLayers.find((l) => l.id === r.layerId);
    r.versions.forEach((v, i) => {
      if (!v.area.length) return;
      features.push({
        type: 'Feature',
        id: `${r.id}:${v.id}`,
        geometry: { type: 'MultiPolygon', coordinates: v.area },
        properties: {
          name: r.name,
          layer: layer?.name ?? null,
          layerType: layer?.type ?? null,
          regionId: r.id,
          color: r.color,
          start: v.start ?? r.start ?? null,
          end: r.versions[i + 1]?.start ?? r.end ?? null,
          intensity: v.intensity ?? null,
          note: v.note ?? null,
        },
      });
    });
  }
  return JSON.stringify({ type: 'FeatureCollection', features, properties: { world: world.settings.name, radiusKm: world.settings.radiusKm } }, null, 2);
}
