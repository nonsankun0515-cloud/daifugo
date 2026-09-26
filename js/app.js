/* 大富豪 — 対局の進行と画面（アプリの中のゲームの1つ） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const E = D.Engine, C = D.Cards, RU = D.Rules, AI = D.AI, A = D.Art, SND = D.Sound, UI = D.UI, RT = D.Rating;
  const CM = D.Common, OC = D.OnlineClient;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const sleep = UI.sleep;
  const { seg, toggle, row, section } = CM;

  const store = CM.store;
  const settings = store.settings;
  const save = CM.save;

  let S = null;
  let loopToken = 0;
  let humanCancel = null;
  let fastForward = false;
  /** オンライン対戦中の大富豪の部屋（なければ null） */
  const onlineRoom = () => (OC.cur && OC.cur.game === 'daifugo' ? OC.cur : null);

  // ─────────────────────────────────────────────
  // 画面
  // ─────────────────────────────────────────────
  function showScreen(name) {
    if (name === 'title') { D.Shell.showHome('daifugo'); return; }
    if (name === 'online') { OC.showOnlineScreen(); return; }
    CM.showScreen('scr-' + name);
    if (name === 'rules') renderRules();
    saveHot();
  }

  const LEVEL_LABEL = CM.LEVEL_LABEL;

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

  function renderHome() {
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
    $('title-rating').innerHTML = D.Shell.rateStripHTML('daifugo');
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
  function renderRules() {
    const wrap = $('rules-wrap');
    const keepScroll = $('rules-scroll').scrollTop;
    wrap.innerHTML = '';
    const set = (k, v) => { settings[k] = v; save(); renderRules(); };

    // 対戦設定（効果音・スピード・カードの裏・名前はマイページ）
    const m = section('対戦設定', 'フリー対戦の設定。レート戦は4人・マイルール・10ゲームで固定');
    m.panel.appendChild(row('人数', 'あなた＋AIロボット', seg([3, 4, 5, 6].map((v) => ({ v, label: v + '人' })), settings.players, (v) => set('players', v))));
    m.panel.appendChild(row('AIの強さ', settings.level === 'hard' ? '手札を読んで先の展開を試算します（考える時間が少し長め）' : '',
      seg([{ v: 'easy', label: 'やさしい' }, { v: 'normal', label: 'ふつう' }, { v: 'hard', label: 'つよい' }], settings.level, (v) => set('level', v))));
    m.panel.appendChild(row('1試合のゲーム数', settings.games ? settings.games + 'ゲームの総得点で順位を決めます' : '終わりなし。好きなところでやめられます',
      seg([{ v: 5, label: '5' }, { v: 10, label: '10' }, { v: 0, label: '無制限' }], settings.games, (v) => set('games', v))));
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
    OC.leaveRoom(true);
    const n = rated ? RT.PLAYERS : settings.players;
    const level = rated ? opts.level : settings.level;
    const players = [{ name: settings.name || 'あなた', human: true }];
    for (let i = 1; i < n; i++) players.push({ name: A.ROBOTS[i - 1].name, level });
    const info = rated ? { level, base: [store.rating.r].concat(players.slice(1).map(() => RT.AI[level])), matches: store.rating.matches, result: null } : null;
    S = E.createMatch({ rules: rated ? RT.rules() : store.rules, players, games: rated ? RT.GAMES : settings.games, rated: info });
    UI.S = S;
    UI.human = 0;
    UI.seatInfo = null;
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
    OC.leaveRoom(true);
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
    UI.resetTable();
    fastForward = false;
    showScreen('game');
    UI.syncVM();
    UI.renderAll();
    if (S.phase === 'over') showResults(++loopToken);
    else runLoop();
  }

  function persist() {
    if (!S || onlineRoom()) return; // オンライン対戦の状態はサーバーが持つ
    try {
      store.match = E.serialize(S);
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
      if (fastForward) { UI.syncVM(); UI.renderAll(); }
      else await UI.playEvents(evs);
      persist();
      if (token !== loopToken) return;
      maybeOfferFastForward();
    }
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
  function applyRated() {
    if (onlineRoom() || !S) return;
    if (CM.applyRatedLocal(S)) persist();
  }

  /** 途中のレート戦を棄権する（残りのゲームは最下位として計算） */
  function abandonRated() {
    const r = CM.abandonRatedLocal(store.match);
    if (r) { store.match = null; save(); }
    return r;
  }
  const abandonNote = CM.abandonNote;

  /** タイトルから新しく始めるとき、途中のレート戦があれば「つづきから／棄権」をたずねる */
  function askAbandon(onAbandoned) {
    CM.askAbandon(savedMatch(), {
      onResume: resumeMatch,
      onAbandoned: () => { store.match = null; save(); renderHome(); onAbandoned(); },
    });
  }

  /** レート戦を始める画面（AIの強さを選ぶ） */
  function openRated() {
    const m = savedMatch();
    if (m && m.rated) { askAbandon(openRated); return; }
    CM.openRatedDialog('daifugo', { slowLevel: 'hard', onPick: (lv) => newMatch({ rated: true, level: lv }) });
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

  const finalHTML = (rateHTML, deltas) => CM.finalHTML(S, UI.human, rateHTML, deltas);
  const rateBoxHTML = CM.rateBoxHTML;
  const animateRate = CM.animateRate;

  function showFinal() {
    return new Promise((resolve) => {
      applyRated();
      UI.hidePrompt();
      const res = S.rated && S.rated.result;
      const box = res ? rateBoxHTML('AI戦レート', res, CM.rateNote('daifugo', res)) : '';
      const dlg = UI.openDialog(finalHTML(box) +
        '<div class="btns"><button class="btn btn-ghost" type="button" id="fin-title">タイトルへ</button><button class="btn btn-gold" type="button" id="fin-again">' +
        (S.rated ? 'もう一度レート戦' : 'もう一度') + '</button></div>');
      animateRate(dlg);
      $('fin-again').addEventListener('click', () => { UI.closeDialog(); resolve(); newMatch(S.rated ? { rated: true, level: S.rated.level } : undefined); });
      $('fin-title').addEventListener('click', () => { UI.closeDialog(); resolve(); cancelLoop(); showScreen('title'); });
    });
  }

  function openMenu() {
    if (onlineRoom()) { OC.openMenu(); return; }
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
    if (onlineRoom()) { OC.reask(); return; }
    if (S && $('scr-game').hidden === false) {
      const q = E.getRequest(S);
      if (q && S.players[q.seat].human && q.kind !== 'turn' && q.kind !== 'give' && q.kind !== 'discard' && q.kind !== 'exchange') {
        cancelLoop();
        runLoop();
      }
    }
  }

  // ─────────────────────────────────────────────
  // オンライン対戦（部屋・待合室・チャットは online-client.js。ここは大富豪の対局の表示と自分の操作）
  // ─────────────────────────────────────────────
  function viewSig(v) {
    if (!v.state) return 'lobby';
    const s = v.state;
    return [s.gameNo, s.moves, s.phase, s.turn, s.pile.length, JSON.stringify(s.pending || null), v.seat].join('|');
  }

  /** 自分の入力待ちの間に来た「接続状態だけ」の更新は、入力を邪魔せずに反映する */
  function quickUpdate(o, m) {
    if (o.waiting && m.phase === 'playing' && viewSig(m) === o.waitingSig && !(m.events && m.events.length)) {
      o.view = m;
      UI.seatInfo = m.seats;
      UI.renderSeats();
      return true;
    }
    if (o.waiting) cancelHuman();
    return false;
  }

  async function handleView(o, v) {
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
    if (OC.cur !== o) return;
    if (S.phase === 'over') { if (!o.resultsOpen) showOnlineResults(o); return; }
    if (v.request && !o.queue.length && sig !== o.sentSig) await askOnline(o, v);
  }

  async function askOnline(o, v) {
    if (o.waiting) return;
    o.waiting = true;
    o.waitingSig = viewSig(v);
    const action = await humanAction(v.request);
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
    UI.hidePrompt();
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

  /** オンラインの試合終了（レート戦なら各自のレートの増減も） */
  function showOnlineFinal(o) {
    const info = S.rated;
    const res = info && info.results ? info.results : [];
    const mine = res[UI.human];
    const box = mine ? rateBoxHTML('オンラインレート', mine, CM.rateNote('daifugo', mine)) : '';
    const left = res.filter((r) => r && r.abandoned).map((r) => esc(r.name) + ' さんは途中で抜けたため棄権（' + RT.fmtDelta(r.delta) + '）').join('<br>');
    const deltas = res.map((r) => (r && !r.abandoned ? r : null));
    const dlg = UI.openDialog(finalHTML(box, deltas) + (left ? '<p class="menu-note">' + left + '</p>' : '') +
      (info && !mine ? '<p class="menu-note">途中から参加したので、あなたのレートは変わりません。</p>' : '') +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button><button class="btn btn-gold" type="button" id="res-lobby">部屋に戻る</button></div>');
    animateRate(dlg);
    $('res-lobby').addEventListener('click', () => {
      if (!OC.cur) return;
      OC.cur.conn.send({ t: 'lobby' });
      $('res-lobby').disabled = true;
    });
    $('res-leave').addEventListener('click', () => OC.confirmLeave(true));
  }

  /** チャットを送った人の席の上に吹き出し（seat=-1 は自分） */
  function chatBubble(seat, name, text, mine) {
    if (!S || !CM.visible('scr-game')) return;
    if (mine) seat = UI.human;
    if (!(seat >= 0) || !S.players[seat] || S.players[seat].name !== name && !mine) seat = S.players.findIndex((p) => p.name === name);
    if (seat >= 0) UI.bubble(seat, text, false, 'chat');
  }

  const online = {
    quickUpdate, handleView, reask: reaskOnline, cancelInput: () => cancelHuman(), bubble: chatBubble,
    showResults: showOnlineResults,
    showTable() { showScreen('game'); UI.renderAll(); },
    rulesDesc: () => presetLabel() + '（ローカルルール ' + localRuleCount(store.rules) + '個）。あなたの「ルールと設定」のルールで遊びます。',
    startRules: () => store.rules,
  };

  // ─────────────────────────────────────────────
  // ルールブック（枠は共通。ここはどのルールを説明するかだけ）
  // ─────────────────────────────────────────────
  /** 対局中は「このゲーム」とレート戦、ホームではレート戦とフリー対戦 */
  function bookSources() {
    const inGame = S && CM.visible('scr-game');
    const list = [];
    if (inGame) list.push({ key: 'game', label: 'このゲーム', rules: S.rules, n: S.n });
    if (!(inGame && S.rated && !onlineRoom())) list.push({ key: 'rated', label: 'レート戦', rules: RT.rules(), n: RT.PLAYERS });
    if (!inGame) list.push({ key: 'free', label: 'フリー対戦', rules: store.rules, n: settings.players });
    return list;
  }
  const openBook = (tab, src) => CM.openBook('daifugo', tab, src);
  const closeBook = CM.closeBook;

  // ─────────────────────────────────────────────
  // アーティファクトの再公開時に対局を引き継ぐ
  // ─────────────────────────────────────────────
  let hotRegistered = false;
  function saveHot() {
    const hot = globalThis.claude && globalThis.claude.hot;
    if (hotRegistered || !hot || !hot.snapshot) return;
    hotRegistered = true;
    try { hot.snapshot(() => ({ match: S ? E.serialize(S) : null, screen: $('scr-game').hidden ? 'title' : 'game' })); } catch (e) { /* 無視 */ }
  }

  // ─────────────────────────────────────────────
  // 起動（main.js から呼ばれる）
  // ─────────────────────────────────────────────
  function init() {
    $('g-menu').innerHTML = A.icon('menu');
    $('g-book').innerHTML = A.icon('book');
    $('rules-back').innerHTML = A.icon('back');
    setActionButtons({});

    $('btn-rated').addEventListener('click', () => { SND.unlock(); openRated(); });
    $('btn-start').addEventListener('click', () => { SND.unlock(); newMatch(); });
    $('btn-book').addEventListener('click', () => openBook('basics'));
    $('g-book').addEventListener('click', () => (CM.bookOpen() ? closeBook() : openBook('rules')));
    $('btn-resume').addEventListener('click', () => { SND.unlock(); resumeMatch(); });
    $('btn-rules').addEventListener('click', () => showScreen('rules'));
    $('btn-online').addEventListener('click', () => { SND.unlock(); OC.openOnline('daifugo'); });
    $('rules-back').addEventListener('click', () => showScreen('title'));
    $('rules-start').addEventListener('click', () => { SND.unlock(); newMatch(); });
    $('g-menu').addEventListener('click', openMenu);

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
  }

  /** Claude のページを再公開したとき、対局中だったら続きから */
  function restore(data) {
    if (!data || !data.match) return false;
    store.match = data.match;
    if (data.screen === 'game') { resumeMatch(); return true; }
    return false;
  }

  D.Games.daifugo = {
    id: 'daifugo', label: '大富豪', init, renderHome, restore, bookSources, online,
    state: () => S,
    stopLocal() { if (S && !onlineRoom() && CM.visible('scr-game')) persist(); cancelLoop(); },
  };
  // 動作確認用
  D.App = { get state() { return S; }, get online() { return OC.cur; }, newMatch, resumeMatch, settings, store };
})();
