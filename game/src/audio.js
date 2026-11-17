/* Audio: everything synthesised in WebAudio — no files, no network. The
   engine hum follows the driven car's speed, the siren swells with the
   nearest police unit, and shots, punches, crashes, UI blips and the
   mission jingle are short scheduled voices. The context is created only
   after a user gesture (the title-screen Enter); every method is a no-op
   before that, and nothing throws when the browser has no audio. */
var CoralAudio = (function () {
  function create() {
    var ctx = null, master = null, engineOsc = null, engineGain = null;
    var sirenOsc = null, sirenGain = null, sirenHigh = false, sirenClock = 0;
    var noiseBuf = null, ok = false;
    function ensure() {
      if (ctx) return true;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = GAME_CONFIG.audio.master;
        master.connect(ctx.destination);
        var len = Math.floor(ctx.sampleRate * 0.3);
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        var data = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        engineOsc = ctx.createOscillator();
        engineOsc.type = 'sawtooth';
        engineOsc.frequency.value = 55;
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        engineOsc.connect(engineGain);
        engineGain.connect(master);
        engineOsc.start();
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'square';
        sirenOsc.frequency.value = 700;
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain);
        sirenGain.connect(master);
        sirenOsc.start();
        ok = true;
      } catch (e) { ok = false; }
      return ok;
    }
    function resume() {
      if (ctx && ctx.state === 'suspended') {
        try { ctx.resume(); } catch (e) {}
      }
    }
    function burst(duration, type, frequency, gainValue) {
      if (!ctx) return;
      try {
        var src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        var filter = ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.value = frequency;
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(gainValue, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(master);
        src.start();
        src.stop(ctx.currentTime + duration);
      } catch (e) {}
    }
    function tone(frequency, duration, type, gainValue, when) {
      if (!ctx) return;
      try {
        var osc = ctx.createOscillator();
        osc.type = type || 'sine';
        osc.frequency.value = frequency;
        var gain = ctx.createGain();
        var start = ctx.currentTime + (when || 0);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(gainValue || 0.15, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + duration + 0.05);
      } catch (e) {}
    }
    function update(dt, state) {
      if (!ctx) return;
      try {
        master.gain.value = state.muted ? 0 : GAME_CONFIG.audio.master;
        var speed = state.vehicles && state.vehicles.playerCar
          ? Math.abs(state.vehicles.playerCar.speed) : 0;
        engineOsc.frequency.value = 55 + speed * 3.2;
        engineGain.gain.value = state.vehicles && state.vehicles.playerCar
          ? GAME_CONFIG.audio.engine : 0;
        var nearest = Infinity;
        if (state.police) {
          state.police.units.forEach(function (u) {
            var d = Math.hypot(u.x - state.player.x, u.y - state.player.y);
            if (d < nearest) nearest = d;
          });
          if (state.police.roadblock) {
            var rd = Math.hypot(state.police.roadblock.x - state.player.x,
              state.police.roadblock.y - state.player.y);
            if (rd < nearest) nearest = rd;
          }
        }
        if (nearest < GAME_CONFIG.audio.sirenRange && state.police && state.police.stars > 0) {
          sirenClock -= dt;
          if (sirenClock <= 0) {
            sirenHigh = !sirenHigh;
            sirenOsc.frequency.value = sirenHigh ? 950 : 700;
            sirenClock = 0.4;
          }
          sirenGain.gain.value = GAME_CONFIG.audio.siren *
            (1 - nearest / GAME_CONFIG.audio.sirenRange);
        } else {
          sirenGain.gain.value = 0;
        }
      } catch (e) {}
    }
    return {
      ensure: ensure, resume: resume, update: update,
      enabled: function () { return ok; },
      shot: function () { burst(0.12, 'bandpass', 1800, 0.5); },
      punch: function () { tone(90, 0.12, 'sine', 0.5); },
      crash: function () { burst(0.25, 'lowpass', 500, 0.6); },
      horn: function () { tone(340, 0.18, 'square', 0.12); },
      ui: function () { tone(660, 0.08, 'sine', 0.15); },
      pickup: function () { tone(880, 0.1, 'sine', 0.2); tone(1320, 0.14, 'sine', 0.15, 0.09); },
      jingle: function () {
        tone(523, 0.16, 'triangle', 0.22, 0);
        tone(659, 0.16, 'triangle', 0.22, 0.12);
        tone(784, 0.16, 'triangle', 0.22, 0.24);
        tone(1046, 0.34, 'triangle', 0.25, 0.36);
      },
      fail: function () {
        tone(392, 0.2, 'triangle', 0.2, 0);
        tone(311, 0.2, 'triangle', 0.2, 0.18);
        tone(233, 0.4, 'triangle', 0.22, 0.36);
      }
    };
  }
  return { create: create };
}());
