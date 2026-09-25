/* 大富豪 — カードの絵柄・ロボットのアバター・アイコン（すべてSVGで描画） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const C = D.Cards;

  const INK = { red: '#b3141f', black: '#16171b' };
  const GOLD = '#c9a032', GOLD_DARK = '#7a5a14', GOLD_LIGHT = '#e9c46a';
  const COURT_BLUE = '#1d3f8f';

  // 100×100 の枠に描いたマーク
  const SUIT_SHAPE = {
    H: '<path d="M50 92C44 84 8 60 8 33 8 17 20 7 33 7c9 0 15 6 17 13 2-7 8-13 17-13 13 0 25 10 25 26 0 27-36 51-42 59z"/>',
    D: '<path d="M50 4c8 16 22 34 38 46-16 12-30 30-38 46-8-16-22-34-38-46C28 38 42 20 50 4z"/>',
    S: '<path d="M50 5S10 38 10 60c0 15 12 23 24 23 7 0 12-3 14-7-1 8-5 15-12 19h28c-7-4-11-11-12-19 2 4 7 7 14 7 12 0 24-8 24-23C90 38 50 5 50 5z"/>',
    C: '<circle cx="50" cy="29" r="19"/><circle cx="28.5" cy="58" r="19"/><circle cx="71.5" cy="58" r="19"/><circle cx="50" cy="52" r="11"/><path d="M46 58c0 18-4 29-12 37h32c-8-8-12-19-12-37z"/>',
  };

  const inkOf = (suit) => (C.RED[suit] ? INK.red : INK.black);

  function pip(suit, cx, cy, size, flip) {
    const s = size / 100;
    const t = (flip ? 'rotate(180 ' + cx + ' ' + cy + ') ' : '') + 'translate(' + (cx - size / 2) + ' ' + (cy - size / 2) + ') scale(' + s + ')';
    return '<g transform="' + t + '">' + SUIT_SHAPE[suit] + '</g>';
  }

  function suitIcon(suit, size, color) {
    const col = color || inkOf(suit);
    return '<svg class="suit-ic" viewBox="0 0 100 100" width="' + size + '" height="' + size + '" fill="' + col + '" aria-hidden="true">' + SUIT_SHAPE[suit] + '</svg>';
  }

  // 共有の定義（グラデーション・模様）。ドキュメントに1回だけ置く
  const SHARED_DEFS =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>' +
    '<linearGradient id="dfg-face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf7"/><stop offset="1" stop-color="#f3eee1"/></linearGradient>' +
    '<linearGradient id="dfg-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d77e"/><stop offset=".55" stop-color="#d4a53a"/><stop offset="1" stop-color="#a47a1c"/></linearGradient>' +
    '<pattern id="dfg-hatch-r" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 4h8" stroke="#b3141f" stroke-opacity=".09" stroke-width="3"/></pattern>' +
    '<pattern id="dfg-hatch-b" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 4h8" stroke="#1d3f8f" stroke-opacity=".09" stroke-width="3"/></pattern>' +
    '</defs></svg>';

  const FONT_IDX = "'Playfair Display','Libre Baskerville',Georgia,'Times New Roman',serif";

  function corners(c, col) {
    const lab = C.RANK_LABEL[c.rank];
    const ten = lab === '10';
    const one =
      '<text x="' + (ten ? 22 : 21) + '" y="44" text-anchor="middle" font-family="' + FONT_IDX + '" font-weight="700" font-size="' +
      (ten ? 31 : 37) + '" letter-spacing="' + (ten ? -3 : 0) + '">' + lab + '</text>' + pip(c.suit, 21, 63, 21);
    return '<g>' + one + '</g><g transform="rotate(180 100 140)">' + one + '</g>';
  }

  const PIPS = (() => {
    const L = 64, M = 100, R = 136;
    const four = [[L, 52], [R, 52], [L, 111], [R, 111], [L, 169], [R, 169], [L, 228], [R, 228]];
    return {
      2: [[M, 52], [M, 228]],
      3: [[M, 52], [M, 140], [M, 228]],
      4: [[L, 52], [R, 52], [L, 228], [R, 228]],
      5: [[L, 52], [R, 52], [M, 140], [L, 228], [R, 228]],
      6: [[L, 52], [R, 52], [L, 140], [R, 140], [L, 228], [R, 228]],
      7: [[L, 52], [R, 52], [M, 96], [L, 140], [R, 140], [L, 228], [R, 228]],
      8: [[L, 52], [R, 52], [M, 96], [L, 140], [R, 140], [M, 184], [L, 228], [R, 228]],
      9: four.concat([[M, 140]]),
      10: four.concat([[M, 81], [M, 199]]),
    };
  })();

  function pips(c) {
    const n = c.rank === 15 ? 2 : c.rank;
    return PIPS[n].map(([x, y]) => pip(c.suit, x, y, 34, y > 140)).join('');
  }

  function ace(c) {
    if (c.suit === 'S') {
      return '<circle cx="100" cy="140" r="64" fill="none" stroke="' + GOLD + '" stroke-width="1.6"/>' +
        '<circle cx="100" cy="140" r="58" fill="none" stroke="' + GOLD + '" stroke-opacity=".55" stroke-width=".8"/>' +
        pip('S', 100, 138, 92) +
        '<path d="M40 140h8M152 140h8M100 72v6M100 202v6" stroke="' + GOLD + '" stroke-width="1.6"/>';
    }
    return pip(c.suit, 100, 140, 78);
  }

  function crown(rank) {
    const g = 'fill="url(#dfg-gold)" stroke="' + GOLD_DARK + '" stroke-width=".9" stroke-linejoin="round"';
    if (rank === 13) {
      return '<path ' + g + ' d="M74 78V56l10 10 8-17 8 13 8-13 8 17 10-10v22z"/>' +
        '<rect ' + g + ' x="72" y="76" width="56" height="7" rx="1.5"/>' +
        '<circle cx="74" cy="55" r="3" fill="' + INK.red + '"/><circle cx="92" cy="48" r="3" fill="' + COURT_BLUE + '"/>' +
        '<circle cx="108" cy="48" r="3" fill="' + COURT_BLUE + '"/><circle cx="126" cy="55" r="3" fill="' + INK.red + '"/>' +
        '<circle cx="100" cy="61" r="3.4" fill="' + INK.red + '"/>';
    }
    if (rank === 12) {
      return '<path ' + g + ' d="M73 80c6-8 16-12 27-12s21 4 27 12l-3 5c-6-6-14-9-24-9s-18 3-24 9z"/>' +
        '<path ' + g + ' d="M82 72l-2-12 8 6zM118 72l2-12-8 6zM100 67l-6-16h12z"/>' +
        '<circle cx="80" cy="58" r="3.4" ' + g + '/><circle cx="120" cy="58" r="3.4" ' + g + '/>' +
        '<circle cx="100" cy="48" r="4.2" fill="' + INK.red + '" stroke="' + GOLD_DARK + '" stroke-width=".8"/>';
    }
    return '<path fill="' + COURT_BLUE + '" stroke="' + GOLD_DARK + '" stroke-width=".9" d="M72 80c1-13 12-21 28-21 15 0 25 7 28 19z"/>' +
      '<path fill="url(#dfg-gold)" stroke="' + GOLD_DARK + '" stroke-width=".8" d="M72 80h56l-1 5H73z"/>' +
      '<path fill="' + INK.red + '" stroke="' + GOLD_DARK + '" stroke-width=".8" d="M116 62c6-10 14-16 24-18-6 6-11 13-14 22-4-2-7-3-10-4z"/>' +
      '<circle cx="100" cy="69" r="3.4" fill="url(#dfg-gold)" stroke="' + GOLD_DARK + '" stroke-width=".7"/>';
  }

  function court(c, col) {
    const letter = C.RANK_LABEL[c.rank];
    const hatch = C.RED[c.suit] ? 'url(#dfg-hatch-r)' : 'url(#dfg-hatch-b)';
    const half =
      crown(c.rank) +
      '<text x="100" y="128" text-anchor="middle" font-family="' + FONT_IDX + '" font-weight="900" font-size="54" fill="' + col + '">' + letter + '</text>' +
      pip(c.suit, 60, 108, 17) + pip(c.suit, 140, 108, 17);
    return '<rect x="37" y="30" width="126" height="220" rx="6" fill="#fbf5e6" stroke="' + col + '" stroke-width="2"/>' +
      '<rect x="37" y="30" width="126" height="220" rx="6" fill="' + hatch + '"/>' +
      '<rect x="42" y="35" width="116" height="210" rx="4" fill="none" stroke="' + GOLD + '" stroke-width=".9"/>' +
      '<path d="M46 140h46M108 140h46" stroke="' + GOLD + '" stroke-width="1.1"/>' +
      '<path d="M100 133l7 7-7 7-7-7z" fill="url(#dfg-gold)" stroke="' + GOLD_DARK + '" stroke-width=".7"/>' +
      '<g>' + half + '</g><g transform="rotate(180 100 140)">' + half + '</g>';
  }

  function joker(id) {
    const color = id === 'X1';
    const c1 = color ? INK.red : '#2b2c31', c2 = color ? COURT_BLUE : '#5b5d66', c3 = color ? '#d4a53a' : '#9a9ca4';
    const letters = 'JOKER'.split('').map((ch, i) =>
      '<text x="21" y="' + (34 + i * 19) + '" text-anchor="middle" font-family="' + FONT_IDX + '" font-weight="700" font-size="18">' + ch + '</text>').join('');
    const corner = '<g fill="' + (color ? INK.red : INK.black) + '">' + letters + '</g>';
    return corner + '<g transform="rotate(180 100 140)">' + corner + '</g>' +
      '<g stroke="#1b1b1f" stroke-width="1.2" stroke-linejoin="round">' +
      '<path fill="' + c1 + '" d="M60 172c2-30 4-52-20-72 30 4 46 26 50 56z"/>' +
      '<path fill="' + c2 + '" d="M88 158c2-36 6-62 12-92 6 30 10 56 12 92z"/>' +
      '<path fill="' + c3 + '" d="M110 156c4-30 20-52 50-56-24 20-22 42-20 72z"/>' +
      '<circle cx="40" cy="98" r="8" fill="url(#dfg-gold)"/><circle cx="100" cy="64" r="8" fill="url(#dfg-gold)"/><circle cx="160" cy="98" r="8" fill="url(#dfg-gold)"/>' +
      '<path fill="#1b1b1f" d="M54 168c30 12 62 12 92 0v18c-30 12-62 12-92 0z"/>' +
      '</g>' +
      '<path d="M66 182l6-5 6 5-6 5zM94 186l6-5 6 5-6 5zM122 182l6-5 6 5-6 5z" fill="url(#dfg-gold)"/>' +
      '<text x="100" y="228" text-anchor="middle" font-family="' + FONT_IDX + '" font-weight="900" font-size="24" letter-spacing="5" fill="' + (color ? INK.red : INK.black) + '">JOKER</text>';
  }

  const faceCache = {};
  /** カードの表面（インラインSVG文字列） */
  function faceSVG(id) {
    if (faceCache[id]) return faceCache[id];
    const c = C.CARDS[id];
    let body;
    if (c.joker) body = joker(id);
    else {
      const col = inkOf(c.suit);
      let art;
      if (c.rank >= 11 && c.rank <= 13) art = court(c, col);
      else if (c.rank === 14) art = ace(c);
      else art = pips(c);
      body = '<g fill="' + col + '">' + corners(c, col) + art + '</g>';
    }
    const svg = '<svg class="cardsvg" viewBox="0 0 200 280" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<rect x="1" y="1" width="198" height="278" rx="14" fill="url(#dfg-face)" stroke="#c9bda3" stroke-width="1.5"/>' + body + '</svg>';
    faceCache[id] = svg;
    return svg;
  }

  const BACKS = {
    red: { label: '赤', c: ['#8a1a2c', '#56101b'] },
    navy: { label: '紺', c: ['#22366a', '#111c3b'] },
    green: { label: '緑', c: ['#1a5c41', '#0c3424'] },
    black: { label: '黒', c: ['#2d2a2c', '#121012'] },
  };

  /** カードの裏面（CSS背景用のデータURI） */
  function backDataURI(color) {
    const b = (BACKS[color] || BACKS.red).c;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280">' +
      '<defs><pattern id="p" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<path d="M0 7.5h15M7.5 0v15" stroke="#e9c46a" stroke-opacity=".28" stroke-width="1"/>' +
      '<circle cx="7.5" cy="7.5" r="1.7" fill="#e9c46a" fill-opacity=".5"/></pattern>' +
      '<radialGradient id="g" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="' + b[0] + '"/><stop offset="1" stop-color="' + b[1] + '"/></radialGradient></defs>' +
      '<rect x="1" y="1" width="198" height="278" rx="14" fill="#fbf8f0" stroke="#c9bda3" stroke-width="1.5"/>' +
      '<rect x="10" y="10" width="180" height="260" rx="8" fill="url(#g)"/>' +
      '<rect x="10" y="10" width="180" height="260" rx="8" fill="url(#p)"/>' +
      '<rect x="16" y="16" width="168" height="248" rx="5" fill="none" stroke="#e9c46a" stroke-opacity=".75" stroke-width="1.3"/>' +
      '<circle cx="100" cy="140" r="40" fill="' + b[1] + '" stroke="#e9c46a" stroke-width="2.2"/>' +
      '<circle cx="100" cy="140" r="33" fill="none" stroke="#e9c46a" stroke-opacity=".55" stroke-width="1"/>' +
      '<path fill="#e9c46a" d="M78 152v-22l9 9 7-15 6 11 6-11 7 15 9-9v22z"/><rect x="77" y="152" width="46" height="6" rx="1.5" fill="#e9c46a"/>' +
      '</svg>';
    // SVGの属性はダブルクォートなので、url() はシングルクォートで囲む（HTMLのstyle属性に埋め込めるように）
    return "url('data:image/svg+xml," + encodeURIComponent(svg) + "')";
  }

  // ロボットのアバター（AIごとに色と形が違う）
  const ROBOTS = [
    { name: 'ロボ太', body: '#c8793a', dark: '#6f3a14', glow: '#ffd29a' },
    { name: 'メカ子', body: '#2a9d8f', dark: '#134b44', glow: '#9ff3e6' },
    { name: 'ギア丸', body: '#7b5ea7', dark: '#3b2a5c', glow: '#dac8ff' },
    { name: 'ボルト', body: '#4f79a8', dark: '#223a57', glow: '#bfe0ff' },
    { name: 'ネジ美', body: '#c0506a', dark: '#5f1f31', glow: '#ffc4d3' },
  ];

  function robotSVG(i) {
    const r = ROBOTS[i % ROBOTS.length];
    const k = i % ROBOTS.length;
    let antenna, eyes, extra = '';
    if (k === 0) {
      antenna = '<path d="M32 16V8" stroke="' + r.dark + '" stroke-width="2.5"/><circle cx="32" cy="7" r="3.6" fill="' + r.glow + '" stroke="' + r.dark + '" stroke-width="1.5"/>';
      eyes = '<circle cx="25" cy="33" r="4.2" fill="' + r.glow + '"/><circle cx="39" cy="33" r="4.2" fill="' + r.glow + '"/>';
    } else if (k === 1) {
      antenna = '<path d="M24 17l-7-7 1 9zM40 17l7-7-1 9z" fill="' + r.glow + '" stroke="' + r.dark + '" stroke-width="1.4" stroke-linejoin="round"/><circle cx="32" cy="16" r="2.8" fill="' + r.dark + '"/>';
      eyes = '<path d="M21 35q4-6 8 0M35 35q4-6 8 0" stroke="' + r.glow + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
    } else if (k === 2) {
      antenna = '<circle cx="32" cy="11" r="5.5" fill="none" stroke="' + r.dark + '" stroke-width="3" stroke-dasharray="2.6 1.8"/><circle cx="32" cy="11" r="2" fill="' + r.dark + '"/>';
      eyes = '<rect x="20" y="29" width="9" height="7" rx="1.5" fill="' + r.glow + '"/><rect x="35" y="29" width="9" height="7" rx="1.5" fill="' + r.glow + '"/>';
    } else if (k === 3) {
      antenna = '<path d="M34 3l-7 9h5l-3 7 8-10h-5z" fill="' + r.glow + '" stroke="' + r.dark + '" stroke-width="1.3" stroke-linejoin="round"/>';
      eyes = '<rect x="20" y="31" width="10" height="4" rx="2" fill="' + r.glow + '"/><rect x="34" y="31" width="10" height="4" rx="2" fill="' + r.glow + '"/>';
    } else {
      antenna = '<path d="M32 17V9" stroke="' + r.dark + '" stroke-width="3"/><rect x="27" y="5" width="10" height="5" rx="1.5" fill="' + r.glow + '" stroke="' + r.dark + '" stroke-width="1.4"/>';
      eyes = '<circle cx="25" cy="32" r="3.8" fill="' + r.glow + '"/><circle cx="39" cy="32" r="3.8" fill="' + r.glow + '"/>';
      extra = '<circle cx="20" cy="40" r="2.6" fill="#ff8fab" opacity=".85"/><circle cx="44" cy="40" r="2.6" fill="#ff8fab" opacity=".85"/>';
    }
    return '<svg viewBox="0 0 64 64" class="robot" aria-hidden="true">' + antenna +
      '<rect x="6" y="26" width="6" height="14" rx="2" fill="' + r.dark + '"/><rect x="52" y="26" width="6" height="14" rx="2" fill="' + r.dark + '"/>' +
      '<rect x="10" y="16" width="44" height="38" rx="11" fill="' + r.body + '" stroke="' + r.dark + '" stroke-width="2"/>' +
      '<rect x="15" y="23" width="34" height="21" rx="7" fill="' + r.dark + '"/>' + eyes + extra +
      '<rect x="24" y="47" width="16" height="3.4" rx="1.7" fill="' + r.dark + '" opacity=".75"/>' +
      '<path d="M16 19q6-3 12-1" stroke="#fff" stroke-opacity=".35" stroke-width="2" fill="none" stroke-linecap="round"/>' +
      '</svg>';
  }

  // オンライン対戦の相手（人）。席ごとに色を変える
  const PERSON_COLORS = ['#e9c46a', '#8ecae6', '#f4a3b5', '#a7d98b', '#c9b3ff', '#f6bd7c'];
  function personSVG(i) {
    const c = PERSON_COLORS[i % PERSON_COLORS.length];
    return '<svg viewBox="0 0 64 64" class="person" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="30" fill="#1d1a16"/>' +
      '<circle cx="32" cy="25" r="10.5" fill="' + c + '"/>' +
      '<path d="M12.5 54c3-11.5 11.2-17.5 19.5-17.5S48.5 42.5 51.5 54" fill="' + c + '"/>' +
      '</svg>';
  }

  function humanSVG() {
    return '<svg viewBox="0 0 64 64" class="human" aria-hidden="true">' +
      '<circle cx="32" cy="32" r="30" fill="#1b2a22"/>' +
      '<circle cx="32" cy="25" r="10" fill="#e9c46a"/>' +
      '<path d="M13 54c3-11 11-17 19-17s16 6 19 17" fill="#e9c46a"/>' +
      '</svg>';
  }

  // アイコン（線画）
  const ICON_PATHS = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    soundOn: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 010 6M18.5 6.5a7.5 7.5 0 010 11"/>',
    soundOff: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>',
    log: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    hint: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
    rules: '<path d="M5 4h11l3 3v13H5z"/><path d="M9 10h7M9 14h7M9 18h4"/>',
    cw: '<path d="M20 12a8 8 0 11-2.3-5.7"/><path d="M20 4v5h-5"/>',
    ccw: '<path d="M4 12a8 8 0 102.3-5.7"/><path d="M4 4v5h5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    crown: '<path d="M3 18h18l-2-10-5 4-2-6-2 6-5-4z"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    restart: '<path d="M4 12a8 8 0 108-8"/><path d="M4 4v5h5"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-6h4v6"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
  };
  function icon(name, size) {
    const s = size || 20;
    return '<svg class="ic" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICON_PATHS[name] || '') + '</svg>';
  }

  D.Art = { faceSVG, backDataURI, BACKS, SHARED_DEFS, robotSVG, humanSVG, personSVG, ROBOTS, icon, suitIcon, pip, SUIT_SHAPE, INK };
})();
