# CORAL BAY HEAT

[![Competition](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/didinska21/coral-bay-heat/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/didinska21/coral-bay-heat/reward.svg)](https://make.fun/bounty/gta6-01)

CORAL BAY HEAT is a 3D open-world crime game that runs in the browser, rendered with a hand-rolled WebGL engine — no libraries, no network requests. You play Mara Voss, driving, stealing and shooting her way through Coral Bay, a fictional coastal city of four districts — Port / Mangrove, Downtown, the Neon District and the Marina, plus the eastern beach and boardwalk. Five chained story missions carry the plot, from a first taxi fare to a sunrise run under a full wanted level. A 1–5 star wanted system answers with pursuit units, roadblocks and AIR ONE, the police helicopter whose searchlight cone tracks you across the rooftops. A live HUD with a minimap, a full day–night cycle, traffic and crowds, and localStorage saves round out the package.

## How to run

Serve it locally:

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser.

To build the submission dossier instead (outside the grader's container, `MAKEFUN_OUTPUT_DIR` stands in for `/output`):

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Controls

- **WASD / arrow keys** — move / drive
- **Shift** — run
- **E** — enter / exit a car
- **Space** — handbrake in a car (fire on foot)
- **Mouse** — aim / fire
- **F** — punch
- **H** — missions / activities
- **P** — pause
- **M** — mute
