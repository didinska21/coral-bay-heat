// CORAL BAY HEAT — a working gta6-01 entry (Node 22, standard library only):
// an open-world crime game in game/ (plain static files a desktop browser
// loads offline: game/index.html and its classic scripts, no library and no
// network request), and the program hands it in. It copies game/ and
// screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library. The game: Mara Voss drives, steals and shoots her way
// through Coral Bay in full 3D — a hand-rolled WebGL engine (no libraries)
// renders four districts plus the beach, with traffic, crowds and a
// day–night cycle; five chained story missions, a 1–5 star wanted system
// with pursuit units, roadblocks and the AIR ONE police helicopter, a
// live HUD with minimap, and localStorage saves. Four staged screenshots
// in screenshots/ (the first by name is the cover) are real renders of
// the game, captured in Chromium with game/src/shots3d.js staging.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Entry contract (S5): exactly the four staged shots, named N-name.jpg —
// a starter screenshot left in screenshots/ would otherwise ship
// silently, so refuse loudly here before the dossier is built.
const entryShots = readdirSync(join(here, 'screenshots')).sort();
if (entryShots.length !== 4) throw new Error('screenshots/: expected 4 entry shots, found ' + entryShots.length);
for (const n of entryShots) {
  if (!/^[1-4]-[a-z]+\.jpe?g$/.test(n)) throw new Error('screenshots/: unexpected entry file ' + n + ' — remove it before handing in');
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);

// Summary for the build log: the dossier is deterministic (the same tree
// always produces the same bytes), so a second run must print the same
// byte count. Screenshots are the entry's cover sheet, in name order.
const shotNames = existsSync(join(out, 'screenshots'))
  ? readdirSync(join(out, 'screenshots')).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort()
  : [];
console.log(
  'CORAL BAY HEAT: ' + shotNames.length + ' screenshot(s) [' + shotNames.join(', ') + '], ' +
  'dossier ' + Buffer.byteLength(dossier) + ' bytes -> ' + join(out, 'dossier.json'),
);
