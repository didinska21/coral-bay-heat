# SESSION-3 — Police and combat (rebuild S3, 18 Nov 2026 ±01:10–02:00 WIB)

Rebuild of the abandoned r2 S3 (commit 28438fb) under recording r3
(01a1ea9f-2cc3-7782-ac1c-f101db5c27aa), built by a Muse-app subagent session.
Old S3 code was read only as a reference for APIs and numbers; every file
below was rewritten by this session through its own file tools.

## What was built
- `game/src/config.js` — new `police` section (escape 8/12/16/22/28 s per
  star, counts 1/2/3/4/6, spawn ring 140–200 m, sight 125, witness 145,
  report 4 s, aim 1.2 s, shot interval 2.4 s, arrest radius 48 m / 3 s,
  roadblock life 35 s) and `combat` section (health 100, pistol 24,
  police bullet 9, fire 0.28 s, punch 0.55 s / range 22 / damage 30).
- `game/src/police.js` (new) — `CoralPolice.create(world, vehicles,
  crimeEvents, combat)`: wanted 0–5 from the shared crime queue, witness
  rules (cop sees it, or a living civilian reports in 4 s), source caps
  (carjacking 2, shooting 3, other 4, 5 only with final-stage mission
  authorisation), spawn 140–200 m out of the camera, chase/ram tactics
  per star, one roadblock from star 3, SEARCHING escape clock with
  dirt-road 1.5× and car-swap halving, arrest (on foot, still,
  surrounded by two units, 3 s) → BUSTED. API: `update`, `setMission`,
  `reset`; state: `stars/floor/finalStage/searching/visible/
  escapeElapsed/escapeDuration/arrestElapsed/lastKnown/units/roadblock/
  cause/incidents/spawnLog`.
- `game/src/combat.js` (new) — `CoralCombat.create(world, vehicles,
  crimeEvents, player)`: punch (F, separate cooldown), pistol (mouse
  click, or Space on foot; drive-by from a car), real projectiles with
  wall/car/enemy/player hits, knockback, muzzle/hit effects, mission
  enemies with aim telegraphs. API: `update`, `spawnEnemy`, `fire`,
  `hurt`, `punch`, `clearLine`, `reset`; state: `bullets/effects/
  enemies/pistolUnlocked/lastPlayerShot/aim/cause`.
- `game/src/vehicles.js` — shared crime queue (`create(world,
  crimeEvents)`), `spawnPolice()`, collision events only for the
  player's own crashes (impact > 3) so AI fender-benders and police
  rams do not feed the wanted system, coast branch excludes police
  cars, dead drivers stop moving.
- `game/src/main.js` — creates `crimeEvents`, `combat`, `police`;
  `vehicles.update` now runs every frame (S3 fix: on foot it still has
  to step cars, fleeing drivers and damage particles); update order
  input → player/vehicles → traffic → police → combat; `failed` screen
  (BUSTED / WASTED with cause) + `retry()` on Enter; `window.CoralGame`
  gains `combat/police/crimeEvents/retry`.
- `game/src/render.js` — camera zoom from `config.camera.height` (720p
  → 320×180 m view, so a 140–200 m police spawn is genuinely
  off-camera); `state.camera` exposed for the spawn check; camera
  snaps to the player on the first frame; police strobe lights; the
  roadblock, enemies, bullets, muzzle/hit effects and dashed AIMING
  telegraphs; wanted panel (health bar, stars, SEARCHING countdown +
  bar, arrest warning); aim tick for the pistol; failed screen.
- `game/src/input.js` — mouse gains `worldX/worldY`; blur also drops
  `mouse.down`.
- `game/index.html` — combat.js + police.js in dependency order.
- `tools/browser-check.js` — S3 acceptance block (S1–S2 kept as
  regression); final label "S3 ACCEPTANCE: PASS".

## Verification (Chromium, tools/browser-check.js — S3 ACCEPTANCE: PASS)
- 47 checks, 0 false, no console errors. Crime levels 1→2→3→4→5,
  roadblock at star 3, star 5 only via final-stage authorisation,
  spawns all 140–200 m and out of view, SEARCHING → stars 5→0 on a
  mangrove dirt road, BUSTED (3 s arrest, no instant arrest) + retry
  restores health/stars, pistol hit 65→41 with knockback, punch
  41→11, no police fire at star 2, aim telegraph before damage at
  star 3, police projectile damage, WASTED at health 0.
- Screenshots /tmp/s3-chase.png (Downtown, 5 stars, SEARCHING 27.7 s,
  strobe + smoke, zoomed view) and /tmp/s3-busted.png (clean BUSTED
  screen with cause + retry) both viewed: no visual defects.
- Flaky-check fixes made during this session (all in the harness, not
  the game): the S2 carjacking check no longer reads the
  police-drained event queue; the staged carjack target is frozen
  (`stop = 5`) so a fast car cannot leave the 42 m enter range before
  the key; the pistol lane is cleared of traffic so no car eats the
  bullet; `trafficMoves` matches cars by id and requires 2 movers
  (a queue/pause can hold the first few cars still).

## Known / for later sessions
- `vehicles.events` IS the shared `crimeEvents` array — police drains
  it every frame. Any check that reads the queue must snapshot it in
  the same frame the crime happens, or assert through `police.stars` /
  `police.incidents` instead.
- `police.setMission(floor, finalStage)` is the mission hook: S4
  missions pin a floor (M3: 3, M4: 4) and only the final M5 stage may
  pass `finalStage=true` for star 5. Call `setMission(0, false)` when
  a mission releases the floor.
- `combat.spawnEnemy(x, y, {group, active})` is the mission-enemy hook;
  inactive enemies stay damageable (used by the acceptance punch test).
  `pistolUnlocked` stays true in S3; S4 missions own the flag.
- `vehicles.shotAt(x, y)` makes nearby drivers bail — combat calls it
  on every player shot; the fleeing drivers are the civilian witnesses.
- A carjacked police car leaves `police.units` (`police=false`) and
  becomes an ordinary player car. A wrecked police car (health 0) is
  dropped from the units the same way.
- `main.ts` and `vendor/` untouched (S5's job).
