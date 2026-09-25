/* 大富豪 — 画面遷移・設定・対局の進行 */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const E = D.Engine, C = D.Cards, RU = D.Rules, AI = D.AI, A = D.Art, SND = D.Sound, UI = D.UI;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const sleep = UI.sleep;

  // ─────────────────────────────────────────────
  // 保存（この端末のブラウザだけ）
  // ─────────────────────────────────────────────
  const STORE_KEY = 'daifugo.v1';
  const DEFAULT_SETTINGS = { players: 4, level: 'normal', speed: 'normal', back: 'red', sound: true, autoPass: true, showPlayable: true, name: 'あなた' };
  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { store = {}; }
  store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings || {});
  store.rules = store.rules ? RU.migrate(store.rules) : Object.assign({}, RU.MINE);
  const settings = store.settings;

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても続行 */ }
  }

  let S = null;
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
    for (const id of ['scr-title', 'scr-rules', 'scr-game']) $(id).hidden = id !== 'scr-' + name;
    if (name === 'title') renderTitle();
    if (name === 'rules') renderRules();
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
    $('title-rule').innerHTML = 'ルール：<b>' + esc(presetLabel()) + '</b>（ローカルルール ' + localRuleCount(store.rules) + '個）';
    $('title-foot').textContent = 'AIロボット' + (settings.players - 1) + '体（' + LEVEL_LABEL[settings.level] + '）と対戦 · ' + settings.players + '人';
    const canResume = store.match && (store.match.phase === 'play' || store.match.phase === 'exchange' || store.match.phase === 'over');
    $('btn-resume').hidden = !canResume;
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
    const m = section('対戦設定');
    m.panel.appendChild(row('人数', 'あなた＋AIロボット', seg([3, 4, 5, 6].map((v) => ({ v, label: v + '人' })), settings.players, (v) => set('players', v))));
    m.panel.appendChild(row('AIの強さ', settings.level === 'hard' ? '手札を読んで先の展開を試算します（考える時間が少し長め）' : '',
      seg([{ v: 'easy', label: 'やさしい' }, { v: 'normal', label: 'ふつう' }, { v: 'hard', label: 'つよい' }], settings.level, (v) => set('level', v))));
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
  function newMatch() {
    cancelLoop();
    const players = [{ name: settings.name || 'あなた', human: true }];
    for (let i = 1; i < settings.players; i++) players.push({ name: A.ROBOTS[i - 1].name, level: settings.level });
    S = E.createMatch({ rules: store.rules, players });
    UI.S = S;
    UI.human = 0;
    UI.logLines = [];
    UI.resetTable();
    fastForward = false;
    showScreen('game');
    startNextGame();
  }

  async function startNextGame() {
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
    if (!S) return;
    try {
      store.match = E.serialize(S);
      store.log = UI.logLines.slice(-120);
      save();
    } catch (e) { /* 保存できなくても続行 */ }
    saveHot();
  }

  function cancelLoop() {
    loopToken++;
    if (humanCancel) { const c = humanCancel; humanCancel = null; c(); }
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
          action = await AI.decide(S, q, P.level, Math.round(420 * UI.speed));
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
  // 結果・メニュー
  // ─────────────────────────────────────────────
  function showResults(token) {
    return new Promise((resolve) => {
      UI.hidePrompt();
      const ranking = S.prevRanking;
      const rows = ranking.map((seat, i) => {
        const P = S.players[seat];
        const t = E.titleOf(S.n, i);
        const note = P.foul ? '反則上がり' : '';
        return '<div class="res-row' + (seat === UI.human ? ' me' : '') + '"><span class="pl">' + (i + 1) + '</span>' +
          '<span><span class="title-chip ' + UI.TITLE_CLASS[t] + '">' + t + '</span></span>' +
          '<span class="nm">' + esc(P.name) + (note ? '<small>' + note + '</small>' : '') + '</span>' +
          '<span class="pt">+' + (S.n - 1 - i) + '<small>計 ' + P.score + '</small></span></div>';
      }).join('');
      const myPlace = ranking.indexOf(UI.human);
      const myTitle = E.titleOf(S.n, myPlace);
      const head = myPlace === 0 ? 'あなたが大富豪！' : 'あなたは ' + myTitle;
      if (myPlace === 0) SND.play('fanfare');
      UI.openDialog('<h3>第' + S.gameNo + 'ゲーム 結果</h3><p>' + esc(head) + (S.rules.exchange ? '　次のゲームは身分に応じてカード交換から。' : '') + '</p>' +
        '<div class="results">' + rows + '</div>' +
        '<div class="btns"><button class="btn btn-ghost" type="button" id="res-title">タイトルへ</button><button class="btn btn-gold" type="button" id="res-next">次のゲームへ</button></div>');
      $('res-next').addEventListener('click', () => { UI.closeDialog(); resolve(); if (token === loopToken) startNextGame(); });
      $('res-title').addEventListener('click', () => { UI.closeDialog(); resolve(); cancelLoop(); showScreen('title'); });
    });
  }

  function ruleSummaryHTML() {
    const R = S ? S.rules : store.rules;
    const on = [];
    for (const def of RU.RULES) {
      if (def.type === 'bool' && R[def.key]) on.push(def.label);
      else if (def.type === 'choice') {
        const op = def.options.find((o) => o.v === R[def.key]);
        if (def.key === 'jokers') on.push('ジョーカー' + op.label);
        else if (def.key === 'seqRevolution' && R[def.key] !== 'off') on.push('階段革命（' + op.label + '）');
      }
    }
    return '<div class="rule-summary">' + on.map((x) => '<span>' + esc(x) + '</span>').join('') + '</div>';
  }

  function openMenu() {
    const dlg = UI.openDialog('<h3>メニュー</h3><div class="menu-list">' +
      '<button class="btn btn-gold" type="button" id="m-close">対局に戻る</button>' +
      '<button class="btn btn-ghost" type="button" id="m-rules">このゲームのルール</button>' +
      '<button class="btn btn-ghost" type="button" id="m-restart">最初からやり直す</button>' +
      '<button class="btn btn-ghost" type="button" id="m-title">タイトルに戻る</button></div>', { onBackdrop: closeMenu });
    void dlg;
    $('m-close').addEventListener('click', closeMenu);
    $('m-rules').addEventListener('click', () => {
      UI.openDialog('<h3>このゲームのルール</h3><p>オンになっているルールです。変えるときはタイトルの「ルールと設定」から。</p>' + ruleSummaryHTML() +
        '<div class="btns"><button class="btn btn-gold" type="button" id="m-back">閉じる</button></div>', { onBackdrop: closeMenu });
      $('m-back').addEventListener('click', closeMenu);
    });
    $('m-restart').addEventListener('click', () => {
      UI.openDialog('<h3>最初からやり直しますか？</h3><p>いまの対局と得点は消えます。</p><div class="btns">' +
        '<button class="btn btn-ghost" type="button" id="m-no">やめる</button><button class="btn btn-gold" type="button" id="m-yes">やり直す</button></div>', { onBackdrop: closeMenu });
      $('m-no').addEventListener('click', closeMenu);
      $('m-yes').addEventListener('click', () => { UI.closeDialog(); newMatch(); });
    });
    $('m-title').addEventListener('click', () => { UI.closeDialog(); cancelLoop(); persist(); showScreen('title'); });
  }
  // メニューを閉じたら、開く前の問い合わせ（止め札など）をやり直す
  function closeMenu() {
    UI.closeDialog();
    if (S && $('scr-game').hidden === false) {
      const q = E.getRequest(S);
      if (q && S.players[q.seat].human && q.kind !== 'turn' && q.kind !== 'give' && q.kind !== 'discard' && q.kind !== 'exchange') {
        cancelLoop();
        runLoop();
      }
    }
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
    $('rules-back').innerHTML = A.icon('back');
    $('log-close').innerHTML = A.icon('close');
    applySettings();
    setActionButtons({});

    const unlock = () => SND.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });

    $('btn-start').addEventListener('click', () => { SND.unlock(); newMatch(); });
    $('btn-resume').addEventListener('click', () => { SND.unlock(); resumeMatch(); });
    $('btn-rules').addEventListener('click', () => showScreen('rules'));
    $('rules-back').addEventListener('click', () => showScreen('title'));
    $('rules-start').addEventListener('click', () => { SND.unlock(); newMatch(); });
    $('g-menu').addEventListener('click', openMenu);
    $('g-sound').addEventListener('click', () => { settings.sound = !settings.sound; save(); applySettings(); if (settings.sound) SND.play('select'); });
    $('g-log').addEventListener('click', () => { const lg = $('log'); lg.hidden = !lg.hidden; if (!lg.hidden) UI.renderLog(); });
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

    if (data && data.match) {
      store.match = data.match;
      if (Array.isArray(data.log)) store.log = data.log;
      if (data.screen === 'game') { resumeMatch(); return; }
    }
    showScreen('title');
  }

  // 動作確認用
  D.App = { get state() { return S; }, newMatch, resumeMatch, settings, store };

  const hot = globalThis.claude && globalThis.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
