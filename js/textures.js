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

  // ─────────────────────────────────────────────
  // ヨーロッパ調のヴィンテージの額縁（CSS の border-image で使う SVG）
  //   9つに切り分けて伸ばすので、角の飾りは「切り分け（slice）」の内側に収め、辺はまっすぐな線だけにする
  // ─────────────────────────────────────────────
  const GOLD_LINE = 'rgb(214,176,96)';

  function svgURL(w, h, body, defs) {
    const s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      (defs ? '<defs>' + defs + '</defs>' : '') + body + '</svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")';
  }
  const n2 = (v) => +v.toFixed(2);

  /** 角を内側に丸くえぐった形（ヴィンテージのラベル）。r：えぐる半径、d：外からの距離（えぐりの中心は外の角のまま） */
  function notched(w, h, r, d) {
    const R = r + d, e = Math.sqrt(R * R - d * d);
    const A = 'A' + n2(R) + ' ' + n2(R) + ' 0 0 0 ';
    return 'M' + n2(e) + ' ' + n2(d) + 'H' + n2(w - e) + A + n2(w - d) + ' ' + n2(e) + 'V' + n2(h - e) + A + n2(w - e) + ' ' + n2(h - d) +
      'H' + n2(e) + A + n2(d) + ' ' + n2(h - e) + 'V' + n2(e) + A + n2(e) + ' ' + n2(d) + 'Z';
  }

  /** 4つの角に同じ飾りを置く（左上に描いたものを鏡に映す） */
  function atCorners(w, h, g) {
    return [[1, 1, 0, 0], [-1, 1, w, 0], [1, -1, 0, h], [-1, -1, w, h]]
      .map(([sx, sy, tx, ty]) => '<g transform="translate(' + tx + ' ' + ty + ') scale(' + sx + ' ' + sy + ')">' + g + '</g>').join('');
  }
  const svgDiamond = (x, y, r, fill) => '<path d="M' + x + ' ' + n2(y - r) + 'L' + n2(x + r) + ' ' + y + 'L' + x + ' ' + n2(y + r) + 'L' + n2(x - r) + ' ' + y + 'Z" fill="' + fill + '"/>';

  /** 金の板のボタン（96×48、切り分け16） */
  function frameGold() {
    const W = 96, H = 48, r = 9;
    const defs = '<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgb(251,234,180)"/><stop offset=".45" stop-color="rgb(226,189,102)"/>' +
      '<stop offset=".6" stop-color="rgb(196,152,62)"/><stop offset="1" stop-color="rgb(166,125,46)"/></linearGradient>';
    return svgURL(W, H,
      '<path d="' + notched(W, H, r, 0.6) + '" fill="url(#g)" stroke="rgb(94,68,18)" stroke-width="1.2"/>' +
      '<path d="' + notched(W, H, r, 4.2) + '" fill="none" stroke="rgb(107,76,18)" stroke-opacity=".6" stroke-width="1"/>' +
      '<path d="' + notched(W, H, r, 5.3) + '" fill="none" stroke="rgb(255,246,214)" stroke-opacity=".5" stroke-width=".8"/>', defs);
  }

  /** 黒檀の板に金の二重線のボタン */
  function frameDark() {
    const W = 96, H = 48, r = 9;
    return svgURL(W, H,
      '<path d="' + notched(W, H, r, 0.6) + '" fill="rgb(18,7,10)" fill-opacity=".8" stroke="' + GOLD_LINE + '" stroke-width="1.3"/>' +
      '<path d="' + notched(W, H, r, 4.4) + '" fill="none" stroke="' + GOLD_LINE + '" stroke-opacity=".5" stroke-width=".9"/>');
  }

  /** 板・タイルの額縁：金の二重線と、角の飾り石（48×48、切り分け16） */
  function framePanel() {
    const W = 48, H = 48;
    const corner = '<rect x=".8" y=".8" width="8.6" height="8.6" fill="rgb(24,9,13)" stroke="' + GOLD_LINE + '" stroke-width="1.1"/>' + svgDiamond(5.1, 5.1, 2.4, GOLD_LINE);
    return svgURL(W, H,
      '<rect x=".8" y=".8" width="' + (W - 1.6) + '" height="' + (H - 1.6) + '" fill="none" stroke="' + GOLD_LINE + '" stroke-width="1.4"/>' +
      '<rect x="4.6" y="4.6" width="' + (W - 9.2) + '" height="' + (H - 9.2) + '" fill="none" stroke="' + GOLD_LINE + '" stroke-opacity=".5" stroke-width=".8"/>' +
      atCorners(W, H, corner));
  }

  /** 見出し・ダイアログの大きな額縁：角に唐草の飾り（96×96、切り分け32） */
  function frameOrnate() {
    const W = 96, H = 96;
    const corner =
      '<path d="M6.5 27A20.5 20.5 0 0 0 27 6.5" fill="none" stroke="' + GOLD_LINE + '" stroke-width="1.2"/>' +
      '<path d="M6.5 20.5C12 20.5 14.5 17 14.5 14.5C17 14.5 20.5 12 20.5 6.5" fill="none" stroke="' + GOLD_LINE + '" stroke-opacity=".75" stroke-width=".9"/>' +
      svgDiamond(10.5, 10.5, 3.2, GOLD_LINE) +
      '<circle cx="6.5" cy="30.5" r="1.4" fill="' + GOLD_LINE + '"/><circle cx="30.5" cy="6.5" r="1.4" fill="' + GOLD_LINE + '"/>';
    return svgURL(W, H,
      '<rect x="1.2" y="1.2" width="' + (W - 2.4) + '" height="' + (H - 2.4) + '" fill="none" stroke="' + GOLD_LINE + '" stroke-width="2.2"/>' +
      '<rect x="6.5" y="6.5" width="' + (W - 13) + '" height="' + (H - 13) + '" fill="none" stroke="' + GOLD_LINE + '" stroke-opacity=".55" stroke-width=".9"/>' +
      atCorners(W, H, corner));
  }

  function applyFrames() {
    const root = document.documentElement.style;
    root.setProperty('--fr-gold', frameGold());
    root.setProperty('--fr-dark', frameDark());
    root.setProperty('--fr-panel', framePanel());
    root.setProperty('--fr-orn', frameOrnate());
  }

  function apply() {
    try { applyFrames(); } catch (e) { /* 額縁が作れなくても、ふつうの枠で表示できる */ }
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
