/* 大富豪 — 画面遷移・設定・対局の進行 */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const E = D.Engine, C = D.Cards, RU = D.Rules, AI = D.AI, A = D.Art, SND = D.Sound, UI = D.UI, RT = D.Rating;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const sleep = UI.sleep;

  // ─────────────────────────────────────────────
  // 保存（この端末のブラウザだけ）
  // ─────────────────────────────────────────────
  const STORE_KEY = 'daifugo.v1';
  const DEFAULT_SETTINGS = { players: 4, level: 'normal', games: 10, speed: 'normal', back: 'red', sound: true, autoPass: true, showPlayable: true, name: 'あなた' };
  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { store = {}; }
  store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings || {});
  store.rules = store.rules ? RU.migrate(store.rules) : Object.assign({}, RU.MINE);
  // AI戦のレート（この端末だけ）。hist は最近の試合
  store.rating = Object.assign({ r: RT.START, matches: 0, best: RT.START, hist: [] }, store.rating || {});
  const settings = store.settings;

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても続行 */ }
  }

  let S = null;
  let online = null; // オンライン対戦中の部屋（ローカル対戦中は null）
  let loopToken = 0;
  let humanCancel = null;
  let fastForward = false;

  const SPEEDS = { slow: 1.35, normal: 1, fast: 0.6 };
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applySettings() {
    UI.speed = SPEEDS[settings.speed] || 1;
    if (reduceMotion) UI.speed = Math.min(UI.speed, 0.6);
    document.documentElement.style.setProperty('--speed', String(UI.speed));
    UI.backURI = A.backDataURI(settings.back);
    UI.showPlayable = settings.showPlayable;
    SND.setEnabled(settings.sound);
    $('g-sound').innerHTML = A.icon(settings.sound ? 'soundOn' : 'soundOff');
    $('g-sound').setAttribute('aria-label', settings.sound ? '効果音をオフ' : '効果音をオン');
  }

  // ─────────────────────────────────────────────
  // 画面
  // ─────────────────────────────────────────────
  function showScreen(name) {
    for (const id of ['scr-title', 'scr-rules', 'scr-online', 'scr-game']) $(id).hidden = id !== 'scr-' + name;
    if (name !== 'game') closeBook();
    if (name === 'title') renderTitle();
    if (name === 'rules') renderRules();
    if (name === 'online') renderOnline();
    saveHot();
  }

  const LEVEL_LABEL = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };

  function localRuleCount(r) {
    let k = 0;
    for (const def of RU.RULES) {
      if (def.cat === 'basic') continue;
      if (def.type === 'bool' && r[def.key]) k++;
      if (def.key === 'seqRevolution' && r[def.key] !== 'off') k++;
    }
    return k;
  }

  function presetLabel() {
    const key = RU.presetMatching(store.rules);
    const p = RU.PRESETS.find((x) => x.key === key);
    return p ? p.label : 'カスタム';
  }

  function renderTitle() {
    const fan = $('title-fan');
    if (!fan.childElementCount) {
      const ids = ['C11', 'D12', 'X1', 'H13', 'S14'];
      ids.forEach((id, i) => {
        const el = UI.makeCardEl(id);
        const t = i - 2;
        el.style.transform = 'translateX(calc(-50% + ' + t * 30 + 'px)) rotate(' + t * 13 + 'deg)';
        el.style.zIndex = String(i + 1);
        fan.appendChild(el);
      });
    }
    const rt = store.rating;
    $('title-rating').innerHTML = '<span class="lbl">AI戦レート</span><b>' + rt.r + '</b><span class="sub">' +
      (rt.matches ? rt.matches + '試合 · 最高 ' + rt.best : 'まだレート戦をしていません') + '</span>';
    $('title-rule').innerHTML = 'フリー対戦のルール：<b>' + esc(presetLabel()) + '</b>（ローカルルール ' + localRuleCount(store.rules) + '個）';
    $('title-foot').textContent = 'フリー対戦：AIロボット' + (settings.players - 1) + '体（' + LEVEL_LABEL[settings.level] + '）· ' + settings.players + '人 · ' +
      (settings.games ? settings.games + 'ゲーム' : 'ゲーム数は無制限');
    const m = savedMatch();
    $('btn-resume').hidden = !m;
    if (m) $('btn-resume').textContent = 'つづきから（' + (m.rated ? 'レート戦 ' : '') + '第' + m.gameNo + (m.maxGames ? '/' + m.maxGames : '') + 'ゲーム）';
    // オンライン対戦はアプリ版（GitHub Pages）だけ。Claude のページ内では外と通信できない
    $('btn-online').hidden = !D.Net.available();
    if (!D.Net.available()) $('title-foot').textContent += ' · オンライン対戦はアプリ版で';
  }

  // ─────────────────────────────────────────────
  // ルールと設定
  // ─────────────────────────────────────────────
  function seg(options, value, onPick, disabled) {
    const wrap = document.createElement('div');
    wrap.className = 'seg';
    for (const op of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = op.label;
      b.setAttribute('aria-pressed', String(op.v === value));
      b.disabled = !!disabled;
      b.addEventListener('click', () => { onPick(op.v); });
      wrap.appendChild(b);
    }
    return wrap;
  }
  function toggle(id, checked, onChange, disabled, label) {
    const w = document.createElement('label');
    w.className = 'switch';
    w.innerHTML = '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + ' aria-label="' + esc(label) + '"><span class="track"></span><span class="knob"></span>';
    w.querySelector('input').addEventListener('change', (e) => onChange(e.target.checked));
    return w;
  }
  function row(name, desc, control, extraCls) {
    const r = document.createElement('div');
    r.className = 'row' + (extraCls ? ' ' + extraCls : '');
    r.innerHTML = '<div class="row-text"><div class="row-name">' + esc(name) + '</div>' + (desc ? '<div class="row-desc">' + esc(desc) + '</div>' : '') + '</div>';
    if (control) r.appendChild(control);
    return r;
  }
  function section(title, note) {
    const s = document.createElement('section');
    s.innerHTML = '<h3 class="sect-title">' + esc(title) + (note ? '<small>' + esc(note) + '</small>' : '') + '</h3>';
    const panel = document.createElement('div');
    panel.className = 'card-panel';
    s.appendChild(panel);
    return { s, panel };
  }

  function renderRules() {
    const wrap = $('rules-wrap');
    const keepScroll = $('rules-scroll').scrollTop;
    wrap.innerHTML = '';
    const set = (k, v) => { settings[k] = v; save(); applySettings(); renderRules(); };

    // 対戦設定
    const m = section('対戦設定', 'フリー対戦の設定。レート戦は4人・マイルール・10ゲームで固定');
    m.panel.appendChild(row('人数', 'あなた＋AIロボット', seg([3, 4, 5, 6].map((v) => ({ v, label: v + '人' })), settings.players, (v) => set('players', v))));
    m.panel.appendChild(row('AIの強さ', settings.level === 'hard' ? '手札を読んで先の展開を試算します（考える時間が少し長め）' : '',
      seg([{ v: 'easy', label: 'やさしい' }, { v: 'normal', label: 'ふつう' }, { v: 'hard', label: 'つよい' }], settings.level, (v) => set('level', v))));
    m.panel.appendChild(row('1試合のゲーム数', settings.games ? settings.games + 'ゲームの総得点で順位を決めます' : '終わりなし。好きなところでやめられます',
      seg([{ v: 5, label: '5' }, { v: 10, label: '10' }, { v: 0, label: '無制限' }], settings.games, (v) => set('games', v))));
    m.panel.appendChild(row('スピード', '', seg([{ v: 'slow', label: 'ゆっくり' }, { v: 'normal', label: 'ふつう' }, { v: 'fast', label: 'はやい' }], settings.speed, (v) => set('speed', v))));
    const sw = document.createElement('div');
    sw.className = 'swatches';
    for (const key of Object.keys(A.BACKS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.backgroundImage = A.backDataURI(key);
      b.setAttribute('aria-label', 'カードの裏：' + A.BACKS[key].label);
      b.setAttribute('aria-pressed', String(settings.back === key));
      b.addEventListener('click', () => set('back', key));
      sw.appendChild(b);
    }
    m.panel.appendChild(row('カードの裏', '', sw));
    const nameIn = document.createElement('input');
    nameIn.className = 'name-input';
    nameIn.id = 'opt-name';
    nameIn.maxLength = 8;
    nameIn.value = settings.name;
    nameIn.setAttribute('aria-label', 'あなたの名前');
    nameIn.addEventListener('change', () => { settings.name = nameIn.value.trim() || 'あなた'; save(); });
    m.panel.appendChild(row('あなたの名前', '', nameIn));
    m.panel.appendChild(row('効果音', '', toggle('opt-sound', settings.sound, (v) => set('sound', v), false, '効果音')));
    m.panel.appendChild(row('出せないときは自動でパス', '', toggle('opt-autopass', settings.autoPass, (v) => set('autoPass', v), false, '自動パス')));
    m.panel.appendChild(row('出せるカードを明るく表示', '', toggle('opt-playable', settings.showPlayable, (v) => set('showPlayable', v), false, '出せるカードを表示')));
    wrap.appendChild(m.s);

    // プリセット
    const cur = RU.presetMatching(store.rules);
    const ps = document.createElement('section');
    ps.innerHTML = '<h3 class="sect-title">ルールのセット<small>選んでから下で1つずつ変えられます</small></h3>';
    const pl = document.createElement('div');
    pl.className = 'presets';
    for (const p of RU.PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.setAttribute('aria-pressed', String(cur === p.key));
      b.innerHTML = '<b>' + esc(p.label) + '</b><span>' + esc(p.desc) + '</span>';
      b.addEventListener('click', () => { store.rules = Object.assign({}, p.rules); save(); renderRules(); });
      pl.appendChild(b);
    }
    ps.appendChild(pl);
    if (!cur) {
      const note = document.createElement('p');
      note.className = 'custom-note';
      note.textContent = 'いまはカスタム（どのセットとも違う組み合わせ）です。';
      ps.appendChild(note);
    }
    wrap.appendChild(ps);

    // ルール一覧
    const R = store.rules;
    for (const cat of RU.CATEGORIES) {
      const sct = section(cat.label);
      for (const def of RU.RULES.filter((d) => d.cat === cat.key)) {
        const disabled = def.needs && !R[def.needs];
        const setRule = (v) => { store.rules[def.key] = v; save(); renderRules(); };
        const ctl = def.type === 'bool'
          ? toggle('rule-' + def.key, R[def.key], setRule, disabled, def.label)
          : seg(def.options, R[def.key], setRule, disabled);
        const wideChoice = def.type === 'choice' && (def.options.length > 2 || def.options.reduce((k, o) => k + o.label.length, 0) > 8);
        const r = row(def.label, def.desc, ctl, (disabled ? 'disabled ' : '') + (wideChoice ? 'col' : ''));
        sct.panel.appendChild(r);
      }
      wrap.appendChild(sct.s);
    }
    $('rules-scroll').scrollTop = keepScroll;
  }

  // ─────────────────────────────────────────────
  // 対局の開始・再開
  // ─────────────────────────────────────────────
  /** つづきから遊べる対局（終わった試合は含めない） */
  function savedMatch() {
    const m = store.match;
    if (!m || !(m.phase === 'play' || m.phase === 'exchange' || m.phase === 'over') || m.matchOver) return null;
    return m;
  }

  /** 新しい試合。opts.rated ならレート戦（4人・マイルール・10ゲーム、AIの強さは opts.level） */
  function newMatch(opts) {
    const rated = !!(opts && opts.rated);
    // 途中のレート戦を捨てて始めるときは、先に棄権の確認
    const m = savedMatch();
    if (m && m.rated && !(opts && opts.abandoned)) { askAbandon(() => newMatch(Object.assign({}, opts, { abandoned: true }))); return; }
    cancelLoop();
    leaveRoom(true);
    const n = rated ? RT.PLAYERS : settings.players;
    const level = rated ? opts.level : settings.level;
    const players = [{ name: settings.name || 'あなた', human: true }];
    for (let i = 1; i < n; i++) players.push({ name: A.ROBOTS[i - 1].name, level });
    const info = rated ? { level, base: [store.rating.r].concat(players.slice(1).map(() => RT.AI[level])), matches: store.rating.matches, result: null } : null;
    S = E.createMatch({ rules: rated ? RT.rules() : store.rules, players, games: rated ? RT.GAMES : settings.games, rated: info });
    UI.S = S;
    UI.human = 0;
    UI.seatInfo = null;
    UI.logLines = [];
    UI.resetTable();
    fastForward = false;
    showScreen('game');
    startNextGame();
  }

  async function startNextGame() {
    if (S.matchOver) return;
    const token = ++loopToken;
    fastForward = false;
    UI.hidePrompt();
    S.events = [];
    E.startGame(S);
    const evs = S.events.slice();
    S.events = [];
    UI.syncVM();
    UI.renderAll();
    persist();
    await UI.playEvents(evs);
    if (token === loopToken) runLoop();
  }

  function resumeMatch() {
    if (!store.match) return;
    cancelLoop();
    leaveRoom(true);
    UI.seatInfo = null;
    try {
      S = E.deserialize(store.match);
      S.rules = RU.migrate(S.rules);
    } catch (e) {
      UI.toast('保存された対局を読み込めませんでした');
      return;
    }
    UI.S = S;
    UI.human = 0;
    UI.logLines = Array.isArray(store.log) ? store.log.slice(-200) : [];
    UI.resetTable();
    fastForward = false;
    showScreen('game');
    UI.syncVM();
    UI.renderAll();
    if (S.phase === 'over') showResults(++loopToken);
    else runLoop();
  }

  function persist() {
    if (!S || online) return; // オンライン対戦の状態はサーバーが持つ
    try {
      store.match = E.serialize(S);
      store.log = UI.logLines.slice(-120);
      save();
    } catch (e) { /* 保存できなくても続行 */ }
    saveHot();
  }

  function cancelHuman() {
    if (humanCancel) { const c = humanCancel; humanCancel = null; c(); }
  }

  function cancelLoop() {
    loopToken++;
    cancelHuman();
    UI.closeDialog();
    UI.hidePrompt();
  }

  // ─────────────────────────────────────────────
  // 進行ループ
  // ─────────────────────────────────────────────
  function thinkTime(q) {
    const base = q.kind === 'turn' ? 620 : 420;
    const f = fastForward ? 0 : S.players[UI.human].out ? 0.55 : 1;
    return (base + Math.random() * 260) * UI.speed * f;
  }

  async function runLoop() {
    const token = ++loopToken;
    while (token === loopToken) {
      const q = E.getRequest(S);
      if (!q) {
        if (S.phase === 'over') await showResults(token);
        return;
      }
      const P = S.players[q.seat];
      let action = null;
      if (P.human) {
        action = await humanAction(q);
        if (token !== loopToken || !action) return;
      } else {
        if (!fastForward) UI.setThinking(q.seat, true);
        const t0 = performance.now();
        try {
          // レート戦はAIのレートを測ったときと同じ考える時間（スピード設定で弱くならないように）
          action = await AI.decide(S, q, P.level, Math.round(420 * (S.rated ? 1 : UI.speed)));
        } catch (err) {
          console.error(err);
          action = fallbackAction(q);
        }
        const wait = thinkTime(q) - (performance.now() - t0);
        if (wait > 0) await sleep(wait);
        UI.setThinking(q.seat, false);
        if (token !== loopToken) return;
      }
      let evs;
      try {
        evs = E.apply(S, action);
      } catch (err) {
        if (P.human) { UI.toast(err.message); SND.play('error'); continue; }
        console.error(err);
        try { evs = E.apply(S, fallbackAction(q)); } catch (e2) { console.error(e2); return; }
      }
      if (S.matchOver) applyRated(); // 演出の途中で閉じてもレートが反映されるように先に
      if (fastForward) { UI.syncVM(); UI.renderAll(); for (const ev of evs) if (ev.t !== 'deal') logEventQuick(ev); }
      else await UI.playEvents(evs);
      persist();
      if (token !== loopToken) return;
      maybeOfferFastForward();
    }
  }

  function logEventQuick(ev) {
    if (ev.t === 'finish') UI.logLine('◆ ' + UI.nameOf(ev.seat) + ' 上がり（' + ev.place + '位）', 'sys');
    else if (ev.t === 'foul') UI.logLine('◆ ' + UI.nameOf(ev.seat) + ' 反則上がり', 'sys');
    else if (ev.t === 'play') UI.logLine(UI.nameOf(ev.seat) + '：' + E.describePlay(ev.play));
  }

  function fallbackAction(q) {
    try { return AI.decideSync(S, q, 'normal'); } catch (e) { /* 下へ */ }
    if (q.kind === 'turn') {
      if (E.topPlay(S)) return { type: 'pass', seat: q.seat };
      return { type: 'play', seat: q.seat, play: E.legalPlays(S, q.seat)[0] };
    }
    if (q.kind === 'stop') return { type: 'nostop', seat: q.seat };
    if (q.kind === 'bomb') return { type: 'bomb', seat: q.seat, ranks: [] };
    if (q.kind === 'tenpen') return { type: 'tenpen', seat: q.seat, accept: false };
    if (q.kind === 'exchange') return { type: 'exchange', seat: q.seat, cards: S.players[q.seat].hand.slice(0, q.count) };
    return { type: q.kind, seat: q.seat, cards: [] };
  }

  function maybeOfferFastForward() {
    if (fastForward || S.phase !== 'play' || !S.players[UI.human].out) return;
    if (!$('prompt').hidden) return;
    const place = S.finished.indexOf(UI.human);
    const msg = S.players[UI.human].foul ? 'あなたは反則上がりでした。' : 'あなたは <b>' + (place + 1) + '位</b> で上がりました。';
    UI.showPrompt(msg + '残りの対局を見ています。', [
      { label: '結果まで早送り', primary: true, onClick: () => { fastForward = true; UI.hidePrompt(); } },
    ]);
  }

  // ─────────────────────────────────────────────
  // 人間の操作
  // ─────────────────────────────────────────────
  function humanAction(q) {
    return new Promise((resolve) => {
      let settled = false;
      const cleanups = [];
      const finish = (action) => {
        if (settled) return;
        settled = true;
        humanCancel = null;
        for (const f of cleanups) f();
        resolve(action);
      };
      humanCancel = () => finish(null);
      const ctx = { q, finish, onCleanup: (f) => cleanups.push(f) };
      switch (q.kind) {
        case 'turn': return humanTurn(ctx);
        case 'stop': return humanStop(ctx);
        case 'give': return humanSelectCards(ctx, q.label, UI.nameOf(q.to) + ' に渡すカードを <b>' + q.count + '枚まで</b> えらんでください', '渡す', '渡さない');
        case 'discard': return humanSelectCards(ctx, '10捨て', '捨てるカードを <b>' + q.count + '枚まで</b> えらんでください', '捨てる', '捨てない');
        case 'exchange': return humanExchange(ctx);
        case 'pickup': return humanPickup(ctx);
        case 'bomb': return humanBomb(ctx);
        case 'tenpen': return humanTenpen(ctx);
      }
      finish(fallbackAction(q));
    });
  }

  function setActionButtons(state) {
    $('b-play').disabled = !state.play;
    $('b-pass').disabled = !state.pass;
    $('b-hint').disabled = !state.hint;
  }

  function humanTurn(ctx) {
    const { q, finish, onCleanup } = ctx;
    const seat = q.seat;
    const legal = E.legalPlays(S, seat);
    const canPass = !!E.topPlay(S);
    UI.vm.turn = seat;
    UI.renderStatus(); UI.renderMe(); UI.renderSeats();
    SND.play('turn');
    if (!legal.length && canPass && settings.autoPass) {
      UI.toast('出せるカードがないのでパスします', 1500);
      const t = setTimeout(() => finish({ type: 'pass', seat }), 1000 * UI.speed);
      onCleanup(() => clearTimeout(t));
      return;
    }
    if (settings.showPlayable) {
      const set = new Set();
      for (const p of legal) for (const id of p.cards) set.add(id);
      UI.dimSet = set;
    }
    UI.setSelectable(true, 0);
    const info = $('sel-info');
    const update = () => {
      const sel = Array.from(UI.sel);
      info.className = 'sel-info';
      if (!sel.length) {
        info.textContent = canPass ? (legal.length ? 'カードをえらぶか、パス' : '出せるカードがありません') : 'あなたが親。好きなカードをどうぞ';
        $('b-play').disabled = true;
        return;
      }
      const plays = E.playsForCards(S, seat, sel);
      if (plays.length) {
        info.className = 'sel-info ok';
        info.textContent = E.describePlay(plays[0]) + (plays.length > 1 ? ' ほか' : '') + effectNote(plays[0]);
        $('b-play').disabled = false;
      } else {
        info.className = 'sel-info ng';
        info.textContent = E.explainIllegal(S, seat, sel);
        $('b-play').disabled = true;
      }
    };
    UI.onSelChange = update;
    setActionButtons({ play: false, pass: canPass, hint: true });
    update();
    $('b-play').onclick = async () => {
      const sel = Array.from(UI.sel);
      const plays = E.playsForCards(S, seat, sel);
      if (!plays.length) { SND.play('error'); return; }
      let p = plays[0];
      if (plays.length > 1) {
        p = await chooseInterpretation(plays);
        if (!p) return;
      }
      finish({ type: 'play', seat, play: p });
    };
    $('b-pass').onclick = () => { if (canPass) finish({ type: 'pass', seat }); };
    $('b-hint').onclick = () => {
      const a = AI.suggest(S, seat);
      if (a.type === 'pass') { UI.clearSelection(); UI.toast('おすすめ：パス'); }
      else { UI.setHint(a.play.cards); UI.toast('おすすめ：' + E.describePlay(a.play)); }
      update();
    };
    onCleanup(() => {
      UI.onSelChange = null;
      UI.dimSet = null;
      UI.hintSet = null;
      UI.setSelectable(false);
      $('b-play').onclick = $('b-pass').onclick = $('b-hint').onclick = null;
      setActionButtons({});
      info.textContent = '';
      info.className = 'sel-info';
    });
  }

  function effectNote(p) {
    const fx = E.effectsOf(p, S);
    const notes = [];
    if (fx.sand) notes.push('砂嵐');
    if (fx.revolution) notes.push('革命');
    if (fx.flow) notes.push({ '8': '8切り', '66': 'ろくろ首', '99': '救急車' }[fx.flow]);
    if (fx.jToggles % 2) notes.push('Jバック');
    if (fx.skip) notes.push(fx.skip + '人スキップ');
    if (fx.give) notes.push('7渡し');
    if (fx.back) notes.push('9戻し');
    if (fx.discard) notes.push('10捨て');
    if (fx.bomb) notes.push('12ボンバー');
    if (fx.take) notes.push('A拾い');
    const top = E.topPlay(S);
    if (top && top.wild && p.cards[0] === 'S3' && S.rules.spade3) notes.push('スペ3返し');
    return notes.length ? '（' + notes.join('・') + '）' : '';
  }

  function chooseInterpretation(plays) {
    return new Promise((resolve) => {
      const opts = plays.map((p, i) => '<button class="opt" type="button" data-i="' + i + '">' + UI.miniCards(p.cards) +
        '<span><b>' + esc(E.describePlay(p)) + '</b><small>' + esc(effectNote(p).replace(/[（）]/g, '') || 'ふつうに出す') + '</small></span></button>').join('');
      const dlg = UI.openDialog('<h3>どの出し方にしますか？</h3><p>ジョーカーの使い方が何通りかあります。</p><div class="opt-list">' + opts +
        '</div><div class="btns"><button class="btn btn-ghost" type="button" id="dlg-cancel">やめる</button></div>', { onBackdrop: () => { UI.closeDialog(); resolve(null); } });
      dlg.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => { UI.closeDialog(); resolve(plays[+b.dataset.i]); }));
      $('dlg-cancel').addEventListener('click', () => { UI.closeDialog(); resolve(null); });
    });
  }

  const FLOW_NAMES = { '8': '8切り', '66': 'ろくろ首', '99': '救急車' };
  const STOP_INFO = {
    four: { name: '4止め', desc: '4を2枚出して8切りを止めます' },
    three: { name: '3止め', desc: '3を2枚出してスキップを止めます' },
    sand: { name: '砂嵐', desc: '3を3枚出して止めます' },
  };

  function humanStop(ctx) {
    const { q, finish, onCleanup } = ctx;
    const opts = E.stopOptions(S, q.seat);
    const trig = q.trigger;
    let what;
    if (trig.flow) what = FLOW_NAMES[trig.flow];
    else {
      const p = trig.play;
      const kind = p.type !== 'seq' && p.rank === 13 ? '13スキップ' : p.type !== 'seq' && p.rank === 5 ? '5スキップ' : 'スキップ';
      const skipped = E.skipTargets(S, trig.seat, trig.skip).map((s) => (s === UI.human ? 'あなた' : S.players[s].name));
      what = kind + '（' + skipped.join('・') + ' が飛ばされる）';
    }
    SND.play('turn');
    const html = '<h3>止めますか？</h3><p>' + esc(UI.nameOf(trig.seat)) + ' の <b>' + esc(what) + '</b><br>止めると場が流れて、あなたが親になります。</p><div class="opt-list">' +
      opts.map((o, i) => '<button class="opt" type="button" data-i="' + i + '">' + UI.miniCards(o.play.cards) + '<span><b>' + STOP_INFO[o.kind].name +
        '</b><small>' + STOP_INFO[o.kind].desc + '</small></span></button>').join('') +
      '</div><div class="btns"><button class="btn btn-ghost" type="button" id="dlg-no">止めない</button></div>';
    const dlg = UI.openDialog(html);
    dlg.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => finish({ type: 'stop', seat: q.seat, kind: opts[+b.dataset.i].kind })));
    $('dlg-no').addEventListener('click', () => finish({ type: 'nostop', seat: q.seat }));
    onCleanup(() => UI.closeDialog());
  }

  function humanSelectCards(ctx, title, text, okLabel, noLabel) {
    const { q, finish, onCleanup } = ctx;
    UI.setSelectable(true, q.count);
    SND.play('turn');
    const refresh = () => {
      const n = UI.sel.size;
      const ok = $('pr-ok');
      if (ok) { ok.disabled = n === 0; ok.textContent = n ? okLabel + '（' + n + '枚）' : okLabel; }
    };
    UI.showPrompt('<b>' + esc(title) + '</b>：' + text, [
      { label: noLabel, onClick: () => finish({ type: q.kind, seat: q.seat, cards: [] }) },
      { label: okLabel, primary: true, id: 'pr-ok', onClick: () => finish({ type: q.kind, seat: q.seat, cards: Array.from(UI.sel) }) },
    ]);
    UI.onSelChange = refresh;
    refresh();
    onCleanup(() => { UI.onSelChange = null; UI.setSelectable(false); UI.hidePrompt(); });
  }

  function humanExchange(ctx) {
    const { q, finish, onCleanup } = ctx;
    UI.setSelectable(true, q.count);
    SND.play('turn');
    const got = q.got && q.got.length ? UI.nameOf(q.to) + ' から <b>' + q.got.map(C.cardLabel).join(' ') + '</b> を受け取りました。' : '';
    const refresh = () => {
      const ok = $('pr-ok');
      if (ok) ok.disabled = UI.sel.size !== q.count;
    };
    UI.showPrompt('<b>カード交換</b>：' + got + 'お返しに渡すカードを <b>' + q.count + '枚</b> えらんでください', [
      { label: '渡す', primary: true, id: 'pr-ok', onClick: () => { if (UI.sel.size === q.count) finish({ type: 'exchange', seat: q.seat, cards: Array.from(UI.sel) }); } },
    ]);
    UI.onSelChange = refresh;
    refresh();
    onCleanup(() => { UI.onSelChange = null; UI.setSelectable(false); UI.hidePrompt(); });
  }

  function humanPickup(ctx) {
    const { q, finish, onCleanup } = ctx;
    const chosen = new Set();
    const cards = q.cards.map((id) => '<div class="card" role="button" tabindex="0" data-id="' + id + '" aria-label="' + esc(C.cardLabel(id)) + '">' + A.faceSVG(id) + '</div>').join('');
    const dlg = UI.openDialog('<h3>A拾い</h3><p>1つ前に出されたカードを手札にできます。拾うカードをえらんでください。</p><div class="pick-cards">' + cards +
      '</div><div class="btns"><button class="btn btn-ghost" type="button" id="dlg-no">拾わない</button><button class="btn btn-gold" type="button" id="dlg-ok" disabled>拾う</button></div>');
    const ok = $('dlg-ok');
    dlg.querySelectorAll('.pick-cards .card').forEach((el) => {
      const tap = () => {
        const id = el.dataset.id;
        if (chosen.has(id)) chosen.delete(id); else chosen.add(id);
        el.classList.toggle('sel', chosen.has(id));
        ok.disabled = !chosen.size;
        ok.textContent = chosen.size ? '拾う（' + chosen.size + '枚）' : '拾う';
        SND.play('select');
      };
      el.addEventListener('click', tap);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    });
    $('dlg-no').addEventListener('click', () => finish({ type: 'pickup', seat: q.seat, cards: [] }));
    ok.addEventListener('click', () => finish({ type: 'pickup', seat: q.seat, cards: Array.from(chosen) }));
    onCleanup(() => UI.closeDialog());
  }

  function humanBomb(ctx) {
    const { q, finish, onCleanup } = ctx;
    const chosen = new Set();
    const hand = S.players[q.seat].hand;
    const grid = q.ranks.map((r) => {
      const mine = hand.filter((id) => !C.isJoker(id) && C.rankOf(id) === r).length;
      return '<button class="rank-btn" type="button" data-r="' + r + '" aria-pressed="false"><b>' + C.rankLabel(r) + '</b><small>手札 ' + mine + '枚</small></button>';
    }).join('');
    const dlg = UI.openDialog('<h3>12ボンバー</h3><p>あなたの手札にある数字から <b>' + q.count + 'つまで</b> 指名できます。全員（あなたも）その数字のカードを全部捨てます。</p><div class="rank-grid">' + grid +
      '</div><div class="btns"><button class="btn btn-ghost" type="button" id="dlg-no">指名しない</button><button class="btn btn-gold" type="button" id="dlg-ok" disabled>指名する</button></div>');
    $('dlg-no').addEventListener('click', () => finish({ type: 'bomb', seat: q.seat, ranks: [] }));
    const ok = $('dlg-ok');
    dlg.querySelectorAll('.rank-btn').forEach((b) => b.addEventListener('click', () => {
      const r = +b.dataset.r;
      if (chosen.has(r)) chosen.delete(r);
      else {
        if (chosen.size >= q.count) {
          if (q.count === 1) { chosen.clear(); dlg.querySelectorAll('.rank-btn').forEach((x) => x.setAttribute('aria-pressed', 'false')); }
          else { UI.toast(q.count + 'つまでです'); return; }
        }
        chosen.add(r);
      }
      b.setAttribute('aria-pressed', String(chosen.has(r)));
      ok.disabled = !chosen.size;
      SND.play('select');
    }));
    ok.addEventListener('click', () => finish({ type: 'bomb', seat: q.seat, ranks: Array.from(chosen) }));
    onCleanup(() => UI.closeDialog());
  }

  function humanTenpen(ctx) {
    const { q, finish, onCleanup } = ctx;
    SND.play('special');
    UI.openDialog('<h3>天変地異</h3><p>あなたの手札は10以下のカードだけです。<br>' + esc(UI.nameOf(q.rich)) + '（大富豪）と手札を全部交換しますか？</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="dlg-no">しない</button><button class="btn btn-gold" type="button" id="dlg-ok">交換する</button></div>');
    $('dlg-ok').addEventListener('click', () => finish({ type: 'tenpen', seat: q.seat, accept: true }));
    $('dlg-no').addEventListener('click', () => finish({ type: 'tenpen', seat: q.seat, accept: false }));
    onCleanup(() => UI.closeDialog());
  }

  // ─────────────────────────────────────────────
  // レート戦（AI戦のレートはこの端末だけに保存）
  // ─────────────────────────────────────────────
  const fmtExp = (v) => (Math.abs(v) < 0.05 ? '±0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1));

  function recordRating(delta, entry) {
    const rt = store.rating;
    const before = rt.r;
    rt.r = before + delta;
    rt.matches++;
    rt.best = Math.max(rt.best, rt.r);
    rt.hist.push(Object.assign({ at: Date.now(), before, after: rt.r, d: delta }, entry));
    if (rt.hist.length > 50) rt.hist.splice(0, rt.hist.length - 50);
    return { before, after: rt.r };
  }

  /** 最後のゲームが終わったらレートを更新する（1試合に1回だけ） */
  function applyRated() {
    const info = S && S.rated;
    if (online || !info || info.result || !S.matchOver) return;
    const total = S.players[0].score;
    const c = RT.change(info.base[0], info.base.slice(1), total, S.maxGames, info.matches);
    const r = recordRating(c.delta, { total, level: info.level });
    info.result = { before: r.before, after: r.after, delta: c.delta, expected: c.expected, total };
    persist();
  }

  /** 途中のレート戦を棄権する（残りのゲームは大貧民として計算） */
  function abandonRated() {
    const m = store.match;
    if (!m || !m.rated || m.matchOver || m.rated.result) return null;
    const played = (m.history || []).length;
    const total = RT.abandonTotal(m.players[0].score, played, m.maxGames, m.n);
    const c = RT.change(m.rated.base[0], m.rated.base.slice(1), total, m.maxGames, m.rated.matches);
    const r = recordRating(c.delta, { total, level: m.rated.level, abandoned: true });
    store.match = null;
    store.log = [];
    save();
    return { before: r.before, after: r.after, delta: c.delta };
  }

  function abandonNote(m) {
    const left = m.maxGames - (m.history || []).length;
    return '残りの' + left + 'ゲームは <b>大貧民（−3点）</b> として計算され、レートが下がります。';
  }

  /** タイトルから新しく始めるとき、途中のレート戦があれば「つづきから／棄権」をたずねる */
  function askAbandon(onAbandoned) {
    const m = savedMatch();
    UI.openDialog('<h3>途中のレート戦があります</h3><p>第' + m.gameNo + '/' + m.maxGames + 'ゲームの途中です。新しく始めると棄権になり、' + abandonNote(m) + '</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="ab-no">やめる</button>' +
      '<button class="btn btn-ghost" type="button" id="ab-yes">棄権する</button>' +
      '<button class="btn btn-gold" type="button" id="ab-resume">つづきから</button></div>', { onBackdrop: UI.closeDialog });
    $('ab-no').addEventListener('click', UI.closeDialog);
    $('ab-resume').addEventListener('click', () => { UI.closeDialog(); resumeMatch(); });
    $('ab-yes').addEventListener('click', () => {
      const r = abandonRated();
      UI.closeDialog();
      if (r) UI.toast('棄権しました。レート ' + r.before + ' → ' + r.after + '（' + RT.fmtDelta(r.delta) + '）', 3500);
      renderTitle();
      onAbandoned();
    });
  }

  /** レート戦を始める画面（AIの強さを選ぶ） */
  function openRated() {
    const m = savedMatch();
    if (m && m.rated) { askAbandon(openRated); return; }
    const my = store.rating.r;
    const opts = ['easy', 'normal', 'hard'].map((lv) => {
      const ai = RT.AI[lv];
      const exp = RT.expectedPoints(my, [ai, ai, ai]) * RT.GAMES;
      return '<button class="opt lvl" type="button" data-lv="' + lv + '"><span class="lvl-name"><b>' + LEVEL_LABEL[lv] + '</b><small>AIのレート ' + ai +
        (lv === 'hard' ? '・考える時間が長め' : '') + '</small></span><span class="lvl-exp"><small>予想の総得点</small><b>' + fmtExp(exp) + '</b></span></button>';
    }).join('');
    const dlg = UI.openDialog('<h3>レート戦</h3><p>4人・<b>マイルール</b>・全10ゲーム。10ゲームの総得点が<br>「予想の総得点」より多ければレートが上がります。</p>' +
      '<div class="rate-now">あなたのレート <b>' + my + '</b>' + (store.rating.matches < RT.NEW_MATCHES ? '<small>はじめの' + RT.NEW_MATCHES + '試合は大きく動きます</small>' : '') + '</div>' +
      '<div class="opt-list">' + opts + '</div>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="rt-book">ルールを見る</button><button class="btn btn-ghost" type="button" id="rt-cancel">やめる</button></div>',
    { onBackdrop: UI.closeDialog });
    dlg.querySelectorAll('.lvl').forEach((b) => b.addEventListener('click', () => { UI.closeDialog(); SND.unlock(); newMatch({ rated: true, level: b.dataset.lv }); }));
    $('rt-book').addEventListener('click', () => { UI.closeDialog(); openBook('rules', 'rated'); });
    $('rt-cancel').addEventListener('click', UI.closeDialog);
  }

  // ─────────────────────────────────────────────
  // 結果・メニュー
  // ─────────────────────────────────────────────
  const ptsHTML = (v, unit) => '<span class="' + UI.ptsClass(v) + '">' + UI.fmtPts(v) + (unit || '') + '</span>';

  function resultsHTML() {
    const ranking = S.prevRanking;
    const last = S.history[S.history.length - 1];
    const rows = ranking.map((seat, i) => {
      const P = S.players[seat];
      const t = E.titleOf(S.n, i);
      const note = P.foul ? '反則上がり' : '';
      const pts = last ? last.pts[seat] : E.pointsFor(S.n, i);
      return '<div class="res-row' + (seat === UI.human ? ' me' : '') + '"><span class="pl">' + (i + 1) + '</span>' +
        '<span><span class="title-chip ' + UI.TITLE_CLASS[t] + '">' + t + '</span></span>' +
        '<span class="nm">' + esc(P.name) + (note ? '<small>' + note + '</small>' : '') + '</span>' +
        '<span class="pt">' + ptsHTML(pts) + '<small>計 ' + UI.fmtPts(P.score) + '</small></span></div>';
    }).join('');
    const myPlace = ranking.indexOf(UI.human);
    const head = myPlace < 0 ? '' : myPlace === 0 ? 'あなたが大富豪！' : 'あなたは ' + E.titleOf(S.n, myPlace);
    if (myPlace === 0) SND.play('fanfare');
    const left = S.maxGames ? S.maxGames - S.gameNo : 0;
    return '<h3>第' + S.gameNo + 'ゲーム 結果</h3><p>' + esc(head) + (S.rules.exchange ? '　次のゲームは身分に応じてカード交換から。' : '') +
      (S.maxGames ? '<br>' + (S.rated ? 'レート戦 ' : '') + '残り ' + left + 'ゲーム' : '') + '</p>' +
      '<div class="results">' + rows + '</div>';
  }

  function nextLabel() {
    return '次のゲームへ' + (S.maxGames ? '（' + (S.gameNo + 1) + '/' + S.maxGames + '）' : '');
  }

  function showResults(token) {
    if (S.matchOver) return showFinal();
    return new Promise((resolve) => {
      UI.hidePrompt();
      UI.openDialog(resultsHTML() +
        '<div class="btns"><button class="btn btn-ghost" type="button" id="res-title">タイトルへ</button><button class="btn btn-gold" type="button" id="res-next">' + nextLabel() + '</button></div>');
      $('res-next').addEventListener('click', () => { UI.closeDialog(); resolve(); if (token === loopToken) startNextGame(); });
      $('res-title').addEventListener('click', () => { UI.closeDialog(); resolve(); cancelLoop(); showScreen('title'); });
    });
  }

  /** 試合の最終結果（順位・ゲームごとの得点表）。rateHTML はレート戦のときのレート欄、deltas は席ごとのレート変動 */
  function finalHTML(rateHTML, deltas) {
    const st = E.standings(S);
    const me = st.find((r) => r.seat === UI.human);
    const rows = st.map((r) => {
      const P = S.players[r.seat];
      const d = deltas && deltas[r.seat];
      return '<div class="res-row fin' + (r.seat === UI.human ? ' me' : '') + '"><span class="pl">' + r.place + '</span>' +
        '<span class="nm">' + esc(P.name) + (r.seat === UI.human ? '<em>あなた</em>' : '') +
        (d ? '<small class="rt">レート ' + d.after + '（' + RT.fmtDelta(d.delta) + '）</small>' : '') + '</span>' +
        '<span class="pt big">' + ptsHTML(r.score, '<small>点</small>') + '</span></div>';
    }).join('');
    const body = st.map((r) => {
      const P = S.players[r.seat];
      const cells = S.history.map((h) => '<td class="' + UI.ptsClass(h.pts[r.seat]) + '">' + UI.fmtPts(h.pts[r.seat]) + '</td>').join('');
      return '<tr' + (r.seat === UI.human ? ' class="mine"' : '') + '><th>' + esc(r.seat === UI.human ? 'あなた' : P.name) + '</th>' + cells +
        '<td class="tot ' + UI.ptsClass(P.score) + '">' + UI.fmtPts(P.score) + '</td></tr>';
    }).join('');
    const cols = S.history.map((_, i) => '<th>' + (i + 1) + '</th>').join('');
    const msg = !me ? '' : me.place === 1 ? 'あなたが優勝！' : 'あなたは ' + me.place + '位';
    if (me && me.place === 1) SND.play('fanfare');
    return '<h3>試合終了</h3><p>' + esc(msg) + '　全' + S.history.length + 'ゲームの総得点で順位を決めました。</p>' +
      '<div class="results">' + rows + '</div>' + (rateHTML || '') +
      '<details class="score-details"><summary>ゲームごとの得点</summary><div class="score-wrap"><table class="score-table"><thead><tr><th></th>' + cols +
      '<th>計</th></tr></thead><tbody>' + body + '</tbody></table></div></details>';
  }

  function rateBoxHTML(label, r, note) {
    return '<div class="rate-box"><div class="rate-lbl">' + esc(label) + '</div><div class="rate-nums"><span class="old">' + r.before + '</span><span class="arrow">→</span>' +
      '<b class="new" data-from="' + r.before + '" data-to="' + r.after + '">' + r.before + '</b><span class="delta ' + UI.ptsClass(r.delta) + '">' + RT.fmtDelta(r.delta) + '</span></div>' +
      (note ? '<div class="rate-note">' + note + '</div>' : '') + '</div>';
  }

  /** レートの数字を数え上げる */
  function animateRate(root) {
    const el = root && root.querySelector('.rate-box .new');
    if (!el) return;
    const from = +el.dataset.from, to = +el.dataset.to;
    const dur = 900 * UI.speed;
    setTimeout(() => {
      if (to > from) SND.play('special');
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
        if (k < 1 && el.isConnected) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, 450);
  }

  function showFinal() {
    return new Promise((resolve) => {
      applyRated();
      UI.hidePrompt();
      const res = S.rated && S.rated.result;
      const box = res ? rateBoxHTML('AI戦レート', res, '予想の総得点 ' + fmtExp(res.expected) + ' に対して、あなたは ' + UI.fmtPts(res.total) + '点') : '';
      const dlg = UI.openDialog(finalHTML(box) +
        '<div class="btns"><button class="btn btn-ghost" type="button" id="fin-title">タイトルへ</button><button class="btn btn-gold" type="button" id="fin-again">' +
        (S.rated ? 'もう一度レート戦' : 'もう一度') + '</button></div>');
      animateRate(dlg);
      $('fin-again').addEventListener('click', () => { UI.closeDialog(); resolve(); newMatch(S.rated ? { rated: true, level: S.rated.level } : undefined); });
      $('fin-title').addEventListener('click', () => { UI.closeDialog(); resolve(); cancelLoop(); showScreen('title'); });
    });
  }

  function openMenu() {
    if (online) { openOnlineMenu(); return; }
    const ratedLive = S && S.rated && !S.matchOver;
    UI.openDialog('<h3>メニュー</h3><div class="menu-list">' +
      '<button class="btn btn-gold" type="button" id="m-close">対局に戻る</button>' +
      '<button class="btn btn-ghost" type="button" id="m-book">ルールブック</button>' +
      (ratedLive ? '<button class="btn btn-ghost" type="button" id="m-abandon">棄権する</button>'
        : '<button class="btn btn-ghost" type="button" id="m-restart">最初からやり直す</button>') +
      '<button class="btn btn-ghost" type="button" id="m-title">タイトルに戻る</button></div>' +
      (ratedLive ? '<p class="menu-note">タイトルに戻っても、レート戦は「つづきから」で再開できます。</p>' : ''), { onBackdrop: closeMenu });
    $('m-close').addEventListener('click', closeMenu);
    $('m-book').addEventListener('click', () => { closeMenu(); openBook('rules'); });
    if (ratedLive) {
      $('m-abandon').addEventListener('click', () => {
        persist();
        UI.openDialog('<h3>棄権しますか？</h3><p>' + abandonNote(store.match) + '</p><div class="btns">' +
          '<button class="btn btn-ghost" type="button" id="m-no">やめる</button><button class="btn btn-gold" type="button" id="m-yes">棄権する</button></div>', { onBackdrop: closeMenu });
        $('m-no').addEventListener('click', closeMenu);
        $('m-yes').addEventListener('click', () => {
          cancelLoop();
          const r = abandonRated();
          const dlg = UI.openDialog('<h3>棄権しました</h3>' + (r ? rateBoxHTML('AI戦レート', r) : '') +
            '<div class="btns"><button class="btn btn-gold" type="button" id="m-done">タイトルへ</button></div>');
          animateRate(dlg);
          $('m-done').addEventListener('click', () => { UI.closeDialog(); showScreen('title'); });
        });
      });
    } else {
      $('m-restart').addEventListener('click', () => {
        UI.openDialog('<h3>最初からやり直しますか？</h3><p>いまの対局と得点は消えます。</p><div class="btns">' +
          '<button class="btn btn-ghost" type="button" id="m-no">やめる</button><button class="btn btn-gold" type="button" id="m-yes">やり直す</button></div>', { onBackdrop: closeMenu });
        $('m-no').addEventListener('click', closeMenu);
        $('m-yes').addEventListener('click', () => { UI.closeDialog(); newMatch(); });
      });
    }
    $('m-title').addEventListener('click', () => { UI.closeDialog(); cancelLoop(); persist(); showScreen('title'); });
  }
  // メニューを閉じたら、開く前の問い合わせ（止め札など）をやり直す
  function closeMenu() {
    UI.closeDialog();
    if (online) { reaskOnline(); return; }
    if (S && $('scr-game').hidden === false) {
      const q = E.getRequest(S);
      if (q && S.players[q.seat].human && q.kind !== 'turn' && q.kind !== 'give' && q.kind !== 'discard' && q.kind !== 'exchange') {
        cancelLoop();
        runLoop();
      }
    }
  }

  // ─────────────────────────────────────────────
  // オンライン対戦（ルール判定とAIはサーバー。ここは表示と自分の操作だけ）
  // ─────────────────────────────────────────────
  let onlineDraftCode = '';

  function onlineName() {
    const n = (settings.name || '').trim();
    return n && n !== 'あなた' ? n : '';
  }

  function inviteURL(code) {
    const h = location.hostname;
    const here = h === 'localhost' || h === '127.0.0.1' || /github\.io$/.test(h);
    return (here ? location.origin + location.pathname : D.Net.APP_URL) + '#r-' + code;
  }

  function openOnline(code) {
    cancelLoop();
    if (!D.Net.available()) { UI.toast('オンライン対戦はアプリ版（GitHubのページ）で遊べます', 4000); return; }
    if (code && !online) {
      onlineDraftCode = code;
      if (onlineName()) { joinRoom(code); return; }
    }
    showScreen('online');
  }

  function setConn(s) {
    if (!online) return;
    online.status = s;
    $('online-conn').textContent = { connecting: '接続中…', retry: '再接続中…', closed: '切断' }[s] || '';
    if (s === 'retry' && online.gameShown) UI.toast('通信が切れました。つなぎ直しています…', 2500);
    if (!$('scr-online').hidden && !online.view) renderOnline();
  }

  function joinRoom(code) {
    const name = onlineName();
    if (!name) { UI.toast('名前を入れてください'); return; }
    leaveRoom(true);
    const o = { code, conn: null, view: null, queue: [], busy: false, waiting: false, sig: '', waitingSig: '', sentSig: '',
      seat: -1, gameShown: false, resultsOpen: false, status: 'connecting', chat: [], unread: 0 };
    online = o;
    UI.roomCode = code;
    updateChatButtons();
    o.conn = D.Net.connect(code, {
      onOpen: () => { if (online === o) o.conn.send({ t: 'hello', cid: D.Net.clientId(), name }); },
      onMessage: (m) => { if (online === o) onlineMessage(o, m); },
      onStatus: (s) => { if (online === o) setConn(s); },
      onClosed: (c) => {
        if (online !== o) return;
        online = null;
        UI.roomCode = null;
        closeChat();
        updateChatButtons();
        if (c === 4000) UI.toast('ほかの画面でこの部屋に入ったので、こちらは切断しました', 4000);
        showScreen('online');
      },
    });
    try { history.replaceState(null, '', location.pathname + location.search + '#r-' + code); } catch (e) { /* 無視 */ }
    showScreen('online');
  }

  /** 部屋を出る（対局中ならその席はAIが引き継ぐ） */
  function leaveRoom(silent) {
    if (!online) return;
    const o = online;
    online = null;
    UI.roomCode = null;
    UI.seatInfo = null;
    closeChat();
    updateChatButtons();
    cancelHuman();
    o.conn.send({ t: 'leave' });
    setTimeout(() => o.conn.close(), 200);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 無視 */ }
    if (!silent) { UI.closeDialog(); UI.hidePrompt(); showScreen('title'); }
  }

  function viewSig(v) {
    if (!v.state) return 'lobby';
    const s = v.state;
    return [s.gameNo, s.moves, s.phase, s.turn, s.pile.length, JSON.stringify(s.pending || null), v.seat].join('|');
  }

  function onlineMessage(o, m) {
    if (m.t === 'error') { UI.toast(m.error, 3000); SND.play('error'); return; }
    if (m.t === 'chat') { onChatItem(o, m.item, false); return; }
    if (m.t === 'chatlog') { o.chat = Array.isArray(m.items) ? m.items.slice(-60) : []; renderChat(); updateChatButtons(); return; }
    if (m.t !== 'room') return;
    // 自分の入力待ちの間に来た「接続状態だけ」の更新は、入力を邪魔せずに反映する
    if (o.waiting && m.phase === 'playing' && viewSig(m) === o.waitingSig && !(m.events && m.events.length)) {
      o.view = m;
      UI.seatInfo = m.seats;
      UI.renderSeats();
      return;
    }
    if (o.waiting) cancelHuman();
    o.queue.push(m);
    pumpOnline(o);
  }

  async function pumpOnline(o) {
    if (o.busy) return;
    o.busy = true;
    try {
      while (online === o && o.queue.length) await handleView(o, o.queue.shift());
    } catch (e) {
      console.error(e);
    }
    o.busy = false;
  }

  function rememberOnlineRating(v) {
    const me = v.members && v.members.find((m) => m.you);
    if (!me || me.rating == null) return;
    const cur = store.onlineRating || {};
    if (cur.r === me.rating && cur.matches === me.matches) return;
    store.onlineRating = { r: me.rating, matches: me.matches || 0 };
    save();
  }

  async function handleView(o, v) {
    o.view = v;
    rememberOnlineRating(v);
    if (v.phase === 'lobby') {
      if (o.gameShown) { o.gameShown = false; o.resultsOpen = false; UI.closeDialog(); UI.hidePrompt(); }
      if ($('scr-online').hidden) showScreen('online'); else renderOnline();
      return;
    }
    if (!(v.seat >= 0)) return;
    const st = E.deserialize(v.state);
    const sig = viewSig(v);
    const evs = v.events || [];
    const first = !o.gameShown || o.seat !== v.seat;
    if (!first && sig === o.sig && !evs.length) {
      // 参加者の接続状態・名前だけの更新
      UI.seatInfo = v.seats;
      st.players.forEach((p, i) => { if (S && S.players[i]) S.players[i].name = p.name; });
      UI.renderSeats();
    } else {
      o.sig = sig;
      S = st;
      UI.S = S;
      UI.human = v.seat;
      UI.seatInfo = v.seats;
      o.seat = v.seat;
      if (o.resultsOpen && S.phase !== 'over') { UI.closeDialog(); o.resultsOpen = false; }
      if (first) {
        o.gameShown = true;
        UI.logLines = [];
        showScreen('game');
        UI.resetTable();
        UI.syncVM();
        UI.renderAll();
        if (evs.some((e) => e.t === 'deal')) await UI.playEvents(evs);
      } else if (evs.length) {
        const saved = UI.speed;
        if (o.queue.length > 1) UI.speed = Math.min(saved, 0.35); // 遅れているときは早送り
        await UI.playEvents(evs);
        UI.speed = saved;
      } else {
        UI.syncVM();
        UI.renderAll();
      }
    }
    if (online !== o) return;
    if (S.phase === 'over') { if (!o.resultsOpen) showOnlineResults(o); return; }
    if (v.request && !o.queue.length && sig !== o.sentSig) await askOnline(o, v);
  }

  async function askOnline(o, v) {
    if (o.waiting) return;
    o.waiting = true;
    o.waitingSig = viewSig(v);
    const action = await humanAction(v.request);
    o.waiting = false;
    if (!action || online !== o) return;
    const a = Object.assign({}, action);
    delete a.seat;
    if (o.conn.send({ t: 'action', action: a })) o.sentSig = o.waitingSig;
    else UI.toast('通信が切れています。つながり直したら、もう一度操作してください', 3500);
  }

  function reaskOnline() {
    const o = online;
    if (!o) return;
    if (o.waiting) cancelHuman();
    setTimeout(() => {
      if (online !== o || o.waiting || o.busy || !o.view || !S) return;
      if (S.phase === 'over') { if (!o.resultsOpen) showOnlineResults(o); return; }
      if (o.view.request) { o.sentSig = ''; askOnline(o, o.view); }
    }, 0);
  }

  function showOnlineResults(o) {
    o.resultsOpen = true;
    UI.hidePrompt();
    if (S.matchOver) { showOnlineFinal(o); return; }
    UI.openDialog(resultsHTML() + '<p>だれかが「次のゲームへ」を押すと、全員の次のゲームが始まります。</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button>' +
      (S.rated ? '' : '<button class="btn btn-ghost" type="button" id="res-lobby">ここで終わる</button>') +
      '<button class="btn btn-gold" type="button" id="res-next">' + nextLabel() + '</button></div>');
    $('res-next').addEventListener('click', () => {
      if (!online) return;
      online.conn.send({ t: 'next' });
      $('res-next').disabled = true;
      $('res-next').textContent = '始めています…';
    });
    if ($('res-lobby')) $('res-lobby').addEventListener('click', () => { if (online) online.conn.send({ t: 'lobby' }); });
    $('res-leave').addEventListener('click', () => confirmLeave(true));
  }

  /** オンラインの試合終了（レート戦なら各自のレートの増減も） */
  function showOnlineFinal(o) {
    const info = S.rated;
    const res = info && info.results ? info.results : [];
    const mine = res[UI.human];
    const box = mine ? rateBoxHTML('オンラインレート', mine, '予想の総得点 ' + fmtExp(mine.expected) + ' に対して、あなたは ' + UI.fmtPts(mine.total) + '点') : '';
    const left = res.filter((r) => r && r.abandoned).map((r) => esc(r.name) + ' さんは途中で抜けたため棄権（' + RT.fmtDelta(r.delta) + '）').join('<br>');
    const deltas = res.map((r) => (r && !r.abandoned ? r : null));
    const dlg = UI.openDialog(finalHTML(box, deltas) + (left ? '<p class="menu-note">' + left + '</p>' : '') +
      (info && !mine ? '<p class="menu-note">途中から参加したので、あなたのレートは変わりません。</p>' : '') +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button><button class="btn btn-gold" type="button" id="res-lobby">部屋に戻る</button></div>');
    animateRate(dlg);
    $('res-lobby').addEventListener('click', () => {
      if (!online) return;
      online.conn.send({ t: 'lobby' });
      $('res-lobby').disabled = true;
    });
    $('res-leave').addEventListener('click', () => confirmLeave(true));
  }

  function confirmLeave(fromResults) {
    const playing = online && online.gameShown;
    const ratedLive = playing && S && S.rated && !S.matchOver && online.view && online.view.youRated;
    UI.openDialog('<h3>部屋を出ますか？</h3><p>' + (playing ? '対局中のあなたの席は、AIロボットが引き継ぎます。' : 'もう一度入るには、招待リンクか部屋コードが必要です。') +
      (ratedLive ? '<br><b>レート戦の途中なので棄権になり、</b>残りのゲームは大貧民（−3点）として計算されます。' : '') + '</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="lv-no">やめる</button><button class="btn btn-gold" type="button" id="lv-yes">部屋を出る</button></div>',
    { onBackdrop: () => back() });
    function back() {
      UI.closeDialog();
      if (fromResults && online) showOnlineResults(online);
      else reaskOnline();
    }
    $('lv-no').addEventListener('click', back);
    $('lv-yes').addEventListener('click', () => leaveRoom(false));
  }

  function openOnlineMenu() {
    UI.openDialog('<h3>メニュー</h3><div class="menu-list">' +
      '<button class="btn btn-gold" type="button" id="m-close">対局に戻る</button>' +
      '<button class="btn btn-ghost" type="button" id="m-invite">友だちを招待</button>' +
      '<button class="btn btn-ghost" type="button" id="m-book">ルールブック</button>' +
      '<button class="btn btn-ghost" type="button" id="m-leave">部屋を出る</button></div>', { onBackdrop: closeMenu });
    $('m-close').addEventListener('click', closeMenu);
    $('m-invite').addEventListener('click', () => { if (online) invite(online.code); });
    $('m-book').addEventListener('click', () => { closeMenu(); openBook('rules'); });
    $('m-leave').addEventListener('click', () => confirmLeave(false));
  }

  async function invite(code) {
    const url = inviteURL(code);
    const text = '大富豪で遊ぼう！ 部屋コード ' + code;
    if (navigator.share) {
      try { await navigator.share({ title: '大富豪', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      UI.toast('招待リンクをコピーしました。LINEなどに貼り付けて送ってください', 3500);
    } catch (e) {
      UI.toast('このリンクを送ってください：' + url, 6000);
    }
  }

  // ── チャット（部屋の人だけに届く。サーバーは直近30件だけ持つ） ──
  const CHAT_PRESETS = ['よろしく！', 'ナイス！', 'やられた〜', '革命きた！', 'ありがとう', 'もう1回！', 'ちょっと待って', '強すぎ😂'];
  const CHAT_COLORS = ['#f3dd9b', '#8ecae6', '#f4a3b5', '#a7d98b', '#c9b3ff', '#f6bd7c'];

  function chatColor(pid) {
    let h = 0;
    for (const ch of String(pid || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return CHAT_COLORS[h % CHAT_COLORS.length];
  }
  function myPid() {
    const v = online && online.view;
    const me = v && v.members && v.members.find((m) => m.you);
    return me ? me.pid : null;
  }
  function hhmm(t) {
    const d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function updateChatButtons() {
    const n = online ? online.unread : 0;
    $('g-chat').hidden = !online;
    $('g-chat-badge').hidden = !n;
    $('g-chat-badge').textContent = n > 9 ? '9+' : String(n);
    $('g-chat').setAttribute('aria-label', n ? 'チャット（未読' + n + '件）' : 'チャット');
    const lb = $('on-chat');
    if (lb) lb.textContent = n ? 'チャット（未読 ' + n + '）' : 'チャット';
  }

  function openChat() {
    if (!online) return;
    $('log').hidden = true;
    $('chat').hidden = false;
    online.unread = 0;
    updateChatButtons();
    renderChat();
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => $('chat-input').focus(), 30);
  }
  function closeChat() { $('chat').hidden = true; }

  function renderChat() {
    if (!online || $('chat').hidden) return;
    const list = $('chat-list');
    const me = myPid();
    if (!online.chat.length) {
      list.innerHTML = '<li class="empty">まだメッセージはありません。<br>下のボタンからひとこと送れます。</li>';
      return;
    }
    list.innerHTML = online.chat.map((it) => {
      const mine = it.pid === me;
      return '<li class="' + (mine ? 'me' : '') + '"><span class="who" style="color:' + chatColor(it.pid) + '">' + esc(mine ? 'あなた' : it.name) +
        '<time>' + hhmm(it.at) + '</time></span><span class="msg">' + esc(it.text) + '</span></li>';
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  function onChatItem(o, item, fromLog) {
    if (!item || typeof item.text !== 'string') return;
    o.chat.push(item);
    if (o.chat.length > 60) o.chat.splice(0, o.chat.length - 60);
    const mine = item.pid === myPid();
    if (!mine && $('chat').hidden) o.unread++;
    updateChatButtons();
    renderChat();
    if (fromLog) return;
    if (!mine) SND.play('chat');
    // 対局中は、送った人の席の上に吹き出しで出す
    if (o.gameShown && !$('scr-game').hidden && S) {
      let seat = mine ? UI.human : item.seat;
      if (!(seat >= 0) || !S.players[seat] || S.players[seat].name !== item.name) seat = S.players.findIndex((p) => p.name === item.name);
      const short = Array.from(item.text).length > 22 ? Array.from(item.text).slice(0, 21).join('') + '…' : item.text;
      if (seat >= 0) UI.bubble(seat, short, false, 'chat');
    }
  }

  function sendChat(text) {
    if (!online) return false;
    text = String(text || '').trim();
    if (!text) return false;
    if (!online.conn.send({ t: 'chat', text })) { UI.toast('通信が切れています。つながり直してから送ってください'); return false; }
    return true;
  }

  function chatInit() {
    $('chat-close').innerHTML = A.icon('close');
    $('g-chat').querySelector('.ic-slot').innerHTML = A.icon('chat');
    $('g-chat').addEventListener('click', () => ($('chat').hidden ? openChat() : closeChat()));
    $('chat-close').addEventListener('click', closeChat);
    $('chat-presets').innerHTML = CHAT_PRESETS.map((p) => '<button type="button">' + esc(p) + '</button>').join('');
    $('chat-presets').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => sendChat(b.textContent)));
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      if (sendChat(input.value)) input.value = '';
    });
    // スマホのキーボードでチャット欄が隠れないように、キーボードの高さだけ持ち上げる
    const vv = globalThis.visualViewport;
    if (vv) {
      const fit = () => {
        const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--kb', Math.round(kb) + 'px');
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
    updateChatButtons();
  }

  function renderOnline() {
    const wrap = $('online-wrap');
    const o = online;
    if (!o) { renderOnlineEntry(wrap); return; }
    const v = o.view;
    if (!v) {
      wrap.innerHTML = '<section class="online-wait"><p class="wait-big">' + (o.status === 'retry' ? 'サーバーにつなぎ直しています…' : '部屋に入っています…') +
        '</p><p class="row-desc">部屋コード <b class="code-inline">' + esc(o.code) + '</b></p><button class="btn btn-ghost" type="button" id="on-cancel">やめる</button></section>';
      $('on-cancel').addEventListener('click', () => leaveRoom(false));
      return;
    }
    if (v.phase === 'lobby') { renderLobby(wrap, o, v); return; }
    wrap.innerHTML = '<section class="online-wait"><p class="wait-big">対局中です</p><button class="btn btn-gold" type="button" id="on-return">対局に戻る</button></section>';
    $('on-return').addEventListener('click', () => { showScreen('game'); UI.renderAll(); reaskOnline(); });
  }

  function renderOnlineEntry(wrap) {
    const orr = store.onlineRating;
    wrap.innerHTML =
      '<section class="online-rate"><span class="lbl">オンラインレート</span><b>' + (orr ? orr.r : RT.START) + '</b><span class="sub">' +
      (orr && orr.matches ? orr.matches + '試合' : 'レート戦の部屋で遊ぶと変わります') + '</span></section>' +
      '<section><h3 class="sect-title">あなたの名前<small>ほかの人に表示されます</small></h3><div class="card-panel"><div class="row">' +
      '<input class="name-input wide" id="on-name" maxlength="8" placeholder="名前（8文字まで）" autocomplete="nickname" value="' + esc(onlineName()) + '"></div></div></section>' +
      '<section><h3 class="sect-title">部屋を作る</h3><div class="card-panel"><div class="row col"><div class="row-desc">部屋を作ると招待リンクができます。LINEなどで友だちに送ってください。人数が足りない席にはAIロボットが入ります。</div>' +
      '<button class="btn btn-gold" type="button" id="on-create">部屋を作る</button></div></div></section>' +
      '<section><h3 class="sect-title">部屋に入る<small>招待された5文字のコード</small></h3><div class="card-panel"><div class="row join-row">' +
      '<input class="code-input" id="on-code" maxlength="5" placeholder="ABCDE" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(onlineDraftCode) + '">' +
      '<button class="btn btn-ghost" type="button" id="on-join">入る</button></div></div></section>';
    const nameIn = $('on-name');
    const saveName = () => { settings.name = D.Online ? D.Online.cleanName(nameIn.value) : nameIn.value.trim().slice(0, 8); save(); };
    nameIn.addEventListener('change', saveName);
    $('on-create').addEventListener('click', () => { saveName(); SND.unlock(); joinRoom(D.Net.newRoomCode()); });
    const doJoin = () => {
      saveName();
      SND.unlock();
      const code = $('on-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-Z0-9]{5}$/.test(code)) { UI.toast('部屋コードは英数字5文字です'); return; }
      onlineDraftCode = code;
      joinRoom(code);
    };
    $('on-join').addEventListener('click', doJoin);
    $('on-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    if (onlineDraftCode && !onlineName()) setTimeout(() => nameIn.focus(), 50);
  }

  function renderLobby(wrap, o, v) {
    const n = v.settings.players;
    const rated = v.settings.mode === 'rated';
    const rows = v.members.map((m) => '<div class="member"><span class="dot ' + (m.connected ? 'on' : 'off') + '"></span>' +
      '<span class="mname">' + esc(m.name) + (m.you ? '<small>（あなた）</small>' : '') + '</span>' + (m.host ? '<span class="host-chip">ホスト</span>' : '') +
      '<span class="rt-chip" title="オンラインレート">' + (m.rating == null ? RT.START : m.rating) + '</span></div>').join('');
    let ai = '';
    for (let i = v.members.length; i < n; i++) {
      ai += '<div class="member ai"><span class="dot ai"></span><span class="mname">AIロボット</span>' +
        (rated ? '<span class="rt-chip">' + (RT.AI[v.settings.aiLevel] || RT.AI.normal) + '</span>' : '') + '</div>';
    }
    wrap.innerHTML =
      '<section class="room-head"><div class="room-label">部屋コード</div><div class="room-code">' + esc(v.code) + '</div>' +
      '<button class="btn btn-gold" type="button" id="on-invite">友だちを招待</button>' +
      '<p class="row-desc invite-url">' + esc(inviteURL(v.code)) + '</p></section>' +
      '<section><h3 class="sect-title">参加者<small>' + v.members.length + '人 ＋ AIロボット' + Math.max(0, n - v.members.length) + '体</small></h3>' +
      '<div class="card-panel member-list">' + rows + ai + '</div></section>' +
      '<section id="on-settings"></section>' +
      '<section class="lobby-actions" id="on-actions"></section>';
    $('on-invite').addEventListener('click', () => invite(v.code));
    const box = $('on-settings');
    if (v.host) {
      box.innerHTML = '<h3 class="sect-title">設定<small>ホストだけが変えられます</small></h3>';
      const panel = document.createElement('div');
      panel.className = 'card-panel';
      const min = Math.max(3, v.members.length);
      panel.appendChild(row('遊び方', rated ? '4人・マイルール・10ゲームで固定。総得点でオンラインレートが上下します' : 'レートは変わりません',
        seg([{ v: 'free', label: 'フリー対戦' }, { v: 'rated', label: 'レート戦' }], v.settings.mode, (x) => {
          if (x === 'rated' && v.members.length > RT.PLAYERS) { UI.toast('レート戦は' + RT.PLAYERS + '人までです'); return; }
          o.conn.send({ t: 'config', mode: x });
        })));
      if (rated) {
        panel.appendChild(row('人数・ゲーム数', RT.PLAYERS + '人・' + RT.GAMES + 'ゲーム（固定）。足りない席はAIロボット', null));
      } else {
        panel.appendChild(row('人数', '足りない席はAIロボット', seg([3, 4, 5, 6].map((x) => ({ v: x, label: x + '人' })), n,
          (x) => { if (x >= min) o.conn.send({ t: 'config', players: x }); else UI.toast('部屋にいる人数より少なくはできません'); })));
        panel.appendChild(row('1試合のゲーム数', '', seg([{ v: 5, label: '5' }, { v: 10, label: '10' }, { v: 0, label: '無制限' }], v.settings.games,
          (x) => o.conn.send({ t: 'config', games: x }))));
      }
      panel.appendChild(row('AIの強さ', rated ? 'AIのレート：やさしい ' + RT.AI.easy + '・ふつう ' + RT.AI.normal : '',
        seg([{ v: 'easy', label: 'やさしい' }, { v: 'normal', label: 'ふつう' }], v.settings.aiLevel, (x) => o.conn.send({ t: 'config', aiLevel: x }))));
      const rr = row('ルール', rated ? 'マイルール（固定）' : presetLabel() + '（ローカルルール ' + localRuleCount(store.rules) + '個）。あなたの「ルールと設定」のルールで遊びます。', null);
      panel.appendChild(rr);
      box.appendChild(panel);
      $('on-actions').innerHTML = '<button class="btn btn-gold btn-lg" type="button" id="on-start">この部屋で始める</button>' +
        '<button class="btn btn-ghost" type="button" id="on-chat">チャット</button>' +
        '<button class="btn btn-ghost" type="button" id="on-leave">部屋を出る</button>';
      $('on-start').addEventListener('click', () => { SND.unlock(); o.conn.send({ t: 'start', rules: store.rules }); $('on-start').disabled = true; });
    } else {
      box.innerHTML = '<h3 class="sect-title">設定</h3><div class="card-panel"><div class="row"><div class="row-text"><div class="row-name">' +
        (rated ? 'レート戦（' + RT.PLAYERS + '人・マイルール・' + RT.GAMES + 'ゲーム）' : 'フリー対戦・' + n + '人・' + (v.settings.games ? v.settings.games + 'ゲーム' : 'ゲーム数は無制限')) + '</div>' +
        '<div class="row-desc">' + (rated ? '総得点でオンラインレートが上下します。' : '') + 'ルールと人数はホストが決めます。AIの強さ：' + (v.settings.aiLevel === 'easy' ? 'やさしい' : 'ふつう') + '</div></div></div></div>';
      $('on-actions').innerHTML = '<p class="wait-big">ホストが始めるのを待っています…</p>' +
        '<button class="btn btn-ghost" type="button" id="on-chat">チャット</button>' +
        '<button class="btn btn-ghost" type="button" id="on-leave">部屋を出る</button>';
    }
    $('on-chat').addEventListener('click', openChat);
    updateChatButtons();
    $('on-leave').addEventListener('click', () => confirmLeave(false));
  }

  // ─────────────────────────────────────────────
  // ルールブック（対局中でも開ける。開いている間も対局はそのまま進む）
  // ─────────────────────────────────────────────
  const book = { tab: 'basics', src: '' };

  /** どのルールを説明するか：対局中は「このゲーム」とレート戦、タイトルではレート戦とフリー対戦 */
  function bookSources() {
    const inGame = S && !$('scr-game').hidden;
    const list = [];
    if (inGame) list.push({ key: 'game', label: 'このゲーム', rules: S.rules, n: S.n });
    if (!(inGame && S.rated && !online)) list.push({ key: 'rated', label: 'レート戦', rules: RT.rules(), n: RT.PLAYERS });
    if (!inGame) list.push({ key: 'free', label: 'フリー対戦', rules: store.rules, n: settings.players });
    return list;
  }

  function renderBook() {
    const srcs = bookSources();
    const src = srcs.find((x) => x.key === book.src) || srcs[0];
    book.src = src.key;
    $('book-tabs').innerHTML = D.Book.TABS.map((t) => '<button type="button" role="tab" data-tab="' + t.key + '" aria-selected="' + (t.key === book.tab) + '">' + esc(t.label) + '</button>').join('');
    $('book-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { book.tab = b.dataset.tab; renderBook(); $('book-body').scrollTop = 0; }));
    const pick = book.tab === 'basics' || book.tab === 'rules' ? '<div class="book-src"><span>説明するルール</span>' +
      '<div class="seg">' + srcs.map((x) => '<button type="button" data-src="' + x.key + '" aria-pressed="' + (x.key === src.key) + '">' + esc(x.label) + '</button>').join('') + '</div></div>' : '';
    $('book-body').innerHTML = pick + D.Book.render(book.tab, src.rules, src.n);
    $('book-body').querySelectorAll('.book-src button').forEach((b) => b.addEventListener('click', () => { book.src = b.dataset.src; renderBook(); }));
  }

  function openBook(tab, src) {
    if (tab) book.tab = tab;
    book.src = src || '';
    $('log').hidden = true;
    closeChat();
    $('book').hidden = false;
    renderBook();
    $('book-body').scrollTop = 0;
    setTimeout(() => $('book-close').focus({ preventScroll: true }), 30);
  }
  function closeBook() { $('book').hidden = true; }

  function bookInit() {
    $('book-close').innerHTML = A.icon('close');
    $('book-close').addEventListener('click', closeBook);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('book').hidden && $('overlay').hidden) closeBook(); });
  }

  // ─────────────────────────────────────────────
  // アーティファクトの再公開時に対局を引き継ぐ
  // ─────────────────────────────────────────────
  let hotRegistered = false;
  function saveHot() {
    const hot = globalThis.claude && globalThis.claude.hot;
    if (hotRegistered || !hot || !hot.snapshot) return;
    hotRegistered = true;
    try { hot.snapshot(() => ({ match: S ? E.serialize(S) : null, screen: $('scr-game').hidden ? 'title' : 'game', log: UI.logLines.slice(-120) })); } catch (e) { /* 無視 */ }
  }

  // ─────────────────────────────────────────────
  // 起動
  // ─────────────────────────────────────────────
  function start(data) {
    document.body.insertAdjacentHTML('afterbegin', A.SHARED_DEFS);
    if (D.Textures) D.Textures.apply();
    $('g-menu').innerHTML = A.icon('menu');
    $('g-log').innerHTML = A.icon('log');
    $('g-book').innerHTML = A.icon('book');
    $('rules-back').innerHTML = A.icon('back');
    $('log-close').innerHTML = A.icon('close');
    applySettings();
    setActionButtons({});

    const unlock = () => SND.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });

    $('btn-rated').addEventListener('click', () => { SND.unlock(); openRated(); });
    $('btn-start').addEventListener('click', () => { SND.unlock(); newMatch(); });
    $('btn-book').addEventListener('click', () => openBook('basics'));
    $('g-book').addEventListener('click', () => ($('book').hidden ? openBook('rules') : closeBook()));
    bookInit();
    $('btn-resume').addEventListener('click', () => { SND.unlock(); resumeMatch(); });
    $('btn-rules').addEventListener('click', () => showScreen('rules'));
    $('btn-online').addEventListener('click', () => { SND.unlock(); openOnline(); });
    chatInit();
    $('online-back').innerHTML = A.icon('back');
    $('online-back').addEventListener('click', () => { if (online) confirmLeave(false); else showScreen('title'); });
    $('rules-back').addEventListener('click', () => showScreen('title'));
    $('rules-start').addEventListener('click', () => { SND.unlock(); newMatch(); });
    $('g-menu').addEventListener('click', openMenu);
    $('g-sound').addEventListener('click', () => { settings.sound = !settings.sound; save(); applySettings(); if (settings.sound) SND.play('select'); });
    $('g-log').addEventListener('click', () => { const lg = $('log'); lg.hidden = !lg.hidden; if (!lg.hidden) { closeChat(); UI.renderLog(); } });
    $('log-close').addEventListener('click', () => { $('log').hidden = true; });

    document.addEventListener('keydown', (e) => {
      if ($('scr-game').hidden || !$('overlay').hidden) return;
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.key === 'Enter' && !$('b-play').disabled && document.activeElement && !document.activeElement.classList.contains('card')) $('b-play').click();
      if ((e.key === 'p' || e.key === 'P') && !$('b-pass').disabled) $('b-pass').click();
    });

    let rz = 0;
    addEventListener('resize', () => {
      cancelAnimationFrame(rz);
      rz = requestAnimationFrame(() => { if (S && !$('scr-game').hidden) UI.renderAll(); });
    });

    // 招待リンク（…#r-ABCDE）から開いたら、その部屋へ
    const hm = location.hash.match(/^#r-([A-Za-z0-9]{5})$/);
    if (hm && D.Net.available()) {
      showScreen('title');
      openOnline(hm[1].toUpperCase());
      return;
    }
    if (data && data.match) {
      store.match = data.match;
      if (Array.isArray(data.log)) store.log = data.log;
      if (data.screen === 'game') { resumeMatch(); return; }
    }
    showScreen('title');
  }

  // 動作確認用
  D.App = { get state() { return S; }, get online() { return online; }, newMatch, resumeMatch, openOnline, settings, store };

  const hot = globalThis.claude && globalThis.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
