# SESSION-4 — Missions, HUD, save, audio (rebuild S4, 18 Nov 2026 ±02:00–03:30 WIB)

Rebuild under recording r3 (01a1ea9f-2cc3-7782-ac1c-f101db5c27aa), built by a
Muse-app subagent session. The old S4 never wrote anything (killed by the
second runtime restart), so there is no old S4 to reference — everything
below was written from the planning docs (01/02/03/05/07) in this session.

## What was built
- `game/src/missions.js` (new) — `CoralMissions.create(world, vehicles, police, combat, state, hooks)`:
  data-driven stage machine (goto / driveTo / enterCar / stealCar / recover /
  defeat / collect / laylow), 5 story missions per planning/02 with intro &
  outro dialog, wanted floors via `police.setMission` (M3: 3, M4: 4, M5:
  3→4→5 with finalStage only on the last bag), mission light-lock
  (M1 09:07, M2 sunset, M3 early night, M4 night, M5 pre-dawn), mission
  timers (M2 150 s, M3 hide 120 s, M5 330 s total), retry checkpoint
  (mission restarts at stage 0 from its start point). M2 spawns two guard
  cars that chase along the roads (`roadStep`) and shoot with a visible aim
  pause; M3 spawns the Vantara Sable at the valet and the rival steals it
  back 5 s after the player takes it (the Sable flees along roads, slowing
  when Mara gets close so the re-carjack is possible); M4 spawns 3 warehouse
  guards via `combat.spawnEnemy(group 'm4')` and ends with a lay-low stage
  (stars must fall to 0, floor released first); M5 collects 3 money bags
  with the wanted floor rising per bag. Three repeatable activities
  (Bay Taxi, Parcel Rush, Hot-Car Deliveries — Beach Sprint stays cut per
  07), started with H at their marker; pay + tip/fast/condition bonuses.
  Landmarks resolved from the built city (shop buildings by name, piers) and
  every objective snapped to the nearest road, so no objective ever sits
  inside a building. Start a mission with H at the workshop marker.
- `game/src/hud.js` (new) — `CoralHud.create(canvas, renderer)`, drawn after
  the renderer: money pill, mission objective panel (+ stage/mission timer),
  dialog panel, fading notifications, Mission Passed banner, news ticker,
  live minimap (district colours, roads, water, player, objective ring,
  police dots, activity icons, mission marker) and a world beacon +
  off-screen edge arrow with distance. `hud.lastMarkers()` exposes the
  minimap contents for the acceptance check.
- `game/src/save.js` (new) — `CoralSave`: one versioned localStorage slot
  (`coral-bay-heat-save-v1`): money, completed missions, current mission,
  pistol/sport/story flags, player position + health, day clock, news.
  Corrupt or foreign slots are ignored safely.
- `game/src/audio.js` (new) — `CoralAudio.create()`: all synthesised
  WebAudio, no files, no network. Engine hum follows car speed, siren
  swells with the nearest police unit, noise-burst shots/crashes, thump,
  UI blips, mission jingle, fail motif. Context is created only after the
  title-screen Enter gesture; every method is a no-op before that and
  nothing throws without audio hardware. Mute (M) drives the master gain.
- `game/src/config.js` — `missions` section (rewards 250/600/1200/2000/5000,
  timers, repair $100, armour $150, BUSTED fine 10% max $500, activity pay)
  and `audio` section (levels, siren range).
- `game/src/vehicles.js` — `spawnCar(typeId, x, y, angle, ai)` for mission
  cars (Sable, M2 guards); traffic only steers cars flagged ai.
- `game/src/main.js` — state.money, notifications, lightLock, news,
  hasSave/saveSummary; missions + hud + audio creation; update order
  input → player/vehicles → traffic → police → combat → missions → audio;
  day clock frozen while a mission locks the light; Continue (Enter) /
  New Game (N) on the title screen; Continue restores money, story,
  unlocks, position and clock, and restarts a saved mid-mission at stage 0;
  retry: BUSTED fine (10%, max $500) then mission checkpoint retry, or the
  old free-roam retry; `window.CoralGame` gains missions/hud/audio/save.
- `game/src/render.js` — title screen shows CONTINUE ($, n/5 missions) when
  a save exists, else ENTER THE CITY; failed screen uses
  `state.failCause` (so FAILED shows the mission reason); wanted panel
  shows "F TO PUNCH — PISTOL LOCKED" until M2 unlocks the pistol; chaser
  cars join the aim-telegraph drawing; controls bar gains H.
- `game/index.html` — missions/hud/save/audio scripts in dependency order.
- `tools/browser-check.js` — S4 acceptance block (see below); final label
  "S4 ACCEPTANCE: PASS".

## Verification (Chromium, tools/browser-check.js — S4 ACCEPTANCE: PASS)
- 92 checks, 0 false, no console errors, exit 0 (final run; money final
  $9,198 after the full M1–M5 chain + taxi + hot-car).
- S1–S3 regression intact (walk, cars, traffic, police, combat, BUSTED,
  WASTED, retry).
- M1 played end to end (walk to loaner → enter → pier → Gull → workshop):
  Mission Passed banner, +$250, save written, light locked at 0.38
  (09:07 AM), dialog shown, minimap objective + player markers present.
- Reload → Continue offered → Enter restores $250 + completed M1.
- M2 chain: 2 guard cars spawn, pistol unlocks, money $850.
- Taxi pays, hot-car (steal requested type → deliver to workshop) pays.
- M3 chain: steal the Sable → rival steals it back after 5 s → recover it
  → hide at the workshop, sport stored. M4 chain: 3 guards spawn and die,
  wanted floor 4, escape to the mangroves, lay low until stars 0, news
  ticker set. M5 chain: 3 bags, stars 3→4→5, dawn delivery, storyComplete.
- Audio: `audio.enabled()` true after the title Enter (context created,
  no exception in headless).
- Screenshots /tmp/s4-m1.png and /tmp/s4-activity.png viewed: mission
  panel, dialog, minimap, Mission Passed banner and notifications all read
  clean; the off-screen objective arrow now sits below the left panels
  instead of overlapping them.

## Fixes made during this session (game, not harness)
- Mission objectives are road-snapped (`onRoad`): building-centre points
  (workshop, pawn, sirena, crown, warehouse) could never be reached on
  foot inside a 45 m radius, and M4 guards spawned inside the warehouse
  building would have been unshootable. Guards are now placed on open
  ground (building check + nearest-road fallback).
- M3 recover stage could soft-lock: if Mara had already stepped out of the
  Sable when the 5 s steal-back timer fired, `flee` was never set and the
  stage could never complete. The rival now takes the car whether Mara is
  sitting in it or not.
- The Sable spawned on the exact road point of the valet objective — on top
  of the player's own car, so `vehicles.enter` (nearest wins) grabbed the
  wrong car and the steal could never register. It now spawns one block
  away on a spot verified clear of other cars.
- HUD edge arrow clamped clear of the left panels (district / objective /
  activity), and notifications moved to y 182 to clear the money pill.

## Harness fixes (tools/browser-check.js only, no game change)
- `window.warpToObjective` and `window.stepPolice` are redefined after the
  S4 reload (a page navigation wipes them).
- The S2 enter-car staging moves only AI cars within 90 m aside, 130 m
  along the road: teleporting the whole fleet across the map starved the
  `trafficMoves` check (the refresh drops them as stale), and a passing
  traffic car could win the 42 m enter range over the intended parked car
  (a fast sport then bounced and read a negative speed).

## Decisions / deviations to note
- Activities unlock after M1 (not only after M5 as 07 lists them under the
  M5 reward): planning/02 presents them as side content, and they need to
  be visible on the minimap during the story. M5 still grants
  Story Complete + free roam.
- Continue restarts a saved mid-mission at stage 0 (the save records which
  mission is open, not the stage) — noted on the title screen as the
  mission count, not a stage.
- M2's "wanted max 2 when shooting" from planning/02 is not enforced: the
  police shooting cap is 3 (S3). No mission code caps it; the natural cap
  is 3.
- `main.ts` and `vendor/` untouched (S5's job).

## Known / for S5
- `missions.stageTarget()` / `activityTarget()` give the current objective
  (x, y, r) for staging; `missions.landmarks` holds the resolved points
  (workshop, pawn, sirena, crown, pier, gull, warehouse, mangroveHideout).
- `missions.chasers` are the M2 guard cars (with `.aim` for telegraphs);
  `combat.spawnEnemy(x, y, {group, active})` and
  `police.setMission(floor, finalStage)` are the mission hooks; M5's
  `finalStage=true` is the only path to star 5.
- `CoralGame.missions.start(id)` starts the next mission only (pass `true`
  as the second argument to bypass the chain order — used by the check).
- `CoralSave.KEY` is `coral-bay-heat-save-v1`; the check's reload relies on
  localStorage surviving a same-origin navigation (same server instance).
- Screenshots in /tmp are verification shots, not the entry's 4 (S5 stages
  those with shots.js per planning/04).
