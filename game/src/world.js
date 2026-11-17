/* Coral Bay itself: road grid, four districts, procedural buildings, palms,
   lamps, mangroves, parked cars and marina piers — all built once from the
   config seed. Pure data plus queries; no drawing and no browser in here. */
var CoralWorld = (function () {
  var cfg = GAME_CONFIG;
  function create() {
    var random = SeededRandom.create(cfg.city.seed);
    var buildings = [], palms = [], lamps = [], mangroves = [], parked = [], piers = [];
    var roadsX = [], roadsY = [];
    var step = cfg.city.block, width = cfg.city.width, height = cfg.city.height;
    var x, y, xi, yi;
    for (x = 80; x < width; x += step) roadsX.push(x);
    for (y = 70; y < height; y += step) roadsY.push(y);

    function districtAt(px, py) {
      for (var i = 0; i < cfg.districts.length; i++) {
        var d = cfg.districts[i];
        if (px >= d.x && px < d.x + d.width && py >= d.y && py < d.y + d.height) return d;
      }
      return { name: 'Coral Bay', color: '#d3a36c' };
    }
    function nearestRoad(px, py) {
      var best = { x: roadsX[0], y: py, distance: Infinity, axis: 'v' };
      roadsX.forEach(function (rx) {
        var d = Math.abs(rx - px);
        if (d < best.distance) best = { x: rx, y: py, distance: d, axis: 'v' };
      });
      roadsY.forEach(function (ry) {
        var d = Math.abs(ry - py);
        if (d < best.distance) best = { x: px, y: ry, distance: d, axis: 'h' };
      });
      return best;
    }
    function nearRoad(px, py) { return nearestRoad(px, py).distance; }
    function buildingAt(px, py) {
      for (var i = buildings.length - 1; i >= 0; i--) {
        var b = buildings[i];
        if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b;
      }
      return null;
    }

    /* One building per block, skipped where the district wants open ground. */
    for (yi = 0; yi < roadsY.length - 1; yi++) {
      for (xi = 0; xi < roadsX.length - 1; xi++) {
        var left = roadsX[xi] + cfg.city.road / 2 + cfg.city.sidewalk;
        var top = roadsY[yi] + cfg.city.road / 2 + cfg.city.sidewalk;
        var w = roadsX[xi + 1] - roadsX[xi] - cfg.city.road - cfg.city.sidewalk * 2;
        var h = roadsY[yi + 1] - roadsY[yi] - cfg.city.road - cfg.city.sidewalk * 2;
        if (left + w > width - cfg.city.beach || top + h > height - 40) continue;
        var district = districtAt(left + w / 2, top + h / 2);
        if (district.name === 'Mangrove Outskirts' && random() < 0.62) continue;
        if (district.name === 'Marina' && left > 2220 && random() < 0.58) continue;
        var inset = SeededRandom.range(random, 7, 19);
        buildings.push({
          x: left + inset, y: top + inset, w: w - inset * 2, h: h - inset * 2,
          height: SeededRandom.range(random, 1, 8),
          color: SeededRandom.pick(random, cfg.palette.building),
          roof: SeededRandom.pick(random, cfg.palette.roof),
          name: SeededRandom.pick(random, cfg.shops),
          shop: random() < 0.24
        });
        var downtownParked = district.name === 'Downtown' && random() < 0.44;
        if (downtownParked || random() < 0.11) {
          parked.push({ x: left + w / 2, y: top - 13, color: SeededRandom.pick(random, ['#d34e47', '#e6ca84', '#388a88', '#f4f1df', '#415b67']), angle: 0 });
        }
      }
    }
    /* Street lamps (with a palm beside most of them north of the mangroves). */
    for (var px = 40; px < width - cfg.city.beach; px += 93) {
      for (var py = 42; py < height; py += 95) {
        if (nearRoad(px, py) < 36) {
          lamps.push({ x: px, y: py });
          if (py < 1110) palms.push({ x: px + 20, y: py + 22, size: 1 });
        }
      }
    }
    /* Mangrove thicket in the south-west, kept clear of the dirt roads. */
    for (var mx = 60; mx < 1280; mx += 44) {
      for (var my = 1210; my < 2360; my += 48) {
        if (nearRoad(mx, my) > 55 && random() > 0.19) {
          mangroves.push({ x: mx + random() * 22, y: my + random() * 20, size: SeededRandom.range(random, 0.7, 1.25) });
        }
      }
    }
    /* Marina piers jutting south from the waterfront. */
    for (var p = 0; p < 7; p++) {
      piers.push({ x: 2270 + p * 113, y: 1135 + (p % 2) * 14, w: 18, h: 230 + (p % 3) * 36 });
    }

    var spawn = { x: 1775, y: 1320 };
    return {
      buildings: buildings, roadsX: roadsX, roadsY: roadsY, palms: palms,
      lamps: lamps, mangroves: mangroves, parked: parked, piers: piers,
      spawn: spawn, districtAt: districtAt, nearestRoad: nearestRoad,
      buildingAt: buildingAt,
      safeSpawn: function () { return { x: spawn.x, y: spawn.y }; }
    };
  }
  return { create: create };
}());
