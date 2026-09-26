/* 七並べ — ホーム・設定・対局の画面と進行（ローカルのAI戦とオンライン） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const C = D.Cards, A = D.Art, SND = D.Sound, UI = D.UI, RT = D.Rating, CM = D.Common, OC = D.OnlineClient;
  const SV = D.Sevens, AI = D.SevensAI, SR = D.SevensRules;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const sleep = UI.sleep;
  const store = CM.store;
  const ss = store.sevens; // { settings, rules, rating, match }
  const SUIT_COLOR = { S: 'black', C: 'black', H: 'red', D: 'red' };

  let S = null; // 表示している対局（オンラインではサーバーから届いた自分用の状態）
  let human = 0; // 自分の席
  let seatInfo = null; // オンライン：[{ name, type, robot, connected }]
  let loopToken = 0;
  let humanCancel = null;
  let sel = null; // 選んでいるカード
  let jokerTargets = null; // ジョーカーを置ける場所（選んでいる間だけ）
  const handEls = new Map();
  const seatEls = {};
  const onlineRoom = () => (OC.cur && OC.cur.game === 'sevens' ? OC.cur : null);
  const nameOf = (seat) => (seat === human ? 'あなた' : S.players[seat].name);
  const numLabel = SV.numLabel;

  // ─────────────────────────────────────────────
  // ホーム
  // ─────────────────────────────────────────────
  function savedMatch() {
    const m = ss.match;
    if (!m || m.game !== 'sevens' || !(m.phase === 'play' || m.phase === 'over') || m.matchOver) return null;
    return m;
  }
  function rulesSummary(R) {
    const on = [];
    on.push(R.passLimit ? 'パス' + R.passLimit + '回' : 'パス無制限');
    if (R.joker) on.push('ジョーカー');
    if (R.tunnel) on.push('トンネル');
    if (R.mustPlay) on.push('パス禁止');
    return on.join('・');
  }

  function renderHome() {
    const el = $('home-sevens');
    if (!el.dataset.built) {
      el.innerHTML = D.Shell.homeHTML({
        prefix: 'svh', title: '七並べ', en: 'SEVENS', tag: 'パス・ジョーカー・トンネル。止めて、読んで、駆け引きの七並べ',
        art: D.Shell.fanHTML(['S7', 'H7', 'D7', 'C7'], 34, 9),
      });
      $('svh-rated').addEventListener('click', () => { SND.unlock(); openRated(); });
      $('svh-free').addEventListener('click', () => { SND.unlock(); newMatch(); });
      $('svh-resume').addEventListener('click', () => { SND.unlock(); resumeMatch(); });
      $('svh-online').addEventListener('click', () => { SND.unlock(); OC.openOnline('sevens'); });
      $('svh-book').addEventListener('click', () => CM.openBook('sevens', 'basics'));
      $('svh-settings').addEventListener('click', openSettings);
      el.dataset.built = '1';
    }
    $('svh-rating').innerHTML = D.Shell.rateStripHTML('sevens');
    const m = savedMatch();
    $('svh-resume').hidden = !m;
    if (m) $('svh-resume').textContent = 'つづきから（' + (m.rated ? 'レート戦 ' : '') + '第' + m.gameNo + (m.maxGames ? '/' + m.maxGames : '') + 'ゲーム）';
    $('svh-online').hidden = !D.Net.available();
    const st = ss.settings;
    $('svh-note').innerHTML = 'フリー対戦：' + st.players + '人・AI（' + CM.LEVEL_LABEL[st.level] + '）・' + (st.games ? st.games + 'ゲーム' : '無制限') +
      '<br>ルール：<b>' + esc(rulesSummary(ss.rules)) + '</b>';
  }

  // ─────────────────────────────────────────────
  // ルールと設定
  // ─────────────────────────────────────────────
  function openSettings() {
    CM.showScreen('scr-gset');
    $('gset-title').textContent = '七並べ・ルールと設定';
    $('gset-back').onclick = () => D.Shell.showHome('sevens');
    $('gset-start').onclick = () => { SND.unlock(); newMatch(); };
    renderSettings();
  }
  function renderSettings() {
    const wrap = $('gset-wrap');
    const keep = $('gset-scroll').scrollTop;
    wrap.innerHTML = '';
    const st = ss.settings;
    const set = (k, v) => { st[k] = v; CM.save(); renderSettings(); };
    const m = CM.section('対戦設定', 'フリー対戦の設定。レート戦は4人・標準ルール・10ゲームで固定');
    m.panel.appendChild(CM.row('人数', 'あなた＋AIロボット', CM.seg([3, 4, 5, 6].map((v) => ({ v, label: v + '人' })), st.players, (v) => set('players', v))));
    m.panel.appendChild(CM.row('AIの強さ', st.level === 'hard' ? '見えないカードを何通りも試して考えます' : '',
      CM.seg([{ v: 'easy', label: 'やさしい' }, { v: 'normal', label: 'ふつう' }, { v: 'hard', label: 'つよい' }], st.level, (v) => set('level', v))));
    m.panel.appendChild(CM.row('1試合のゲーム数', st.games ? st.games + 'ゲームの総得点で順位を決めます' : '終わりなし',
      CM.seg([{ v: 5, label: '5' }, { v: 10, label: '10' }, { v: 0, label: '無制限' }], st.games, (v) => set('games', v))));
    wrap.appendChild(m.s);
    const R = ss.rules;
    const r = CM.section('ルール', 'どれも1つずつ切り替えられます');
    for (const def of SR.RULES) {
      const setRule = (v) => { R[def.key] = v; CM.save(); renderSettings(); };
      const ctl = def.type === 'bool' ? CM.toggle('svr-' + def.key, R[def.key], setRule, false, def.label) : CM.seg(def.options, R[def.key], setRule);
      r.panel.appendChild(CM.row(def.label, def.desc, ctl));
    }
    const reset = document.createElement('div');
    reset.className = 'row';
    reset.innerHTML = '<div class="row-text"><div class="row-desc">標準ルール：パス3回・ジョーカー・トンネル</div></div>';
    const rb = document.createElement('button');
    rb.className = 'btn btn-ghost btn-sm';
    rb.type = 'button';
    rb.textContent = '標準に戻す';
    rb.addEventListener('click', () => { ss.rules = Object.assign({}, SR.STANDARD); CM.save(); renderSettings(); });
    reset.appendChild(rb);
    r.panel.appendChild(reset);
    wrap.appendChild(r.s);
    $('gset-scroll').scrollTop = keep;
  }

  // ─────────────────────────────────────────────
  // 対局の開始・再開・保存
  // ─────────────────────────────────────────────
  function openRated() {
    const m = savedMatch();
    if (m && m.rated) { askAbandon(openRated); return; }
    CM.openRatedDialog('sevens', { slowLevel: 'hard', onPick: (lv) => newMatch({ rated: true, level: lv }) });
  }
  function askAbandon(then) {
    CM.askAbandon(savedMatch(), { onResume: resumeMatch, onAbandoned: () => { ss.match = null; CM.save(); renderHome(); then(); } });
  }

  function newMatch(opts) {
    const rated = !!(opts && opts.rated);
    const m = savedMatch();
    if (m && m.rated && !(opts && opts.abandoned)) { askAbandon(() => newMatch(Object.assign({}, opts, { abandoned: true }))); return; }
    stopLoop();
    OC.leaveRoom(true);
    const c = RT.cfg('sevens');
    const n = rated ? c.players : ss.settings.players;
    const level = rated ? opts.level : ss.settings.level;
    const players = [{ name: CM.settings.name || 'あなた', human: true }];
    for (let i = 1; i < n; i++) players.push({ name: A.ROBOTS[i - 1].name, level });
    const info = rated ? { level, base: [ss.rating.r].concat(players.slice(1).map(() => c.ai[level])), matches: ss.rating.matches, result: null } : null;
    S = SV.createMatch({ rules: rated ? c.rules() : ss.rules, players, games: rated ? c.games : ss.settings.games, rated: info });
    human = 0;
    seatInfo = null;
    showTable(true);
    startNextGame();
  }

  async function startNextGame() {
    if (S.matchOver) return;
    const token = ++loopToken;
    UI.hidePrompt();
    S.events = [];
    SV.startGame(S);
    const evs = S.events.slice();
    S.events = [];
    persist();
    await playEvents(evs, true);
    if (token === loopToken) runLoop();
  }

  function resumeMatch() {
    const m = savedMatch();
    if (!m) return;
    stopLoop();
    OC.leaveRoom(true);
    try { S = SV.deserialize(m); } catch (e) { UI.toast('保存された対局を読み込めませんでした'); return; }
    human = 0;
    seatInfo = null;
    showTable(true);
    if (S.phase === 'over') showResults(++loopToken);
    else runLoop();
  }

  function persist() {
    if (!S || onlineRoom()) return;
    try { ss.match = SV.serialize(S); CM.save(); } catch (e) { /* 保存できなくても続行 */ }
  }

  function stopLoop() {
    loopToken++;
    cancelHuman();
    UI.closeDialog();
  }
  function cancelHuman() { if (humanCancel) { const c = humanCancel; humanCancel = null; c(); } }

  // ─────────────────────────────────────────────
  // 表示
  // ─────────────────────────────────────────────
  function showTable(reset) {
    CM.showScreen('scr-sevens');
    if (reset) {
      for (const el of handEls.values()) el.remove();
      handEls.clear();
      for (const k of Object.keys(seatEls)) { seatEls[k].remove(); delete seatEls[k]; }
      $('fx').innerHTML = '';
    }
    renderAll();
  }

  function renderAll() {
    if (!S) return;
    fit();
    renderHud();
    renderSeats();
    renderBoard();
    renderMe();
    renderHand();
    renderStatus();
  }

  /** 画面の広さから、場のマスと手札の大きさを決める */
  function fit() {
    const scr = $('scr-sevens');
    const W = scr.clientWidth, H = scr.clientHeight;
    if (!W || !H) return;
    const narrow = W / H < 1.05;
    // 手札
    let cw = narrow ? Math.min((W - 30) / 4.6, (H - 460) / 3.2) : Math.min((W - 40) / 7.2, (H - 440) / 1.6);
    cw = Math.max(50, Math.min(118, Math.floor(cw)));
    scr.style.setProperty('--cw', cw + 'px');
    // 場（13列×4段）。幅で決まるスマホでは、マスを縦長にして読みやすくする
    const table = $('sv-table');
    const gap = narrow ? 2 : 3;
    const tw = table.clientWidth - (narrow ? 8 : 16);
    const th = table.clientHeight - (narrow ? 150 : 140) - 36;
    let w = Math.floor((Math.min(tw, 900) - (narrow ? 12 + 14 : 20 + 18) - 12 * gap) / 13);
    let h = Math.floor(Math.min(w * (narrow ? 1.75 : 1.4), (th - 3 * 5) / 4));
    if (h < w * 1.15) w = Math.floor(h / 1.15);
    scr.style.setProperty('--svw', Math.max(18, w) + 'px');
    scr.style.setProperty('--svh', Math.max(26, h) + 'px');
    scr.style.setProperty('--svgap', gap + 'px');
  }

  function renderHud() {
    const sub = [];
    if (S.rated) sub.push('<span class="rated-tag">レート戦</span>');
    if (UI.roomCode && onlineRoom()) sub.push('部屋 ' + esc(UI.roomCode));
    $('sv-gameno').innerHTML = '第' + S.gameNo + (S.maxGames ? '<span class="of">/' + S.maxGames + '</span>' : '') + 'ゲーム' + (sub.length ? '<small>' + sub.join(' ') + '</small>' : '');
  }

  function passPips(P) {
    const limit = S.rules.passLimit;
    if (!limit) return P.passes ? '<span class="pips">パス' + P.passes + '</span>' : '';
    let h = '<span class="pips" title="パス ' + P.passes + '/' + limit + '">';
    for (let i = 0; i < limit; i++) h += '<i class="' + (i < P.passes ? 'used' : '') + '"></i>';
    return h + '</span>';
  }
  function scoreTag(seat) {
    if (!S.history.length) return '';
    const v = S.players[seat].score;
    return '<span class="sc ' + UI.ptsClass(v) + '">' + UI.fmtPts(v) + '</span>';
  }
  function placeOf(seat) {
    const i = S.finished.indexOf(seat);
    return i >= 0 ? i + 1 : 0;
  }

  function renderSeats() {
    const box = $('sv-seats');
    const alive = new Set();
    for (let i = 1; i < S.n; i++) {
      const seat = (human + i) % S.n;
      alive.add(String(seat));
      let el = seatEls[seat];
      if (!el) {
        el = document.createElement('div');
        el.className = 'sv-seat';
        el.innerHTML = '<div class="ava"><span class="face"></span><div class="think"><i></i><i></i><i></i></div></div>' +
          '<div class="plate"><span class="nmrow"><span class="name"></span><span class="scw"></span></span><span class="cnt"></span></div>';
        box.appendChild(el);
        seatEls[seat] = el;
      }
      const info = seatInfo && seatInfo[seat];
      const kind = info && info.type === 'human' ? 'human' : 'ai:' + (info ? info.robot : seat - 1);
      if (el.dataset.kind !== kind) {
        el.dataset.kind = kind;
        el.querySelector('.face').innerHTML = kind === 'human' ? A.personSVG(seat) : A.robotSVG(info ? info.robot : seat - 1);
      }
      el.classList.toggle('away', !!(info && info.type === 'human' && !info.connected));
      box.appendChild(el); // 並び順をそろえる
      const P = S.players[seat];
      el.querySelector('.name').textContent = P.name;
      el.querySelector('.scw').innerHTML = scoreTag(seat);
      el.querySelector('.cnt').innerHTML = P.out ? (P.elim ? '<span class="out-tag foul">失格</span>' : '<span class="out-tag">' + placeOf(seat) + '位</span>')
        : '<span class="mini" style="background-image:' + UI.backURI + '"></span>' + P.hand.length + passPips(P);
      el.classList.toggle('turn', S.phase === 'play' && S.turn === seat);
      el.classList.toggle('out', !!P.out);
    }
    for (const k of Object.keys(seatEls)) if (!alive.has(k)) { seatEls[k].remove(); delete seatEls[k]; }
  }

  function cellHTML(s, n) {
    const c = S.board[s][n];
    const tgt = jokerTargets && jokerTargets.some((sp) => sp.suit === s && sp.n === n);
    if (!c) return '<button type="button" class="svc empty' + (tgt ? ' target' : '') + '" data-s="' + s + '" data-n="' + n + '"' + (tgt ? '' : ' tabindex="-1"') +
      ' aria-label="' + C.SUIT_NAME[s] + 'の' + numLabel(n) + '（空き）"><span>' + numLabel(n) + '</span></button>';
    if (c.joker) return '<div class="svc joker" data-s="' + s + '" data-n="' + n + '" aria-label="ジョーカー"><b>J</b><i>★</i></div>';
    return '<div class="svc placed ' + SUIT_COLOR[s] + (c.elim ? ' elim' : '') + '" data-s="' + s + '" data-n="' + n + '"><b>' + numLabel(n) + '</b><i>' + C.SUIT_SYM[s] + '</i></div>';
  }

  function renderBoard() {
    const b = $('sv-board');
    let h = '';
    for (const s of SV.SUITS) {
      h += '<div class="sv-row" data-suit="' + s + '"><span class="sv-suit ' + SUIT_COLOR[s] + '">' + A.suitIcon(s, 14) + '</span>';
      for (let n = 1; n <= 13; n++) h += cellHTML(s, n);
      h += '</div>';
    }
    b.innerHTML = h;
    b.classList.toggle('picking', !!jokerTargets);
    b.querySelectorAll('.svc.target').forEach((el) => el.addEventListener('click', () => { if (onPickSpot) onPickSpot(el.dataset.s, +el.dataset.n); }));
  }
  let onPickSpot = null;

  function renderMe() {
    const P = S.players[human];
    let st = '';
    if (P.out) st = P.elim ? '<span class="yourturn">失格</span>' : '<span class="yourturn">' + placeOf(human) + '位で上がり</span>';
    $('sv-me-id').innerHTML = '<span class="ava">' + A.humanSVG() + '</span><span class="nm">' + esc(P.name) + '</span>' + scoreTag(human) + passPips(P) + st;
    $('sv-me').classList.toggle('turn', S.phase === 'play' && S.turn === human);
  }

  function renderStatus() {
    const out = [];
    if (S.joker) out.push('<span class="chip lock">★ ジョーカー：' + C.SUIT_SYM[S.joker.suit] + numLabel(S.joker.n) + ' の場所</span>');
    if (S.phase === 'play') out.push('<span class="chip turnchip">' + (S.turn === human ? 'あなたの番' : esc(S.players[S.turn].name) + 'の番') + '</span>');
    $('sv-status').innerHTML = out.join('');
  }

  /** 手札（大富豪と同じ並べ方：重ねて1段、多ければ2段） */
  function renderHand() {
    const box = $('sv-hand');
    const hand = SV.sortHand(S.players[human].hand);
    for (const [id, el] of handEls) if (!hand.includes(id)) { el.remove(); handEls.delete(id); }
    const W = box.clientWidth || 320;
    const cw = parseFloat(getComputedStyle($('scr-sevens')).getPropertyValue('--cw')) || 64;
    const ch = cw * 1.4;
    const n = hand.length;
    let rows = 1;
    let step = n > 1 ? Math.min(cw * 0.64, (W - cw) / (n - 1)) : 0;
    if (n > 1 && step < Math.max(20, cw * 0.34)) rows = 2;
    box.classList.toggle('two', rows === 2);
    const perRow = rows === 2 ? Math.ceil(n / 2) : n;
    if (rows === 2) step = perRow > 1 ? Math.min(cw * 0.64, (W - cw) / (perRow - 1)) : 0;
    const q = S.phase === 'play' && S.turn === human && humanCancel;
    const playable = q && CM.settings.showPlayable ? new Set(SV.legalMoves(S, human, true).map((a) => (a.type === 'joker' ? 'X1' : a.card))) : null;
    box.classList.toggle('locked', !q);
    hand.forEach((id, i) => {
      let el = handEls.get(id);
      if (!el) {
        el = UI.makeCardEl(id);
        el.setAttribute('role', 'button');
        el.tabIndex = 0;
        el.addEventListener('click', () => onCardTap(id));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCardTap(id); } });
        box.appendChild(el);
        handEls.set(id, el);
      }
      const row = rows === 2 && i >= perRow ? 1 : 0;
      const j = row ? i - perRow : i;
      const cnt = row ? n - perRow : perRow;
      const x = (W - (cw + (cnt - 1) * step)) / 2 + j * step;
      let y = row * ch * 0.55;
      if (sel === id) y -= 22;
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      el.style.zIndex = String(i + 1);
      el.classList.toggle('sel', sel === id);
      el.setAttribute('aria-pressed', sel === id ? 'true' : 'false');
      el.classList.toggle('dim', !!(playable && !playable.has(id)));
    });
  }
  let onCardTap = () => {};

  // ─────────────────────────────────────────────
  // 演出（エンジンのイベントを順に見せる）
  // ─────────────────────────────────────────────
  const cellEl = (s, n) => $('sv-board').querySelector('.svc[data-s="' + s + '"][data-n="' + n + '"]');
  function seatRect(seat) {
    if (seat === human) {
      const r = $('sv-hand').getBoundingClientRect();
      return { left: r.left + r.width / 2 - 30, top: r.top + 10, width: 60, height: 84 };
    }
    const el = seatEls[seat] && seatEls[seat].querySelector('.ava');
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, top: 60, width: 0, height: 0 };
    return { left: r.left + r.width / 2 - 18, top: r.top + r.height / 2 - 25, width: 36, height: 50 };
  }
  function fromRect(seat, id) {
    const el = seat === human && handEls.get(id);
    return el ? el.getBoundingClientRect() : seatRect(seat);
  }
  async function flyToCell(seat, id, s, n, faceId) {
    const target = cellEl(s, n);
    if (!target) return;
    const to = target.getBoundingClientRect();
    const from = fromRect(seat, id);
    SND.play('card', 1);
    await UI.fly([{ id: faceId || id, from, to, r0: seat === human ? 0 : -10 }], 330);
  }
  function bubble(seat, text, alert, kind) {
    const host = seat === human ? $('sv-me-id') : seatEls[seat];
    UI.bubbleAt(host, text, alert, kind);
  }

  async function playEvents(evs, fromDeal) {
    for (const ev of evs) {
      switch (ev.t) {
        case 'deal': {
          if (fromDeal) SND.play('deal');
          renderAll();
          break;
        }
        case 'sevens': {
          await sleep(200 * UI.speed);
          for (const p of ev.placed) {
            bubble(p.seat, C.SUIT_SYM[p.card[0]] + '7', false);
          }
          SND.play('flow');
          await sleep(500 * UI.speed);
          break;
        }
        case 'start': {
          renderAll();
          UI.toast(nameOf(ev.leader) + ' から始めます（♦7）', 1600);
          break;
        }
        case 'play': {
          renderStatus();
          await flyToCell(ev.seat, ev.card, ev.card[0], SV.numOf(ev.card));
          renderAll();
          break;
        }
        case 'joker': {
          await flyToCell(ev.seat, 'X1', ev.suit, ev.n);
          renderAll();
          SND.play('special');
          await UI.banner('ジョーカー', 'cool', C.SUIT_SYM[ev.suit] + numLabel(ev.n) + ' を持っている人は、次の番で必ず出す', 1300);
          break;
        }
        case 'jokerBack': {
          await flyToCell(ev.seat, ev.card, ev.card[0], SV.numOf(ev.card));
          renderAll();
          bubble(ev.seat, 'ジョーカーを受け取った', true);
          SND.play('special');
          await sleep(500 * UI.speed);
          break;
        }
        case 'pass': {
          SND.play('pass');
          bubble(ev.seat, ev.limit ? 'パス ' + ev.passes + '/' + ev.limit : 'パス', ev.limit && ev.passes >= ev.limit);
          renderSeats(); renderMe();
          await sleep(300 * UI.speed);
          break;
        }
        case 'elim': {
          SND.play('foul');
          renderAll();
          await UI.banner('失格', 'foul', nameOf(ev.seat) + 'のカードを場に並べます', 1300);
          break;
        }
        case 'finish': {
          renderAll();
          SND.play(ev.seat === human && ev.place === 1 ? 'fanfare' : 'finish');
          await UI.banner(ev.seat === human ? (ev.place === 1 ? '一番上がり！' : ev.place + '位で上がり') : '上がり', ev.seat === human ? '' : 'small', nameOf(ev.seat) + '（' + ev.place + '位）', 1100);
          break;
        }
        case 'last':
        case 'over':
          renderAll();
          break;
        default:
          break;
      }
    }
    renderAll();
  }

  // ─────────────────────────────────────────────
  // 進行（ローカルのAI戦）
  // ─────────────────────────────────────────────
  function thinkTime(q) {
    const f = S.players[human].out ? 0.45 : 1;
    return (560 + Math.random() * 280) * UI.speed * f;
  }

  async function runLoop() {
    const token = ++loopToken;
    while (token === loopToken) {
      const q = SV.getRequest(S);
      if (!q) { if (S.phase === 'over') await showResults(token); return; }
      const P = S.players[q.seat];
      let action;
      if (P.human) {
        action = await humanTurn(q);
        if (token !== loopToken || !action) return;
      } else {
        setThinking(q.seat, true);
        const t0 = performance.now();
        // つよいAIは決まった回数だけ試す（端末の速さで強さが変わらないように）。3秒はとても遅い端末での上限
        try { action = await AI.decide(S, q, P.level, 3000); } catch (e) { console.error(e); action = SV.legalMoves(S, q.seat)[0]; }
        const wait = thinkTime(q) - (performance.now() - t0);
        if (wait > 0) await sleep(wait);
        setThinking(q.seat, false);
        if (token !== loopToken) return;
      }
      let evs;
      try { evs = SV.apply(S, action); } catch (err) {
        if (P.human) { UI.toast(err.message); SND.play('error'); continue; }
        console.error(err);
        evs = SV.apply(S, SV.legalMoves(S, q.seat)[0]);
      }
      if (S.matchOver && CM.applyRatedLocal(S)) persist();
      await playEvents(evs);
      persist();
    }
  }
  function setThinking(seat, on) { const el = seatEls[seat]; if (el) el.classList.toggle('thinking', !!on); }

  /** 自分の番：カードを選んで「出す」／ジョーカーは場所を選ぶ／パス */
  function humanTurn(q) {
    return new Promise((resolve) => {
      let done = false;
      let autoTimer = 0;
      const finish = (a) => {
        if (done) return;
        done = true;
        humanCancel = null;
        sel = null;
        jokerTargets = null;
        onPickSpot = null;
        onCardTap = () => {};
        $('sv-play').onclick = $('sv-pass').onclick = $('sv-hint').onclick = null;
        $('sv-play').disabled = $('sv-pass').disabled = $('sv-hint').disabled = true;
        $('sv-info').textContent = '';
        clearTimeout(autoTimer);
        if (S) { renderBoard(); renderHand(); }
        resolve(a);
      };
      humanCancel = () => finish(null);
      const seat = human;
      const moves = SV.legalMoves(S, seat, true);
      const passOK = SV.canPass(S, seat);
      const P = S.players[seat];
      const limit = S.rules.passLimit;
      SND.play('turn');
      renderAll();
      const info = $('sv-info');
      // 「出す」が2段目に落ちないように、残りの回数は小さく添える
      $('sv-pass').innerHTML = 'パス' + (!limit ? '' : '<small class="sub">' + (P.passes >= limit ? '失格' : '残り' + (limit - P.passes)) + '</small>');
      $('sv-pass').disabled = !passOK;
      $('sv-hint').disabled = false;
      if (!moves.length && passOK && CM.settings.autoPass && !(limit && P.passes >= limit)) {
        UI.toast('出せるカードがないのでパスします', 1500);
        autoTimer = setTimeout(() => finish({ type: 'pass', seat }), 1000 * UI.speed);
        return;
      }
      const update = () => {
        info.className = 'sel-info';
        if (q.forced) {
          info.className = 'sel-info ng';
          info.textContent = 'ジョーカーの場所の ' + SV.cardName(q.forced) + ' を出してください';
        } else if (!sel) info.textContent = moves.length ? 'カードをえらんでください' : '出せるカードがありません';
        else if (sel === 'X1') { info.className = 'sel-info ok'; info.textContent = 'ジョーカーを置く場所を、場でえらんでください'; }
        else if (SV.canPlayCard(S, sel)) { info.className = 'sel-info ok'; info.textContent = SV.cardName(sel) + ' を出せます'; }
        else { info.className = 'sel-info ng'; info.textContent = 'まだ出せません（となりにカードがありません）'; }
        $('sv-play').disabled = !(sel && sel !== 'X1' && moves.some((a) => a.type === 'play' && a.card === sel));
      };
      onCardTap = (id) => {
        if (q.forced && id !== q.forced) { UI.toast(SV.cardName(q.forced) + ' を出してください'); SND.play('error'); return; }
        sel = sel === id ? null : id;
        SND.play('select');
        jokerTargets = sel === 'X1' ? SV.jokerSpots(S, seat) : null;
        onPickSpot = jokerTargets ? (s, n) => finish({ type: 'joker', seat, suit: s, n }) : null;
        renderBoard();
        renderHand();
        update();
      };
      $('sv-play').onclick = () => { if (sel && sel !== 'X1') finish({ type: 'play', seat, card: sel }); };
      $('sv-pass').onclick = () => {
        if (!passOK) return;
        if (limit && P.passes >= limit) {
          UI.openDialog('<h3>失格になります</h3><p>パスは' + limit + '回までです。もう一度パスすると失格になり、手札はすべて場に並べられます。</p>' +
            '<div class="btns"><button class="btn btn-ghost" type="button" id="sv-np">やめる</button><button class="btn btn-gold" type="button" id="sv-yp">パスする</button></div>');
          $('sv-np').addEventListener('click', UI.closeDialog);
          $('sv-yp').addEventListener('click', () => { UI.closeDialog(); finish({ type: 'pass', seat }); });
          return;
        }
        finish({ type: 'pass', seat });
      };
      $('sv-hint').onclick = () => {
        const a = AI.suggest(S, seat);
        if (!a || a.type === 'pass') { UI.toast('おすすめ：パス'); return; }
        if (a.type === 'joker') { onCardTap('X1'); UI.toast('おすすめ：ジョーカーを ' + C.SUIT_SYM[a.suit] + numLabel(a.n) + ' の場所へ'); return; }
        sel = null;
        onCardTap(a.card);
        UI.toast('おすすめ：' + SV.cardName(a.card));
      };
      if (q.forced) { sel = q.forced; renderHand(); }
      update();
    });
  }

  // ─────────────────────────────────────────────
  // 結果・メニュー
  // ─────────────────────────────────────────────
  function resultsHTML() {
    const last = S.history[S.history.length - 1];
    const rows = S.prevRanking.map((seat, i) => {
      const P = S.players[seat];
      const pts = last ? last.pts[seat] : D.Engine.pointsFor(S.n, i);
      return '<div class="res-row' + (seat === human ? ' me' : '') + '"><span class="pl">' + (i + 1) + '</span>' +
        '<span><span class="title-chip ' + (i === 0 ? 't-0' : P.elim ? 't-4' : 't-2') + '">' + (P.elim ? '失格' : (i + 1) + '位') + '</span></span>' +
        '<span class="nm">' + esc(P.name) + '</span>' +
        '<span class="pt">' + CM.ptsHTML(pts) + '<small>計 ' + UI.fmtPts(P.score) + '</small></span></div>';
    }).join('');
    const my = S.prevRanking.indexOf(human);
    if (my === 0) SND.play('fanfare');
    const left = S.maxGames ? S.maxGames - S.gameNo : 0;
    return '<h3>第' + S.gameNo + 'ゲーム 結果</h3><p>' + (my === 0 ? 'あなたが1位！' : my >= 0 ? 'あなたは ' + (my + 1) + '位' : '') +
      (S.maxGames ? '<br>' + (S.rated ? 'レート戦 ' : '') + '残り ' + left + 'ゲーム' : '') + '</p><div class="results">' + rows + '</div>';
  }
  const nextLabel = () => '次のゲームへ' + (S.maxGames ? '（' + (S.gameNo + 1) + '/' + S.maxGames + '）' : '');

  function showResults(token) {
    if (S.matchOver) return showFinal();
    return new Promise((resolve) => {
      UI.openDialog(resultsHTML() + '<div class="btns"><button class="btn btn-ghost" type="button" id="res-title">ホームへ</button><button class="btn btn-gold" type="button" id="res-next">' + nextLabel() + '</button></div>');
      $('res-next').addEventListener('click', () => { UI.closeDialog(); resolve(); if (token === loopToken) startNextGame(); });
      $('res-title').addEventListener('click', () => { UI.closeDialog(); resolve(); stopLoop(); D.Shell.showHome('sevens'); });
    });
  }

  function showFinal() {
    return new Promise((resolve) => {
      if (CM.applyRatedLocal(S)) persist();
      const res = S.rated && S.rated.result;
      const box = res ? CM.rateBoxHTML('AI戦レート', res, CM.rateNote('sevens', res)) : '';
      const dlg = UI.openDialog(CM.finalHTML(S, human, box) + '<div class="btns"><button class="btn btn-ghost" type="button" id="fin-title">ホームへ</button><button class="btn btn-gold" type="button" id="fin-again">' +
        (S.rated ? 'もう一度レート戦' : 'もう一度') + '</button></div>');
      CM.animateRate(dlg);
      $('fin-again').addEventListener('click', () => { UI.closeDialog(); resolve(); newMatch(S.rated ? { rated: true, level: S.rated.level } : undefined); });
      $('fin-title').addEventListener('click', () => { UI.closeDialog(); resolve(); stopLoop(); D.Shell.showHome('sevens'); });
    });
  }

  function openMenu() {
    if (onlineRoom()) { OC.openMenu(); return; }
    const ratedLive = S && S.rated && !S.matchOver;
    UI.openDialog('<h3>メニュー</h3><div class="menu-list">' +
      '<button class="btn btn-gold" type="button" id="m-close">対局に戻る</button>' +
      '<button class="btn btn-ghost" type="button" id="m-book">ルールブック</button>' +
      (ratedLive ? '<button class="btn btn-ghost" type="button" id="m-abandon">棄権する</button>' : '<button class="btn btn-ghost" type="button" id="m-restart">最初からやり直す</button>') +
      '<button class="btn btn-ghost" type="button" id="m-title">ホームに戻る</button></div>' +
      (ratedLive ? '<p class="menu-note">ホームに戻っても、レート戦は「つづきから」で再開できます。</p>' : ''), { onBackdrop: UI.closeDialog });
    $('m-close').addEventListener('click', UI.closeDialog);
    $('m-book').addEventListener('click', () => { UI.closeDialog(); CM.openBook('sevens', 'basics', 'game'); });
    if (ratedLive) {
      $('m-abandon').addEventListener('click', () => {
        persist();
        UI.openDialog('<h3>棄権しますか？</h3><p>' + CM.abandonNote(ss.match) + '</p><div class="btns">' +
          '<button class="btn btn-ghost" type="button" id="m-no">やめる</button><button class="btn btn-gold" type="button" id="m-yes">棄権する</button></div>', { onBackdrop: UI.closeDialog });
        $('m-no').addEventListener('click', UI.closeDialog);
        $('m-yes').addEventListener('click', () => {
          stopLoop();
          const r = CM.abandonRatedLocal(ss.match);
          ss.match = null;
          CM.save();
          const dlg = UI.openDialog('<h3>棄権しました</h3>' + (r ? CM.rateBoxHTML('AI戦レート', r) : '') + '<div class="btns"><button class="btn btn-gold" type="button" id="m-done">ホームへ</button></div>');
          CM.animateRate(dlg);
          $('m-done').addEventListener('click', () => { UI.closeDialog(); D.Shell.showHome('sevens'); });
        });
      });
    } else {
      $('m-restart').addEventListener('click', () => {
        UI.openDialog('<h3>最初からやり直しますか？</h3><p>いまの対局と得点は消えます。</p><div class="btns">' +
          '<button class="btn btn-ghost" type="button" id="m-no">やめる</button><button class="btn btn-gold" type="button" id="m-yes">やり直す</button></div>', { onBackdrop: UI.closeDialog });
        $('m-no').addEventListener('click', UI.closeDialog);
        $('m-yes').addEventListener('click', () => { UI.closeDialog(); newMatch(); });
      });
    }
    $('m-title').addEventListener('click', () => { UI.closeDialog(); persist(); stopLoop(); D.Shell.showHome('sevens'); });
  }

  // ─────────────────────────────────────────────
  // オンライン（部屋・待合室・チャットは共通。ここは七並べの対局だけ）
  // ─────────────────────────────────────────────
  function viewSig(v) {
    if (!v.state) return 'lobby';
    const s = v.state;
    return [s.gameNo, s.moves, s.phase, s.turn, s.passRun, s.players.map((p) => p.passes).join(','), JSON.stringify(s.forced || null), v.seat].join('|');
  }
  function quickUpdate(o, m) {
    if (o.waiting && m.phase === 'playing' && viewSig(m) === o.waitingSig && !(m.events && m.events.length)) {
      o.view = m;
      seatInfo = m.seats;
      renderSeats();
      return true;
    }
    if (o.waiting) cancelHuman();
    return false;
  }

  async function handleView(o, v) {
    const st = SV.deserialize(v.state);
    const sig = viewSig(v);
    const evs = v.events || [];
    const first = !o.gameShown || o.seat !== v.seat;
    if (!first && sig === o.sig && !evs.length) {
      seatInfo = v.seats;
      st.players.forEach((p, i) => { if (S && S.players[i]) S.players[i].name = p.name; });
      renderSeats();
    } else {
      o.sig = sig;
      S = st;
      human = v.seat;
      seatInfo = v.seats;
      o.seat = v.seat;
      if (o.resultsOpen && S.phase !== 'over') { UI.closeDialog(); o.resultsOpen = false; }
      if (first) {
        o.gameShown = true;
        showTable(true);
        if (evs.some((e) => e.t === 'deal')) await playEvents(evs, true);
      } else if (evs.length) {
        const saved = UI.speed;
        if (o.queue.length > 1) UI.speed = Math.min(saved, 0.35);
        await playEvents(evs);
        UI.speed = saved;
      } else renderAll();
    }
    if (OC.cur !== o) return;
    if (S.phase === 'over') { if (!o.resultsOpen) showOnlineResults(o); return; }
    if (v.request && !o.queue.length && sig !== o.sentSig) await askOnline(o, v);
  }

  async function askOnline(o, v) {
    if (o.waiting) return;
    o.waiting = true;
    o.waitingSig = viewSig(v);
    const action = await humanTurn(v.request);
    o.waiting = false;
    if (!action || OC.cur !== o) return;
    const a = Object.assign({}, action);
    delete a.seat;
    if (o.conn.send({ t: 'action', action: a })) o.sentSig = o.waitingSig;
    else UI.toast('通信が切れています。つながり直したら、もう一度操作してください', 3500);
  }

  function reaskOnline(o) {
    if (!o) return;
    if (o.waiting) cancelHuman();
    setTimeout(() => {
      if (OC.cur !== o || o.waiting || o.busy || !o.view || !S) return;
      if (S.phase === 'over') { if (!o.resultsOpen) showOnlineResults(o); return; }
      if (o.view.request) { o.sentSig = ''; askOnline(o, o.view); }
    }, 0);
  }

  function showOnlineResults(o) {
    o.resultsOpen = true;
    if (S.matchOver) { showOnlineFinal(o); return; }
    UI.openDialog(resultsHTML() + '<p>だれかが「次のゲームへ」を押すと、全員の次のゲームが始まります。</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button>' +
      (S.rated ? '' : '<button class="btn btn-ghost" type="button" id="res-lobby">ここで終わる</button>') +
      '<button class="btn btn-gold" type="button" id="res-next">' + nextLabel() + '</button></div>');
    $('res-next').addEventListener('click', () => {
      if (!OC.cur) return;
      OC.cur.conn.send({ t: 'next' });
      $('res-next').disabled = true;
      $('res-next').textContent = '始めています…';
    });
    if ($('res-lobby')) $('res-lobby').addEventListener('click', () => { if (OC.cur) OC.cur.conn.send({ t: 'lobby' }); });
    $('res-leave').addEventListener('click', () => OC.confirmLeave(true));
  }

  function showOnlineFinal(o) {
    const info = S.rated;
    const res = info && info.results ? info.results : [];
    const mine = res[human];
    const box = mine ? CM.rateBoxHTML('オンラインレート', mine, CM.rateNote('sevens', mine)) : '';
    const left = res.filter((r) => r && r.abandoned).map((r) => esc(r.name) + ' さんは途中で抜けたため棄権（' + RT.fmtDelta(r.delta) + '）').join('<br>');
    const dlg = UI.openDialog(CM.finalHTML(S, human, box, res.map((r) => (r && !r.abandoned ? r : null))) + (left ? '<p class="menu-note">' + left + '</p>' : '') +
      (info && !mine ? '<p class="menu-note">途中から参加したので、あなたのレートは変わりません。</p>' : '') +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button><button class="btn btn-gold" type="button" id="res-lobby">部屋に戻る</button></div>');
    CM.animateRate(dlg);
    $('res-lobby').addEventListener('click', () => { if (OC.cur) { OC.cur.conn.send({ t: 'lobby' }); $('res-lobby').disabled = true; } });
    $('res-leave').addEventListener('click', () => OC.confirmLeave(true));
  }

  function chatBubble(seat, name, text, mine) {
    if (!S || !CM.visible('scr-sevens')) return;
    if (mine) seat = human;
    else if (!(seat >= 0) || !S.players[seat] || S.players[seat].name !== name) seat = S.players.findIndex((p) => p.name === name);
    if (seat >= 0) bubble(seat, text, false, 'chat');
  }

  const online = {
    quickUpdate, handleView, reask: reaskOnline, cancelInput: () => cancelHuman(), bubble: chatBubble,
    showResults: showOnlineResults,
    showTable() { showTable(false); },
    rulesDesc: () => 'あなたの七並べのルール（' + rulesSummary(ss.rules) + '）で遊びます。',
    startRules: () => ss.rules,
  };

  // ─────────────────────────────────────────────
  // ルールブック・起動
  // ─────────────────────────────────────────────
  function bookSources() {
    const inGame = S && CM.visible('scr-sevens');
    const list = [];
    if (inGame) list.push({ key: 'game', label: 'このゲーム', rules: S.rules, n: S.n });
    list.push({ key: 'rated', label: 'レート戦', rules: RT.cfg('sevens').rules(), n: 4 });
    if (!inGame) list.push({ key: 'free', label: 'フリー対戦', rules: ss.rules, n: ss.settings.players });
    return list;
  }

  function init() {
    $('sv-menu').innerHTML = A.icon('menu');
    $('sv-book').innerHTML = A.icon('book');
    $('sv-menu').addEventListener('click', openMenu);
    $('sv-book').addEventListener('click', () => (CM.bookOpen() ? CM.closeBook() : CM.openBook('sevens', 'basics', 'game')));
    $('sv-play').disabled = $('sv-pass').disabled = $('sv-hint').disabled = true;
    let rz = 0;
    addEventListener('resize', () => {
      cancelAnimationFrame(rz);
      rz = requestAnimationFrame(() => { if (S && CM.visible('scr-sevens')) renderAll(); });
    });
    document.addEventListener('keydown', (e) => {
      if (!CM.visible('scr-sevens') || !$('overlay').hidden || (e.target && e.target.tagName === 'INPUT')) return;
      if (e.key === 'Enter' && !$('sv-play').disabled) $('sv-play').click();
      if ((e.key === 'p' || e.key === 'P') && !$('sv-pass').disabled) $('sv-pass').click();
    });
  }

  D.Games.sevens = {
    id: 'sevens', label: '七並べ', init, renderHome, bookSources, online,
    state: () => S,
    stopLocal() { if (S && !onlineRoom() && CM.visible('scr-sevens')) persist(); stopLoop(); },
  };
  D.SevensApp = { get state() { return S; }, newMatch, resumeMatch };
})();
