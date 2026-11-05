/** PL-4: open export formats. JSON for everything, GeoJSON (lat/long) for map features. */
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
  const features = world.places
    .filter((p) => !p.isPlaceholder)
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
  return JSON.stringify({ type: 'FeatureCollection', features, properties: { world: world.settings.name, radiusKm: world.settings.radiusKm } }, null, 2);
}
