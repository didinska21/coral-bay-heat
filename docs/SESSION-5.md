# SESSION-5 — Screenshots & polish v1 (continuation, 18 Nov 2026 ±04:12–04:50 WIB)

S5 continuation under recording r4 (01a1eb27-719b-747f-a237-609f949f614f),
after the 22:01 WIB kickoff run timed out at the 6 h cron limit before
submitting. The r3 seal (01a1ea9f-2cc3-7782-ac1c-f101db5c27aa, sealed
03:13 WIB) already witnessed the S1–S4 rebuild and the first S5 work
(commit 81811a7); this session finished the remaining S5 under r4 and
submitted v1 with both recordings.

## What was done

- **Shot 3 (`3-chase`, Mangrove Outskirts, 11:49 PM, 5 stars)** — captured
  with `node tools/capture-shots.js --shot 3-chase`, all 6 checks PASS
  (stars 5, roadblock, night, car hurt, health 35, no runtime errors).
  First capture failed the visual review: the roadblock was cropped at the
  top frame edge, only 1 police unit was in the world, and the sport had
  been damaged to 0 health by `damage()` on top of the M-chain damage, so
  it read as a dead wreck. Fixed in `tools/capture-shots.js` (this session,
  r4): player staged 45 m south of the roadblock instead of 60 m (chevron
  clears the roadblock car), two police units placed visibly behind the
  car (spawned if fewer than two exist), car health set directly to 35%
  with `smoke = 1` instead of `damage()`. Re-captured PASS; viewed at
  1280 px and at 768 px (contact-sheet size): ROADBLOCK label + white
  roadblock car, two pursuing police, 5 gold stars, POLICE PURSUIT,
  mission text, minimap, news ticker all read.
- **Shot 4 (`4-mission`, Marina, 5:45 AM, MISSION PASSED)** — captured
  with `node tools/capture-shots.js --shot 4-mission`, all 6 checks PASS.
  First capture failed one check (`shot4Banner`): the banner read
  "MISSION PASSED — Gilded Sunrise  —  +$5000" (double spaces). Root
  cause was the game, not the check: `game/src/missions.js:295` built
  the sub as `def.title + '  —  +$' + reward`. Fixed to single spaces
  (this session, r4) and re-captured PASS. Two staging fixes in
  `tools/capture-shots.js`: the freeze now drops the stale TITO dialog
  from M2 (`freeze(true, false, true)` — banner kept) and the sport was
  moved west of Mara (2440,1290) so it no longer sits under the minimap.
  Viewed at 1280 px and 768 px: banner, $9,050, 0 stars, Mango House,
  red sport beside Mara on foot all read.
- **Shots 1–2 re-viewed by this session** (not just trusted from the
  earlier agent): shot 1 Boardwalk 8:24 PM, 3 stars, SEARCHING, two
  police under the player car; shot 2 Downtown 11:19 AM, on foot, SAL
  dialog, TAXI activity. The star row was verified at 3× zoom: 3 filled
  + 2 hollow on shot 1, 5 hollow on shot 2 — both match the describe
  output. All four shots ≤ 84,103 B (cap 256 KiB).
- **Starter screenshots deleted** (`screenshots/1-start.jpg`,
  `2-play.jpg`, `3-end.jpg`): the entry now ships exactly the four
  staged shots.
- **`main.ts` revision #2** (this session, r4; revision #1 was the S5
  agent's in r3, commit 81811a7): an entry-contract guard before the
  dossier build — exactly 4 files in `screenshots/`, each matching
  `^[1-4]-[a-z]+\.jpe?g$`, otherwise it throws naming the offending
  file. The guard is what the deleted starters would have tripped.

## Test block (all in this session, under r4)

- `node tools/browser-check.js` (S1–S4 acceptance, real Chromium):
  **PASS** — every check true, including `m1Passed` … `m5Passed`,
  `wasted: true`, `retryToPlay: true`, `noRuntimeErrors: true`
  (`runtimeErrors: []`), money final $9,229.
- Playtest start → M1 → game over → restart
  (`/tmp/gta6-playtest-fail-restart.js`, scratch, not in the repo):
  **PASS 10/10** — title → play → M1 active → health 0 → screen
  `failed`, `fail` = WASTED → Enter → screen `play`, health 100,
  M1 back at stage 0 (retry checkpoint), no runtime errors.
- `main.ts` 2× (`MAKEFUN_OUTPUT_DIR=/tmp/out1|out2`): dossier
  **byte-identical** (sha256
  `d3be70ccb0cfcbc19175fd048d3608db6a9939d97a8979ccfee5b368c6a496e1`,
  554,309 bytes), whole output trees identical; 4 screenshots listed.
- Reject checklist (planning/04 § "Ceklis tolak"): **clean** — minimap
  in all four; wanted > 0 (shots 1, 3); on-foot shots (2, 4); night
  shot (3); objective text readable at 768 px; no ghost/transient
  text over text; all four different districts and times
  (Boardwalk 8:24 PM / Downtown 11:19 AM / Mangrove 11:49 PM /
  Marina 5:45 AM). Minor: shot 1's objective timer suffix ("118s")
  sits tight against its panel edge at 768 px — the objective text
  itself reads fully.

## Known items for Fase 2 (before the 24 Nov deadline)

- Shot 3's player car is subtle: the sport's dark Sable paint is nearly
  invisible against the night dirt road — only the red chevron, the
  windshield glint and the muzzle flash mark it. Setting
  `c.color = '#ff735d'` in the staging did not visibly change the body
  (pixels sample neutral grey, not coral — cause not yet found; the
  night shade overlay is suspected). Options: stage the chase at dusk
  (day ~0.75) instead of midnight, or find why the colour assignment
  does not reach the renderer. The shot still reads as a chase (roadblock
  + two police + 5 stars), so this is polish, not a blocker.
- Shot 1's objective panel clips its timer suffix at 768 px (see above).
  Consider shortening the objective line or widening the panel.
- Shots are v1 safety-net quality: the entry is valid and submittable,
  Fase 2 iterates on the judge criteria (open-world breadth, mission
  depth, polish) while the deadline allows.
