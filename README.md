# CORAL BAY HEAT

[![Competition](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/didinska21/coral-bay-heat/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/didinska21/coral-bay-heat/reward.svg)](https://make.fun/bounty/gta6-01)

CORAL BAY HEAT is a 2D open-world crime game that runs in the browser. You play Mara Voss, driving, stealing and shooting her way through Coral Bay, a fictional coastal city with four districts — Boardwalk, Downtown, Marina and Mangrove Outskirts. Five chained story missions carry the plot, and three street activities (Bay Taxi, Parcel Rush and Hot-Car Deliveries) fill the time between them. A 1–5 star wanted system with police roadblocks keeps the heat on, while a live minimap, localStorage saves and synthesised WebAudio round out the package — all in 2D canvas, with no libraries and no network requests.

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
