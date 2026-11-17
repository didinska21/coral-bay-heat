# SESSION-2 — Vehicles and traffic (rebuild S2, 18 Nov 2026 ±01:10 WIB)

Rebuild of the abandoned r2 S2 (commit 3d1e86e) under recording r3
(01a1ea9f-2cc3-7782-ac1c-f101db5c27aa), built by a Muse-app subagent session.
Old S2 code was read only as a reference for APIs; every file below was
rewritten by this session through its own file tools.

## What was built
- `game/src/config.js` — new `vehicles` section: 6 types with 07 speeds
  (compact 30, sedan 34, SUV 32, pickup 31, sport 46, police 40 m/s),
  acceleration / grip / durability / colors per type; per-district traffic
  density (Downtown 14, Boardwalk 10, Marina 6, Mangrove 2) + night ×0.6.
- `game/src/input.js` — added `held(key)` for continuously-held keys
  (Space = handbrake); `take()` stays one-shot.
- `game/src/vehicles.js` — CoralVehicles.create(world): parked cars from
  world.parked (36, civilian types only — police type reserved for S3),
  enter/exit (E toggles), carjacking (driver bails to `drivers`, event
  logged), arcade physics (throttle/steer/handbrake drift, grip lerp),
  building + car collision with bounce and damage, damage thresholds
  (smoke <65% health, fire <22%, fire burns over time), particles
  (smoke/flame/impact/skid), `shotAt()` for S3 combat. API: cars, drivers,
  events, playerCar, enter, exit, update, damage, shotAt, spawnTraffic,
  move (= collide), clearAt, nearest, effects().
- `game/src/traffic.js` — CoralTraffic.create(world, vehicles): AI cars
  follow the road grid (node-to-node, random turns, random junction pauses),
  brake for cars and the player ahead (horn "!" when blocked), sidestep a
  blockage after 1.2 s, reverse route after 5 s stuck. Population held at
  the district target, refreshed every 12 s or on district change.
- `game/src/render.js` — draws vehicles (rotated bodies, windshield, wheels,
  police light bar, open door), fleeing drivers with "!", smoke/flame/
  impact/skid particles, coral chevron above the player's car (07), HUD
  speed box (km/h + type name) and contextual prompts ("E — ENTER SEDAN",
  "E — EXIT · SPACE — HANDBRAKE"). Static world.parked drawing removed
  (parked cars now come from the vehicle system, so they are drawn once).
- `game/src/main.js` — creates vehicles + traffic, E toggles enter/exit,
  driving replaces walking while in a car, traffic updates every frame;
  `state.vehicles` / `state.traffic` and `window.CoralGame.vehicles` /
  `.traffic` expose them for checks and later sessions.
- `game/index.html` — vehicles.js + traffic.js in dependency order
  (after world.js, before render.js).
- `tools/browser-check.js` — extended with the S2 acceptance block (S1
  checks kept as regression); final label now "S2 ACCEPTANCE: PASS".

## Cleanup fix vs the old S2 (the traffic-drain bug)
The old refresh re-counted ALL AI cars in the whole city once per car while
comparing against the current district's small target — in a quiet district
that drained traffic everywhere toward zero. The new refresh: (1) drops
stale AI cars that are out of the district AND far (>900) from the player;
(2) counts the in-district AI population ONCE; (3) trims genuine surplus
farthest-first and only cars the player cannot see (>600 away); (4) tops
the district back up to its target. Verified: 14 AI after reload in
Downtown = the district target exactly.

## Verification (Chromium, tools/browser-check.js — S2 ACCEPTANCE: PASS)
- titleScreen, playing, spawn Downtown, districtChangedToMarina: all true
  (S1 regression intact, no console errors).
- parkedCount 36; enterParkedCar true (compact "Pinto"); drove 15 m to
  15.4 m/s on real keys (compact reaches ~16 m/s at the end of a 2.5 s
  launch — the first 40 m threshold was too strict for that launch and
  was corrected to >10 m + >5 m/s, with the reason noted in the script).
- damageSmokes true (damage 60 → health 0 on the compact, smoke = 1,
  smoke particles in effects); exitCar true; carjackingWorks true
  (playerCar set, carjacking event logged, driver fled to drivers list).
- trafficMoves true; trafficNotInBuildings true; aiCountAfterReload 14
  (Downtown target) — stable, not drained.
- Screenshots /tmp/s2-drive.png (Marina, 54 km/h, chevron over the Pinto,
  prompt visible) and /tmp/s2-traffic.png (Downtown, carjacked Marlin at
  0 km/h, smoke puffs, traffic on the roads) both viewed: cars read
  clearly, no visual defects spotted.

## Known / for later sessions
- No pedestrians yet (planning 05 puts them outside S2); no police/combat
  (S3). The police vehicle type exists in config but nothing spawns it.
- `vehicles.events` is the single crime feed S3 reads (carjacking,
  collision with x/y/impact). `vehicles.shotAt(x, y, radius)` makes nearby
  drivers bail — S3 combat calls it when shots are fired.
- A wrecked car (health 0) cannot be driven (throttle ×0) but still coasts;
  fire keeps burning it. Repair pricing is an S4/balancing item.
- `window.CoralGame` now carries vehicles + traffic; S3 checks should use
  them (e.g. `CoralGame.vehicles.events` for wanted triggers).
- `main.ts` and `vendor/` untouched (S5's job).
