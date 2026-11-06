import { describe, expect, it } from 'vitest';
import {
  LayerIndex, Region, World, areaContains, areaKm2, defaultRegionLayers, describeChain, editRegionArea, labelPoint, polygonFromPoints, strokeArea,
  subtractArea, toDayNumber, unionArea,
} from '../src/core';
import { bytesToWorld, normalizeWorld, worldToBytes, worldFromJson, worldToJson, placesToGeoJson } from '../src/storage';
import { d, world } from './fixtures';

const box = (w: number, s: number, e: number, n: number) =>
  polygonFromPoints([{ lat: s, lng: w }, { lat: s, lng: e }, { lat: n, lng: e }, { lat: n, lng: w }]);

let k = 0;
const newId = () => `v${++k}`;

function region(id: string, layerId: string, name: string, extra: Partial<Region> = {}): Region {
  return { id, scenarioId: 'canon', status: 'canon', createdAt: '', updatedAt: '', layerId, name, color: '#c00', versions: [], overlords: [], ties: [], entry: '', ...extra };
}

function layered(): World {
  const w = world();
  w.regionLayers = defaultRegionLayers('');
  return w;
}

describe('region shapes', () => {
  it('adds, cuts and tests points, including across the date line', () => {
    const a = box(0, 0, 10, 10);
    expect(areaContains(a, { lat: 5, lng: 5 })).toBe(true);
    expect(areaContains(a, { lat: 5, lng: 15 })).toBe(false);
    const holed = subtractArea(a, box(3, 3, 6, 6));
    expect(areaContains(holed, { lat: 4, lng: 4 })).toBe(false);
    expect(areaContains(holed, { lat: 1, lng: 1 })).toBe(true);
    const joined = unionArea(a, box(10, 0, 20, 10));
    expect(joined).toHaveLength(1);
    // a realm drawn across the date line
    const pacific = polygonFromPoints([{ lat: 0, lng: 170 }, { lat: 0, lng: -170 }, { lat: 10, lng: -170 }, { lat: 10, lng: 170 }]);
    expect(areaContains(pacific, { lat: 5, lng: 179 })).toBe(true);
    expect(areaContains(pacific, { lat: 5, lng: -175 })).toBe(true);
    expect(areaContains(pacific, { lat: 5, lng: 0 })).toBe(false);
    const cut = subtractArea(pacific, box(-178, -5, -172, 20));
    expect(areaContains(cut, { lat: 5, lng: -175 })).toBe(false);
    expect(areaContains(cut, { lat: 5, lng: 175 })).toBe(true);
  });
  it('measures area on the sphere and finds a label spot inside', () => {
    // 1°×1° at the equator is about 111 × 111 km
    expect(areaKm2(box(0, 0, 1, 1), 6371)).toBeGreaterThan(12000);
    expect(areaKm2(box(0, 0, 1, 1), 6371)).toBeLessThan(12500);
    const u = polygonFromPoints([[0, 0], [0, 10], [10, 10], [10, 7], [3, 7], [3, 3], [10, 3], [10, 0]].map(([lng, lat]) => ({ lat, lng })));
    const lp = labelPoint(u)!;
    expect(areaContains(u, lp.at)).toBe(true);
  });
  it('sweeps a brush stroke into one shape', () => {
    const s = strokeArea([{ lat: 0, lng: 0 }, { lat: 0, lng: 5 }], 50, 6371);
    expect(s).toHaveLength(1);
    expect(areaContains(s, { lat: 0, lng: 2.5 })).toBe(true);
    expect(areaContains(s, { lat: 3, lng: 2.5 })).toBe(false);
  });
});

describe('borders over time (LY-6) and realms (LY-2, LY-12, DM-2)', () => {
  function realms() {
    const w = layered();
    const varn = region('varn', 'layer-political', 'Kingdom of Varn', { start: d(1001, 1, 1), versions: [{ id: 'a', area: box(8, 45, 14, 55) }] });
    const ash = region('ash', 'layer-political', 'Empire of Ash', { versions: [{ id: 'b', area: box(14, 45, 25, 55) }] });
    w.regions = [varn, ash];
    return w;
  }
  const thornwick = { lat: 50, lng: 12 };

  it('a conquest moves the land on a date, and places pick up the new realm', () => {
    let w = realms();
    w = editRegionArea(w, { regionId: 'ash', area: box(11, 44, 15, 56), op: 'add', from: d(1044, 6, 1), neighbours: 'take', note: 'Conquest', newId });
    const ix = new LayerIndex(w);
    const before = toDayNumber({ year: 1043, month: 1, day: 1 });
    const after = toDayNumber({ year: 1045, month: 1, day: 1 });
    expect(ix.realmAt(thornwick, before)[0].region.name).toBe('Kingdom of Varn');
    expect(ix.realmAt(thornwick, after)[0].region.name).toBe('Empire of Ash');
    // Varn keeps its western land
    expect(ix.realmAt({ lat: 50, lng: 9 }, after)[0].region.name).toBe('Kingdom of Varn');
    // both realms got a border version on the date
    expect(w.regions.find((r) => r.id === 'varn')!.versions).toHaveLength(2);
    expect(w.regions.find((r) => r.id === 'ash')!.versions[1].note).toBe('Conquest');
    const hist = ix.realmHistory(thornwick).map((p) => `${p.chain[0].region.name} ${p.startLabel ?? ''}–${p.endLabel ?? ''}`);
    expect(hist).toEqual(['Kingdom of Varn 1 January 1001–1 June 1044', 'Empire of Ash 1 June 1044–']);
  });

  it('a temporary occupation ends on the until date', () => {
    let w = realms();
    w = editRegionArea(w, { regionId: 'ash', area: box(11, 44, 15, 56), op: 'add', from: d(1044, 6, 1), until: d(1046, 6, 1), neighbours: 'take', newId });
    const ix = new LayerIndex(w);
    expect(ix.realmAt(thornwick, toDayNumber({ year: 1045, month: 1, day: 1 }))[0].region.id).toBe('ash');
    expect(ix.realmAt(thornwick, toDayNumber({ year: 1047, month: 1, day: 1 }))[0].region.id).toBe('varn');
  });

  it('"stop at borders" makes new land share an edge instead of taking it', () => {
    let w = realms();
    w = editRegionArea(w, { regionId: 'ash', area: box(11, 44, 15, 56), op: 'add', neighbours: 'stop', newId });
    const ix = new LayerIndex(w);
    expect(ix.realmAt(thornwick, toDayNumber({ year: 1045, month: 1, day: 1 }))[0].region.id).toBe('varn');
    expect(w.regions.find((r) => r.id === 'varn')!.versions).toHaveLength(1);
  });

  it('overlapping layers keep both regions, with intensity (LY-3, LY-4, LY-9)', () => {
    const w = realms();
    w.regions.push(
      region('old', 'layer-religion', 'Old Faith', { versions: [{ id: 'c', area: box(5, 40, 15, 60) }] }),
      region('sun', 'layer-religion', 'Sun Faith', { versions: [{ id: 'e', area: box(10, 40, 30, 60), intensity: 70 }] }),
    );
    const out = editRegionArea(w, { regionId: 'sun', area: box(0, 40, 10, 60), op: 'add', neighbours: 'take', newId });
    // religions overlap: adding land to one never takes it from another
    expect(out.regions.find((r) => r.id === 'old')).toBe(w.regions.find((r) => r.id === 'old'));
    const ix = new LayerIndex(out);
    const here = ix.regionsAt(thornwick, 0);
    expect(here.map((h) => h.layer.name)).toEqual(['Political', 'Religions']);
    expect(here[1].hits.map((x) => `${x.region.name} ${x.intensity}`)).toEqual(['Old Faith 100', 'Sun Faith 70']);
  });

  it('follows duchy → kingdom → empire over time', () => {
    const w = realms();
    w.regions.push(region('ost', 'layer-political', 'Duchy of Ost', {
      versions: [{ id: 'f', area: box(8, 45, 10, 55) }],
      overlords: [
        { id: 'o1', regionId: 'varn', relation: 'part', end: d(1050, 1, 1) },
        { id: 'o2', regionId: 'ash', relation: 'vassal', start: d(1050, 1, 2) },
      ],
    }));
    // the duchy's land is cut out of the kingdom so they do not overlap
    w.regions[0] = { ...w.regions[0], versions: [{ id: 'a', area: box(10, 45, 14, 55) }] };
    const ix = new LayerIndex(w);
    const p = { lat: 50, lng: 9 };
    expect(describeChain(ix.realmAt(p, toDayNumber({ year: 1040, month: 1, day: 1 })))).toBe('Duchy of Ost, part of Kingdom of Varn');
    expect(describeChain(ix.realmAt(p, toDayNumber({ year: 1051, month: 1, day: 1 })))).toBe('Duchy of Ost, vassal of Empire of Ash');
    expect(ix.realmHistory(p).map((h) => h.chain[h.chain.length - 1].region.name)).toEqual(['Duchy of Ost', 'Kingdom of Varn', 'Empire of Ash']);
  });

  it('removing land ends a region there', () => {
    let w = realms();
    w = editRegionArea(w, { regionId: 'varn', area: box(0, 40, 30, 60), op: 'remove', from: d(1080, 1, 1), neighbours: 'take', newId });
    const ix = new LayerIndex(w);
    expect(ix.realmAt(thornwick, toDayNumber({ year: 1081, month: 1, day: 1 }))).toEqual([]);
    expect(ix.changeDays(['layer-political'])).toContain(toDayNumber({ year: 1080, month: 1, day: 1 }));
  });
});

describe('saving layers', () => {
  it('round-trips regions and gives older worlds the starting layers (LY-1)', async () => {
    const w = layered();
    w.regions.push(region('varn', 'layer-political', 'Kingdom of Varn', { versions: [{ id: 'a', area: box(8, 45, 14, 55) }] }));
    const back = await bytesToWorld(await worldToBytes(w));
    expect(back.regions).toEqual(w.regions);
    expect(back.regionLayers.map((l) => l.name)).toEqual(['Political', 'Cultures', 'Religions', 'Languages', 'Trade']);
    expect(worldFromJson(worldToJson(w)).regions).toEqual(w.regions);
    // an export from before layers existed
    const old = { ...w } as Partial<World>;
    delete old.regionLayers;
    delete old.regions;
    const n = normalizeWorld(old as World);
    expect(n.regionLayers).toHaveLength(5);
    expect(n.regions).toEqual([]);
    const gj = JSON.parse(placesToGeoJson(w));
    const varn = gj.features.find((f: { properties: { name: string } }) => f.properties.name === 'Kingdom of Varn');
    expect(varn.geometry.type).toBe('MultiPolygon');
    expect(varn.properties.layer).toBe('Political');
  });
});

describe('stop at borders with dated neighbours', () => {
  it('a new region drawn for all time stops at a neighbour founded later', () => {
    const w = layered();
    w.regions = [
      region('varn', 'layer-political', 'Kingdom of Varn', { start: d(1001, 1, 1), versions: [{ id: 'a', area: box(8, 45, 14, 55) }] }),
      region('free', 'layer-political', 'Free City'),
    ];
    const out = editRegionArea(w, { regionId: 'free', area: box(12, 44, 16, 46), op: 'add', neighbours: 'stop', newId });
    const ix = new LayerIndex(out);
    expect(ix.realmAt({ lat: 45.5, lng: 13 }, toDayNumber({ year: 1042, month: 1, day: 1 }))[0].region.id).toBe('varn');
    expect(ix.realmAt({ lat: 45.5, lng: 15 }, toDayNumber({ year: 1042, month: 1, day: 1 }))[0].region.id).toBe('free');
  });
});
