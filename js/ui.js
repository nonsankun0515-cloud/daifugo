/* 大富豪 — テーブルの描画と演出（エンジンのイベントを順番に再生する） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const E = D.Engine, C = D.Cards, A = D.Art, SND = D.Sound;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const TITLE_CLASS = { 大富豪: 't-0', 富豪: 't-1', 平民: 't-2', 貧民: 't-3', 大貧民: 't-4' };

  const UI = {
    S: null,
    human: 0,
    seatInfo: null, // オンライン対戦のときだけ：[{ name, type: 'human'|'ai', robot, connected }]
    vm: null,
    speed: 1,
    backURI: '',
    showPlayable: true,
    sel: new Set(),
    selectable: false,
    selMax: 0,
    dimSet: null,
    hintSet: null,
    onSelChange: null,
    handEls: new Map(),
    seatEls: {},
  };

  // ─────────────────────────────────────────────
  // ビューモデル（アニメーション中に少しずつ更新し、最後にエンジンの状態と合わせる）
  // ─────────────────────────────────────────────
  function vmFromState(S) {
    return {
      pile: S.pile.map((e) => ({ seat: e.seat, cards: e.shown.slice(), stop: e.stop, key: e.seat + ':' + e.play.cards.join('') })),
      hands: S.players.map((p) => p.hand.slice()),
      out: S.players.map((p) => p.out),
      foul: S.players.map((p) => p.foul),
      places: placesOf(S),
      rev: S.revolution,
      jback: S.jback,
      lock: { suits: S.lock.suits && S.lock.suits.slice(), partial: S.lock.partial && S.lock.partial.slice(), number: S.lock.number },
      constraint: S.constraint && Object.assign({}, S.constraint),
      dir: S.dir,
      turn: S.phase === 'play' && !S.pending ? S.turn : null,
    };
  }
  function placesOf(S) {
    const pl = S.players.map(() => null);
    S.finished.forEach((s, i) => { pl[s] = i + 1; });
    return pl;
  }
  function syncVM() { UI.vm = vmFromState(UI.S); }

  // ─────────────────────────────────────────────
  // 部品
  // ─────────────────────────────────────────────
  function makeCardEl(id, extra) {
    const el = document.createElement('div');
    el.className = 'card' + (extra ? ' ' + extra : '');
    el.dataset.id = id;
    el.innerHTML = A.faceSVG(id);
    el.setAttribute('aria-label', C.cardLabel(id));
    return el;
  }
  function makeBackEl(extra) {
    const el = document.createElement('div');
    el.className = 'card back' + (extra ? ' ' + extra : '');
    el.style.backgroundImage = UI.backURI;
    return el;
  }
  let probe = null;
  function cardSize(kind) {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:-999px;top:0';
      probe.innerHTML = '<div class="card" style="position:static"></div><div class="pile-entry"><div class="card" style="position:static"></div></div>';
      document.body.appendChild(probe);
    }
    const el = kind === 'pile' ? probe.children[1].firstChild : probe.firstChild;
    return { w: el.offsetWidth || 60, h: el.offsetHeight || 84 };
  }
  function titleIdx(seat) {
    const S = UI.S;
    if (!S.prevRanking || S.gameNo < 2 && S.phase !== 'over') return -1;
    return S.prevRanking.indexOf(seat);
  }
  function titleOfSeat(seat) {
    const S = UI.S;
    // 対局中は前のゲームの身分、終了後は今回の身分
    const i = titleIdx(seat);
    return i < 0 ? '' : E.titleOf(S.n, i);
  }
  function titleChip(seat) {
    const t = titleOfSeat(seat);
    return t ? '<span class="title-chip ' + TITLE_CLASS[t] + '">' + t + '</span>' : '';
  }
  const nameOf = (seat) => (seat === UI.human ? 'あなた' : UI.S.players[seat].name);
  /** 得点の表示（+3・−1・0） */
  function fmtPts(v) { return v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0'; }
  const ptsClass = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');
  /** 試合の総得点（1ゲーム目が終わるまでは出さない） */
  function scoreTag(seat) {
    const S = UI.S;
    if (!S.history || !S.history.length) return '';
    const v = S.players[seat].score;
    return '<span class="sc ' + ptsClass(v) + '" title="総得点">' + fmtPts(v) + '</span>';
  }

  // ─────────────────────────────────────────────
  // 席の配置
  // ─────────────────────────────────────────────
  /** 相手の席の位置（テーブル内のpx）。上のボタン列と重ならず、場のカードとも重ならないようにする */
  function seatPositions(n, w, h, half, ph) {
    const k = n - 1;
    const narrow = w / h < 1.05;
    const top = 54 + half;
    const pos = [];
    for (let i = 0; i < k; i++) {
      if (narrow) {
        const fx = k === 1 ? 0.5 : 0.13 + (0.74 * i) / (k - 1);
        const edge = Math.abs(fx - 0.5) / 0.37;
        pos.push([fx * w, top + edge * Math.min(30, h * 0.06)]);
      } else {
        const th = Math.PI - (Math.PI * (i + 0.5)) / k;
        const cy = Math.max(top + 40, h * 0.6);
        const ry = cy - top;
        pos.push([w / 2 + w * 0.41 * Math.cos(th), cy - ry * Math.sin(th)]);
      }
    }
    const pileY = Math.max(top + half + 10 + (ph + 30) / 2, h * (narrow ? 0.6 : 0.58));
    return { pos, narrow, pileY };
  }

  // フェルトに印刷する金文字：有効なローカルルール（カジノのテーブルの注意書きのように）
  const PRINT_RULES = ['revolution', 'eightCut', 'sandstorm', 'spade3', 'queenBomber', 'jBack', 'sevenPass', 'tenDiscard', 'fiveSkip', 'kingSkip',
    'rokurokubi', 'fourStop', 'threeStop', 'sixNine', 'aceTake', 'gekiLock', 'suitLock', 'numberLock', 'miyakoOchi', 'gekokujo', 'tenpen',
    'kyukyusha', 'coup', 'omen', 'greatRevolution', 'nineReverse', 'nineBack', 'twoBack', 'luckySeven', 'downNumber', 'partialLock'];
  let printKey = '';

  function ellipsePerimeter(a, b) { return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))); }

  function renderFeltPrint(w, h, cy, pw, ph, narrow) {
    const host = $('felt-print');
    const S = UI.S;
    if (!host || !S || w < 60 || h < 60) return; // 卓が隠れていて大きさが0のときは描かない（楕円の半径が負になる）
    const key = [w, h, cy, pw, narrow, RULE_KEYS.map((k) => S.rules[k]).join('')].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join('|');
    if (key === printKey) return;
    printKey = key;
    const cx = w / 2;
    const fs = Math.max(10, Math.min(17, w / 58));
    const ry = Math.min(Math.max(ph * 0.95, Math.min(h * 0.27, 190)), Math.max(ph * 0.62, h - cy - 6));
    const rx = Math.min(w * (narrow ? 0.44 : 0.34), Math.max(ry * 1.9, pw * 2.6));
    const f = (v) => v.toFixed(1);
    let s = '<svg width="' + f(w) + '" height="' + f(h) + '" viewBox="0 0 ' + f(w) + ' ' + f(h) + '" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<defs><linearGradient id="dfg-foil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e4a6"/><stop offset="1" stop-color="#b78a30"/></linearGradient></defs>';
    // 二重の楕円
    s += '<ellipse cx="' + f(cx) + '" cy="' + f(cy) + '" rx="' + f(rx) + '" ry="' + f(ry) + '" fill="none" stroke="rgba(228,188,98,.34)" stroke-width="1.6"/>';
    s += '<ellipse cx="' + f(cx) + '" cy="' + f(cy) + '" rx="' + f(Math.max(0, rx - 7)) + '" ry="' + f(Math.max(0, ry - 7)) + '" fill="none" stroke="rgba(228,188,98,.17)" stroke-width="1"/>';
    // カード置き場
    const sw = pw * 1.14, sh = ph * 1.1;
    s += '<rect x="' + f(cx - sw / 2) + '" y="' + f(cy - sh / 2) + '" width="' + f(sw) + '" height="' + f(sh) + '" rx="' + f(pw * 0.1) + '" fill="rgba(0,0,0,.1)" stroke="rgba(228,188,98,.38)" stroke-width="1.3"/>';
    s += '<rect x="' + f(cx - sw / 2 + 4) + '" y="' + f(cy - sh / 2 + 4) + '" width="' + f(sw - 8) + '" height="' + f(sh - 8) + '" rx="' + f(pw * 0.08) + '" fill="none" stroke="rgba(228,188,98,.2)" stroke-width="1"/>';
    // 楕円の左右にマーク
    const mk = fs * 1.05;
    s += '<g fill="url(#dfg-foil)" opacity=".5">' +
      A.pip('S', cx - rx, cy - mk * 0.62, mk) + A.pip('H', cx - rx, cy + mk * 0.62, mk) +
      A.pip('D', cx + rx, cy - mk * 0.62, mk) + A.pip('C', cx + rx, cy + mk * 0.62, mk) + '</g>';
    // 有効なローカルルール名を金文字で印刷（席の下に隠れない場所に）
    const names = PRINT_RULES.filter((k) => S.rules[k]).map((k) => D.Rules.BY_KEY[k].label);
    const font = 'font-family="\'Shippori Mincho B1\',\'Hiragino Mincho ProN\',\'Yu Mincho\',serif" font-weight="700"';
    const charW = fs * 1.08;
    const lobeW = rx - sw / 2 - fs * 2.2;
    let bottomUsed = cy + ry;
    if (names.length && lobeW >= 110) {
      // 楕円の左右のふくらみに、中央ぞろえの数行
      const perLine = Math.max(3, Math.floor(lobeW / charW));
      const lines = [];
      let cur = '';
      for (const nm of names) {
        const next = cur ? cur + '・' + nm : nm;
        if (next.length > perLine && cur) { lines.push(cur); cur = nm; } else cur = next;
        if (lines.length >= 6) break;
      }
      if (cur && lines.length < 6) lines.push(cur);
      const half = Math.ceil(lines.length / 2);
      const maxLines = Math.max(1, Math.floor(ry / (fs * 1.6)));
      [lines.slice(0, Math.min(half, maxLines)), lines.slice(half, half + maxLines)].forEach((group, side) => {
        if (!group.length) return;
        const lx = cx + (side ? 1 : -1) * (sw / 2 + fs * 1.1 + lobeW / 2);
        const y0 = cy - ((group.length - 1) * fs * 1.6) / 2 + fs * 0.35;
        group.forEach((ln, i) => {
          s += '<text x="' + f(lx) + '" y="' + f(y0 + i * fs * 1.6) + '" text-anchor="middle" ' + font + ' font-size="' + f(fs) + '" letter-spacing="' + f(fs * 0.08) +
            '" fill="url(#dfg-foil)" opacity=".5">' + esc(ln) + '</text>';
        });
      });
    } else if (names.length) {
      // 狭い画面：楕円の下の弧に沿って
      const ax = rx + fs * 0.9, ay = ry + fs * 1.3;
      if (cy + ay + fs * 0.4 < h - 2) {
        const t1 = (208 * Math.PI) / 180, t2 = (332 * Math.PI) / 180;
        const arcLen = ellipsePerimeter(ax, ay) * (124 / 360);
        let text = '';
        for (const nm of names) {
          const next = text ? text + ' ◆ ' + nm : nm;
          if (next.length * charW > arcLen * 0.95) break;
          text = next;
        }
        s += '<path id="dfg-arc" d="M' + f(cx + ax * Math.cos(t1)) + ' ' + f(cy - ay * Math.sin(t1)) + ' A' + f(ax) + ' ' + f(ay) + ' 0 0 0 ' +
          f(cx + ax * Math.cos(t2)) + ' ' + f(cy - ay * Math.sin(t2)) + '" fill="none"/>' +
          '<text ' + font + ' font-size="' + f(fs) + '" letter-spacing="' + f(fs * 0.08) + '" fill="url(#dfg-foil)" opacity=".5">' +
          '<textPath href="#dfg-arc" xlink:href="#dfg-arc" startOffset="50%" text-anchor="middle">' + esc(text) + '</textPath></text>';
        bottomUsed = cy + ay + fs * 0.4;
      }
    }
    // 下にロゴ
    const lf = fs * 1.9;
    const ly = bottomUsed + lf * 1.3;
    if (ly + 4 < h) {
      s += '<text x="' + f(cx + lf * 0.45) + '" y="' + f(ly) + '" text-anchor="middle" font-family="\'Shippori Mincho B1\',\'Hiragino Mincho ProN\',\'Yu Mincho\',serif" font-weight="800" font-size="' +
        f(lf) + '" letter-spacing="' + f(lf * 0.9) + '" fill="url(#dfg-foil)" opacity=".36">大富豪</text>';
    }
    host.innerHTML = s + '</svg>';
  }
  const RULE_KEYS = D.Rules.RULES.map((r) => r.key);

  function renderSeats() {
    const S = UI.S, vm = UI.vm;
    if (!S || !vm) return;
    const box = $('seats');
    const rect = $('table').getBoundingClientRect();
    const w = rect.width || 1, h = rect.height || 1;
    const alive = new Set();
    const order = [];
    for (let i = 1; i < S.n; i++) {
      const seat = (UI.human + i) % S.n;
      alive.add(String(seat));
      let el = UI.seatEls[seat];
      if (!el) {
        el = document.createElement('div');
        el.className = 'seat';
        el.dataset.seat = seat;
        el.innerHTML = '<div class="ava"><span class="face"></span><div class="think"><i></i><i></i><i></i></div></div>' +
          '<div class="info"><div class="plate"><span class="nmrow"><span class="name"></span><span class="scw"></span></span><span class="cnt"></span></div><div class="fan"></div></div>';
        box.appendChild(el);
        UI.seatEls[seat] = el;
      }
      // オンライン対戦では人の席は人のアイコン、AIはロボット
      const info = UI.seatInfo && UI.seatInfo[seat];
      const kind = info && info.type === 'human' ? 'human' : 'ai:' + (info ? info.robot : seat - 1);
      if (el.dataset.kind !== kind) {
        el.dataset.kind = kind;
        el.querySelector('.face').innerHTML = kind === 'human' ? A.personSVG(seat) : A.robotSVG(info ? info.robot : seat - 1);
      }
      el.classList.toggle('away', !!(info && info.type === 'human' && !info.connected));
      order.push(el);
      const P = S.players[seat];
      const count = vm.hands[seat].length;
      el.querySelector('.name').textContent = P.name;
      el.querySelector('.scw').innerHTML = scoreTag(seat);
      const cnt = el.querySelector('.cnt');
      const tc = titleChip(seat);
      cnt.innerHTML = (vm.out[seat] ? '' : '<span class="mini" style="background-image:' + UI.backURI + '"></span>' + count) + (tc ? ' ' + tc : '');
      const fan = el.querySelector('.fan');
      const show = vm.out[seat] ? 0 : Math.min(count, 9);
      if (fan.childElementCount !== show || fan.dataset.back !== UI.backURI.length + '') {
        fan.dataset.back = UI.backURI.length + '';
        let html = '';
        for (let j = 0; j < show; j++) {
          const t = j - (show - 1) / 2;
          html += '<i style="background-image:' + UI.backURI + ';transform:translateX(calc(-50% + ' + (t * 5) + 'px)) rotate(' + (t * 8) + 'deg)"></i>';
        }
        fan.innerHTML = html;
      }
      el.classList.toggle('turn', vm.turn === seat);
      el.classList.toggle('out', !!vm.out[seat]);
      let medal = el.querySelector('.medal');
      const place = vm.places[seat];
      if (vm.out[seat]) {
        if (!medal) { medal = document.createElement('div'); el.querySelector('.ava').appendChild(medal); }
        medal.className = 'medal' + (vm.foul[seat] ? ' foul' : '');
        medal.textContent = vm.foul[seat] ? '反則' : place ? place : '落';
      } else if (medal) medal.remove();
    }
    for (const k of Object.keys(UI.seatEls)) {
      if (!alive.has(k)) { UI.seatEls[k].remove(); delete UI.seatEls[k]; }
    }
    // 席の大きさを測ってから配置する
    const half = order.length ? order[0].offsetHeight / 2 : 45;
    const { w: pw, h: ph } = cardSize('pile');
    const { pos, narrow, pileY } = seatPositions(S.n, w, h, half, ph);
    const spacing = narrow && order.length > 1 ? (0.74 * w) / (order.length - 1) : Infinity;
    order.forEach((el, i) => {
      el.style.left = Math.round(pos[i][0]) + 'px';
      el.style.top = Math.round(pos[i][1]) + 'px';
      el.style.width = spacing < 80 ? Math.floor(spacing - 2) + 'px' : '';
    });
    $('table').style.setProperty('--pile-y', Math.round(pileY) + 'px');
    renderFeltPrint(w, h, pileY, pw, ph, narrow);
  }

  function seatAnchor(seat) {
    if (seat === UI.human) {
      const r = $('hand').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    const el = UI.seatEls[seat];
    if (!el) return { x: innerWidth / 2, y: 60 };
    const r = el.querySelector('.ava').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function rectAt(pt, w, h) { return { left: pt.x - w / 2, top: pt.y - h / 2, width: w, height: h }; }

  // ─────────────────────────────────────────────
  // 自分の情報・手札
  // ─────────────────────────────────────────────
  function renderMe() {
    const S = UI.S, vm = UI.vm;
    const me = $('me');
    const myTurn = vm.turn === UI.human;
    me.classList.toggle('turn', myTurn);
    const tc = titleChip(UI.human);
    const status = vm.out[UI.human]
      ? (vm.foul[UI.human] ? '<span class="yourturn">反則上がり</span>'
        : '<span class="yourturn">' + (vm.places[UI.human] || '') + (vm.places[UI.human] === S.n ? '位' : '位で上がり') + '</span>')
      : '';
    $('me-id').innerHTML = '<span class="ava">' + A.humanSVG() + '</span><span class="nm">' + esc(S.players[UI.human].name) + '</span>' + scoreTag(UI.human) + tc + status;
  }

  function renderHand() {
    if (!UI.vm) return;
    const box = $('hand');
    const hand = UI.vm.hands[UI.human];
    const sorted = C.sortHand(hand, UI.vm.rev);
    for (const [id, el] of UI.handEls) {
      if (!hand.includes(id)) { el.remove(); UI.handEls.delete(id); UI.sel.delete(id); }
    }
    const W = box.clientWidth || 320;
    const { w: cw, h: ch } = cardSize('hand');
    const n = sorted.length;
    let rows = 1;
    let step = n > 1 ? Math.min(cw * 0.64, (W - cw) / (n - 1)) : 0;
    if (n > 1 && step < Math.max(20, cw * 0.34)) rows = 2;
    box.classList.toggle('two', rows === 2);
    const perRow = rows === 2 ? Math.ceil(n / 2) : n;
    if (rows === 2) step = perRow > 1 ? Math.min(cw * 0.64, (W - cw) / (perRow - 1)) : 0;
    const fan = rows === 1 && W >= 640;
    box.classList.toggle('locked', !UI.selectable);
    sorted.forEach((id, i) => {
      let el = UI.handEls.get(id);
      if (!el) {
        el = makeCardEl(id);
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', onCardTap);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardTap(e); } });
        box.appendChild(el);
        UI.handEls.set(id, el);
      }
      const row = rows === 2 && i >= perRow ? 1 : 0;
      const j = row ? i - perRow : i;
      const cnt = row ? n - perRow : perRow;
      const rowW = cw + (cnt - 1) * step;
      const x = (W - rowW) / 2 + j * step;
      let y = row * ch * 0.55;
      let rot = 0;
      if (fan) {
        const t = j - (cnt - 1) / 2;
        rot = t * 1.15;
        y += t * t * 0.32;
      }
      const selected = UI.sel.has(id);
      if (selected) y -= 22;
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) rotate(' + rot.toFixed(2) + 'deg)';
      el.style.zIndex = String(i + 1);
      el.classList.toggle('sel', selected);
      el.setAttribute('aria-pressed', selected ? 'true' : 'false');
      el.classList.toggle('dim', !!(UI.dimSet && !UI.dimSet.has(id)));
      el.classList.toggle('hint', !!(UI.hintSet && UI.hintSet.has(id)));
    });
  }

  function onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!UI.selectable) return;
    UI.hintSet = null;
    if (UI.sel.has(id)) UI.sel.delete(id);
    else {
      if (UI.selMax && UI.sel.size >= UI.selMax) {
        if (UI.selMax === 1) UI.sel.clear();
        else { toast(UI.selMax + '枚までえらべます'); SND.play('error'); return; }
      }
      UI.sel.add(id);
    }
    SND.play('select');
    renderHand();
    if (UI.onSelChange) UI.onSelChange();
  }

  // ─────────────────────────────────────────────
  // 場
  // ─────────────────────────────────────────────
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function renderPile(hideTop) {
    const box = $('pile');
    box.innerHTML = '';
    const entries = UI.vm.pile.slice(-3);
    if (!entries.length) { box.innerHTML = '<div class="pile-empty"></div>'; return; }
    const { w: pw, h: ph } = cardSize('pile');
    entries.forEach((e, idx) => {
      const depth = entries.length - 1 - idx;
      const g = document.createElement('div');
      g.className = 'pile-entry' + (depth ? ' old' : ' top');
      const n = e.cards.length;
      const step = pw * (n > 5 ? 0.3 : n > 3 ? 0.38 : 0.46);
      const width = pw + Math.max(0, n - 1) * step;
      const hsh = hashStr(e.key || e.cards.join(''));
      const rot = depth ? ((hsh % 9) - 4) * 2.2 : 0;
      const dx = depth ? (((hsh >> 4) % 13) - 6) * 3 : 0;
      g.style.width = width + 'px';
      g.style.height = ph + 'px';
      g.style.transform = 'translate(calc(-50% + ' + (dx - depth * 10) + 'px), calc(-50% - ' + depth * 9 + 'px)) rotate(' + rot + 'deg) scale(' + (1 - depth * 0.06) + ')';
      g.style.zIndex = String(idx + 1);
      e.cards.forEach((id, j) => {
        const c = makeCardEl(id);
        c.style.left = j * step + 'px';
        g.appendChild(c);
      });
      if (hideTop && depth === 0) g.style.visibility = 'hidden';
      box.appendChild(g);
    });
  }

  function chip(html, cls) { return '<span class="chip ' + (cls || '') + '">' + html + '</span>'; }
  function suitsHTML(suits) { return suits.map((s) => A.suitIcon(s, 12)).join(''); }

  function renderStatus() {
    const vm = UI.vm, S = UI.S;
    const out = [];
    if (vm.rev) out.push(chip(A.icon('crown', 13) + '革命中', 'revo'));
    if (vm.jback) out.push(chip('Jバック中', 'jback'));
    if (vm.lock.suits && vm.lock.number) out.push(chip(A.icon('lock', 12) + suitsHTML(vm.lock.suits) + ' 激縛り', 'lock'));
    else {
      if (vm.lock.suits) out.push(chip(A.icon('lock', 12) + suitsHTML(vm.lock.suits) + ' 縛り', 'lock'));
      if (vm.lock.number) out.push(chip(A.icon('lock', 12) + '階段縛り', 'lock'));
    }
    if (vm.lock.partial) out.push(chip(A.icon('lock', 12) + suitsHTML(vm.lock.partial) + ' 片縛り', 'lock'));
    if (vm.constraint) out.push(chip('次は ' + C.rankLabel(vm.constraint.rank) + ' だけ', 'lock'));
    if (S.rules.nineReverse || vm.dir !== 1) out.push(chip(A.icon(vm.dir === 1 ? 'cw' : 'ccw', 14), 'dir'));
    if (vm.turn !== null && vm.turn !== undefined && S.phase === 'play') {
      out.push(chip(vm.turn === UI.human ? 'あなたの番' : esc(S.players[vm.turn].name) + 'の番', 'turnchip'));
    }
    $('status').innerHTML = out.join('');
    document.querySelector('.game').classList.toggle('is-revo', !!vm.rev);
  }

  function renderHud() {
    const S = UI.S;
    const sub = [];
    if (S.rated) sub.push('<span class="rated-tag">レート戦</span>');
    if (UI.roomCode) sub.push('部屋 ' + esc(UI.roomCode));
    $('g-gameno').innerHTML = '第' + S.gameNo + (S.maxGames ? '<span class="of">/' + S.maxGames + '</span>' : '') + 'ゲーム' +
      (sub.length ? '<small>' + sub.join(' ') + '</small>' : '');
  }

  /** 画面の広さに合わせて、手札と場のカードをできるだけ大きくする */
  function fitCards() {
    const g = $('scr-game');
    if (!g || g.hidden) return;
    const cs = getComputedStyle(g);
    const W = g.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const H = g.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (W <= 0 || H <= 0) return;
    const wideSeats = matchMedia('(min-width: 900px) and (min-height: 560px)').matches;
    const narrow = W / H < 1.05;
    const handW = W - 16;
    let cw;
    if (narrow) {
      // 縦長：手札は2段。自分の欄 ≒ 2.17cw+122、テーブル ≒ 1.4cw+260
      cw = Math.min(handW / 4.1, (H - 382) / 3.57);
    } else {
      // 横長：手札は1段。席の高さ（横並びなら低い）＋場のカード＋状態表示
      const seatH = wideSeats ? 76 : 96;
      const fixed = 126 + 8 + seatH + 10 + 30 + 36 + 26;
      cw = Math.min(handW / 6.4, (H - fixed) / (1.4 + 1.4 * 0.9));
    }
    cw = Math.max(52, Math.min(150, Math.floor(cw)));
    const pw = Math.max(48, narrow ? cw : Math.floor(cw * 0.9));
    const root = document.documentElement.style;
    if (root.getPropertyValue('--cw') !== cw + 'px') root.setProperty('--cw', cw + 'px');
    if (root.getPropertyValue('--pw') !== pw + 'px') root.setProperty('--pw', pw + 'px');
  }

  function renderAll() {
    if (!UI.S || !UI.vm) return;
    fitCards();
    renderHud();
    renderSeats();
    renderPile(false);
    renderStatus();
    renderMe();
    renderHand();
  }

  // ─────────────────────────────────────────────
  // 演出
  // ─────────────────────────────────────────────
  function fly(items, dur) {
    const fx = $('fx');
    const d = Math.max(60, dur * UI.speed);
    return Promise.all(items.map((it) => {
      const el = document.createElement('div');
      el.className = it.back ? 'fly back' : 'fly';
      if (it.back) el.style.backgroundImage = UI.backURI;
      else el.innerHTML = A.faceSVG(it.id);
      el.style.width = it.to.width + 'px';
      el.style.height = it.to.height + 'px';
      el.style.transformOrigin = '50% 50%';
      fx.appendChild(el);
      const s0 = it.from.width / it.to.width;
      const c0x = it.from.left + it.from.width / 2 - it.to.width / 2, c0y = it.from.top + it.from.height / 2 - it.to.height / 2;
      const k0 = 'translate(' + c0x + 'px,' + c0y + 'px) rotate(' + (it.r0 || 0) + 'deg) scale(' + s0 + ')';
      const k1 = 'translate(' + it.to.left + 'px,' + it.to.top + 'px) rotate(' + (it.r1 || 0) + 'deg) scale(' + (it.s1 || 1) + ')';
      const a = el.animate([{ transform: k0, opacity: it.o0 == null ? 1 : it.o0 }, { transform: k1, opacity: it.o1 == null ? 1 : it.o1 }],
        { duration: d, delay: (it.delay || 0) * UI.speed, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'both' });
      return a.finished.catch(() => {}).then(() => el.remove());
    }));
  }

  function banner(text, variant, sub, hold) {
    const b = document.createElement('div');
    b.className = 'banner ' + (variant || '');
    b.innerHTML = '<div class="big">' + esc(text) + '</div>' + (sub ? '<div class="sub">' + esc(sub) + '</div>' : '');
    $('fx').appendChild(b);
    const a = b.animate([
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.45)' },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.16 },
      { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.82 },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(0.97)' },
    ], { duration: (hold || 1150) * UI.speed, easing: 'ease-out', fill: 'both' });
    return a.finished.catch(() => {}).then(() => b.remove());
  }

  function flash(color, dur) {
    const f = document.createElement('div');
    f.className = 'flash';
    f.style.background = color;
    $('fx').appendChild(f);
    return f.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: (dur || 600) * UI.speed, easing: 'ease-out', fill: 'both' })
      .finished.catch(() => {}).then(() => f.remove());
  }

  function shake() {
    const g = $('scr-game');
    g.classList.remove('shake');
    void g.offsetWidth;
    g.classList.add('shake');
    setTimeout(() => g.classList.remove('shake'), 600);
  }

  function sandstorm() {
    const fx = $('fx');
    const n = 46;
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const g = document.createElement('div');
      g.className = 'sand-grain';
      const y = Math.random() * innerHeight;
      const s = 2 + Math.random() * 4;
      g.style.width = g.style.height = s + 'px';
      fx.appendChild(g);
      const a = g.animate([
        { transform: 'translate(-20px,' + y + 'px)', opacity: 0 },
        { opacity: 0.9, offset: 0.2 },
        { transform: 'translate(' + (innerWidth + 20) + 'px,' + (y + (Math.random() - 0.5) * 120) + 'px)', opacity: 0 },
      ], { duration: (700 + Math.random() * 600) * UI.speed, delay: Math.random() * 350 * UI.speed, easing: 'ease-in', fill: 'both' });
      jobs.push(a.finished.catch(() => {}).then(() => g.remove()));
    }
    return Promise.all(jobs);
  }

  function bubble(seat, text, alert, kind) {
    const host = seat === UI.human ? $('me-id') : UI.seatEls[seat];
    if (!host) return;
    // チャットの吹き出しは 'talk'（チャット欄の .chat と名前がぶつからないように）
    if (kind === 'chat') { const old = host.querySelector(':scope > .bubble.talk'); if (old) old.remove(); }
    const b = document.createElement('div');
    b.className = 'bubble' + (alert ? ' alert' : '') + (kind === 'chat' ? ' talk' : '');
    b.textContent = text;
    if (seat === UI.human) { b.style.left = '40px'; b.style.top = '-6px'; }
    host.appendChild(b);
    setTimeout(() => b.remove(), (kind === 'chat' ? 3500 : 1400) * UI.speed + 100);
  }

  /** 任意の要素の上に吹き出しを出す（七並べ・スピードの席でも使う） */
  function bubbleAt(host, text, alert, kind) {
    if (!host) return;
    if (kind === 'chat') { const old = host.querySelector(':scope > .bubble.talk'); if (old) old.remove(); }
    const b = document.createElement('div');
    b.className = 'bubble' + (alert ? ' alert' : '') + (kind === 'chat' ? ' talk' : '');
    b.textContent = text;
    host.appendChild(b);
    setTimeout(() => b.remove(), (kind === 'chat' ? 3500 : 1400) * UI.speed + 100);
  }

  let toastTimer = 0;
  function toast(text, ms) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  function setThinking(seat, on) {
    const el = UI.seatEls[seat];
    if (el) el.classList.toggle('thinking', !!on);
  }

  // ─────────────────────────────────────────────
  // イベントの再生
  // ─────────────────────────────────────────────
  function removeFrom(arr, cards) {
    for (const id of cards) {
      let i = arr.indexOf(id);
      if (i < 0) i = arr.indexOf('?'); // オンラインで伏せられた他人の手札
      if (i >= 0) arr.splice(i, 1);
    }
  }

  function handRects(cards) {
    return cards.map((id) => { const el = UI.handEls.get(id); return el ? el.getBoundingClientRect() : null; });
  }

  function seatRects(seat, k, w, h) {
    const p = seatAnchor(seat);
    return Array.from({ length: k }, () => rectAt(p, w * 0.45, h * 0.45));
  }

  async function animPlay(seat, cards, extra) {
    const vm = UI.vm;
    const { w: pw, h: ph } = cardSize('pile');
    const from = seat === UI.human ? handRects(cards) : seatRects(seat, cards.length, pw, ph);
    removeFrom(vm.hands[seat], cards);
    vm.pile.push(Object.assign({ seat, cards: cards.slice(), key: seat + ':' + cards.join('') + ':' + vm.pile.length }, extra || {}));
    renderHand();
    renderSeats();
    renderPile(true);
    const tops = Array.from(document.querySelectorAll('#pile .pile-entry.top .card')).map((e) => e.getBoundingClientRect());
    SND.play('card', cards.length);
    const fallback = rectAt(seatAnchor(seat), pw * 0.45, ph * 0.45);
    await fly(cards.map((id, i) => ({ id, from: from[i] || fallback, to: tops[i], delay: i * 45, r0: seat === UI.human ? 0 : -14 })), 400);
    renderPile(false);
  }

  async function animFlow() {
    const els = Array.from(document.querySelectorAll('#pile .pile-entry'));
    if (els.length) {
      SND.play('flow');
      await Promise.all(els.map((el) => el.animate(
        [{ opacity: 1, transform: el.style.transform }, { opacity: 0, transform: el.style.transform + ' translateX(34vw) rotate(24deg)' }],
        { duration: 420 * UI.speed, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'forwards' }).finished.catch(() => {})));
    }
    const vm = UI.vm;
    vm.pile = [];
    vm.lock = { suits: null, partial: null, number: false };
    vm.constraint = null;
    vm.jback = false;
    renderPile(false);
    renderStatus();
  }

  async function animTransfer(from, to, cards, faceUp) {
    const { w, h } = cardSize('pile');
    const vm = UI.vm;
    const src = from === UI.human ? handRects(cards) : seatRects(from, cards.length, w, h);
    removeFrom(vm.hands[from], cards);
    renderHand(); renderSeats();
    const dst = rectAt(seatAnchor(to), w * 0.6, h * 0.6);
    if (cards.length) {
      await fly(cards.map((id, i) => ({ id, back: !faceUp, from: src[i] || rectAt(seatAnchor(from), w * 0.45, h * 0.45), to: dst, delay: i * 70, o1: 0.9 })), 520);
    }
    vm.hands[to] = vm.hands[to].concat(cards);
    renderHand(); renderSeats();
  }

  async function animDiscard(seat, cards) {
    const { w, h } = cardSize('pile');
    const vm = UI.vm;
    const src = seat === UI.human ? handRects(cards) : seatRects(seat, cards.length, w, h);
    removeFrom(vm.hands[seat], cards);
    renderHand(); renderSeats();
    const c = $('pile').getBoundingClientRect();
    const dst = { left: c.right - w * 0.4, top: c.top + c.height / 2 - h / 2, width: w, height: h };
    await fly(cards.map((id, i) => ({ id, from: src[i] || rectAt(seatAnchor(seat), w * 0.45, h * 0.45), to: dst, delay: i * 60, o1: 0, r1: 20 })), 560);
  }

  const FLOW_NAMES = { '8': '8切り', '66': 'ろくろ首', '99': '救急車' };
  const STOP_NAMES = { four: '4止め', three: '3止め', sand: '砂嵐' };
  const LOCK_NAMES = { suit: '縛り', partial: '片縛り', number: '階段縛り', geki: '激縛り' };
  const REVO_NAMES = { normal: '革命', seq: '階段革命', coup: 'クーデター', omen: 'オーメン', great: '大革命' };

  /** 状態に合わせたうえで、同じ束の後ろにあるカード交換を巻き戻す（交換アニメーションで二重に動かさないため） */
  function syncBefore(evs, i) {
    syncVM();
    const vm = UI.vm;
    for (let j = evs.length - 1; j > i; j--) {
      const e = evs[j];
      if (e.t === 'exchange') {
        removeFrom(vm.hands[e.to], e.cards);
        vm.hands[e.from] = vm.hands[e.from].concat(e.cards);
      }
    }
    vm.turn = null;
  }

  async function playEvents(evs) {
    const S = UI.S;
    let vm = UI.vm;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      switch (ev.t) {
        case 'deal': {
          syncBefore(evs, i);
          vm = UI.vm;
          renderAll();
          await animDeal();
          break;
        }
        case 'start': {
          vm.turn = ev.leader;
          renderAll();
          break;
        }
        case 'play': {
          vm.constraint = null;
          vm.turn = null;
          renderStatus();
          await animPlay(ev.seat, ev.play.cards);
          break;
        }
        case 'pass': {
          SND.play('pass');
          bubble(ev.seat, 'パス');
          await sleep(260 * UI.speed);
          break;
        }
        case 'flow': {
          await animFlow();
          vm.turn = ev.leader;
          renderStatus();
          renderSeats();
          renderMe();
          break;
        }
        case 'revolution': {
          vm.rev = ev.on;
          SND.play('revolution');
          shake();
          flash('radial-gradient(circle, rgba(255,120,140,.75), rgba(120,0,20,0) 70%)', 900);
          renderStatus();
          const nm = REVO_NAMES[ev.kind] || '革命';
          await banner(ev.on ? nm : nm === '革命' ? '革命返し' : nm, 'revo', ev.on ? '強さが逆転！' : '強さが元に戻った', 1400);
          renderHand();
          break;
        }
        case 'jback': {
          vm.jback = ev.on;
          SND.play('special');
          renderStatus();
          await banner(ev.by === 'J' ? 'Jバック' : '2バック', 'cool', ev.on ? '場が流れるまで強さが逆転' : '強さが元に戻った');
          break;
        }
        case 'cut': {
          SND.play('cut');
          await banner(FLOW_NAMES[ev.kind], '', '場が流れる', 950);
          break;
        }
        case 'sand': {
          SND.play('cut');
          sandstorm();
          await banner('砂嵐', '', '最強の役！場が流れる', 1200);
          break;
        }
        case 'spade3': {
          SND.play('cut');
          await banner('スペ3返し', '', 'ジョーカーを破った！', 1100);
          break;
        }
        case 'stop': {
          SND.play('special');
          await animPlay(ev.seat, ev.play.cards, { stop: ev.kind });
          if (ev.kind === 'sand') sandstorm();
          await banner(STOP_NAMES[ev.kind], ev.kind === 'sand' ? '' : 'cool', nameOf(ev.seat) + 'が止めた！', 1150);
          break;
        }
        case 'skip': {
          SND.play('special');
          for (const s of ev.seats) bubble(s, 'スキップ', true);
          await banner('スキップ', 'cool', ev.seats.map(nameOf).join('・') + ' を飛ばす', 950);
          break;
        }
        case 'give': {
          const involved = ev.from === UI.human || ev.to === UI.human;
          if (ev.cards.length) {
            banner(ev.label, 'cool', nameOf(ev.from) + ' → ' + nameOf(ev.to) + '（' + ev.cards.length + '枚）', 1000);
            await animTransfer(ev.from, ev.to, ev.cards, involved);
            if (ev.to === UI.human) toast(ev.label + 'で受け取った：' + ev.cards.map(C.cardLabel).join(' '));
          }
          break;
        }
        case 'discard': {
          if (ev.cards.length) {
            banner('10捨て', 'cool', nameOf(ev.seat) + 'が' + ev.cards.length + '枚捨てた', 1000);
            await animDiscard(ev.seat, ev.cards);
          }
          break;
        }
        case 'bomb': {
          if (!ev.ranks.length) {
            bubble(ev.seat, ev.none ? '指名できる数字なし' : '指名しない');
            break;
          }
          SND.play('bomb');
          flash('radial-gradient(circle, rgba(255,240,200,.9), rgba(255,160,60,0) 70%)', 700);
          shake();
          await banner('12ボンバー', '', ev.ranks.map((r) => C.rankLabel(r)).join('・') + ' を全員捨てる', 1200);
          const jobs = [];
          for (const s of Object.keys(ev.removed)) jobs.push(animDiscard(+s, ev.removed[s]));
          await Promise.all(jobs);
          break;
        }
        case 'pickup': {
          if (ev.cards.length) {
            const idx = vm.pile.length - 2;
            const { w, h } = cardSize('pile');
            const entryEl = document.querySelectorAll('#pile .pile-entry')[Math.max(0, document.querySelectorAll('#pile .pile-entry').length - 2)];
            const src = entryEl ? entryEl.getBoundingClientRect() : $('pile').getBoundingClientRect();
            if (idx >= 0) vm.pile[idx].cards = vm.pile[idx].cards.filter((id) => !ev.cards.includes(id));
            renderPile(false);
            banner('A拾い', 'cool', nameOf(ev.seat) + 'が' + ev.cards.length + '枚拾った', 1000);
            await fly(ev.cards.map((id, i) => ({ id, from: { left: src.left, top: src.top, width: w, height: h }, to: rectAt(seatAnchor(ev.seat), w * 0.6, h * 0.6), delay: i * 70, o1: 0.8 })), 520);
            vm.hands[ev.seat] = vm.hands[ev.seat].concat(ev.cards);
            renderHand(); renderSeats();
          }
          break;
        }
        case 'reverse': {
          vm.dir = ev.dir;
          SND.play('special');
          renderStatus();
          await banner('リバース', 'cool', '順番が逆回りに', 900);
          break;
        }
        case 'lock': {
          vm.lock = ev.lock;
          SND.play('special');
          renderStatus();
          const suits = ev.lock.suits || ev.lock.partial || [];
          const sym = suits.map((s) => C.SUIT_SYM[s]).join('');
          const sub = ev.kind === 'number' ? '次も1つ上の数字だけ' : ev.kind === 'geki' ? sym + ' の1つ上の数字だけ' : ev.kind === 'partial' ? sym + ' を含めて出す' : sym + ' しか出せない';
          await banner(LOCK_NAMES[ev.kind], 'small', sub, 900);
          break;
        }
        case 'constraint': {
          vm.constraint = { rank: ev.rank, from: ev.from };
          renderStatus();
          bubble(S.lastSeat == null ? UI.human : S.lastSeat, '次は' + C.rankLabel(ev.rank) + 'だけ', true);
          break;
        }
        case 'finish': {
          vm.out[ev.seat] = true;
          vm.places[ev.seat] = ev.place;
          vm.hands[ev.seat] = [];
          renderSeats(); renderMe();
          SND.play(ev.seat === UI.human && ev.place === 1 ? 'fanfare' : 'finish');
          await banner(ev.seat === UI.human ? (ev.place === 1 ? '一番上がり！' : ev.place + '位で上がり') : '上がり',
            ev.seat === UI.human ? '' : 'small', nameOf(ev.seat) + '（' + ev.place + '位）', 1100);
          break;
        }
        case 'foul': {
          vm.out[ev.seat] = true;
          vm.foul[ev.seat] = true;
          vm.hands[ev.seat] = [];
          renderSeats(); renderMe();
          SND.play('foul');
          await banner('反則上がり', 'foul', nameOf(ev.seat) + 'は最下位', 1300);
          break;
        }
        case 'miyako': {
          vm.out[ev.seat] = true;
          vm.hands[ev.seat] = [];
          renderSeats(); renderMe();
          SND.play('foul');
          await banner('都落ち', 'foul', nameOf(ev.seat) + 'は大貧民に', 1400);
          break;
        }
        case 'gekokujo': {
          SND.play('revolution');
          shake();
          await banner('下剋上', 'revo', nameOf(ev.seat) + 'が一番上がり！身分が全部ひっくり返る', 1700);
          break;
        }
        case 'tenpen': {
          SND.play('revolution');
          await banner('天変地異', 'revo', nameOf(ev.seat) + 'と' + nameOf(ev.with) + 'の手札が入れ替わる', 1600);
          syncBefore(evs, i);
          vm = UI.vm;
          renderAll();
          break;
        }
        case 'greatRevolution': {
          vm.hands[ev.seat] = [];
          SND.play('fanfare');
          await banner('大革命', 'revo', nameOf(ev.seat) + 'はそのまま上がり', 1500);
          break;
        }
        case 'lucky': {
          vm.hands[ev.seat] = [];
          SND.play('fanfare');
          await banner('ラッキーセブン', '', nameOf(ev.seat) + 'はそのまま上がり', 1400);
          break;
        }
        case 'exchange': {
          const faceUp = ev.from === UI.human || ev.to === UI.human;
          await animTransfer(ev.from, ev.to, ev.cards, faceUp);
          break;
        }
        case 'last': {
          vm.out[ev.seat] = true;
          vm.places[ev.seat] = S.finished.indexOf(ev.seat) + 1;
          renderSeats(); renderMe();
          break;
        }
        default:
          break;
      }
    }
    syncVM();
    renderAll();
  }

  async function animDeal() {
    SND.play('deal');
    const { w, h } = cardSize('pile');
    const c = $('pile').getBoundingClientRect();
    const center = { x: c.left + c.width / 2, y: c.top + c.height / 2 };
    const items = [];
    const S = UI.S;
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < S.n; i++) {
        const seat = (UI.human + i) % S.n;
        items.push({ back: true, from: rectAt(center, w, h), to: rectAt(seatAnchor(seat), w * 0.5, h * 0.5), delay: (r * S.n + i) * 38, o1: 0.2 });
      }
    }
    const hand = $('hand');
    hand.style.opacity = '0';
    await fly(items, 320);
    hand.style.transition = 'opacity .3s';
    hand.style.opacity = '1';
    setTimeout(() => { hand.style.transition = ''; }, 350);
  }

  // ─────────────────────────────────────────────
  // 操作
  // ─────────────────────────────────────────────
  function setSelectable(on, max) {
    UI.selectable = !!on;
    UI.selMax = max || 0;
    if (!on) UI.sel.clear();
    renderHand();
  }
  function clearSelection() { UI.sel.clear(); UI.hintSet = null; renderHand(); }
  function setDim(set) { UI.dimSet = set; renderHand(); }
  function setHint(ids) { UI.sel = new Set(ids); UI.hintSet = new Set(ids); renderHand(); }

  function showPrompt(html, buttons) {
    $('prompt-text').innerHTML = html;
    const box = $('prompt-btns');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'btn ' + (b.primary ? 'btn-gold' : 'btn-ghost') + ' btn-sm';
      el.textContent = b.label;
      if (b.id) el.id = b.id;
      el.addEventListener('click', b.onClick);
      box.appendChild(el);
    }
    $('prompt').hidden = false;
    requestAnimationFrame(renderHand);
  }
  function hidePrompt() { $('prompt').hidden = true; requestAnimationFrame(renderHand); }

  function openDialog(html, opts) {
    const ov = $('overlay');
    ov.innerHTML = '<div class="dialog" role="dialog" aria-modal="true">' + html + '</div>';
    ov.hidden = false;
    ov.onclick = (e) => { if (e.target === ov && opts && opts.onBackdrop) opts.onBackdrop(); };
    const first = ov.querySelector('button');
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
    return ov.firstChild;
  }
  function closeDialog() { const ov = $('overlay'); ov.hidden = true; ov.innerHTML = ''; ov.onclick = null; }

  function miniCards(ids) {
    return '<span class="mini-cards">' + ids.map((id) => '<span class="mc">' + A.faceSVG(id) + '</span>').join('') + '</span>';
  }

  function resetTable() {
    for (const el of UI.handEls.values()) el.remove();
    UI.handEls.clear();
    for (const k of Object.keys(UI.seatEls)) UI.seatEls[k].remove();
    UI.seatEls = {};
    UI.sel.clear();
    UI.dimSet = null;
    UI.hintSet = null;
    $('fx').innerHTML = '';
  }

  Object.assign(UI, {
    syncVM, renderAll, renderHand, renderSeats, renderPile, renderStatus, renderMe,
    playEvents, banner, toast, bubble, flash, shake, setThinking, setSelectable, clearSelection, setDim, setHint,
    showPrompt, hidePrompt, openDialog, closeDialog, miniCards, makeCardEl, makeBackEl, resetTable,
    nameOf, titleOfSeat, TITLE_CLASS, esc, sleep, fmtPts, ptsClass, fly, rectAt, bubbleAt,
  });
  D.UI = UI;
})();
