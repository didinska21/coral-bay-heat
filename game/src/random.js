/* Seeded RNG (mulberry32-style) plus small helpers. All world randomness flows
   through here so a fixed seed always builds the same city. */
var SeededRandom = (function () {
  function create(seed) {
    var state = seed | 0;
    return function () {
      state = (state + 0x6d2b79f5) | 0;
      var value = Math.imul(state ^ (state >>> 15), 1 | state);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }
  function range(random, low, high) { return low + random() * (high - low); }
  function pick(random, values) { return values[Math.floor(random() * values.length)]; }
  return { create: create, range: range, pick: pick };
}());
