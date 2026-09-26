/* テーブルとロビーの素材（フェルト・木・革・絨毯）をキャンバスで作る */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // 同じ乱数列にして、毎回同じ見た目にする
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** フェルトの毛羽（透明の上に明暗の点と短い繊維）。どの色のフェルトにも重ねられる */
  function felt() {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const r = rng(11);
    const img = g.createImageData(S, S);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r();
      if (v < 0.5) { img.data[i] = img.data[i + 1] = img.data[i + 2] = 0; img.data[i + 3] = Math.floor((0.5 - v) * 70); }
      else { img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.floor((v - 0.5) * 34); }
    }
    g.putImageData(img, 0, 0);
    g.lineCap = 'round';
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, len = 1.5 + r() * 5, a = r() * Math.PI;
      const light = r() < 0.45;
      g.strokeStyle = light ? 'rgba(255,255,255,' + (0.05 + r() * 0.08) + ')' : 'rgba(0,0,0,' + (0.06 + r() * 0.1) + ')';
      g.lineWidth = 0.5 + r() * 0.7;
      for (const [ox, oy] of [[0, 0], [-S, 0], [S, 0], [0, -S], [0, S]]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + Math.cos(a) * len, y + oy + Math.sin(a) * len);
        g.stroke();
      }
    }
    return c.toDataURL('image/png');
  }

  /** くるみ材の木目（横にも縦にもつながる） */
  function wood() {
    const W = 512, H = 128;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const r = rng(29);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#5b331b');
    grd.addColorStop(0.5, '#4b2914');
    grd.addColorStop(1, '#5a311a');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 110; i++) {
      const y0 = r() * H;
      const k1 = 1 + Math.floor(r() * 3), k2 = 3 + Math.floor(r() * 5);
      const a1 = 1 + r() * 5, a2 = r() * 1.6;
      const p1 = r() * 6.283, p2 = r() * 6.283;
      const dark = r() < 0.6;
      g.strokeStyle = dark ? 'rgba(24,9,2,' + (0.12 + r() * 0.3) + ')' : 'rgba(160,96,50,' + (0.05 + r() * 0.12) + ')';
      g.lineWidth = 0.5 + r() * 2.2;
      for (const oy of [0, -H, H]) {
        g.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const t = (x / W) * 6.283;
          const y = y0 + oy + Math.sin(t * k1 + p1) * a1 + Math.sin(t * k2 + p2) * a2;
          if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    const img = g.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 16;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.9);
  }

  /** 革のしぼ（細かいシワ） */
  function leather() {
    const S = 192;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const r = rng(47);
    for (let i = 0; i < 900; i++) {
      const x = r() * S, y = r() * S, rad = 1 + r() * 3.5;
      g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,' + (0.1 + r() * 0.16) + ')' : 'rgba(255,230,200,' + (0.025 + r() * 0.04) + ')';
      for (const [ox, oy] of [[0, 0], [-S, 0], [S, 0], [0, -S], [0, S]]) {
        g.beginPath();
        g.ellipse(x + ox, y + oy, rad, rad * (0.5 + r() * 0.6), r() * Math.PI, 0, 6.283);
        g.fill();
      }
    }
    return c.toDataURL('image/png');
  }

  // 絨毯の花びら（中心から先端へ）を n 枚、放射状に
  function rosette(g, x, y, R, n, rot, fill, stroke, lw, w) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    for (let i = 0; i < n; i++) {
      g.save();
      g.rotate((i / n) * Math.PI * 2);
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(R * 0.3, -R * w, R * 0.78, -R * w * 0.62, R, 0);
      g.bezierCurveTo(R * 0.78, R * w * 0.62, R * 0.3, R * w, 0, 0);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
      g.restore();
    }
    g.restore();
  }

  function diamond(g, x, y, r, fill) {
    g.beginPath();
    g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }

  /** カジノの絨毯（ホームなどの背景）：ワインレッドの地に、金の菱形の格子と花のメダリオン。上下左右につながる */
  function carpet() {
    const T = 132, PX = 2; // 高精細の画面でもにじまないように2倍で描く
    const c = canvas(T * PX, T * PX);
    const g = c.getContext('2d');
    g.scale(PX, PX);
    const GOLD = '#c9a052', GOLD2 = 'rgba(232,203,132,0.9)';
    const corners = [[0, 0], [T, 0], [0, T], [T, T]];
    g.fillStyle = '#4d0f1d';
    g.fillRect(0, 0, T, T);
    // 角のまわりの菱形は少し濃い色
    for (const [x, y] of corners) diamond(g, x, y, T / 2, '#3a0a16');
    // 菱形の格子（2本線）
    g.strokeStyle = GOLD;
    for (const [k, lw] of [[0.5, 1.4], [0.43, 0.7]]) {
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(T / 2, T / 2 - T * k); g.lineTo(T / 2 + T * k, T / 2); g.lineTo(T / 2, T / 2 + T * k); g.lineTo(T / 2 - T * k, T / 2);
      g.closePath();
      g.stroke();
    }
    // まん中のメダリオン
    rosette(g, T / 2, T / 2, T * 0.34, 8, 0, '#0c3639', GOLD, 1.1, 0.56);
    rosette(g, T / 2, T / 2, T * 0.22, 8, Math.PI / 8, '#621425', GOLD2, 0.9, 0.6);
    rosette(g, T / 2, T / 2, T * 0.1, 4, Math.PI / 4, '#d6b064', null, 0, 0.62);
    g.beginPath();
    g.arc(T / 2, T / 2, T * 0.035, 0, Math.PI * 2);
    g.fillStyle = '#2a0710';
    g.fill();
    // 角の小さな花（4つの角に描いて、つなぎ目なく並ぶように）
    for (const [x, y] of corners) {
      rosette(g, x, y, T * 0.17, 4, Math.PI / 4, '#142344', GOLD, 1, 0.5);
      rosette(g, x, y, T * 0.08, 4, 0, GOLD, null, 0, 0.5);
    }
    // 格子の上の小さな金の粒
    for (const [x, y] of [[T / 4, T / 4], [T * 3 / 4, T / 4], [T / 4, T * 3 / 4], [T * 3 / 4, T * 3 / 4]]) diamond(g, x, y, 2.6, GOLD2);
    // 毛足のざらつき
    const r = rng(5);
    const img = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (r() - 0.5) * 22;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  function apply() {
    try {
      const root = document.documentElement.style;
      root.setProperty('--tex-felt', 'url(' + felt() + ')');
      root.setProperty('--tex-wood', 'url(' + wood() + ')');
      root.setProperty('--tex-leather', 'url(' + leather() + ')');
      root.setProperty('--tex-carpet', 'url(' + carpet() + ')');
    } catch (e) { /* 素材が作れなくても単色で表示できる */ }
  }

  D.Textures = { apply };
})();
