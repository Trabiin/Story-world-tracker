# Story World Tracker

A desktop app for novelists, for Windows and for a Chromebook (as a Linux app): where is everyone, what are they doing, and how did they get there, at any moment of a series. Fully offline, single user, one `.world` file per series.

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

## Phase 3b: views over time

- **Play** (top bar) moves the date smoothly, at 1 day, 1 week, 1 month or 1 year per second. Characters glide along their routes. When the date crosses a border change, the regions involved glow and the map names the change and its date ("01/06/1044: The Ash conquest of the east march").
- **Character track**: **Show track on map** on a character page draws their whole path, with numbered stops and dates. The part travelled by the current date is solid; the rest is dashed. Track several characters at once from the map's Tracks card.
- **Who was here**: a place page shows everyone who was there (or anywhere inside it) on a small timeline with the current date marked, plus a list of stays, arrivals, departures and passes.
- **Reader's view** (top bar): see the world as the reader knows it at the end of any chapter or book. Characters, places and groups appear from the first chapter that mentions them; stays, journeys, borders and attributes appear once the story has reached their date. Override it on any record with **Reader learns of it**. Editing is off while the reader's view is on.

## Phase 3c: map polish and checks

- **More realism checks**: lakes with no outlet or several (RC-4), rivers running into mountains or through each other (RC-5), river sources on low, dry ground (RC-6), large towns far from water (RC-11), and an optional rain-shadow check with Earth-like or fixed winds (RC-9, World settings).
- **One-click fixes** (MK-23): on the Warnings page, "Fix: …" shows the change on the map first (new lines in green), then Apply or Cancel. Fixes include adding a lake outlet at the lowest point of its shore, rerouting a river downhill, and marking a salt lake, basin, spring, fork or intended crossing.
- **Seasons** (RC-10): each place page says how long winter and summer last there, from latitude, height and the axial tilt; the map's hover line shows winter length too.
- **Terrain suggestions** (MK-20): ✎ Draw map → Finishing touches → "Suggest terrain". It proposes forest, rainforest, grassland, desert, tundra, ice and bare rock from climate, distance to the sea and rain shadows. You see it first, then accept or cancel.
- **Add detail** (MK-21): natural wiggles for coastlines and hand-drawn rivers, lakes and areas; "Remove detail" puts them back exactly. One feature at a time works from its card too.
- **Curved labels** (MK-11): river names follow the river and range names follow the mountains, sized by importance.
- **Map styles** (MK-12): clean and flat, or hand-drawn parchment (World settings).
- **Export** (MK-14): the map's side panel saves the current view as PNG, PNG for print (4×) or SVG with vector lines and labels.


## Phase 4a: people and events

- **World events** (TL-5, Events & secrets): battles, coronations, festivals, eclipses and more, with a date or span, a place and who takes part. Yearly festivals repeat on the timeline as holidays (TL-6).
- **Relative dates** (TL-4): any date box takes "3 days after the Battle of Varn", "a week before chapter 4" or "before chapter 12". The date follows its anchor when it moves.
- **Timeline sky** (TL-6): an events lane, moon phases (set the cycle in Settings), and seasons, either calendar seasons or as long as they really last at a chosen place's latitude.
- **Relationships and family trees** (CH-4, EU-11): family, friends, rivals, mentors and more, with dates; the family tree draws itself from parent, spouse and sibling links.
- **Status and knowledge** (CH-7, CH-8): every character page shows alive, dead, missing or whereabouts unknown on the current date, and which secrets they know by then.
- **New checks**: activity before birth or after death (CC-4), visiting a place before it exists or after it is gone (CC-5), a scene's place that doesn't match a character's stay (CC-6), and learning of an event before it happens.
- **Meetings & tools**: who met whom, nesting aware (VW-6); two or three characters side by side (EU-13); calculators for age, travel time and days between dates (EU-12).
- World file format 7 (events, relationships, secrets). Older files open as before.

## Phase 4b: story structure

- **Plot threads and the thread map** (ST-3, Books & scenes → Threads): storylines with branches that split off and rejoin; tick scenes into threads and see them as lanes across the books.
- **Reading order vs story order** (ST-4, ST-5, Books & scenes → In order): every scene as read or as it happens, with flashbacks and parallel scenes labelled.
- **What-if scenarios** (ST-7, top bar): try "what if she goes north" without touching canon, compare the changes and warnings, then make it canon or discard it. Drafts (ST-6) can be hidden everywhere.
- **Filters and saved views** (VW-7, EU-7, top bar → Filter): show only one book, thread, POV, faction or tag in every view, and save the setup under a name.
- **Name spotting** (ST-12, Manuscripts → Find names): finds character and place names chapter by chapter and suggests links, cast members and stays.
- **Chapter overview** (ST-13): each chapter shows when it happens, who is in it and where.
- **Travel** (WH-9 to WH-11): optional slow-downs for mountains, winter, danger and river currents (Settings); incidents on a journey shown on the map and timeline; characters' plans, flagged when they run out of time.
- World file format 8 (threads, scenarios). Older files open as before.

## Phase 4c: everyday tools

- **Home** (EU-15): the new starting page, with open warnings, to-dos, recent changes, loose ends and chapters not yet linked to the manuscript.
- **Search** (VW-8, top bar or Ctrl+K): finds words in names, notes, scenes, events, encyclopedia entries and the manuscripts themselves.
- **To-dos and plot holes** (EU-14): their own page, and on every character, place, scene or event page they are linked to.
- **Merge and safe delete** (EU-20): fold a duplicate into the real record, or see everything that depends on a record before deleting it, and hand it to another record instead.
- **Bulk edit and shifting dates** (EU-4): tag, re-rank or archive many characters at once; push everything after a date later or earlier.
- **Templates and duplicates** (EU-3): start a character from a template, or duplicate a stay or journey.
- **Pictures** (EU-10) on character, place, region and event pages.
- World file format 9 (to-dos). Older files open as before.

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

The **Desktop installers** workflow (Actions tab → Run workflow, and on every pull request) builds, attached to the run:

- **installers-windows**: the Windows `.exe` and `.msi` installers.
- **installers-chromebook-intel**: the `.deb` (and an `.AppImage`) for Chromebooks with an Intel or AMD processor.
- **installers-chromebook-arm**: the `.deb` for Chromebooks with an ARM processor (MediaTek, Snapdragon, Kompanio).

Pushing a tag such as `v0.1.0` also creates a draft GitHub release with them.

### On a Chromebook

1. Turn on Linux once: **Settings → About ChromeOS → Developers → Linux development environment → Set up**.
2. Which processor? **Settings → About ChromeOS → Diagnostics** shows it (Intel, AMD, or MediaTek/Snapdragon for ARM). Download the matching `.deb`.
3. In the Files app, double-click the `.deb` and choose **Install**. The app then sits in the launcher under **Linux apps**.
4. Keep `.world` files in **Linux files**, or share a folder (such as Google Drive) with Linux: right-click it → **Share with Linux**. The same `.world` file opens on Windows and on the Chromebook; just don't have it open on both at once.

Spell checking and the Claude Code features work as on Windows once the Linux tools are installed (Claude Code is installed in the Linux terminal).

## Phase 6a: write here

The manuscript now lives in the app. Word is the way in and out.

- **Write** page: one book as a continuous document, scene after scene, each with a thin header (date, POV, words, history). Bold (`Ctrl+B`), italics (`Ctrl+I`), headings (`Ctrl+Alt+1..3`), scene breaks (type `***` or `Ctrl+Enter`), curly quotes, dashes and ellipses as you type. Arrow keys run on into the next scene.
- **Autosave** a moment after you stop typing, every few seconds while typing, and when you leave a scene. The editor has its own undo; world undo never touches the text.
- **Focus mode** (`F11`, `Esc` to leave): full screen, light, sepia or dark page, text size, typewriter scrolling.
- **Scene history**: versions kept as you work (and by hand, with a name); compare any two side by side word by word, and restore one.
- **Import from Word**: split by headings and `***`/`#` lines into chapters and scenes; headings, bold, italics and scene breaks come along, Word comments become margin comments, and linked passages move with their text. Connected manuscripts have an **Import into the app** button.
- **Export to Word**: a book or a range of chapters as a standard manuscript (title page, Times New Roman 12, double spacing, running header with page numbers) or a reading copy.
- **Plain-text safety copies**: every backup also writes each scene as a `.txt` file, foldered by book and chapter; Settings can download them as a zip.
- **Spelling**: Windows' English spell checker (UK or US in Settings). Character, place, realm, event and group names are never underlined.

## Phase 6b: write with the world

- **Story sidebar** (WR-9, Write page → Sidebar): the scene's date, place, season and moon; who is present and where each one is staying (flagged if it's somewhere else); where everyone else in the cast is; and the warnings that concern the scene.
- **Name cards** (WR-10): hover a character, place, realm, group or event name in the text for its card on the scene's date: age, status, whereabouts, relationships, what they know, a place's realm and who is there, and what the reader already knows by this chapter. Ctrl+click opens the page.
- **Inline links** (WR-11): type `@` and a name to link it, or select words and press `Ctrl+L` (or Link). Links sit in the text, so they never break, and show under "Mentioned in". Realms can be linked too.
- **Word counts and goals** (WR-12): counts per scene, chapter, book and series; a daily goal, a word goal and deadline per book (words a day needed), a streak and a calendar of words written per day (Sidebar → Goals).
- **Scene stages** (WR-13): idea, outlined, first draft, revised, final. Shown as a dot in the scene trees, set in the scene header, and available as a filter.
- **Series dashboard** (SR-1): the Home page starts with every book's stage, words, progress, deadline and open to-dos.
- World file format 11 (words written per day). Older files open as before.

## Phase 6c: ask Claude

Off for every world until you switch it on (**Ask Claude → Setup**). Claude Code uses your own Claude account; the app itself stays offline, and only what Claude reads is sent to Anthropic, by Claude Code. While it is on, the top bar shows **Claude on**.

- **Claude folder** (AI-1): a live, read-only copy of the world as plain files in `Documents\Story World Tracker\Claude\<world>` (movable): `CLAUDE.md` (what the folder is, the world's rules, how to propose changes), `guide/data-model.md`, every scene as Markdown by book and chapter, a page per character, place, group, event and realm (with ids, whereabouts, realm history, where it appears), the timeline, threads, secrets, scenarios, to-dos, map features, open warnings and `data/world.json`. Rewritten a moment after every change; only files the app wrote are ever removed.
- **Live world tools** (AI-2): the app is an MCP connector on this computer only (`127.0.0.1`, a secret token per world, browsers refused). Tools: `search`, `get_record`, `list_records`, `where_is`, `character_timeline`, `scene`, `warnings`, `reader_knows`, `travel_time`, `realm_at`, `data_model`, `check_changes`, `propose_changes`, `suggestions`. They answer with the app's own rules (fuzzy dates, groups, realms over time, the reader's view).
- **Suggestions** (AI-3): Claude can propose changes to anything you can edit: records of every kind, scene text (a passage or the whole scene), terrain (land, water, height, terrain type in an area or along a line) and borders from a date. Each arrives checked, with a before/after preview (field tables, a word diff for text) and **Show on map** for map changes as a violet ghost. Accept all, change by change, or reject with a note Claude can read. Each accept is one undo step; changed scene text keeps a "Before Claude" version.
- **Checks** (AI-8, AI-10): every proposal goes through the same rules as the app's forms: field types, required fields, references that must exist, safe delete with what else would go (EU-20), a river is also a place, political borders never overlap. Anything that would break a link or leave an orphan is refused with the reason. New warnings it would cause are shown with it. The guide is built from the code (adding a field without describing it fails the build), and a test round-trips every kind of change.
- **Big ideas as scenarios** (AI-7): a proposal can arrive as a what-if scenario and is kept as one, to compare with canon.
- **Direct editing** (AI-9): optional, off by default, per world. Every change is labelled "Before Claude…" in version history, listed in **Activity**, and can be undone singly or all at once.
- **Chat, VS Code and terminal** (AI-4, AI-5): ask Claude Code inside the app, or open the folder in VS Code or a terminal with Claude Code. Setup checks that Claude Code is installed and writes `.mcp.json` and `.claude/settings.local.json` (Claude may read the folder and use the connector, not edit files).
- World file format 12 (suggestions and the Claude activity log). Older files open as before.

## Phase 7a: notes

- **Margin comments** (NT-1): select words on the Write page and press **Comment** (Ctrl+Alt+M). The card sits in the margin beside the words (under the scene when the window is narrow). Edit, resolve, delete, or **Make to-do**: the to-do quotes the words and **Show in the text** jumps back to the comment. Word comments come in the same way.
- **Notebook** (NT-2): notes in folders (use `/` for folders inside folders; double-click a folder to rename it, drag notes onto one to move them). Link a note to any record and it shows on that record's page, which also has a **+ Note** button.
- **Quick capture** (NT-3): **Ctrl+Shift+N** or **Note** in the top bar, from anywhere (also in focus mode). The first line is the title; it is linked to what was open and lands in the **Inbox** until you file it.
- **Research files** (NT-4): add or drop images and PDFs (up to 25 MB) on any note or record page. They open in the app, PDFs in the built-in reader. Each file is stored once in the world file.
- Claude's folder gains `notes/`, `research/` (with copies of the files) and `story/comments.md`; Claude can propose notes.
- World file format 13 (notes and research files). Older files open as before.

## Phase 7b: plan

- **Corkboard and outline** (NT-5): the **Plan** page shows an index card per scene, by chapter. Drag a card to a new place (also into another chapter) and edit its summary on the card. **Outline** is the same book as a table: summary, POV, date, stage and words, with totals per chapter.
- **Setups and payoffs** (NT-6): plant a clue, a promise, an object or a bit of foreshadowing in one scene and say where it pays off (also in a later book). A setup with no payoff, or a payoff the reader meets before its setup, shows on the **Warnings** page. Cards, outline rows and scene pages show the setups and payoffs in each scene.
- **Structure** (NT-7, optional): lay three acts, seven points, the hero's journey or four parts over a book, or your own (**Save as template**). Pin each beat to a scene; the pacing strip shows where the beats fall by words (by scenes while there is little text) and flags a beat ten points or more from where the template puts it.
- **Character arcs** (NT-8): per book, where a character starts and ends (goal, belief, wound) and the scenes that turn them. Main characters without an arc are listed; arcs show on the character's page and turns on the scene's page.
- Claude's folder gains `story/setups.md`, `story/structure.md` and `story/arcs.md`; Claude can propose setups, arcs and beats.
- World file format 14 (setups and character arcs). Older files open as before.

## Phase 8a: revise

- **Find and replace** (RV-3): **Revise → Find & replace**, or **Find** (Ctrl+H) on the Write page. Look in a scene, a chapter, a book or the whole series, with whole words and match case. Every match is listed with the words around it; untick any to leave them. Bold, italics, links and margin comments stay on the text around them. Each changed scene keeps a version from before, and **Undo** puts it all back.
- **Rename everywhere** (RV-1): **Rename everywhere…** next to the name of a character, place, realm, group or event (or **Revise → Names**). It finds the full name and, when one word changes ("Kaela Venn" to "Kayla Venn"), that word on its own, in scene text, scene and chapter titles, summaries and notes. Words that other names share ("Venn") start unticked. The old name can stay as an alias.
- **Name typos** (RV-2): a capitalised word one letter from a name or alias ("Kayla" for Kaela) is underlined in red on the Write page and listed on the Warnings page and in **Revise → Names**, with **Change to Kaela** or **Not a typo**.
- **Style checks** (RV-4): **Style** on the Write page marks words repeated close together, very long sentences, adverbs, filter words and crutch words overused in the book. **Revise → Style** switches each rule on or off and shows them per chapter, with the book's most used words. Plain rules, no AI.
- **Revision passes** (RV-5): **Revise → Passes**: named passes ("Dialogue", "Timeline and places") with a tick per chapter and a progress bar.
- **Editor's changes** (RV-6): export the book (Write → Export), send it to your editor, and open the file they send back in **Revise → Editor's changes**. The export now carries an invisible marker around each scene, so every scene is found again (older exports are matched by chapter titles and scene breaks). Tracked insertions and deletions are shown scene by scene: **Accept** (your links and comments stay where their words still are), **Reject**, or **Keep both** (the editor's version goes into the scene's History). The editor's comments become margin comments.
- Claude's folder gains `story/revision.md`; Claude can propose revision passes.
- World file format 15 (revision passes). Older files open as before.

## Phase 8b: finish

- **Dialogue by character** (RV-7): on the Write page, put the cursor inside a quote (or select the words) and press **Speaker** (Ctrl+Alt+S) to say who speaks it; the scene's point of view and cast are listed first. Tagged lines get a thin underline in the character's colour. **Revise → Dialogue** lists every line each character speaks, in reading order, with lines, words and share of the dialogue, and how many quotes in the book have no speaker yet. Guessing speakers automatically comes later.
- **Reading copies** (RV-8): a new **Finish** page. **Reading copy** saves a book (or some of its chapters) as an **ePub** (Kindle, Kobo, Apple Books) or a **PDF** (paperback 6 × 9 in, A4 or US Letter), with a title page, chapters on a new page, justified text and page numbers. The PDF is set in Times; letters outside Western European alphabets show as "?" there.
- **Submissions** (RV-9): **Finish → Submissions**: a row each time a book goes out (to an agent, publisher, contest or magazine; query, partial or full), with the answer, the dates and notes, how long each has been waiting, and a count of waiting, offers and rejections.
- **"Previously on…"** (SR-2): **Finish → Previously on…** builds a recap before any book after the first: the scene summaries of the books before it, who's who and where the story left them, and the secrets the reader knows. It uses the reader's view at the end of the book before, so nothing later leaks in. Save as PDF or Word.
- **Series bible** (EU-16): **Finish → Series bible**: characters (dates, titles, groups, relationships, description), places by region, groups and their members, and one timeline of events, births and deaths and dated scenes. Either everything (your copy, with notes) or only what the reader knows by the end of a chosen book. Save as PDF or Word.
- Claude's folder gains `story/dialogue.md` and `story/submissions.md`; Claude can propose submissions.
- World file format 16 (submissions). Older files open as before.

## Phase 5a: calendars

- **Your world's own calendars** (TL-2): **Settings → Calendars**. Add as many as you like, starting from 12 months, 13 months of 28 days, or 10 months, and set month names and lengths, leap days and the leap rule, the days of the week, the eras and the day year 1 begins. Dates everywhere stay day/month/year (D-16).
- The date bar shows the current day in your calendar ("Sixthday, 11 Seedtime 319 AR"); hover for all of them.
- **Convert a date**: type "3/5/1042" or "3 Thaw 318 AR" and see it in every calendar.
- Claude's `world.md` lists the calendars and today in each.

## Phase 5b: pictures and spreadsheets

- **Pictures** (PL-5): the map's **Export this view** gains **PDF** (one page, A4 or Letter, with the date it shows), next to PNG and SVG. The Timeline gets **Save: PNG / PDF** for what is on screen.
- **Import from a spreadsheet** (PL-6): **Import CSV…** on the Characters and Places pages. Save the sheet as "CSV UTF-8"; columns are matched by their headings (name, aliases, born, died, importance, tags, notes; for places kind, inside, latitude, longitude). Each row shows what will happen before you import; names that already exist are skipped or only have their empty fields filled in. One undo takes it back.
