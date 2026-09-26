/* スピード — ホーム・設定・対局の画面と進行（リアルタイム。ローカルのAI戦とオンライン） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const C = D.Cards, A = D.Art, SND = D.Sound, UI = D.UI, RT = D.Rating, CM = D.Common, OC = D.OnlineClient;
  const SP = D.Speed, SPH = D.SpeedHost, SR = D.SpeedRules;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const store = CM.store;
  const ss = store.speed; // { settings: { level, games }, rules, rating, match }
  const now = () => Date.now();

  let S = null;
  let human = 0;
  let seatInfo = null;
  let timer = 0;
  let running = false; // ローカル：時計が動いているか
  let resultsOpen = false;
  let pending = []; // オンライン：送ったがまだサーバーから返ってきていない自分の手 { slot, pile, card }
  const onlineRoom = () => (OC.cur && OC.cur.game === 'speed' ? OC.cur : null);
  const opp = () => 1 - human;
  const levelOf = (seat) => (S && !S.players[seat].human ? S.players[seat].level : null);

  // ─────────────────────────────────────────────
  // ホーム・設定
  // ─────────────────────────────────────────────
  function savedMatch() {
    const m = ss.match;
    if (!m || m.game !== 'speed' || m.matchOver || m.phase === 'idle') return null;
    return m;
  }
  const gamesLabel = (g) => (g === 1 ? '1ゲーム' : g + '本勝負');
  function rulesSummary(R) {
    const on = ['となりの数字'];
    if (R.same) on.push('同じ数字');
    if (R.wrap) on.push('AとKがつながる');
    return on.join('・');
  }

  function renderHome() {
    const el = $('home-speed');
    if (!el.dataset.built) {
      el.innerHTML = D.Shell.homeHTML({
        prefix: 'sph', title: 'スピード', en: 'SPEED', tag: '順番なし、早い者勝ち。反射神経の1対1',
        art: D.Shell.fanHTML(['H9', 'S10', 'D11'], 44, 16),
      });
      $('sph-rated').addEventListener('click', () => { SND.unlock(); openRated(); });
      $('sph-free').addEventListener('click', () => { SND.unlock(); newMatch(); });
      $('sph-resume').addEventListener('click', () => { SND.unlock(); resumeMatch(); });
      $('sph-online').addEventListener('click', () => { SND.unlock(); OC.openOnline('speed'); });
      $('sph-book').addEventListener('click', () => CM.openBook('speed', 'basics'));
      $('sph-settings').addEventListener('click', openSettings);
      el.dataset.built = '1';
    }
    $('sph-rating').innerHTML = D.Shell.rateStripHTML('speed');
    const m = savedMatch();
    $('sph-resume').hidden = !m;
    if (m) $('sph-resume').textContent = 'つづきから（' + (m.rated ? 'レート戦 ' : '') + m.players.map((p) => p.wins).join(' - ') + '）';
    $('sph-online').hidden = !D.Net.available();
    $('sph-note').innerHTML = 'フリー対戦：AI（' + CM.LEVEL_LABEL[ss.settings.level] + '）・' + gamesLabel(ss.settings.games) + '<br>ルール：<b>' + esc(rulesSummary(ss.rules)) + '</b>';
  }

  function openSettings() {
    CM.showScreen('scr-gset');
    $('gset-title').textContent = 'スピード・ルールと設定';
    $('gset-back').onclick = () => D.Shell.showHome('speed');
    $('gset-start').onclick = () => { SND.unlock(); newMatch(); };
    renderSettings();
  }
  function renderSettings() {
    const wrap = $('gset-wrap');
    wrap.innerHTML = '';
    const st = ss.settings;
    const set = (k, v) => { st[k] = v; CM.save(); renderSettings(); };
    const m = CM.section('対戦設定', 'フリー対戦の設定。レート戦は3本勝負・標準ルールで固定');
    m.panel.appendChild(CM.row('AIの強さ', 'AIがカードを出す速さ：やさしい 約2秒・ふつう 約1.2秒・つよい 約0.7秒',
      CM.seg([{ v: 'easy', label: 'やさしい' }, { v: 'normal', label: 'ふつう' }, { v: 'hard', label: 'つよい' }], st.level, (v) => set('level', v))));
    m.panel.appendChild(CM.row('試合の長さ', '', CM.seg([{ v: 1, label: '1ゲーム' }, { v: 3, label: '3本勝負' }, { v: 5, label: '5本勝負' }], st.games, (v) => set('games', v))));
    wrap.appendChild(m.s);
    const r = CM.section('ルール');
    for (const def of SR.RULES) {
      r.panel.appendChild(CM.row(def.label, def.desc, CM.toggle('spr-' + def.key, ss.rules[def.key], (v) => { ss.rules[def.key] = v; CM.save(); renderSettings(); }, false, def.label)));
    }
    wrap.appendChild(r.s);
  }

  // ─────────────────────────────────────────────
  // 試合の開始・再開・保存
  // ─────────────────────────────────────────────
  function openRated() {
    const m = savedMatch();
    if (m && m.rated) { askAbandon(openRated); return; }
    CM.openRatedDialog('speed', { onPick: (lv) => newMatch({ rated: true, level: lv }) });
  }
  function askAbandon(then) {
    CM.askAbandon(savedMatch(), { onResume: resumeMatch, onAbandoned: () => { ss.match = null; CM.save(); renderHome(); then(); } });
  }

  function newMatch(opts) {
    const rated = !!(opts && opts.rated);
    const m = savedMatch();
    if (m && m.rated && !(opts && opts.abandoned)) { askAbandon(() => newMatch(Object.assign({}, opts, { abandoned: true }))); return; }
    stopClock();
    OC.leaveRoom(true);
    const c = RT.cfg('speed');
    const level = rated ? opts.level : ss.settings.level;
    const players = [{ name: CM.settings.name || 'あなた', human: true }, { name: A.ROBOTS[0].name, level }];
    const info = rated ? { level, base: [ss.rating.r, c.ai[level]], matches: ss.rating.matches, result: null } : null;
    S = SP.createMatch({ rules: rated ? c.rules() : ss.rules, players, games: rated ? c.games : ss.settings.games, rated: info });
    human = 0;
    seatInfo = null;
    startGame();
  }

  function startGame() {
    resultsOpen = false;
    const evs = SP.startGame(S);
    S.clock = null;
    showTable();
    animate(evs);
    persist();
    startClock();
  }

  function resumeMatch() {
    const m = savedMatch();
    if (!m) return;
    stopClock();
    OC.leaveRoom(true);
    try { S = SP.deserialize(m); } catch (e) { UI.toast('保存された試合を読み込めませんでした'); return; }
    human = 0;
    seatInfo = null;
    S.clock = null;
    showTable();
    if (S.phase === 'over') showResults();
    else startClock();
  }

  function persist() {
    if (!S || onlineRoom()) return;
    try { const o = SP.serialize(S); delete o.clock; ss.match = o; CM.save(); } catch (e) { /* 保存できなくても続行 */ }
  }

  // ─────────────────────────────────────────────
  // 時計（ローカル）：AIが出す時刻と「せーの」
  // ─────────────────────────────────────────────
  function startClock() {
    running = true;
    S.clock = null;
    SPH.schedule(S, now(), levelOf);
    loop();
  }
  function stopClock() { running = false; clearTimeout(timer); }
  function loop() {
    clearTimeout(timer);
    if (!running || !S || onlineRoom()) return;
    const d = SPH.nextDelay(S, now());
    renderCall();
    if (d == null) return;
    timer = setTimeout(tick, Math.max(16, d));
  }
  function tick() {
    if (!running || !S) return;
    const r = SPH.tick(S, now(), levelOf);
    if (r) { animate(r.events); after(); }
    loop();
  }
  function after() {
    if (S.phase === 'over') {
      stopClock();
      if (S.matchOver && CM.applyRatedLocal(S)) { /* レートを更新 */ }
      persist();
      setTimeout(showResults, 900 * UI.speed);
    }
  }

  // ─────────────────────────────────────────────
  // 表示
  // ─────────────────────────────────────────────
  function showTable() {
    CM.showScreen('scr-speed');
    $('fx').innerHTML = '';
    $('spd-my-field').innerHTML = '';
    $('spd-opp-field').innerHTML = '';
    render();
  }

  function fit() {
    const scr = $('scr-speed');
    const W = scr.clientWidth, H = scr.clientHeight;
    if (!W || !H) return;
    let cw = Math.min((W - 60) / 5.4, (H - 120) / 6.3);
    cw = Math.max(52, Math.min(120, Math.floor(cw)));
    scr.style.setProperty('--sw', cw + 'px');
    scr.style.setProperty('--ow', Math.round(cw * 0.72) + 'px');
    scr.style.setProperty('--pw2', Math.round(Math.max(cw * 1.12, Math.min(cw * 1.6, (W - 90) / 2.5, (H - 120) / 7.2))) + 'px');
  }

  function render() {
    if (!S) return;
    fit();
    const sub = [];
    if (S.rated) sub.push('<span class="rated-tag">レート戦</span>');
    if (UI.roomCode && onlineRoom()) sub.push('部屋 ' + esc(UI.roomCode));
    $('spd-gameno').innerHTML = '第' + S.gameNo + 'ゲーム' + (S.maxGames ? '<span class="of">（' + gamesLabel(S.maxGames) + '）</span>' : '') + (sub.length ? '<small>' + sub.join(' ') + '</small>' : '');
    const me = S.players[human], op = S.players[opp()];
    const info = seatInfo && seatInfo[opp()];
    const face = info && info.type === 'human' ? A.personSVG(opp()) : A.robotSVG(info ? info.robot : 0);
    if ($('spd-opp-ava').dataset.face !== (info && info.type === 'human' ? 'h' : 'r')) { $('spd-opp-ava').innerHTML = face; $('spd-opp-ava').dataset.face = info && info.type === 'human' ? 'h' : 'r'; }
    $('spd-opp-name').textContent = op.name;
    $('spd-my-name').textContent = me.name === 'あなた' ? 'あなた' : me.name;
    if (!$('spd-my-ava').innerHTML) $('spd-my-ava').innerHTML = A.humanSVG();
    $('spd-opp-wins').innerHTML = winsHTML(op.wins);
    $('spd-my-wins').innerHTML = winsHTML(me.wins);
    $('spd-opp').classList.toggle('away', !!(info && info.type === 'human' && !info.connected));
    renderField(opp(), $('spd-opp-field'), false);
    renderField(human, $('spd-my-field'), true);
    renderDeck(op, $('spd-opp-deck'));
    renderDeck(me, $('spd-my-deck'));
    renderPile(0);
    renderPile(1);
    renderCall();
  }
  function winsHTML(w) {
    const need = SP.winsNeeded(S);
    if (!isFinite(need)) return w ? '<span class="wn">' + w + '勝</span>' : '';
    let h = '';
    for (let i = 0; i < need; i++) h += '<i class="' + (i < w ? 'on' : '') + '"></i>';
    return h;
  }
  function renderDeck(P, el) {
    const n = SP.deckCount(P);
    el.innerHTML = n ? '<div class="card back" style="background-image:' + UI.backURI + '"></div><span class="cnt">' + n + '</span>' : '<div class="spd-empty"></div><span class="cnt">0</span>';
  }
  function playableSlots(seat) {
    const set = new Set();
    for (const mv of SP.playable(S, seat)) set.add(mv.slot);
    return set;
  }
  /** 場札：変わった場所だけ作り直す（毎回作ると全部のカードがちらつくため） */
  function renderField(seat, el, mine) {
    const P = S.players[seat];
    const ok = mine && S.phase === 'play' && CM.settings.showPlayable ? playableSlots(seat) : null;
    if (el.children.length !== P.field.length) {
      el.innerHTML = P.field.map((_, slot) => '<div class="spd-slot" data-slot="' + slot + '"></div>').join('');
    }
    P.field.forEach((card, slot) => {
      const box = el.children[slot];
      if (box.dataset.card !== (card || '')) {
        box.dataset.card = card || '';
        if (!card) box.innerHTML = '<div class="spd-empty"></div>';
        else {
          box.innerHTML = '<div class="card fresh' + (mine ? ' mine' : '') + '" data-slot="' + slot + '"' +
            (mine ? ' role="button" tabindex="0" aria-label="' + esc(SP.cardName(card)) + '"' : '') + '>' + A.faceSVG(card) + '</div>';
          if (mine) bindCard(box.firstChild, slot);
        }
      }
      const c = box.querySelector('.card');
      if (c) c.classList.toggle('dim', !!(ok && !ok.has(slot)));
    });
  }
  function renderPile(i) {
    const el = $('spd-pile-' + i);
    const p = S.piles[i];
    const k = p.length;
    let h = '<div class="spd-pile-base"></div>';
    for (let j = Math.max(0, k - 3); j < k; j++) {
      const d = k - 1 - j;
      const rot = ((j * 37 + i * 11) % 9 - 4) * 1.6;
      h += '<div class="card" style="transform:translate(' + (-d * 2) + 'px,' + (-d * 2) + 'px) rotate(' + rot + 'deg);z-index:' + (j + 1) + '">' + A.faceSVG(p[j]) + '</div>';
    }
    el.innerHTML = h;
  }
  function renderCall() {
    const el = $('spd-call');
    if (!S) return;
    if (S.phase === 'stuck') { el.textContent = S.stuckReason === 'start' ? 'せーの…' : '出せるカードなし・せーの…'; el.className = 'spd-call on'; }
    else el.className = 'spd-call';
  }

  // ─────────────────────────────────────────────
  // 操作：タップで出す（両方に出せるなら続きやすいほう）、ドラッグで台札を選ぶ
  // ─────────────────────────────────────────────
  function pilesFor(slot) {
    const card = S.players[human].field[slot];
    if (!card) return [];
    return [0, 1].filter((i) => SP.canStack(S.rules, card, SP.topOf(S, i)));
  }
  function bestPile(slot, piles) {
    if (piles.length === 1) return piles[0];
    let best = piles[0], bestV = -1;
    for (const pile of piles) {
      const T = SP.clone(S);
      T.piles[pile].push(T.players[human].field[slot]);
      T.players[human].field[slot] = null;
      const v = SP.playable(T, human).length - 0.3 * SP.playable(T, opp()).length;
      if (v > bestV) { bestV = v; best = pile; }
    }
    return best;
  }

  function tryPlay(slot, pile, fromEl) {
    if (!S || S.phase !== 'play') { SND.play('error'); return; }
    const piles = pilesFor(slot);
    if (!piles.length) { shake(fromEl); SND.play('error'); return; }
    if (pile == null || !piles.includes(pile)) pile = pile == null ? bestPile(slot, piles) : null;
    if (pile == null) { shake(fromEl); SND.play('error'); return; }
    const card = S.players[human].field[slot];
    const o = onlineRoom();
    if (o) {
      // オンライン：すぐに動かして見せ、サーバーの結果で正しい状態に合わせる
      if (!o.conn.send({ t: 'action', action: { type: 'play', slot, pile } })) { UI.toast('通信が切れています'); return; }
      pending.push({ slot, pile, card, at: now() });
      flyFrom(fromEl, pile, card);
      S.piles[pile].push(card);
      S.players[human].field[slot] = null;
      render();
      return;
    }
    let evs;
    try { evs = SP.play(S, human, slot, pile); } catch (e) { shake(fromEl); SND.play('error'); return; }
    SPH.schedule(S, now(), levelOf);
    animate(evs, fromEl);
    after();
    loop();
  }

  function shake(el) {
    if (!el) return;
    el.classList.remove('nope');
    void el.offsetWidth;
    el.classList.add('nope');
  }

  function bindCard(el, slot) {
    let sx = 0, sy = 0, dragging = false, pid = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      pid = e.pointerId;
      sx = e.clientX; sy = e.clientY; dragging = false;
      try { el.setPointerCapture(pid); } catch (err) { /* 無視 */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (pid !== e.pointerId) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging && Math.hypot(dx, dy) > 10) { dragging = true; el.classList.add('drag'); }
      if (dragging) {
        el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.06)';
        const over = pileAt(e.clientX, e.clientY);
        document.querySelectorAll('.spd-pile').forEach((p) => p.classList.toggle('over', over != null && +p.dataset.pile === over));
      }
    });
    const end = (e) => {
      if (pid !== e.pointerId) return;
      pid = null;
      document.querySelectorAll('.spd-pile').forEach((p) => p.classList.remove('over'));
      if (dragging) {
        const pile = pileAt(e.clientX, e.clientY);
        el.classList.remove('drag');
        el.style.transform = '';
        if (pile != null) tryPlay(slot, pile, el);
      } else tryPlay(slot, null, el);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { if (pid === e.pointerId) { pid = null; el.classList.remove('drag'); el.style.transform = ''; } });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tryPlay(slot, null, el); } });
  }
  function pileAt(x, y) {
    for (const i of [0, 1]) {
      const r = $('spd-pile-' + i).getBoundingClientRect();
      if (x >= r.left - 16 && x <= r.right + 16 && y >= r.top - 16 && y <= r.bottom + 16) return i;
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 演出（短く・速く）
  // ─────────────────────────────────────────────
  function pileRect(i) {
    const el = $('spd-pile-' + i).querySelector('.card:last-child') || $('spd-pile-' + i);
    return el.getBoundingClientRect();
  }
  function slotRect(seat, slot) {
    const box = seat === human ? $('spd-my-field') : $('spd-opp-field');
    const el = box.querySelector('.spd-slot[data-slot="' + slot + '"]');
    return (el || box).getBoundingClientRect();
  }
  function deckRect(seat) { return (seat === human ? $('spd-my-deck') : $('spd-opp-deck')).getBoundingClientRect(); }
  function flyFrom(fromEl, pile, card) {
    const from = fromEl ? fromEl.getBoundingClientRect() : null;
    const to = pileRect(pile);
    SND.play('card', 1);
    if (from) UI.fly([{ id: card, from, to }], 150);
  }

  function animate(evs, fromEl) {
    for (const ev of evs) {
      if (ev.t === 'play') {
        const mine = ev.seat === human;
        const from = mine && fromEl ? fromEl.getBoundingClientRect() : slotRect(ev.seat, ev.slot);
        const to = pileRect(ev.pile);
        SND.play('card', 1);
        UI.fly([{ id: ev.card, from, to }], mine ? 150 : 190);
      } else if (ev.t === 'flip') {
        SND.play('flow');
        const items = ev.cards.map((c) => ({ id: c.card, from: c.from === 'deck' ? deckRect(c.seat) : slotRect(c.seat, c.slot), to: pileRect(c.seat), delay: 0 }));
        if (items.length) UI.fly(items, 260);
        flashCall(ev.reason === 'start' ? 'スタート！' : 'せーの！');
      } else if (ev.t === 'stuck') {
        SND.play('pass');
      } else if (ev.t === 'over') {
        const win = ev.winner === human, draw = ev.winner === null;
        SND.play(win ? 'fanfare' : draw ? 'pass' : 'foul');
        UI.banner(draw ? '引き分け' : win ? '勝ち！' : '負け…', draw ? 'small' : win ? '' : 'foul', ev.wins[human] + ' - ' + ev.wins[opp()], 1300);
      }
    }
    render();
  }
  function flashCall(text) {
    const el = $('spd-call');
    el.textContent = text;
    el.className = 'spd-call flash';
    setTimeout(() => { if (S && S.phase !== 'stuck') el.className = 'spd-call'; }, 700);
  }

  // ─────────────────────────────────────────────
  // 結果・メニュー
  // ─────────────────────────────────────────────
  function gameResultHTML() {
    const w = S.winner;
    const me = S.players[human], op = S.players[opp()];
    const msg = w === null ? '引き分け（このゲームは数えません）' : w === human ? 'あなたの勝ち！' : op.name + ' の勝ち';
    return '<h3>第' + S.gameNo + 'ゲーム 結果</h3><p>' + esc(msg) + '</p>' +
      '<div class="spd-score"><div><span>' + esc(me.name) + '</span><b>' + me.wins + '</b></div><em>-</em><div><b>' + op.wins + '</b><span>' + esc(op.name) + '</span></div></div>' +
      (S.maxGames > 1 ? '<p class="menu-note">' + gamesLabel(S.maxGames) + '：先に' + SP.winsNeeded(S) + '勝した方の勝ち</p>' : '');
  }

  function showResults() {
    if (!S || resultsOpen) return;
    resultsOpen = true;
    if (S.matchOver) { showFinal(); return; }
    UI.openDialog(gameResultHTML() + '<div class="btns"><button class="btn btn-ghost" type="button" id="res-title">ホームへ</button><button class="btn btn-gold" type="button" id="res-next">次のゲームへ</button></div>');
    $('res-next').addEventListener('click', () => { UI.closeDialog(); startGame(); });
    $('res-title').addEventListener('click', () => { UI.closeDialog(); resultsOpen = false; D.Shell.showHome('speed'); });
  }

  function showFinal() {
    CM.applyRatedLocal(S);
    persist();
    const res = S.rated && S.rated.result;
    const box = res ? CM.rateBoxHTML('AI戦レート', res, CM.rateNote('speed', res)) : '';
    const dlg = UI.openDialog(CM.finalHTML(S, human, box) + '<div class="btns"><button class="btn btn-ghost" type="button" id="fin-title">ホームへ</button><button class="btn btn-gold" type="button" id="fin-again">' +
      (S.rated ? 'もう一度レート戦' : 'もう一度') + '</button></div>');
    CM.animateRate(dlg);
    $('fin-again').addEventListener('click', () => { UI.closeDialog(); newMatch(S.rated ? { rated: true, level: S.rated.level } : undefined); });
    $('fin-title').addEventListener('click', () => { UI.closeDialog(); resultsOpen = false; D.Shell.showHome('speed'); });
  }

  function openMenu() {
    if (onlineRoom()) { OC.openMenu(); return; }
    const wasRunning = running;
    stopClock(); // メニューを開いている間は止める
    const ratedLive = S && S.rated && !S.matchOver;
    const resume = () => { UI.closeDialog(); if (wasRunning && S && S.phase !== 'over') startClock(); };
    UI.openDialog('<h3>一時停止</h3><div class="menu-list">' +
      '<button class="btn btn-gold" type="button" id="m-close">続ける</button>' +
      '<button class="btn btn-ghost" type="button" id="m-book">ルールブック</button>' +
      (ratedLive ? '<button class="btn btn-ghost" type="button" id="m-abandon">棄権する</button>' : '<button class="btn btn-ghost" type="button" id="m-restart">最初からやり直す</button>') +
      '<button class="btn btn-ghost" type="button" id="m-title">ホームに戻る</button></div>' +
      (ratedLive ? '<p class="menu-note">ホームに戻っても、レート戦は「つづきから」で再開できます。</p>' : ''), { onBackdrop: resume });
    $('m-close').addEventListener('click', resume);
    $('m-book').addEventListener('click', () => { UI.closeDialog(); CM.openBook('speed', 'basics', 'game'); if (wasRunning) startClock(); });
    if (ratedLive) {
      $('m-abandon').addEventListener('click', () => {
        persist();
        UI.openDialog('<h3>棄権しますか？</h3><p>' + CM.abandonNote(ss.match) + '</p><div class="btns">' +
          '<button class="btn btn-ghost" type="button" id="m-no">やめる</button><button class="btn btn-gold" type="button" id="m-yes">棄権する</button></div>', { onBackdrop: resume });
        $('m-no').addEventListener('click', resume);
        $('m-yes').addEventListener('click', () => {
          const r = CM.abandonRatedLocal(ss.match);
          ss.match = null;
          CM.save();
          const dlg = UI.openDialog('<h3>棄権しました</h3>' + (r ? CM.rateBoxHTML('AI戦レート', r) : '') + '<div class="btns"><button class="btn btn-gold" type="button" id="m-done">ホームへ</button></div>');
          CM.animateRate(dlg);
          $('m-done').addEventListener('click', () => { UI.closeDialog(); D.Shell.showHome('speed'); });
        });
      });
    } else {
      $('m-restart').addEventListener('click', () => { UI.closeDialog(); newMatch(); });
    }
    $('m-title').addEventListener('click', () => { UI.closeDialog(); persist(); D.Shell.showHome('speed'); });
  }

  // ─────────────────────────────────────────────
  // オンライン（時計とAIはサーバー。ここは表示と自分の手）
  // ─────────────────────────────────────────────
  async function handleView(o, v) {
    const st = SP.deserialize(v.state);
    const evs = v.events || [];
    const first = !o.gameShown || o.seat !== v.seat;
    // サーバーが受け付けた自分の手は、もう動かして見せたので演出しない
    const shown = new Set();
    for (const ev of evs) {
      if (ev.t !== 'play' || ev.seat !== v.seat) continue;
      const i = pending.findIndex((p) => p.slot === ev.slot && p.card === ev.card);
      if (i >= 0) { pending.splice(i, 1); shown.add(ev); }
    }
    S = st;
    human = v.seat;
    seatInfo = v.seats;
    o.seat = v.seat;
    // まだ返ってきていない自分の手は、見た目の上では出したことにしておく。
    // 出せなくなっていたら（相手が先に出した）あきらめて、カードを場札に戻す
    pending = pending.filter((p) => now() - p.at < 1500 && S.players[human].field[p.slot] === p.card && SP.canStack(S.rules, p.card, SP.topOf(S, p.pile)));
    for (const p of pending) {
      S.piles[p.pile].push(p.card);
      S.players[human].field[p.slot] = null;
    }
    if (o.resultsOpen && S.phase !== 'over') { UI.closeDialog(); o.resultsOpen = false; resultsOpen = false; }
    if (first) {
      o.gameShown = true;
      pending = [];
      showTable();
    }
    const rest = evs.filter((ev) => !shown.has(ev));
    if (rest.length) animate(rest); else render();
    if (S.phase === 'over' && !o.resultsOpen) setTimeout(() => { if (OC.cur === o && S.phase === 'over' && !o.resultsOpen) showOnlineResults(o); }, 900 * UI.speed);
  }

  function showOnlineResults(o) {
    o.resultsOpen = true;
    if (S.matchOver) { showOnlineFinal(o); return; }
    UI.openDialog(gameResultHTML() + '<p>だれかが「次のゲームへ」を押すと、次のゲームが始まります。</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button>' +
      (S.rated ? '' : '<button class="btn btn-ghost" type="button" id="res-lobby">ここで終わる</button>') +
      '<button class="btn btn-gold" type="button" id="res-next">次のゲームへ</button></div>');
    $('res-next').addEventListener('click', () => { if (OC.cur) { OC.cur.conn.send({ t: 'next' }); $('res-next').disabled = true; $('res-next').textContent = '始めています…'; } });
    if ($('res-lobby')) $('res-lobby').addEventListener('click', () => { if (OC.cur) OC.cur.conn.send({ t: 'lobby' }); });
    $('res-leave').addEventListener('click', () => OC.confirmLeave(true));
  }

  function showOnlineFinal(o) {
    const info = S.rated;
    const res = info && info.results ? info.results : [];
    const mine = res[human];
    const box = mine ? CM.rateBoxHTML('オンラインレート', Object.assign({ result: S.players[human].wins > S.players[opp()].wins ? 1 : 0 }, mine), CM.rateNote('speed', Object.assign({ result: S.players[human].wins > S.players[opp()].wins ? 1 : 0 }, mine))) : '';
    const dlg = UI.openDialog(CM.finalHTML(S, human, box, res.map((r) => (r && !r.abandoned ? r : null))) +
      (info && !mine ? '<p class="menu-note">途中から参加したので、あなたのレートは変わりません。</p>' : '') +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="res-leave">部屋を出る</button><button class="btn btn-gold" type="button" id="res-lobby">部屋に戻る</button></div>');
    CM.animateRate(dlg);
    $('res-lobby').addEventListener('click', () => { if (OC.cur) { OC.cur.conn.send({ t: 'lobby' }); $('res-lobby').disabled = true; } });
    $('res-leave').addEventListener('click', () => OC.confirmLeave(true));
  }

  function chatBubble(seat, name, text, mine) {
    if (!S || !CM.visible('scr-speed')) return;
    UI.bubbleAt((mine || seat === human) ? $('spd-me').querySelector('.spd-who') : $('spd-opp').querySelector('.spd-who'), text, false, 'chat');
  }

  /** 同時に出してぶつかったとき（相手が先）は、やさしく知らせる */
  function onError(msg) {
    if (!/出せません|せーの/.test(msg)) return false;
    UI.toast('相手が先に出しました', 900);
    return true;
  }

  const online = {
    quickUpdate: () => false,
    onError,
    handleView,
    reask(o) { if (o && S && S.phase === 'over' && !o.resultsOpen) showOnlineResults(o); },
    cancelInput() { pending = []; },
    bubble: chatBubble,
    showResults: showOnlineResults,
    showTable() { showTable(); },
    rulesDesc: () => 'あなたのスピードのルール（' + rulesSummary(ss.rules) + '）で遊びます。',
    startRules: () => ss.rules,
  };

  function bookSources() {
    const inGame = S && CM.visible('scr-speed');
    const list = [];
    if (inGame) list.push({ key: 'game', label: 'このゲーム', rules: S.rules, n: 2 });
    list.push({ key: 'rated', label: 'レート戦', rules: RT.cfg('speed').rules(), n: 2 });
    if (!inGame) list.push({ key: 'free', label: 'フリー対戦', rules: ss.rules, n: 2 });
    return list;
  }

  function init() {
    $('spd-menu').innerHTML = A.icon('menu');
    $('spd-book').innerHTML = A.icon('book');
    $('spd-menu').addEventListener('click', openMenu);
    $('spd-book').addEventListener('click', () => (CM.bookOpen() ? CM.closeBook() : CM.openBook('speed', 'basics', 'game')));
    let rz = 0;
    addEventListener('resize', () => {
      cancelAnimationFrame(rz);
      rz = requestAnimationFrame(() => { if (S && CM.visible('scr-speed')) render(); });
    });
    // アプリを離れたら一時停止（ローカルだけ）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && running && !onlineRoom()) { persist(); openMenu(); }
    });
  }

  D.Games.speed = {
    id: 'speed', label: 'スピード', init, renderHome, bookSources, online,
    state: () => S,
    stopLocal() { if (S && !onlineRoom() && CM.visible('scr-speed')) persist(); stopClock(); },
  };
  D.SpeedApp = { get state() { return S; }, newMatch, resumeMatch };
})();
