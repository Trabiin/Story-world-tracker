# Story World Tracker

A desktop app (Windows and macOS) for novelists: where is everyone, what are they doing, and how did they get there, at any moment of a series. Fully offline, single user, one `.world` file per series.

The full requirements live in the project's `spec/requirements.md`; the approved architecture is in `spec/architecture.md`.

## Phase 1a: who is where (this version)

- **Characters** with aliases, tags, importance (main / secondary / minor), birth and death, colour and icon, portrait, archive.
- **Places** that nest physically (room → castle → city), positioned by latitude and longitude on a globe. A built-in "Unknown / on the road" placeholder.
- **Groups** with time-bound membership: move the group once and its members follow; a member's own entries win.
- **Stays** (arrival, departure or duration or "until further notice", purpose) and **journeys** (origin, waypoints, destination, mode, detour factor). Arrival dates are suggested from great-circle distance × detour ÷ speed.
- **Fuzzy dates** typed in day/month/year order: `3/5/1042`, `May 1042`, `late spring 1042`, `~1042`, `300 BC`. Each date is compared as an earliest–latest window.
- **Current moment** slider: every view follows it.
- **Who is where**: everyone's location and activity on the chosen date.
- **Timeline**: swimlanes per character, zoom from decades to days.
- **Map**: equirectangular globe that wraps east–west, uploaded sketches pinned by their edges or calibrated with two known points, tiled rendering for big images, character markers moving along journeys, measuring tool.
- **Warnings** (never blocks): two places at once, gaps, impossible travel, moving without a journey (with a one-click draft journey), open-ended stays, unknown places. Mark any warning intentional with a note, or switch rules off.
- **Saving**: autosave, undo/redo, timed backups to a folder you choose, export as `.world` (SQLite), JSON or GeoJSON, import from JSON. Several worlds.
- Command bar: `Ctrl/Cmd+K`. Views: `Alt+1`…`Alt+0`.

## Phase 1b: story links

- **Books → chapters → scenes**, each scene with an in-world date or range, a POV character (or the chapter's), and a place that follows from where the POV character is unless you override it.
- **Manuscripts**: connect Word `.docx` files (read, never changed), read them in the app, select a passage and link it to a character, place, group, stay, journey, book, chapter or scene. **Open in Word** on desktop.
- **Links survive edits**: when the file changes, every linked passage is found again by its text, surrounding words and heading; moved passages follow, lightly reworded ones are found approximately (marked to check), and lost ones are listed to re-link.
- **Mentioned in**: every character, place, group, stay, journey and scene lists the passages, scenes and records that refer to it.
- **Time-bound attributes** per character (title, allegiance, faction, culture, religion, health, possessions…), with today's values shown.
- **Quick add** (`Ctrl/Cmd+J`): type "Kaela rides to Thornwick, leaves 3 May" or "The Party stays at Varn Keep from 3 May for 2 weeks" and confirm the filled-in form.
- **Version history**: a copy of the world every 10 minutes inside the world file (last 60), restorable from Settings.
- Checked at 1,000 characters, 2,000 places and 20,000 stays and journeys: all warnings in about 0.05 s.

## Phase 2a: draw the land

Open the **Map** and press **✎ Draw map**. Every stroke stores real data (land, height in metres, terrain type) on a latitude/longitude grid of the globe, so the realism checks can use it.

- **Land and water**: brush (`L`, `W`; hold Alt to swap), **Shape** tool (`P`) to click out a polygon and fill it with land, water or a terrain type, **Smooth** (`S`) and **Roughen** (`G`) for natural coastlines.
- **Height**: **Raise** (`U`), **Lower** (`D`), **Exact height** (`E`), **Plateau** (`F`), and smart brushes **Mountain range** (`M`) and **Hills** (`H`). Shown as hillshading, contour lines (every 250 m) or both.
- **Terrain types** (`T`): grassland, forest, rainforest, pine forest, farmland, desert, swamp, tundra, ice, bare rock. The list is editable in Settings, with the climates each type suits.
- **Symbols**: mountain and hill symbols appear by themselves where the ground is high; a small library (mountain, hill, volcano, trees, palms, reeds, dunes, rocks) can be stamped by hand (`Y`, Shift-click removes).
- Brush sizes are in km on the globe, so brushes near the poles stretch the way the flat map does. `[` and `]` change the size, Space-drag moves the map, pen pressure changes strength. Each stroke is one undo step.
- **Climate zones**: a switchable overlay of tropical → polar bands from latitude, height and the planet's axial tilt. Terrain that clashes with its zone (rainforest near a pole, glaciers at sea level in the tropics) shows in Warnings, with **Show on map**.
- **Globe**: the world as a sphere, drag to turn it, click to jump the flat map there.
- **World settings**: planet radius or circumference, axial tilt (season strength), the part of the globe the main map frames, and map detail (about 11, 6 or 3 km per cell on an Earth-sized globe).
- The painted map is saved inside the `.world` file (each tile stored once, shared with version history), included in the JSON export, and part of version history.

## Phase 2b: rivers, lakes, roads and settlements

Still in **✎ Draw map**, the lower part of the tool palette draws features. Each one is also a place (it shows in Places, characters can stay there) and can have "exists from / until" dates, so a road built in 1030 only appears from 1030 on.

- **River** (`R`): click points or drag freehand from source to mouth, then double-click or Enter. Stretches that climb show red while you draw. End it on another river and it becomes a tributary. Rivers get wider downstream.
- **Automatic river** (`A`): click a source and the river finds its own way to the sea, a lake or another river. Small hollows fill up and the river cuts a valley through their rim; a hollow deeper than 300 m becomes an inland basin.
- **Lake** (`K`): click its outline. A river that starts in a lake becomes its outlet; salt lakes need none.
- **Road and other lines** (`O`): roads, trade routes, sea lanes and walls. Points snap to settlements and places.
- **Area** (`N`): named mountain ranges, forests, deserts, swamps and seas.
- **Settlement** (`C`): village, town, city or capital.
- Click a feature in Move mode to rename it, set its dates, mark a river's basin or delta, or delete it. Drag the white squares to reshape it; Shift-click a square removes that point.
- **River checks** in Warnings, with Show on map: rivers that flow uphill (RC-1), dead ends that don't reach the sea, a lake, another river or a marked basin (RC-2), and rivers that split, unless it's a delta or marked intentional (RC-3).
- Places as GeoJSON now exports rivers and roads as lines and lakes and areas as polygons.

## Phase 2c: routes, detail maps and the first-map guide

- **Journey routes**: in a journey, **Follow roads** routes it along the drawn roads and trade routes (ships take sea lanes and rivers, flyers go straight), or **Draw on map** to click the way yourself; each click can follow the roads to the next one. A route's length replaces the straight distance and detour factor, so travel time and the impossible-travel check use the real way. Characters move along their route as the date changes.
- **Drag a character** on the map onto a place (or anywhere, to make a new place) to start a journey there, with the travel time suggested.
- **Measure** has an "along roads" option.
- **Detail maps**: zoom in and make a continent, region or city map of the view. Maps sit on the same globe, show as dashed frames on larger maps, and a map linked to a place opens from that place (button, or double-click the place). The sample world has a region map and a city map of Varn.
- **Drawing layers**: features and symbols go on the chosen layer; layers can be hidden or locked.
- **First-map guide**: opens by itself on an empty world in ✎ Draw map. Seven steps (sketch, globe, coastline, mountains, rivers, terrain, settlements); any step can be skipped and revisited.
- **Everything stays editable**: automatic rivers re-trace themselves when you paint the land under them (in the same undo step), unless you reshaped them by hand; **Trace again** re-runs one. Climate zones and checks always follow the current map.

## Phase 3a: realms, cultures and borders over time

- **▦ Layers** on the map: region layers, starting with Political, Cultures, Religions, Languages and Trade. Add more (population, resources, spheres of influence, military, danger, magic, known world, history, plagues and disasters, author notes).
- **Draw a region** with the **Shape** tool (corners snap to existing borders, rivers, roads and coastlines) or the **Brush**. Alt swaps between adding and removing land. Political regions never overlap: new land either **stops at the neighbour's border** or **takes it** (a conquest).
- **Borders change over time**: choose "From a date" (and optionally "until", for an occupation) before drawing. That records a border change on the date for every realm involved. Move the timeline and the map, every place's realm and every check follow.
- **Realm hierarchy**: duchies are part of kingdoms, kingdoms can be vassals of empires, and both can change hands on dates (Realms & layers page). Political fills can use the top realm's colour.
- **Overlapping layers**: cultures, religions and languages may overlap; hatching and intensity (e.g. "70% Sun Faith") show it.
- **Layer controls**: show, hide, lock, reorder, opacity, fill, border style, labels, "stop at the coastline", and saved presets such as "politics + religion".
- **What is here**: click any spot to see every region covering it on the current date; the status bar shows it while hovering.
- **Realms & layers** page: each region's encyclopedia entry, rulers and other characters tied to it with dates, overlords and vassals over time, border history and the places inside it. A **place** page shows its realm history ("Kingdom of Varn 1001–1044, Empire of Ash 1044–"); a character page shows the realms they are tied to.
- Places as GeoJSON exports every border version as a MultiPolygon with its dates.

## Development

```bash
npm install
npm test            # core logic tests (dates, globe, whereabouts, warnings, storage)
npm run dev         # browser version at http://localhost:1420
npm run desktop:dev # desktop app (needs Rust and the Tauri prerequisites)
```

Code layout:

```
src/core      pure logic: dates, globe math, data model, whereabouts, warnings, terrain (grid, brushes, climate)
src/storage   SQLite world file, JSON/GeoJSON export, new world
src/ui        React screens, map and timeline renderers, platform adapters (desktop / browser)
src-tauri     desktop shell (Tauri 2)
```

## Installers

The **Desktop installers** workflow (Actions tab → Run workflow) builds a Windows `.exe`/`.msi` and a macOS `.dmg`, attached to the run. Pushing a tag such as `v0.1.0` also creates a draft GitHub release with them. The macOS build is unsigned, so the first time, right-click the app and choose Open.
