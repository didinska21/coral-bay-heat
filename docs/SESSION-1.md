# SESSION-1 — City skeleton (rebuild S1, 18 Nov 2026 ±01:00 WIB)

Rebuild of the abandoned r2 S1 (commit 82b39d1) under recording r3
(01a1ea9f-2cc3-7782-ac1c-f101db5c27aa), built by a Muse-app subagent session.
Old S1 code was read only as a reference for APIs and layout; every file
below was rewritten by this session through its own file tools.

## What was built
- `game/src/config.js` — GAME_CONFIG: city 3200x2400, block 180, road 28,
  4 districts (Mangrove Outskirts / Downtown / Boardwalk / Marina) with
  rects, 28 shop names, palette. Day cycle 600 s (10 min, per 07).
- `game/src/random.js` — SeededRandom (mulberry32) + range/pick helpers.
- `game/src/input.js` — GameInput: WASD/arrows axis + run (Shift), one-shot
  take() for Enter/Space/P/E/F/M/H/Escape, pointer position + click.
- `game/src/world.js` — CoralWorld.create(): road grid, one building per
  block (skipped for open ground in Mangrove/Marina), palms, lamps,
  mangroves, parked cars, 7 marina piers, spawn (1775,1320). Queries:
  districtAt, nearestRoad, buildingAt, safeSpawn.
- `game/src/render.js` — CoralRender: ground/beach/sea, roads with centre
  dashes (dirt roads in the mangroves), piers, mangroves, buildings with
  day-leaning shadows + lit windows + shop signs, palms/lamps, parked cars,
  night shade + sunset wash, Mara as a coral dot with the chevron marker
  (07: player readable at a glance). HUD: district panel + clock, MARA VOSS
  pill, controls bar, title screen, paused screen.
- `game/src/main.js` — loop (title/play/paused), day clock, district-change
  announcement, axis-separated building collision. Exposes
  `window.CoralGame` (screen/state/world/input/renderer) as a debug handle
  for the automated acceptance checks and later sessions.
- `game/index.html` — classic scripts in dependency order (config, random,
  input, world, render, main). Title CORAL BAY HEAT.
- `game/src/shots.js` (starter Block Dodger staging) DELETED — S5 writes its
  own shots.js; main.js no longer imports it.
- `tools/browser-check.js` — S1 acceptance in real Chromium (CDP + Node
  WebSocket, no packages): title screen, Enter to play, waypoint walk
  Downtown -> Marina with real key events, screenshots to /tmp, zero
  console errors required.

## Fixes vs the old S1
- **Walking speed fixed at the source**: old main.js multiplied the speed by
  13 (`speed * dt * 13` — the 13x bug S3 later had to fix). This build uses
  plain `speed * dt` (walk 4.5 m/s, run 7.5 m/s, per 07).
- Clock is computed from the day fraction at boot (09:07 AM at day 0.38)
  instead of a hardcoded placeholder.
- Parked-car spawn condition written without the old `||` precedence quirk.
- Roads are drawn with the road colour explicitly for both axes (the old
  render left a translucent tint fill active for the vertical roads).

## Verification (Chromium, tools/browser-check.js)
- titleScreen: true, playing: true, spawn Downtown (1775,1320),
  districtChangedToMarina: true, end pos (1735,1588) in Marina,
  noRuntimeErrors: true. Screenshots /tmp/s1-title.png and /tmp/s1-marina.png
  viewed: title screen clean, Marina view shows buildings/roads/parked cars
  with Mara visible against a building edge (standing flush to the wall
  after the eastward leg of the walk — not inside the building).
- Walk note: the spawn sits on road y=1330 inside a building block, so a
  straight-south walk is blocked by the block's building; the check walks
  west to road x=1700 first, then south, then east. That is the intended
  street layout, not a bug.

## Known / for later sessions
- Camera is 1:1 scale (world units = CSS pixels); `config.camera.height`
  (180) is not applied as a zoom yet — zoom/look-ahead is an S5/polish item.
- `window.CoralGame` is the shared debug handle; S2+ checks should use it
  (vehicles, traffic, police, combat attach their state there as they land).
- No audio yet (S4), no vehicles/traffic (S2), no police/combat (S3),
  no missions/HUD minimap/save (S4), no staged shots (S5).
- `main.ts` untouched (starter version); S5 authors >=1 line and revises it.
