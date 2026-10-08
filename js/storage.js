/* 保存の境界（この端末のブラウザの localStorage）：読み込み・形式の確認・移行・復旧・書き込みの結果
 * 画面（DOM）から独立していて、テスト（tools/run_tests.js）でも同じものを動かす。使うのは common.js。
 *
 * キー（「大富豪」だった頃の名前のまま。変えると今の保存データが読めなくなる）
 *   daifugo.v1         … 本体
 *   daifugo.v1.bak     … 最後に問題なく読めた本体の控え（起動のたびに更新）。本体が読めないときはここから戻す
 *   daifugo.v1.s1      … 形式の番号がない頃（schemaVersion 1）の原本。移行して書き換える前に残す
 *   daifugo.v1.broken  … 壊れていた・一部を直した本体の原本。書き換える前に残す
 *   daifugo.v1.prerestore … バックアップを読み込む直前の本体（マイページの「1つ前のデータに戻す」で使う）
 *   （daifugo.cid はオンラインの本人IDで net.js が持つ。ここでは扱わない）
 *
 * 形式（schemaVersion。アプリのバージョンとは別の数字）
 *   1 … 2026-09-27 までの形（番号なし）
 *   2 … schemaVersion・revision（書いた回数）・savedAt を持つ。途中の対局に engineVersion。
 *        大富豪だけの頃の onlineRating は onlineRatings.daifugo へ。log（出したカードの履歴）は持たない
 *   中身の形は 1 と同じ（足しただけ）なので、古いアプリに戻しても読める（知らない項目は古いアプリもそのまま残す）。
 *
 * 決まり：
 *   - 直す（壊れた値を外す・既定値に戻す）ときは、先に原本を別のキーに残す。残せなければ本体を書き換えない（protect）
 *   - 新しい形式（schemaVersion が大きい）のデータは読めるところだけ使い、書き込まない（incompatible）
 *   - ほかのタブ（ウィンドウ）が本体を書き換えていたら上書きしない（conflict）
 *   - 書き込みは成功・失敗（容量不足 quota・禁止 denied など）を返す。画面はそれを見て知らせる
 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  const KEY = 'daifugo.v1';
  const KEYS = { main: KEY, bak: KEY + '.bak', broken: KEY + '.broken', prerestore: KEY + '.prerestore', before: (v) => KEY + '.s' + v };
  const SCHEMA_VERSION = 2;
  /** 途中の対局（serialize した形）の版。エンジンの保存の形を変えたら上げて、読み込みの確認を足す */
  const ENGINE_VERSION = { daifugo: 1, sevens: 1, speed: 1 };
  const MAX_CHARS = 1000000; // ふだんは数十KB。これより大きいのは壊れたデータとして扱う

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isInt = (v) => Number.isInteger(v);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const isBool = (v) => typeof v === 'boolean';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
  /** JSON から来たオブジェクトを1段だけ写す（__proto__ などは写さない） */
  function copy(o) {
    const r = {};
    if (isObj(o)) for (const k of Object.keys(o)) if (!BAD_KEYS.includes(k)) r[k] = o[k];
    return r;
  }

  // ─────────────────────────────────────────────
  // 保存先（localStorage か、テスト用のメモリ）
  // ─────────────────────────────────────────────
  /** ブラウザの localStorage。使えない環境（アクセスで例外になる）なら null */
  function webBackend() {
    let ls = null;
    try { ls = globalThis.localStorage || null; } catch (e) { ls = null; }
    if (!ls) return null;
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => ls.setItem(k, v),
      remove: (k) => ls.removeItem(k),
    };
  }
  /** メモリに保存する（テスト用） */
  function memoryBackend(init) {
    const m = new Map(Object.entries(init || {}));
    return {
      get: (k) => (m.has(k) ? m.get(k) : null),
      set: (k, v) => { m.set(k, String(v)); },
      remove: (k) => { m.delete(k); },
      dump: () => Object.fromEntries(m),
    };
  }

  /** 書き込みの例外の種類：quota（容量不足・プライベートブラウズ）／denied（禁止）／error */
  function classify(e) {
    const n = e && e.name, c = e && e.code;
    if (n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED' || c === 22 || c === 1014) return 'quota';
    if (n === 'SecurityError' || c === 18) return 'denied';
    return 'error';
  }
  const fail = (reason, error) => ({ ok: false, reason, error: error ? String((error && error.message) || error) : undefined });
  const OK = { ok: true };

  // ─────────────────────────────────────────────
  // 形式の移行：MIGRATIONS[v] は v の形を v+1 の形にする（受け取ったデータは変えない純粋な関数）
  // ルールの中身の更新（古いマイルール → 今のマイルール）は RU.migrate で、ここではない
  // ─────────────────────────────────────────────
  const MIGRATIONS = {
    1(d) {
      const o = copy(d);
      delete o.log; // 出したカードの履歴（2026-09-26 にやめた。カウンティングできないように）
      if (o.onlineRating !== undefined) {
        // 大富豪しかなかった頃のオンラインのレートの控え
        const ors = copy(o.onlineRatings);
        if (!ors.daifugo) ors.daifugo = o.onlineRating;
        o.onlineRatings = ors;
        delete o.onlineRating;
      }
      o.schemaVersion = 2;
      return o;
    },
  };
  function migrate(data, from) {
    let d = data;
    for (let v = from; v < SCHEMA_VERSION; v++) {
      if (!MIGRATIONS[v]) throw new Error('schemaVersion ' + v + ' からの移行がありません');
      d = MIGRATIONS[v](d);
    }
    return d;
  }

  // ─────────────────────────────────────────────
  // 中身の確認（schemaVersion 2 の形にそろえる）
  //   fix    … 欠けた項目を既定値で補った・不要な項目を外した（ふつうのこと。知らせない）
  //   repair … 値が壊れていたので直した・外した（知らせる。原本を残してから書き換える）
  // ─────────────────────────────────────────────
  const LEVELS = ['easy', 'normal', 'hard'];
  const oneOf = (list) => (v) => list.includes(v);
  const cleanName = (s) => s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || 'あなた';
  /** 大富豪の設定と、全ゲーム共通の個人設定（以前からこの形で store.settings に入っている） */
  const SETTINGS = {
    players: { def: 4, ok: oneOf([3, 4, 5, 6]) },
    level: { def: 'normal', ok: oneOf(LEVELS) },
    games: { def: 10, ok: oneOf([5, 10, 0]) },
    speed: { def: 'normal', ok: oneOf(['slow', 'normal', 'fast']) },
    back: { def: 'red', ok: (v) => typeof v === 'string' && (!D.Art || own(D.Art.BACKS, v)) },
    sound: { def: true, ok: isBool },
    bgm: { def: true, ok: isBool },
    bgmVol: { def: 'low', ok: oneOf(['low', 'mid', 'high']) },
    autoPass: { def: true, ok: isBool },
    showPlayable: { def: true, ok: isBool },
    name: { def: 'あなた', ok: (v) => typeof v === 'string' && v === cleanName(v), fix: (v) => (typeof v === 'string' ? cleanName(v) : undefined) },
  };
  const GAMES = {
    sevens: {
      label: '七並べ',
      settings: { players: { def: 4, ok: oneOf([3, 4, 5, 6]) }, level: { def: 'normal', ok: oneOf(LEVELS) }, games: { def: 10, ok: oneOf([5, 10, 0]) } },
      rules: () => D.SevensRules,
    },
    speed: {
      label: 'スピード',
      settings: { level: { def: 'normal', ok: oneOf(LEVELS) }, games: { def: 3, ok: oneOf([1, 3, 5]) } },
      rules: () => D.SpeedRules,
    },
  };
  const LABEL = { daifugo: '大富豪', sevens: '七並べ', speed: 'スピード' };
  const TABS = ['daifugo', 'sevens', 'speed', 'me'];

  function issue(c, level, label, detail) { c.issues.push({ level, label, detail }); }

  function settingsOf(src, schema, c, label) {
    if (src !== undefined && !isObj(src)) issue(c, 'repair', label, '形が違う');
    const o = copy(src);
    for (const k of Object.keys(schema)) {
      const f = schema[k];
      if (!own(o, k)) { o[k] = f.def; continue; }
      if (f.ok(o[k])) continue;
      const fixed = f.fix ? f.fix(o[k]) : undefined;
      issue(c, 'repair', label, k);
      o[k] = fixed !== undefined && f.ok(fixed) ? fixed : f.def;
    }
    return o;
  }

  /** ルール。normalize は欠けた項目を既定値に、知らない値を既定値にする。後者だけ repair として数える */
  function rulesOf(src, R, c, label, fallback) {
    if (src === undefined || src === null) return fallback();
    if (!isObj(src)) { issue(c, 'repair', label, '形が違う'); return fallback(); }
    const n = R.normalize(src);
    for (const d of R.RULES) if (own(src, d.key) && n[d.key] !== src[d.key]) { issue(c, 'repair', label, d.key); break; }
    return R.migrate ? R.migrate(src) : n;
  }

  /** AI戦のレート { r, matches, best, hist }。r が壊れていたら記録（hist）の最後の値から戻す */
  function ratingOf(src, c, label) {
    const START = D.Rating ? D.Rating.START : 1500;
    if (src === undefined || src === null) return { r: START, matches: 0, best: START, hist: [] };
    if (!isObj(src)) { issue(c, 'repair', label, '形が違う'); return { r: START, matches: 0, best: START, hist: [] }; }
    const o = copy(src);
    let hist = Array.isArray(src.hist) ? src.hist.filter((h) => isObj(h) && isNum(h.after)) : [];
    if (src.hist !== undefined && (!Array.isArray(src.hist) || hist.length !== src.hist.length)) issue(c, 'repair', label, 'hist');
    if (hist.length > 50) hist = hist.slice(-50);
    o.hist = hist;
    if (!isNum(o.r)) {
      if (src.r !== undefined) issue(c, 'repair', label, 'r');
      o.r = hist.length ? hist[hist.length - 1].after : START;
    }
    if (!(isInt(o.matches) && o.matches >= 0)) {
      if (src.matches !== undefined) issue(c, 'repair', label, 'matches');
      o.matches = hist.length;
    }
    if (!isNum(o.best)) {
      if (src.best !== undefined) issue(c, 'repair', label, 'best');
      o.best = Math.max(o.r, START, ...hist.map((h) => h.after));
    }
    return o;
  }

  function matchOf(game, src, c) {
    if (src === undefined || src === null) return null;
    const why = checkMatch(game, src);
    if (why) { issue(c, 'repair', LABEL[game] + 'の途中の対局', why); return null; }
    const o = copy(src);
    if (o.engineVersion === undefined) o.engineVersion = 1; // 版がない頃の対局は 1
    return o;
  }

  function gameOf(game, src, c) {
    const G = GAMES[game];
    if (src !== undefined && !isObj(src)) issue(c, 'repair', G.label + 'の保存データ', '形が違う');
    const s = isObj(src) ? src : {};
    const o = copy(s);
    o.settings = settingsOf(s.settings, G.settings, c, G.label + 'の設定');
    o.rules = rulesOf(s.rules, G.rules(), c, G.label + 'のルール', () => G.rules().defaults());
    o.rating = ratingOf(s.rating, c, G.label + 'のAI戦レート');
    o.match = matchOf(game, s.match, c);
    return o;
  }

  /** オンラインのレートの控え（正しい値はサーバー。壊れていたら外すだけ） */
  function onlineOf(src, c) {
    const o = {};
    if (!isObj(src)) { if (src !== undefined) issue(c, 'fix', 'オンラインのレートの控え'); return o; }
    for (const k of Object.keys(src)) {
      if (BAD_KEYS.includes(k)) continue;
      const v = src[k];
      if (isObj(v) && isNum(v.r) && isInt(v.matches) && v.matches >= 0) o[k] = v;
      else issue(c, 'fix', 'オンラインのレートの控え', k);
    }
    return o;
  }

  /** 保存データを schemaVersion 2 の形にそろえる。{ store, issues } */
  function sanitize(data) {
    const c = { issues: [] };
    if (!isObj(data)) issue(c, 'repair', '保存データ', '形が違う');
    const src = isObj(data) ? data : {};
    const o = copy(src);
    delete o.log; // 出したカードの履歴は持たない（古いアプリが書いたものも読まない）
    delete o.onlineRating;
    o.schemaVersion = SCHEMA_VERSION;
    if (!(isInt(o.revision) && o.revision >= 0)) o.revision = 0;
    if (typeof o.savedAt !== 'string') delete o.savedAt;
    o.settings = settingsOf(src.settings, SETTINGS, c, '設定');
    o.rules = rulesOf(src.rules, D.Rules, c, '大富豪のルール', () => Object.assign({}, D.Rules.MINE));
    o.rating = ratingOf(src.rating, c, '大富豪のAI戦レート');
    o.match = matchOf('daifugo', src.match, c);
    o.sevens = gameOf('sevens', src.sevens, c);
    o.speed = gameOf('speed', src.speed, c);
    o.onlineRatings = onlineOf(src.onlineRatings, c);
    if (!o.onlineRatings.daifugo && src.onlineRating !== undefined) Object.assign(o.onlineRatings, onlineOf({ daifugo: src.onlineRating }, c));
    if (o.tab !== undefined && !TABS.includes(o.tab)) { issue(c, 'fix', '最後に開いたタブ'); delete o.tab; }
    if (o.installTipOff !== undefined && !(isNum(o.installTipOff) && o.installTipOff >= 0)) { issue(c, 'fix', 'ホーム画面に追加の案内'); delete o.installTipOff; }
    if (o.backupAt !== undefined && !(isNum(o.backupAt) && o.backupAt >= 0)) { issue(c, 'fix', '最後に書き出した日時'); delete o.backupAt; }
    return { store: o, issues: c.issues };
  }

  /** 何もないところからの保存データ（はじめて開いたとき） */
  function fresh() { return sanitize({}).store; }

  // ─────────────────────────────────────────────
  // 途中の対局の確認（つづきから遊べる形か）。問題がなければ null、あれば理由
  // ─────────────────────────────────────────────
  const PHASES = { daifugo: ['idle', 'exchange', 'play', 'over'], sevens: ['idle', 'play', 'over'], speed: ['idle', 'stuck', 'play', 'over'] };
  const SEATS = { daifugo: [3, 6], sevens: [3, 6], speed: [2, 2] };
  const SUITS = ['S', 'H', 'D', 'C'];

  /** その対局にあるカードを全部集める（形が違えば理由の文字列）。count：全部で何枚あるはずか（わからなければ null） */
  function cardsOf(game, m) {
    const out = [];
    if (game === 'speed') {
      for (const P of m.players) {
        if (!Array.isArray(P.deck) || !Array.isArray(P.field) || P.field.length !== 4) return '山札・場札の形が違う';
        out.push(...P.deck, ...P.field.filter((x) => x !== null));
      }
      if (!Array.isArray(m.piles) || m.piles.length !== 2 || !m.piles.every(Array.isArray)) return '台札の形が違う';
      for (const p of m.piles) out.push(...p);
      return { cards: out, count: 52 };
    }
    for (const P of m.players) {
      if (!Array.isArray(P.hand)) return '手札の形が違う';
      out.push(...P.hand);
    }
    if (game === 'daifugo') {
      if (!Array.isArray(m.discard) || !Array.isArray(m.pile)) return '場の形が違う';
      out.push(...m.discard);
      for (const e of m.pile) {
        if (!isObj(e) || !Array.isArray(e.shown)) return '場の形が違う';
        out.push(...e.shown);
      }
      return { cards: out, count: 52 + D.Rules.normalize(m.rules).jokers };
    }
    // 七並べ：場は スート → 1〜13 の欄（null か { id }）
    if (!isObj(m.board) || !SUITS.every((s) => Array.isArray(m.board[s]) && m.board[s].length === 14)) return '場の形が違う';
    for (const s of SUITS) for (const cell of m.board[s]) {
      if (cell === null) continue;
      if (!isObj(cell)) return '場の形が違う';
      out.push(cell.id);
    }
    return { cards: out, count: null };
  }

  function checkMatch(game, m) {
    if (!isObj(m)) return '形が違う';
    const ev = m.engineVersion === undefined ? 1 : m.engineVersion;
    if (!isInt(ev) || ev < 1) return 'engineVersion が不正';
    if (ev > ENGINE_VERSION[game]) return '新しいバージョンのアプリで保存された対局';
    if ((m.game === undefined ? 'daifugo' : m.game) !== game) return 'ゲームの種類が違う';
    const P = m.players;
    const [lo, hi] = SEATS[game];
    if (!Array.isArray(P) || P.length < lo || P.length > hi || m.n !== P.length) return '人数が不正';
    const scored = Array.isArray(m.history); // 得点表がない頃の大富豪の対局は、得点を0からやり直す（deserialize）
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (!isObj(p) || p.seat !== i || typeof p.name !== 'string') return '席が不正';
      if (scored && !isNum(p.score)) return '得点が不正';
      if (game === 'speed' && !(isInt(p.wins) && p.wins >= 0)) return '勝ち数が不正';
    }
    if (!PHASES[game].includes(m.phase)) return '進行の段階が不正';
    if (!(isInt(m.gameNo) && m.gameNo >= 0)) return 'ゲーム番号が不正';
    if (m.maxGames !== undefined && !(isInt(m.maxGames) && m.maxGames >= 0)) return 'ゲーム数が不正';
    if (m.history !== undefined && !scored) return '記録が不正';
    if (scored) {
      if (m.history.length > m.gameNo) return '記録の数が合わない';
      const sum = new Array(P.length).fill(0);
      for (const h of m.history) {
        if (!isObj(h) || !Array.isArray(h.pts) || h.pts.length !== P.length || !h.pts.every(isNum)) return '記録が不正';
        h.pts.forEach((v, i) => { sum[i] += v; });
      }
      const got = P.map((p) => (game === 'speed' ? p.wins : p.score));
      if (got.some((v, i) => v !== sum[i])) return '得点が記録と合わない';
    }
    if (m.rated !== undefined && m.rated !== null) {
      const R = m.rated;
      if (!isObj(R)) return 'レート戦の情報が不正';
      if (!R.online) {
        if (!Array.isArray(R.base) || R.base.length !== P.length || !R.base.every(isNum)) return 'レート戦の情報が不正';
        if (!LEVELS.includes(R.level) || !(isInt(R.matches) && R.matches >= 0)) return 'レート戦の情報が不正';
      }
      if (R.result !== undefined && R.result !== null && !isObj(R.result)) return 'レート戦の結果が不正';
    }
    if (m.phase === 'idle') return null; // まだ配っていない
    if (game !== 'speed' && m.phase === 'play' && !(isInt(m.turn) && m.turn >= 0 && m.turn < P.length)) return '手番が不正';
    const cs = cardsOf(game, m);
    if (typeof cs === 'string') return cs;
    const seen = new Set();
    for (const id of cs.cards) {
      if (typeof id !== 'string' || !own(D.Cards.CARDS, id)) return '知らないカード';
      if (seen.has(id)) return 'カードが重複';
      seen.add(id);
    }
    if (cs.count !== null && seen.size !== cs.count) return 'カードの枚数が合わない';
    if (game === 'sevens' && seen.size > 53) return 'カードの枚数が合わない';
    // 最後に、エンジンで読み込んで次の手を数えられるか
    try {
      if (game === 'daifugo') {
        const E = D.Engine;
        const S = E.deserialize(m);
        S.rules = D.Rules.migrate(S.rules);
        const q = E.getRequest(S);
        if (q && q.kind === 'turn') E.legalPlays(S, q.seat);
      } else if (game === 'sevens') {
        const S = D.Sevens.deserialize(m);
        const q = D.Sevens.getRequest(S);
        if (q) D.Sevens.legalMoves(S, q.seat);
      } else {
        const S = D.Speed.deserialize(m);
        if (S.phase === 'play') { D.Speed.playable(S, 0); D.Speed.playable(S, 1); }
      }
    } catch (e) {
      return '読み込めない（' + ((e && e.message) || e) + '）';
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // 読み書き
  // ─────────────────────────────────────────────
  function parse(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_CHARS) return { error: '大きすぎる' };
    try { return { data: JSON.parse(raw) }; } catch (e) { return { error: 'JSON として読めない' }; }
  }
  const versionOf = (d) => (d.schemaVersion === undefined ? 1 : d.schemaVersion);

  /**
   * 保存先 backend（webBackend() か memoryBackend()。null なら保存できない環境）を使う窓口
   *   load()  … 起動時に1回。{ status, store, issues, fromVersion, mode, commit }
   *             status：new / ok / migrated（古い形式から移行）/ repaired（一部を直した）/ recovered（控えから戻した）/
   *                     corrupt（読めず、はじめから）/ incompatible（新しい形式。保存しない）/ unavailable（保存できない環境）
   *   save(store) … { ok: true, revision } か { ok: false, reason }。reason：quota / denied / error / verify / serialize /
   *                 conflict（ほかのタブが書いた）/ incompatible / protect（原本を残せず書き換えを止めている）/ unavailable
   */
  function createRepository(backend, opts) {
    const now = (opts && opts.now) || (() => Date.now());
    let lastRaw = null; // 最後に読んだ・書いた本体（ほかのタブが書き換えたかをこれと比べる）
    let mode = backend ? 'ok' : 'unavailable'; // ok / unavailable / incompatible / protect / conflict
    let pending = []; // protect のとき、まだ残せていない原本 [{ key, raw }]
    let last = null; // 最後の load / save の結果（確認用）

    /** 書いて、読み直して同じか確かめる */
    function put(k, v) {
      try {
        backend.set(k, v);
        return backend.get(k) === v ? OK : fail('verify');
      } catch (e) {
        return fail(classify(e), e);
      }
    }

    function write(store) {
      const rev = (isInt(store.revision) ? store.revision : 0) + 1;
      const meta = { schemaVersion: SCHEMA_VERSION, revision: rev, savedAt: new Date(now()).toISOString() };
      let str;
      try { str = JSON.stringify(Object.assign({}, store, meta)); } catch (e) { return fail('serialize', e); }
      const r = put(KEYS.main, str);
      if (!r.ok) return r;
      Object.assign(store, meta);
      lastRaw = str;
      return { ok: true, revision: rev };
    }

    /** 控えなど、本体以外のキーを読む（読めなければ null） */
    function readCandidate(k) {
      let raw = null;
      try { raw = backend.get(k); } catch (e) { return null; }
      if (raw == null) return null;
      const p = parse(raw);
      if (p.error || !isObj(p.data)) return null;
      const v = versionOf(p.data);
      if (!isInt(v) || v < 1 || v > SCHEMA_VERSION) return null;
      try { return sanitize(migrate(p.data, v)); } catch (e) { return null; }
    }

    /** 正常に読めた本体を控えに写す（同じなら書かない） */
    function refreshBak() {
      if (lastRaw == null) return;
      try { if (backend.get(KEYS.bak) === lastRaw) return; } catch (e) { return; }
      put(KEYS.bak, lastRaw); // 失敗しても本体には影響しない（次の起動でまた試す）
    }

    /** 原本を残す。全部残せたら true。残せなかったものは pending に入れる */
    function preserve(list) {
      pending = list.filter((x) => !put(x.key, x.raw).ok);
      return !pending.length;
    }

    function done(status, store, issues, extra) {
      last = Object.assign({ status, store, issues: issues || [], mode }, extra || {});
      return last;
    }

    /** 本体が読めないとき：原本を残し、控えがあれば控えから、なければはじめから */
    function recover(raw, why) {
      const b = readCandidate(KEYS.bak);
      const store = b ? b.store : fresh();
      const status = b ? 'recovered' : 'corrupt';
      const issues = [{ level: 'repair', label: '保存データ', detail: why }];
      if (!preserve([{ key: KEYS.broken, raw }])) { mode = 'protect'; return done(status, store, issues); }
      return done(status, store, issues, { commit: write(store) });
    }

    function load() {
      if (!backend) return done('unavailable', fresh());
      let raw;
      try { raw = backend.get(KEYS.main); } catch (e) { mode = 'unavailable'; return done('unavailable', fresh(), [], { error: String(e && e.message) }); }
      lastRaw = raw;
      if (raw == null) {
        // 本体がない：はじめて開いた。控えだけ残っていれば（本体だけ消えた）控えから戻す
        const b = readCandidate(KEYS.bak);
        if (!b) return done('new', fresh());
        return done('recovered', b.store, [{ level: 'repair', label: '保存データ', detail: '本体がない' }], { commit: write(b.store) });
      }
      const p = parse(raw);
      if (p.error) return recover(raw, p.error);
      if (!isObj(p.data)) return recover(raw, '形が違う');
      const v = versionOf(p.data);
      if (!isInt(v) || v < 1) return recover(raw, 'schemaVersion が不正');
      if (v > SCHEMA_VERSION) {
        // 新しいアプリで保存された形式：読めるところだけ使い、書き込まない（新しいアプリのデータを壊さない）
        mode = 'incompatible';
        const s = sanitize(p.data);
        return done('incompatible', s.store, s.issues, { fromVersion: v });
      }
      let data;
      try { data = migrate(p.data, v); } catch (e) { return recover(raw, '移行できない（' + e.message + '）'); }
      const s = sanitize(data);
      const repairs = s.issues.filter((x) => x.level === 'repair');
      const keep = [];
      if (v < SCHEMA_VERSION) keep.push({ key: KEYS.before(v), raw, optional: !repairs.length });
      if (repairs.length) keep.push({ key: KEYS.broken, raw });
      if (keep.length && !preserve(keep)) {
        // 直したところがなければ、移行は項目を足すだけなので書き換えてよい（原本を残せなくても失うものはない）
        if (pending.some((x) => !x.optional)) {
          mode = 'protect';
          return done(repairs.length ? 'repaired' : 'migrated', s.store, s.issues, { fromVersion: v });
        }
        pending = [];
      }
      const commit = v < SCHEMA_VERSION || repairs.length ? write(s.store) : null; // 移行・修理を本体に書く（二重に移行しない）
      if (!repairs.length) refreshBak();
      return done(repairs.length ? 'repaired' : v < SCHEMA_VERSION ? 'migrated' : 'ok', s.store, s.issues, { fromVersion: v, commit });
    }

    function save(store) {
      if (mode !== 'ok') return (last = fail(mode));
      let cur;
      try { cur = backend.get(KEYS.main); } catch (e) { return (last = fail(classify(e), e)); }
      if (cur !== lastRaw) { mode = 'conflict'; return (last = fail('conflict')); }
      return (last = write(store));
    }

    /** ほかのタブが本体を書き換えたか（storage イベントで呼ぶ）。書き換えていたら以後は保存しない */
    function checkExternal() {
      if (mode !== 'ok') return false;
      let cur;
      try { cur = backend.get(KEYS.main); } catch (e) { return false; }
      if (cur === lastRaw) return false;
      mode = 'conflict';
      return true;
    }

    /** バックアップの読み込み：今の本体を .prerestore に残してから、store で置き換える。
     *  残せなければ置き換えない（今のデータが消えてしまうので）。ほかのタブが書き換えていたら置き換えない */
    function replace(store) {
      if (mode !== 'ok') return (last = fail(mode));
      let cur;
      try { cur = backend.get(KEYS.main); } catch (e) { return (last = fail(classify(e), e)); }
      if (cur !== lastRaw) { mode = 'conflict'; return (last = fail('conflict')); }
      if (cur != null) {
        const r = put(KEYS.prerestore, cur);
        if (!r.ok) return (last = Object.assign({ stage: 'prerestore' }, r));
      }
      return (last = write(store));
    }

    /** 本体以外のキー（KEYS.prerestore など）を読んで確かめた中身 { store, issues }。なければ null */
    function peek(k) { return backend ? readCandidate(k) : null; }

    /** protect：原本をもう一度残してみる。残せたら保存できるようになる */
    function retryProtect() {
      if (mode !== 'protect') return mode === 'ok';
      if (preserve(pending)) mode = 'ok';
      return mode === 'ok';
    }
    /** protect：原本を残さずに書き換えてよい（利用者が選んだとき） */
    function allowOverwrite() {
      if (mode !== 'protect') return;
      pending = [];
      mode = 'ok';
    }

    return {
      load, save, replace, peek, checkExternal, retryProtect, allowOverwrite,
      get mode() { return mode; },
      status: () => ({ mode, last, pending: pending.map((x) => x.key), lastLength: lastRaw == null ? 0 : lastRaw.length }),
    };
  }

  /** 対局を保存するときの印（どの版のエンジンの形か） */
  function stampMatch(game, snap) {
    if (snap) snap.engineVersion = ENGINE_VERSION[game];
    return snap;
  }

  D.Storage = {
    KEY, KEYS, SCHEMA_VERSION, ENGINE_VERSION, MIGRATIONS,
    webBackend, memoryBackend, classify, migrate, sanitize, fresh, checkMatch, createRepository, stampMatch, cleanName,
  };
})();
