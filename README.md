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
- Command bar: `Ctrl/Cmd+K`. Views: `Alt+1`…`Alt+8`.

## Development

```bash
npm install
npm test            # core logic tests (dates, globe, whereabouts, warnings, storage)
npm run dev         # browser version at http://localhost:1420
npm run desktop:dev # desktop app (needs Rust and the Tauri prerequisites)
```

Code layout:

```
src/core      pure logic: dates, globe math, data model, whereabouts, warnings
src/storage   SQLite world file, JSON/GeoJSON export, new world
src/ui        React screens, map and timeline renderers, platform adapters (desktop / browser)
src-tauri     desktop shell (Tauri 2)
```

## Installers

The **Desktop installers** workflow (Actions tab → Run workflow) builds a Windows `.exe`/`.msi` and a macOS `.dmg`, attached to the run. Pushing a tag such as `v0.1.0` also creates a draft GitHub release with them. The macOS build is unsigned, so the first time, right-click the app and choose Open.
