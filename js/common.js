/* 共通：保存・個人設定・画面の切り替え・画面の部品・レート戦・試合結果・ルールブックの枠
 * どのゲーム（大富豪・七並べ・スピード）からも使う */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, SND = D.Sound, UI = D.UI, RT = D.Rating, RU = D.Rules;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;

  // ─────────────────────────────────────────────
  // 保存（この端末のブラウザだけ）。キーは大富豪だけだった頃のまま
  // ─────────────────────────────────────────────
  const STORE_KEY = 'daifugo.v1';
  const DEFAULT_SETTINGS = { players: 4, level: 'normal', games: 10, speed: 'normal', back: 'red', sound: true, bgm: true, bgmVol: 'low', autoPass: true, showPlayable: true, name: 'あなた' };
  const newRating = () => ({ r: RT.START, matches: 0, best: RT.START, hist: [] });
  let store = {};
  try { store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { store = {}; }
  // 大富豪（以前からの形のまま）
  store.settings = Object.assign({}, DEFAULT_SETTINGS, store.settings || {});
  store.rules = store.rules ? RU.migrate(store.rules) : Object.assign({}, RU.MINE);
  store.rating = Object.assign(newRating(), store.rating || {});
  delete store.log; // 以前の「履歴」（出したカードの記録）。カウンティングできないように履歴はなくした
  // 七並べ・スピード
  store.sevens = Object.assign({}, store.sevens);
  store.sevens.settings = Object.assign({ players: 4, level: 'normal', games: 10 }, store.sevens.settings);
  store.sevens.rules = D.SevensRules.normalize(store.sevens.rules);
  store.sevens.rating = Object.assign(newRating(), store.sevens.rating || {});
  store.speed = Object.assign({}, store.speed);
  store.speed.settings = Object.assign({ level: 'normal', games: 3 }, store.speed.settings);
  store.speed.rules = D.SpeedRules.normalize(store.speed.rules);
  store.speed.rating = Object.assign(newRating(), store.speed.rating || {});
  // オンラインのレート（サーバーから届いた値の控え）
  store.onlineRatings = store.onlineRatings || {};
  if (store.onlineRating && !store.onlineRatings.daifugo) store.onlineRatings.daifugo = store.onlineRating;
  const settings = store.settings;

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 保存できなくても続行 */ }
  }

  // ─────────────────────────────────────────────
  // 個人設定（全ゲーム共通）
  // ─────────────────────────────────────────────
  const SPEEDS = { slow: 1.35, normal: 1, fast: 0.6 };
  const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LEVEL_LABEL = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };

  function applySettings() {
    UI.speed = SPEEDS[settings.speed] || 1;
    if (reduceMotion) UI.speed = Math.min(UI.speed, 0.6);
    document.documentElement.style.setProperty('--speed', String(UI.speed));
    UI.backURI = A.backDataURI(settings.back);
    UI.showPlayable = settings.showPlayable;
    SND.setEnabled(settings.sound);
    if (D.BGM) D.BGM.sync();
    const any = settings.sound || settings.bgm;
    document.querySelectorAll('[data-sound-btn]').forEach((b) => {
      b.innerHTML = A.icon(any ? 'soundOn' : 'soundOff');
      b.setAttribute('aria-label', any ? '音をすべて消す' : '音を出す');
    });
  }
  /** 対局中のスピーカーのボタン：効果音と BGM をまとめて消す／出す（別々の設定はマイページ） */
  function toggleSound() {
    const any = settings.sound || settings.bgm;
    settings.sound = settings.bgm = !any;
    save();
    applySettings();
    if (settings.sound) SND.play('select');
  }
  /** オンラインで表示する名前（「あなた」のままなら未設定） */
  function playerName() {
    const n = (settings.name || '').trim();
    return n && n !== 'あなた' ? n : '';
  }

  // ─────────────────────────────────────────────
  // 画面の切り替え（#app 直下の .screen を1つだけ表示）
  // ─────────────────────────────────────────────
  const showHooks = [];
  function showScreen(id) {
    document.querySelectorAll('#app > .screen').forEach((el) => { el.hidden = el.id !== id; });
    closeBook();
    for (const f of showHooks) f(id);
  }
  const onShow = (f) => showHooks.push(f);
  const visible = (id) => { const el = $(id); return !!el && !el.hidden; };

  // ─────────────────────────────────────────────
  // 設定画面の部品
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

  // ─────────────────────────────────────────────
  // レート戦（AI戦のレートはこの端末に、ゲームごとに保存）
  // ─────────────────────────────────────────────
  const ratingOf = (game) => (game === 'daifugo' ? store.rating : store[game].rating);
  const fmtExp = (v) => (Math.abs(v) < 0.05 ? '±0' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1));
  const pct = (p) => Math.round(p * 100) + '%';

  function recordRating(game, delta, entry) {
    const rt = ratingOf(game);
    const before = rt.r;
    rt.r = before + delta;
    rt.matches++;
    rt.best = Math.max(rt.best, rt.r);
    rt.hist.push(Object.assign({ at: Date.now(), before, after: rt.r, d: delta }, entry));
    if (rt.hist.length > 50) rt.hist.splice(0, rt.hist.length - 50);
    save();
    return { before, after: rt.r };
  }

  /** ローカルのレート戦が終わったらレートを更新する（S.rated.result で1回だけ） */
  function applyRatedLocal(S) {
    const info = S && S.rated;
    if (!info || info.result || info.online || !S.matchOver) return null;
    const r = RT.matchResult(S, info.base, info.base.map((_, i) => (i === 0 ? info.matches : 0)))[0];
    const rec = recordRating(S.game || 'daifugo', r.delta, { total: r.total, level: info.level });
    info.result = { before: rec.before, after: rec.after, delta: r.delta, expected: r.expected, total: r.total, result: r.result };
    return info.result;
  }

  /** 途中のレート戦を棄権（保存された試合 m を使う。得点のゲームは残りを最下位、勝ち負けのゲームは負け） */
  function abandonRatedLocal(m) {
    if (!m || !m.rated || m.matchOver || m.rated.result) return null;
    const game = m.game || 'daifugo';
    const r = RT.abandonResult(m, 0, m.rated.base, m.rated.matches);
    const rec = recordRating(game, r.delta, { total: r.total, level: m.rated.level, abandoned: true });
    return { before: rec.before, after: rec.after, delta: r.delta };
  }

  function abandonNote(m) {
    if (RT.cfg(m.game).kind === 'winloss') return '棄権すると <b>負け</b> になり、レートが下がります。';
    const left = m.maxGames - (m.history || []).length;
    return '残りの' + left + 'ゲームは <b>最下位（−3点）</b> として計算され、レートが下がります。';
  }

  /** レートの説明（結果の下の1行） */
  function rateNote(game, r) {
    if (RT.cfg(game).kind === 'winloss') return '勝つ確率 ' + pct(r.expected) + ' の相手に' + (r.result === 1 ? '勝ちました' : r.result === 0 ? '負けました' : '引き分け');
    return '予想の総得点 ' + fmtExp(r.expected) + ' に対して、' + UI.fmtPts(r.total) + '点';
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

  /** レート戦を始める画面（AIの強さを選ぶ）。onPick(level) で開始 */
  function openRatedDialog(game, opts) {
    const c = RT.cfg(game);
    const my = ratingOf(game).r;
    const winloss = c.kind === 'winloss';
    const levels = (opts && opts.levels) || ['easy', 'normal', 'hard'];
    const items = levels.map((lv) => {
      const ai = c.ai[lv];
      const exp = winloss ? pct(RT.winProb(my, ai)) : fmtExp(RT.expectedPoints(my, new Array(c.players - 1).fill(ai)) * c.games);
      return '<button class="opt lvl" type="button" data-lv="' + lv + '"><span class="lvl-name"><b>' + LEVEL_LABEL[lv] + '</b><small>AIのレート ' + ai +
        (opts && opts.slowLevel === lv ? '・考える時間が長め' : '') + '</small></span><span class="lvl-exp"><small>' + (winloss ? 'あなたが勝つ確率' : '予想の総得点') + '</small><b>' + exp + '</b></span></button>';
    }).join('');
    const how = winloss ? c.players + '人・' + c.rulesLabel + '・' + c.games + '本勝負（' + (Math.floor(c.games / 2) + 1) + '勝で勝ち）。<br>勝つ確率が低い相手に勝つほど、レートが大きく上がります。'
      : c.players + '人・<b>' + esc(c.rulesLabel) + '</b>・全' + c.games + 'ゲーム。<br>' + c.games + 'ゲームの総得点が「予想の総得点」より多ければレートが上がります。';
    const dlg = UI.openDialog('<h3>レート戦</h3><p>' + how + '</p>' +
      '<div class="rate-now">あなたのレート <b>' + my + '</b>' + (ratingOf(game).matches < RT.NEW_MATCHES ? '<small>はじめの' + RT.NEW_MATCHES + '試合は大きく動きます</small>' : '') + '</div>' +
      '<div class="opt-list">' + items + '</div>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="rt-book">ルールを見る</button><button class="btn btn-ghost" type="button" id="rt-cancel">やめる</button></div>',
    { onBackdrop: UI.closeDialog });
    dlg.querySelectorAll('.lvl').forEach((b) => b.addEventListener('click', () => { UI.closeDialog(); SND.unlock(); opts.onPick(b.dataset.lv); }));
    $('rt-book').addEventListener('click', () => { UI.closeDialog(); openBook(game, 'rules', 'rated'); });
    $('rt-cancel').addEventListener('click', UI.closeDialog);
  }

  /** 途中のレート戦がある状態で新しく始めるとき：「つづきから／棄権」をたずねる */
  function askAbandon(m, opts) {
    const c = RT.cfg(m.game);
    UI.openDialog('<h3>途中のレート戦があります</h3><p>' + c.label + ' 第' + m.gameNo + '/' + m.maxGames + 'ゲームの途中です。新しく始めると棄権になり、' + abandonNote(m) + '</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="ab-no">やめる</button>' +
      '<button class="btn btn-ghost" type="button" id="ab-yes">棄権する</button>' +
      '<button class="btn btn-gold" type="button" id="ab-resume">つづきから</button></div>', { onBackdrop: UI.closeDialog });
    $('ab-no').addEventListener('click', UI.closeDialog);
    $('ab-resume').addEventListener('click', () => { UI.closeDialog(); opts.onResume(); });
    $('ab-yes').addEventListener('click', () => {
      const r = abandonRatedLocal(m);
      UI.closeDialog();
      opts.onAbandoned(r);
      if (r) UI.toast('棄権しました。レート ' + r.before + ' → ' + r.after + '（' + RT.fmtDelta(r.delta) + '）', 3500);
    });
  }

  // ─────────────────────────────────────────────
  // 試合の最終結果（順位・ゲームごとの得点表）
  // ─────────────────────────────────────────────
  const ptsHTML = (v, unit) => '<span class="' + UI.ptsClass(v) + '">' + UI.fmtPts(v) + (unit || '') + '</span>';

  /** S の試合結果。human：あなたの席、rateHTML：レート欄、deltas：席ごとのレート変動（オンライン） */
  function finalHTML(S, human, rateHTML, deltas) {
    const winloss = RT.cfg(S.game).kind === 'winloss';
    const st = (winloss ? D.Speed : D.Engine).standings(S);
    const me = st.find((r) => r.seat === human);
    const name = (seat) => S.players[seat].name;
    const rows = st.map((r) => {
      const d = deltas && deltas[r.seat];
      return '<div class="res-row fin' + (r.seat === human ? ' me' : '') + '"><span class="pl">' + r.place + '</span>' +
        '<span class="nm">' + esc(name(r.seat)) + (r.seat === human ? '<em>あなた</em>' : '') +
        (d ? '<small class="rt">レート ' + d.after + '（' + RT.fmtDelta(d.delta) + '）</small>' : '') + '</span>' +
        '<span class="pt big">' + (winloss ? '<span class="zero">' + r.score + '<small>勝</small></span>' : ptsHTML(r.score, '<small>点</small>')) + '</span></div>';
    }).join('');
    const cell = (v) => (winloss ? '<td class="' + (v > 0 ? 'pos' : 'zero') + '">' + (v > 0 ? '○' : '×') + '</td>' : '<td class="' + UI.ptsClass(v) + '">' + UI.fmtPts(v) + '</td>');
    const body = st.map((r) => {
      const cells = S.history.map((h) => (winloss && h.winner === null ? '<td class="zero">△</td>' : cell(h.pts[r.seat]))).join('');
      const tot = winloss ? r.score + '勝' : UI.fmtPts(S.players[r.seat].score);
      return '<tr' + (r.seat === human ? ' class="mine"' : '') + '><th>' + esc(r.seat === human ? 'あなた' : name(r.seat)) + '</th>' + cells +
        '<td class="tot ' + (winloss ? '' : UI.ptsClass(S.players[r.seat].score)) + '">' + tot + '</td></tr>';
    }).join('');
    const cols = S.history.map((_, i) => '<th>' + (i + 1) + '</th>').join('');
    const msg = !me ? '' : me.place === 1 && !(winloss && st[1] && st[1].place === 1) ? 'あなたの勝ち！' : 'あなたは ' + me.place + '位';
    if (me && me.place === 1) SND.play('fanfare');
    const how = winloss ? S.history.length + 'ゲームの勝ち数で決まりました。' : '全' + S.history.length + 'ゲームの総得点で順位を決めました。';
    return '<h3>試合終了</h3><p>' + esc(msg) + '　' + how + '</p>' +
      '<div class="results">' + rows + '</div>' + (rateHTML || '') +
      '<details class="score-details"><summary>ゲームごとの結果</summary><div class="score-wrap"><table class="score-table"><thead><tr><th></th>' + cols +
      '<th>計</th></tr></thead><tbody>' + body + '</tbody></table></div></details>';
  }

  // ─────────────────────────────────────────────
  // ルールブック（対局中でも開ける。開いている間も対局はそのまま進む）
  // ─────────────────────────────────────────────
  const book = { game: 'daifugo', tab: 'basics', src: '' };

  function renderBook() {
    const B = D.Books[book.game];
    const mod = D.Games[book.game];
    const srcs = (mod && mod.bookSources && mod.bookSources()) || [{ key: 'std', label: '', rules: null, n: 4 }];
    const src = srcs.find((x) => x.key === book.src) || srcs[0];
    book.src = src.key;
    if (!B.TABS.some((t) => t.key === book.tab)) book.tab = B.TABS[0].key;
    $('book-title').textContent = 'ルールブック' + (D.Games[book.game] ? '・' + D.Games[book.game].label : '');
    $('book-tabs').innerHTML = B.TABS.map((t) => '<button type="button" role="tab" data-tab="' + t.key + '" aria-selected="' + (t.key === book.tab) + '">' + esc(t.label) + '</button>').join('');
    $('book-tabs').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { book.tab = b.dataset.tab; renderBook(); $('book-body').scrollTop = 0; }));
    const pick = srcs.length > 1 && (book.tab === 'basics' || book.tab === 'rules') ? '<div class="book-src"><span>説明するルール</span>' +
      '<div class="seg">' + srcs.map((x) => '<button type="button" data-src="' + x.key + '" aria-pressed="' + (x.key === src.key) + '">' + esc(x.label) + '</button>').join('') + '</div></div>' : '';
    $('book-body').innerHTML = pick + B.render(book.tab, src.rules, src.n);
    $('book-body').querySelectorAll('.book-src button').forEach((b) => b.addEventListener('click', () => { book.src = b.dataset.src; renderBook(); }));
  }

  /** game のルールブックを開く。tab：章、src：どのルールを説明するか（bookSources の key） */
  function openBook(game, tab, src) {
    book.game = game || book.game;
    if (tab) book.tab = tab;
    book.src = src || '';
    if (D.OnlineClient) D.OnlineClient.closeChat();
    $('book').hidden = false;
    renderBook();
    $('book-body').scrollTop = 0;
    setTimeout(() => $('book-close').focus({ preventScroll: true }), 30);
  }
  function closeBook() { const b = $('book'); if (b) b.hidden = true; }
  const bookOpen = () => !$('book').hidden;

  function init() {
    $('book-close').innerHTML = A.icon('close');
    $('book-close').addEventListener('click', closeBook);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bookOpen() && $('overlay').hidden) closeBook(); });
    document.querySelectorAll('[data-sound-btn]').forEach((b) => b.addEventListener('click', toggleSound));
    applySettings();
  }

  D.Games = D.Games || {};
  D.Books = D.Books || {};
  D.Common = {
    store, settings, save, applySettings, toggleSound, playerName, LEVEL_LABEL, SPEEDS,
    showScreen, onShow, visible, seg, toggle, row, section,
    ratingOf, recordRating, applyRatedLocal, abandonRatedLocal, abandonNote, rateNote, rateBoxHTML, animateRate, fmtExp, pct,
    openRatedDialog, askAbandon, finalHTML, ptsHTML,
    openBook, closeBook, bookOpen, init,
  };
})();
