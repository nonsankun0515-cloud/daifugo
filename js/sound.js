/* 大富豪 — 効果音（Web Audio で合成。音源ファイルなし） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  let ctx = null, master = null, enabled = true, noiseBuf = null;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.55;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function noise(t, dur, freq, q, gain, sweepTo) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t);
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  function tone(t, freq, dur, type, gain, glideTo) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    card(n) {
      const t = ctx.currentTime;
      const k = Math.min(n || 1, 4);
      for (let i = 0; i < k; i++) noise(t + i * 0.035, 0.09, 2600 + Math.random() * 600, 1.4, 0.55);
      noise(t + 0.01, 0.05, 900, 0.8, 0.25);
    },
    deal() { const t = ctx.currentTime; noise(t, 0.05, 3200, 1.6, 0.22); },
    pass() { const t = ctx.currentTime; tone(t, 330, 0.12, 'triangle', 0.08, 260); },
    flow() { const t = ctx.currentTime; noise(t, 0.45, 800, 0.9, 0.35, 5200); },
    turn() { const t = ctx.currentTime; tone(t, 880, 0.18, 'sine', 0.07); tone(t + 0.09, 1320, 0.22, 'sine', 0.05); },
    special() {
      const t = ctx.currentTime;
      [659, 988, 1319].forEach((f, i) => tone(t + i * 0.06, f, 0.5, 'triangle', 0.09));
    },
    cut() {
      const t = ctx.currentTime;
      noise(t, 0.28, 1400, 1.2, 0.5, 7000);
      tone(t + 0.04, 1568, 0.3, 'triangle', 0.08);
    },
    revolution() {
      const t = ctx.currentTime;
      tone(t, 70, 0.9, 'sine', 0.5, 40);
      noise(t, 0.6, 300, 0.7, 0.4, 120);
      [392, 494, 587, 784].forEach((f, i) => tone(t + 0.25 + i * 0.08, f, 0.7, 'sawtooth', 0.035));
    },
    bomb() {
      const t = ctx.currentTime;
      tone(t, 110, 0.6, 'sine', 0.45, 35);
      noise(t, 0.7, 500, 0.6, 0.6, 90);
    },
    finish() {
      const t = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.45, 'triangle', 0.09));
    },
    foul() {
      const t = ctx.currentTime;
      tone(t, 196, 0.35, 'square', 0.05, 150);
      tone(t + 0.18, 147, 0.45, 'square', 0.05, 110);
    },
    fanfare() {
      const t = ctx.currentTime;
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, 0.35, 'triangle', 0.1));
    },
    select() { const t = ctx.currentTime; noise(t, 0.03, 4200, 2, 0.12); },
    chat() { const t = ctx.currentTime; tone(t, 988, 0.12, 'sine', 0.06); tone(t + 0.08, 1480, 0.16, 'sine', 0.05); },
    error() { const t = ctx.currentTime; tone(t, 220, 0.14, 'triangle', 0.08, 180); },
  };

  function play(name, arg) {
    if (!enabled) return;
    if (!ensure()) return;
    try { SOUNDS[name] && SOUNDS[name](arg); } catch (e) { /* 音が出なくても続行 */ }
  }

  D.Sound = {
    play,
    unlock() { ensure(); },
    setEnabled(v) { enabled = !!v; if (enabled) ensure(); },
    get enabled() { return enabled; },
  };
})();
