/* 保存のテスト（js/storage.js）：古い形式の読み込み・移行・壊れたデータ・容量不足などの故障・ほかのタブ・途中再開
 * 保存先はメモリ（localStorage の代わり）。故障は faulty() で起こす。
 * fixture は個人の情報を含まない作りもののデータ（名前は「テスト」など） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const ST = D.Storage, E = D.Engine, AI = D.AI, RU = D.Rules, C = D.Cards;
  const SV = D.Sevens, SVAI = D.SevensAI, SP = D.Speed, SPH = D.SpeedHost;
  const out = document.getElementById('out');
  const lines = [];
  let cur = null;
  function test(name, fn) {
    cur = { name, ok: true, msgs: [] };
    try { fn(); } catch (e) { cur.ok = false; cur.msgs.push('例外: ' + (e && e.stack || e)); }
    lines.push(cur);
    const li = document.createElement('li');
    li.className = cur.ok ? 'ok' : 'ng';
    li.textContent = (cur.ok ? '✔ ' : '✘ ') + '[storage] ' + name + (cur.msgs.length ? '\n   ' + cur.msgs.join('\n   ') : '');
    out.appendChild(li);
  }
  const ok = (c, m) => { if (!c) { cur.ok = false; cur.msgs.push('NG: ' + m); } };
  const eq = (a, b, m) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) { cur.ok = false; cur.msgs.push('NG: ' + m + ' 期待=' + sb + ' 実際=' + sa); } };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  /** 項目の順番を気にしない比較 */
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
  const eqv = (a, b, m) => eq(canon(a), canon(b), m);
  const K = ST.KEYS;

  // ─────────────────────────────────────────────
  // 故障を起こせる保存先
  //   f.quota：全部のキーの文字数の上限（こえる書き込みは QuotaExceededError）
  //   f.failSet(k, v)：例外を返すとその書き込みが失敗する／f.failGet：読み込みで投げる例外
  // ─────────────────────────────────────────────
  function domErr(name, code) {
    if (typeof DOMException === 'function') return new DOMException(name, name);
    const e = new Error(name);
    e.name = name;
    e.code = code;
    return e;
  }
  const quotaErr = () => domErr('QuotaExceededError', 22);
  function faulty(init) {
    const mem = ST.memoryBackend(init);
    const f = { quota: Infinity, failSet: null, failGet: null, writes: [] };
    const size = (skip) => Object.entries(mem.dump()).reduce((n, [k, v]) => n + (k === skip ? 0 : k.length + v.length), 0);
    return {
      f,
      get(k) { if (f.failGet) throw f.failGet; return mem.get(k); },
      set(k, v) {
        const e = f.failSet && f.failSet(k, v);
        if (e) throw e;
        if (size(k) + k.length + String(v).length > f.quota) throw quotaErr();
        f.writes.push(k);
        mem.set(k, v);
      },
      remove: (k) => mem.remove(k),
      dump: () => mem.dump(),
      raw: (k) => mem.get(k),
    };
  }
  const repoOf = (be) => ST.createRepository(be, { now: () => Date.UTC(2026, 9, 8, 3, 0, 0) });
  const json = (o) => JSON.stringify(o);

  // ─────────────────────────────────────────────
  // 対局の途中の状態を作る（AI どうしで何手か進める）
  // ─────────────────────────────────────────────
  const robots = (n, level) => [{ name: 'テスト', human: true }].concat(Array.from({ length: n - 1 }, (_, i) => ({ name: 'ロボ' + (i + 1), level })));
  function playDaifugo(S, steps, onStep) {
    let q, k = 0;
    while (k++ < steps && (q = E.getRequest(S))) { E.apply(S, AI.decideSync(S, q, 'easy')); if (onStep) onStep(S); }
    return S;
  }
  function daifugoMid(seed, opt) {
    const S = E.createMatch(Object.assign({ rules: RU.MINE, players: robots(4, 'normal'), games: 10, seed }, opt));
    E.startGame(S);
    return playDaifugo(S, 12);
  }
  function playSevens(S, steps, onStep) {
    let q, k = 0;
    while (k++ < steps && (q = SV.getRequest(S))) { SV.apply(S, SVAI.decideSync(S, q, 'easy')); if (onStep) onStep(S); }
    return S;
  }
  function sevensMid(seed, opt) {
    const S = SV.createMatch(Object.assign({ rules: D.SevensRules.STANDARD, players: robots(4, 'normal'), games: 10, seed }, opt));
    SV.startGame(S);
    return playSevens(S, 10);
  }
  /** スピード：時刻を進めながら AI（両方の席）で進める */
  function playSpeed(S, ticks, rng, onStep) {
    let now = 0;
    const lv = () => 'hard';
    S.clock = null;
    SPH.schedule(S, now, lv, rng);
    for (let i = 0; i < ticks && S.phase !== 'over'; i++) {
      const d = SPH.nextDelay(S, now);
      if (d == null) break;
      now += d;
      if (SPH.tick(S, now, lv, rng) && onStep) onStep(S);
    }
    return S;
  }
  function speedMid(seed, opt) {
    const S = SP.createMatch(Object.assign({ rules: D.SpeedRules.STANDARD, players: robots(2, 'normal'), games: 3, seed }, opt));
    SP.startGame(S);
    return playSpeed(S, 25, C.mulberry32(seed));
  }
  const snapDaifugo = (S) => E.serialize(S);
  const snapSevens = (S) => SV.serialize(S);
  const snapSpeed = (S) => { const o = SP.serialize(S); delete o.clock; return o; }; // 画面と同じ（時計は保存しない）

  // ─────────────────────────────────────────────
  // 古い形式（schemaVersion なし）の保存データ
  // ─────────────────────────────────────────────
  /** 2026-09-25：大富豪だけ。得点表の前（対局に history がない）、出したカードの履歴 log あり、マイルールに救急車がない頃 */
  function fixture0925() {
    const m = snapDaifugo(daifugoMid(11, { games: 0 }));
    delete m.history; delete m.maxGames; delete m.matchOver; delete m.rated;
    return {
      settings: { players: 4, level: 'normal', speed: 'normal', back: 'navy', sound: true, autoPass: true, showPlayable: true, name: 'あなた' },
      rules: Object.assign({}, RU.MINE, { kyukyusha: false }),
      match: m,
      log: ['テスト：♠3', 'ロボ1：パス'],
    };
  }
  /** 2026-09-26（レート戦を足した頃）：大富豪のレート・オンラインのレート（onlineRating）・レート戦の途中 */
  function fixture0926() {
    const rated = { level: 'hard', base: [1532, 1630, 1630, 1630], matches: 3, result: null };
    const m = snapDaifugo(daifugoMid(12, { rated }));
    return {
      settings: { players: 5, level: 'hard', games: 5, speed: 'fast', back: 'red', sound: false, autoPass: false, showPlayable: true, name: 'テスト' },
      rules: Object.assign({}, RU.MINE),
      rating: { r: 1532, matches: 3, best: 1540, hist: [{ at: 1790000000000, before: 1500, after: 1540, d: 40, total: 12, level: 'normal' }, { at: 1790000100000, before: 1540, after: 1532, d: -8, total: -2, level: 'normal' }] },
      onlineRating: { r: 1512, matches: 2 },
      match: m,
      log: [],
    };
  }
  /** 2026-09-27（今のアプリ）：3ゲーム・BGM・タブ・ホーム画面の案内 */
  function fixture0927() {
    const hist = (r) => [{ at: 1790000000000, before: 1500, after: r, d: r - 1500, total: 3, level: 'normal' }];
    return {
      settings: { players: 4, level: 'normal', games: 10, speed: 'normal', back: 'green', sound: true, bgm: true, bgmVol: 'mid', autoPass: true, showPlayable: false, name: 'テスト' },
      rules: Object.assign({}, RU.MINE, { jokers: 1 }),
      rating: { r: 1488, matches: 1, best: 1500, hist: hist(1488) },
      match: snapDaifugo(daifugoMid(13)),
      sevens: { settings: { players: 3, level: 'hard', games: 5 }, rules: Object.assign({}, D.SevensRules.STANDARD, { mustPlay: true }), rating: { r: 1516, matches: 1, best: 1516, hist: hist(1516) }, match: snapSevens(sevensMid(14)) },
      speed: { settings: { level: 'easy', games: 5 }, rules: { wrap: false, same: true }, rating: { r: 1564, matches: 1, best: 1564, hist: hist(1564) }, match: snapSpeed(speedMid(15)) },
      onlineRatings: { daifugo: { r: 1521, matches: 4 }, sevens: { r: 1490, matches: 1 } },
      tab: 'sevens',
      installTipOff: 1790000200000,
    };
  }

  /** 今まで（2026-09-27）のアプリの読み込み（common.js の以前の処理）。新しい形式を古いアプリが読めるかの確認に使う */
  function oldAppLoad(raw) {
    const RT = D.Rating;
    const newRating = () => ({ r: RT.START, matches: 0, best: RT.START, hist: [] });
    const store = JSON.parse(raw || '{}') || {};
    store.settings = Object.assign({}, { players: 4, level: 'normal', games: 10, speed: 'normal', back: 'red', sound: true, bgm: true, bgmVol: 'low', autoPass: true, showPlayable: true, name: 'あなた' }, store.settings || {});
    store.rules = store.rules ? RU.migrate(store.rules) : Object.assign({}, RU.MINE);
    store.rating = Object.assign(newRating(), store.rating || {});
    store.sevens = Object.assign({}, store.sevens);
    store.sevens.settings = Object.assign({ players: 4, level: 'normal', games: 10 }, store.sevens.settings);
    store.sevens.rules = D.SevensRules.normalize(store.sevens.rules);
    store.sevens.rating = Object.assign(newRating(), store.sevens.rating || {});
    store.speed = Object.assign({}, store.speed);
    store.speed.settings = Object.assign({ level: 'normal', games: 3 }, store.speed.settings);
    store.speed.rules = D.SpeedRules.normalize(store.speed.rules);
    store.speed.rating = Object.assign(newRating(), store.speed.rating || {});
    store.onlineRatings = store.onlineRatings || {};
    if (store.onlineRating && !store.onlineRatings.daifugo) store.onlineRatings.daifugo = store.onlineRating;
    return store;
  }
  const noEV = (m) => { const o = clone(m); delete o.engineVersion; return o; };

  // ─────────────────────────────────────────────
  // 古い形式からの移行
  // ─────────────────────────────────────────────
  test('移行：9/25の形式（大富豪だけ・履歴あり・古いマイルール）', () => {
    const fx = fixture0925();
    const be = faulty({ [K.main]: json(fx) });
    const r = repoOf(be).load();
    eq(r.status, 'migrated', '状態');
    eq(r.issues.filter((x) => x.level === 'repair'), [], '直したところはない');
    const s = r.store;
    eq(s.schemaVersion, 2, 'schemaVersion');
    ok(!('log' in s), '出したカードの履歴は捨てる（復活させない）');
    eq(s.settings, Object.assign({}, fx.settings, { games: 10, bgm: true, bgmVol: 'low' }), '設定（欠けた項目は既定値）');
    eqv(s.rules, RU.MINE, '古いマイルール → 今のマイルール');
    eq(noEV(s.match), fx.match, '途中の対局はそのまま');
    eq(s.match.engineVersion, 1, '対局に engineVersion');
    eq(s.rating, { r: 1500, matches: 0, best: 1500, hist: [] }, 'レートは1500から');
    eq(be.raw(K.before(1)), json(fx), '移行前の原本を残す');
    eq(JSON.parse(be.raw(K.main)).revision, 1, '本体に書いた');
    // 得点表の前の対局：得点は0から・ゲーム数は無制限（以前と同じ扱い）
    const T = E.deserialize(s.match);
    eq([T.history, T.maxGames, T.matchOver, T.rated], [[], 0, false, null], '以前と同じ既定値');
  });

  test('移行：9/26の形式（レート・onlineRating・レート戦の途中）', () => {
    const fx = fixture0926();
    const be = faulty({ [K.main]: json(fx) });
    const s = repoOf(be).load().store;
    eq(s.rating, fx.rating, 'AI戦のレート');
    eq(s.onlineRatings, { daifugo: { r: 1512, matches: 2 } }, 'onlineRating → onlineRatings.daifugo');
    ok(!('onlineRating' in s), '古い項目は外す');
    eq(s.settings, Object.assign({}, fx.settings, { bgm: true, bgmVol: 'low' }), '設定');
    eq(noEV(s.match), fx.match, 'レート戦の途中の対局');
    eq(s.match.rated, fx.match.rated, 'レート戦の情報');
  });

  test('移行：9/27の形式（3ゲーム）は値がそのまま', () => {
    const fx = fixture0927();
    const be = faulty({ [K.main]: json(fx) });
    const r = repoOf(be).load();
    eq(r.status, 'migrated', '状態');
    const s = r.store;
    for (const k of ['settings', 'rules', 'rating', 'onlineRatings', 'tab', 'installTipOff']) eqv(s[k], fx[k], k);
    for (const g of ['sevens', 'speed']) for (const k of ['settings', 'rules', 'rating']) eqv(s[g][k], fx[g][k], g + '.' + k);
    eq(noEV(s.match), fx.match, '大富豪の途中');
    eq(noEV(s.sevens.match), fx.sevens.match, '七並べの途中');
    eq(noEV(s.speed.match), fx.speed.match, 'スピードの途中');
  });

  test('移行は1回だけ（もう一度開いても移行しない・原本は上書きしない）', () => {
    const fx = fixture0927();
    const be = faulty({ [K.main]: json(fx) });
    repoOf(be).load();
    const main1 = be.raw(K.main);
    be.f.writes = [];
    const r2 = repoOf(be).load();
    eq(r2.status, 'ok', '2回目はそのまま');
    eq(r2.fromVersion, 2, '2回目は schemaVersion 2');
    eq(be.raw(K.main), main1, '本体は書き換えない');
    ok(!be.f.writes.includes(K.before(1)), '原本（s1）を書き直さない');
    eq(be.raw(K.before(1)), json(fx), '原本はそのまま');
    eq(be.raw(K.bak), main1, '正常に読めた本体を控えに写す');
    be.f.writes = [];
    repoOf(be).load();
    eq(be.f.writes, [], '3回目は何も書かない');
  });

  test('移行した本体は、以前のアプリでも同じ値で読める（巻き戻しても壊れない）', () => {
    const fx = fixture0927();
    const be = faulty({ [K.main]: json(fx) });
    repoOf(be).load();
    const before = oldAppLoad(json(fx));
    const after = oldAppLoad(be.raw(K.main));
    for (const k of ['settings', 'rules', 'rating', 'onlineRatings', 'tab', 'installTipOff']) eq(after[k], before[k], k);
    for (const g of ['sevens', 'speed']) for (const k of ['settings', 'rules', 'rating']) eq(after[g][k], before[g][k], g + '.' + k);
    eq(noEV(after.match), before.match, '途中の対局');
    // 以前のアプリが書き戻した形（知らない項目も残る）を、新しいアプリがまた読める
    const back = repoOf(faulty({ [K.main]: JSON.stringify(after) })).load();
    eq(back.status, 'ok', '書き戻されたデータも読める');
    eq(back.store.rating, fx.rating, 'レート');
  });

  // ─────────────────────────────────────────────
  // 途中再開：保存 → 起動し直す → 読み込み で同じ局面になる
  // ─────────────────────────────────────────────
  test('途中再開：3ゲームとも、ルール・得点・手番・手札・ゲーム数が一致', () => {
    const be = faulty();
    const repo = repoOf(be);
    const store = repo.load().store;
    const d = daifugoMid(21, { rules: Object.assign({}, RU.MINE, { jokers: 1 }) });
    const sv = sevensMid(22);
    const sp = speedMid(23);
    store.match = ST.stampMatch('daifugo', snapDaifugo(d));
    store.sevens.match = ST.stampMatch('sevens', snapSevens(sv));
    store.speed.match = ST.stampMatch('speed', snapSpeed(sp));
    store.rating.r = 1555;
    eq(repo.save(store).ok, true, '保存');
    const r = repoOf(be).load();
    eq(r.status, 'ok', '読み込み');
    const s = r.store;
    const dT = E.deserialize(s.match);
    dT.rules = RU.migrate(dT.rules); // 画面（app.js）の再開と同じ
    eqv(dT.rules, d.rules, '大富豪：ルール');
    eq([dT.turn, dT.phase, dT.gameNo, dT.maxGames], [d.turn, d.phase, d.gameNo, d.maxGames], '大富豪：手番・段階・ゲーム');
    eq(dT.players.map((p) => [p.score, p.hand]), d.players.map((p) => [p.score, p.hand]), '大富豪：得点・手札');
    eq(E.getRequest(dT), E.getRequest(d), '大富豪：次の要求');
    const q = E.getRequest(d);
    if (q && q.kind === 'turn') eq(E.legalPlays(dT, q.seat).map(E.playKey), E.legalPlays(d, q.seat).map(E.playKey), '大富豪：出せる手');
    const sT = SV.deserialize(s.sevens.match);
    eq([sT.rules, sT.turn, sT.board, sT.players.map((p) => [p.score, p.hand, p.passes])], [sv.rules, sv.turn, sv.board, sv.players.map((p) => [p.score, p.hand, p.passes])], '七並べ：ルール・手番・場・得点・手札・パス');
    eq(SV.legalMoves(sT, sT.turn), SV.legalMoves(sv, sv.turn), '七並べ：出せる手');
    const pT = SP.deserialize(s.speed.match);
    eq([pT.rules, pT.phase, pT.piles, pT.players.map((p) => [p.wins, p.deck, p.field])], [sp.rules, sp.phase, sp.piles, sp.players.map((p) => [p.wins, p.deck, p.field])], 'スピード：ルール・段階・台札・勝ち数・山札・場札');
    eq(s.rating.r, 1555, 'レート');
  });

  test('レート戦の途中を保存して再開しても、レート戦の情報（基準のレート・試合数）が同じ', () => {
    const be = faulty();
    const repo = repoOf(be);
    const store = repo.load().store;
    const rated = { level: 'normal', base: [1520, 1500, 1500, 1500], matches: 7, result: null };
    const d = daifugoMid(31, { rated });
    store.match = ST.stampMatch('daifugo', snapDaifugo(d));
    const sp = speedMid(32, { rated: { level: 'hard', base: [1480, 1850], matches: 2, result: null } });
    store.speed.match = ST.stampMatch('speed', snapSpeed(sp));
    repo.save(store);
    const s = repoOf(be).load().store;
    eq(s.match.rated, rated, '大富豪');
    eq(s.speed.match.rated, sp.rated, 'スピード');
    eq(D.Rating.matchResult(E.deserialize(s.match), rated.base, [7, 0, 0, 0]), D.Rating.matchResult(d, rated.base, [7, 0, 0, 0]), '同じ結果ならレートの計算も同じ');
  });

  // ─────────────────────────────────────────────
  // 壊れたデータ
  // ─────────────────────────────────────────────
  test('壊れたJSON：前回正常だった控えから戻す（壊れた本体は別に残す）', () => {
    const fx = fixture0927();
    const be = faulty({ [K.main]: json(fx) });
    repoOf(be).load(); // 1回目（移行）
    repoOf(be).load(); // 2回目：正常に読めた → 控え
    const good = be.raw(K.main);
    be.set(K.main, good.slice(0, good.length >> 1)); // 書きかけで切れた
    const broken = be.raw(K.main);
    const r = repoOf(be).load();
    eq(r.status, 'recovered', '控えから戻した');
    eq(r.store.rating, fx.rating, 'レートが戻る');
    eq(noEV(r.store.sevens.match), fx.sevens.match, '途中の対局も戻る');
    eq(be.raw(K.broken), broken, '壊れた本体を残す');
    eq(JSON.parse(be.raw(K.main)).rating, fx.rating, '本体を控えの内容で書き直した');
    eq(repoOf(be).load().status, 'ok', '次は普通に読める');
  });

  test('壊れたJSON・控えもない：はじめから（壊れた本体は残す）', () => {
    const be = faulty({ [K.main]: '{"settings":{"players":4' });
    const r = repoOf(be).load();
    eq(r.status, 'corrupt', '状態');
    eq(r.store.settings.players, 4, '既定値');
    eqv(r.store.rules, RU.MINE, 'ルールはマイルール');
    eq(be.raw(K.broken), '{"settings":{"players":4', '壊れた本体を残す');
  });

  test('JSON でない形・大きすぎる値・schemaVersion が数字でない：壊れたデータとして扱う', () => {
    for (const raw of ['[1,2,3]', '"text"', 'null', '{"schemaVersion":"2"}', '{"schemaVersion":0}', '{"pad":"' + 'x'.repeat(1000001) + '"}']) {
      const be = faulty({ [K.main]: raw });
      const r = repoOf(be).load();
      eq(r.status, 'corrupt', raw.slice(0, 24));
      eq(be.raw(K.broken), raw, '原本を残す: ' + raw.slice(0, 24));
    }
  });

  test('数値でないレート：記録（hist）の最後の値から戻す／記録がなければ1500', () => {
    const fx = fixture0927();
    fx.rating = Object.assign({}, fx.rating, { r: 'abc' });
    fx.sevens.rating = { r: null, matches: -1, best: 'x', hist: 'none' };
    fx.speed.rating = { r: Infinity, matches: 2, best: 1600, hist: [{ after: 1600 }, { after: 'bad' }, 3] };
    const be = faulty({ [K.main]: JSON.stringify(fx).replace('"r":null', '"r":"NaN"') });
    const r = repoOf(be).load();
    eq(r.status, 'repaired', '状態');
    eq(r.store.rating.r, 1488, '大富豪：記録の最後の値');
    eq([r.store.sevens.rating.r, r.store.sevens.rating.matches, r.store.sevens.rating.best, r.store.sevens.rating.hist], [1500, 0, 1500, []], '七並べ：1500から');
    eq([r.store.speed.rating.r, r.store.speed.rating.hist.length], [1600, 1], 'スピード：正しい記録だけ残す');
    const labels = r.issues.filter((x) => x.level === 'repair').map((x) => x.label);
    ok(labels.includes('大富豪のAI戦レート') && labels.includes('七並べのAI戦レート') && labels.includes('スピードのAI戦レート'), '直したところを知らせる: ' + labels);
    ok(be.raw(K.broken) !== null, '直す前の原本を残す');
  });

  test('知らない値（enum）・型の違う設定：既定値に戻して知らせる。知らない項目は残す', () => {
    const fx = fixture0927();
    fx.settings = Object.assign({}, fx.settings, { players: 9, level: 'expert', back: 'gold', bgmVol: 'max', sound: 'yes', name: '<b>テスト</b>名前が長すぎる', future: 1 });
    fx.rules = Object.assign({}, fx.rules, { jokers: 7, eightCut: 'on' });
    fx.speed.settings = { level: 'hard', games: 2 };
    fx.tab = 'poker';
    const r = repoOf(faulty({ [K.main]: json(fx) })).load();
    const st = r.store.settings;
    eq([st.players, st.level, st.back, st.bgmVol, st.sound], [4, 'normal', 'red', 'low', true], '既定値に戻す');
    eq(st.name, 'bテスト/b名前', '名前は使えない文字を除いて8文字まで');
    eq(st.future, 1, '知らない項目は残す');
    eq([st.speed, st.showPlayable], [fx.settings.speed, fx.settings.showPlayable], '正しい項目はそのまま');
    eq(r.store.rules.jokers, RU.defaults().jokers, 'ルールの知らない値は既定値');
    eq(r.store.speed.settings, { level: 'hard', games: 3 }, 'スピードの試合の長さ');
    ok(!('tab' in r.store), '知らないタブは外す');
    eq(r.status, 'repaired', '状態');
  });

  test('途中の対局が壊れていたら、その対局だけ外す（ほかは残す）', () => {
    const cases = [
      ['カードが重複', (m) => { m.players[1].hand.push(m.players[0].hand[0]); }],
      ['知らないカード', (m) => { m.players[0].hand[0] = 'Z9'; }],
      ['カードが足りない', (m) => { m.players[2].hand.pop(); }],
      ['手番が範囲外', (m) => { m.phase = 'play'; m.turn = 7; }],
      ['知らない段階', (m) => { m.phase = 'paused'; }],
      ['得点が記録と合わない', (m) => { m.players[0].score += 3; }],
      ['新しいエンジンの形', (m) => { m.engineVersion = 99; }],
      ['人数が不正', (m) => { m.players = m.players.slice(0, 2); m.n = 2; }],
      ['レート戦の情報が不正', (m) => { m.rated = { level: 'normal', base: 'x', matches: 1 }; }],
    ];
    for (const [name, breakIt] of cases) {
      const fx = fixture0927();
      fx.match.history = [{ ranking: [0, 1, 2, 3], pts: [3, 1, -1, -3] }];
      fx.match.gameNo = 2;
      fx.match.players.forEach((p, i) => { p.score = [3, 1, -1, -3][i]; });
      ok(ST.checkMatch('daifugo', fx.match) === null, name + '：壊す前は読める');
      breakIt(fx.match);
      const r = repoOf(faulty({ [K.main]: json(fx) })).load();
      eq(r.store.match, null, name + '：大富豪の対局は外す');
      ok(r.issues.some((x) => x.label === '大富豪の途中の対局'), name + '：知らせる');
      eq(noEV(r.store.sevens.match), fx.sevens.match, name + '：七並べの対局は残る');
      eq(r.store.rating, fx.rating, name + '：レートは残る');
    }
    const fx = fixture0927();
    fx.speed.match.piles[0].push(fx.speed.match.players[0].deck[0]);
    eq(repoOf(faulty({ [K.main]: json(fx) })).load().store.speed.match, null, 'スピード：カードが重複');
    const fx2 = fixture0927();
    fx2.sevens.match.board.S = 'x';
    eq(repoOf(faulty({ [K.main]: json(fx2) })).load().store.sevens.match, null, '七並べ：場の形が違う');
  });

  test('未来の schemaVersion：読めるところだけ使い、書き込まない', () => {
    const fx = Object.assign(fixture0927(), { schemaVersion: 3, revision: 9, newThing: { a: 1 } });
    const raw = json(fx);
    const be = faulty({ [K.main]: raw });
    const repo = repoOf(be);
    const r = repo.load();
    eq(r.status, 'incompatible', '状態');
    eq(r.store.rating, fx.rating, '読めるところは使う');
    be.f.writes = [];
    const w = repo.save(r.store);
    eq([w.ok, w.reason], [false, 'incompatible'], '保存しない');
    eq(be.f.writes, [], '何も書かない');
    eq(be.raw(K.main), raw, '本体はそのまま');
  });

  test('__proto__ などを含むデータでも、ほかのオブジェクトを汚さない', () => {
    const raw = '{"__proto__":{"polluted":1},"settings":{"__proto__":{"polluted":2},"players":3},"constructor":{"x":1}}';
    const r = repoOf(faulty({ [K.main]: raw })).load();
    eq(r.store.settings.players, 3, '読める');
    ok(({}).polluted === undefined && r.store.polluted === undefined && r.store.settings.polluted === undefined, '汚染なし');
    ok(Object.getPrototypeOf(r.store) === Object.prototype, 'プロトタイプはそのまま');
  });

  // ─────────────────────────────────────────────
  // 書き込みの故障
  // ─────────────────────────────────────────────
  test('容量不足を注入：保存は失敗を返し、本体は前の内容のまま。空きができたら保存できる', () => {
    const be = faulty();
    const repo = repoOf(be);
    const store = repo.load().store;
    store.rating.r = 1510;
    eq(repo.save(store).ok, true, '最初は保存できる');
    const before = be.raw(K.main);
    be.f.quota = before.length; // 今より大きくなる書き込みは入らない
    store.match = ST.stampMatch('daifugo', snapDaifugo(daifugoMid(41)));
    const r = repo.save(store);
    eq([r.ok, r.reason], [false, 'quota'], '容量不足');
    eq(be.raw(K.main), before, '本体は前の内容のまま');
    eq(store.revision, 1, '失敗したら revision は進まない');
    be.f.quota = Infinity;
    const r2 = repo.save(store);
    eq([r2.ok, r2.revision], [true, 2], 'もう一度保存できる');
    eq(JSON.parse(be.raw(K.main)).match.gameNo, 1, '対局も保存された');
  });

  test('書き込みが禁止（SecurityError）・読み直すと違う・localStorage が使えない', () => {
    const be = faulty();
    const repo = repoOf(be);
    const store = repo.load().store;
    be.f.failSet = () => domErr('SecurityError', 18);
    eq(repo.save(store).reason, 'denied', '禁止');
    be.f.failSet = null;
    const be2 = faulty();
    const repo2 = repoOf(be2);
    const s2 = repo2.load().store;
    be2.set = () => {}; // 例外は出ないが、書いたはずの値が入らない
    const w2 = repo2.save(s2);
    eq([w2.ok, w2.reason], [false, 'verify'], '読み直して違えば失敗');
    const r3 = ST.createRepository(null).load();
    eq(r3.status, 'unavailable', '保存できない環境');
    eq(ST.createRepository(null).save(r3.store).reason, 'unavailable', '保存は失敗を返す');
    const be4 = faulty();
    be4.f.failGet = domErr('SecurityError', 18);
    eq(repoOf(be4).load().status, 'unavailable', '読むだけで例外');
    eq(ST.classify(quotaErr()), 'quota', 'QuotaExceededError');
    eq(ST.classify({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), 'quota', 'Firefox の容量不足');
    eq(ST.classify({ code: 22 }), 'quota', 'code 22');
    eq(ST.classify(new Error('x')), 'error', 'その他');
  });

  test('ほかのタブが保存データを書き換えたら、上書きしない', () => {
    const be = faulty({ [K.main]: json(fixture0927()) });
    const tabA = repoOf(be), tabB = repoOf(be);
    const a = tabA.load().store;
    const b = tabB.load().store;
    b.rating.r = 1600;
    eq(tabB.save(b).ok, true, 'タブBが保存');
    ok(tabA.checkExternal(), 'タブAは書き換えに気づく（storage イベント）');
    a.rating.r = 1400;
    const r = tabA.save(a);
    eq([r.ok, r.reason], [false, 'conflict'], 'タブAは保存しない');
    eq(JSON.parse(be.raw(K.main)).rating.r, 1600, 'タブBの内容が残る');
    // storage イベントが届かなくても、保存の前に気づく
    const tabC = repoOf(be);
    const c = tabC.load().store;
    b.rating.r = 1610;
    tabB.save(b);
    eq(tabC.save(c).reason, 'conflict', '保存の前に気づく');
    eq(JSON.parse(be.raw(K.main)).rating.r, 1610, '上書きしていない');
    eq(tabB.save(b).ok, true, '最後に書いたタブは続けて保存できる');
  });

  // ─────────────────────────────────────────────
  // 移行・修理の途中の故障
  // ─────────────────────────────────────────────
  test('移行の途中で本体の書き込みが失敗：原本はそのまま、次の起動でもう一度移行できる', () => {
    const fx = fixture0927();
    const raw = json(fx);
    const be = faulty({ [K.main]: raw });
    be.f.failSet = (k) => (k === K.main ? quotaErr() : null);
    const r = repoOf(be).load();
    eq(r.status, 'migrated', '読めた');
    eq([r.commit.ok, r.commit.reason], [false, 'quota'], '本体は書けなかった');
    eq(be.raw(K.main), raw, '本体は元のまま');
    eq(r.store.rating, fx.rating, 'このときも使える');
    be.f.failSet = null;
    const r2 = repoOf(be).load();
    eq([r2.status, r2.commit.ok], ['migrated', true], '次の起動で移行できた');
    eq(r2.store.rating, fx.rating, 'データは失われない');
  });

  test('移行の原本を残せない（容量不足）：直すところがなければ移行して続ける', () => {
    const fx = fixture0927();
    const raw = json(fx);
    const be = faulty({ [K.main]: raw });
    be.f.quota = raw.length * 1.3 + 200; // 本体の書き換えは入るが、原本の写しは入らない
    const r = repoOf(be).load();
    eq([r.status, r.mode], ['migrated', 'ok'], '移行は足すだけなので続ける');
    eq(be.raw(K.before(1)), null, '原本は残せなかった');
    eq(JSON.parse(be.raw(K.main)).schemaVersion, 2, '本体は移行した');
    eq(JSON.parse(be.raw(K.main)).rating, fx.rating, '値は同じ');
  });

  test('直すところがあるのに原本を残せない：本体を書き換えない（protect）→ もう一度試す／このまま保存', () => {
    const fx = fixture0927();
    fx.rating.r = 'broken';
    const raw = json(fx);
    const be = faulty({ [K.main]: raw });
    be.f.quota = raw.length + 600;
    const repo = repoOf(be);
    const r = repo.load();
    eq([r.status, r.mode], ['repaired', 'protect'], '書き換えを止める');
    eq(be.raw(K.main), raw, '本体は元のまま');
    const w = repo.save(r.store);
    eq([w.ok, w.reason], [false, 'protect'], '保存も止める');
    eq(be.raw(K.main), raw, '本体は元のまま（保存しても）');
    ok(!repo.retryProtect(), 'まだ容量不足');
    be.f.quota = Infinity;
    ok(repo.retryProtect(), '空きができたら原本を残せる');
    eq(be.raw(K.broken), raw, '原本');
    eq(repo.save(r.store).ok, true, '保存できる');
    // 利用者が「このまま保存」を選んだとき
    const be2 = faulty({ [K.main]: raw });
    be2.f.quota = raw.length + 600;
    const repo2 = repoOf(be2);
    const r2 = repo2.load();
    repo2.allowOverwrite();
    eq(repo2.save(r2.store).ok, true, 'このまま保存');
    eq(JSON.parse(be2.raw(K.main)).rating.r, 1488, '直した値で保存');
  });

  test('本体だけ消えて控えが残っている：控えから戻す', () => {
    const fx = fixture0927();
    const be = faulty({ [K.main]: json(fx) });
    repoOf(be).load();
    repoOf(be).load();
    be.remove(K.main);
    const r = repoOf(be).load();
    eq(r.status, 'recovered', '控えから');
    eq(r.store.speed.rating, fx.speed.rating, 'レート');
    eq(repoOf(faulty()).load().status, 'new', '何もなければ、はじめて');
  });

  test('保存のたびに revision が増え、savedAt が付く。直したデータは控えにしない', () => {
    const be = faulty();
    const repo = repoOf(be);
    const s = repo.load().store;
    repo.save(s);
    repo.save(s);
    const o = JSON.parse(be.raw(K.main));
    eq([o.schemaVersion, o.revision, o.savedAt], [2, 2, '2026-10-08T03:00:00.000Z'], '印');
    const fx = fixture0927();
    fx.rating.r = 'x';
    const be2 = faulty({ [K.main]: json(fx), [K.bak]: 'old-bak' });
    repoOf(be2).load();
    eq(be2.raw(K.bak), 'old-bak', '直したときは控えを更新しない');
  });

  // ─────────────────────────────────────────────
  // ランダムな対戦のどの局面でも「つづきから遊べる」と判定される（正しい対局を外してしまわない）
  // ─────────────────────────────────────────────
  test('ランダム対戦：3ゲームのどの局面の保存も、読み込みの確認を通り、そのまま残る', () => {
    let n = 0;
    const check = (game, snap) => {
      n++;
      const why = ST.checkMatch(game, snap);
      if (why) throw new Error(game + ' の正しい局面を外した：' + why + '（' + snap.phase + ' 第' + snap.gameNo + 'ゲーム）');
    };
    const presets = RU.PRESETS.map((p) => p.rules);
    for (let m = 0; m < 10; m++) {
      const S = E.createMatch({ rules: presets[m % presets.length], players: robots(3 + (m % 4), 'normal'), games: 2, seed: 100 + m });
      while (!S.matchOver) { E.startGame(S); check('daifugo', snapDaifugo(S)); playDaifugo(S, 5000, (T) => check('daifugo', snapDaifugo(T))); }
    }
    for (let m = 0; m < 12; m++) {
      const rules = Object.assign({}, D.SevensRules.STANDARD, { passLimit: [3, 5, 0][m % 3], joker: m % 2 === 0, tunnel: m % 4 < 2 });
      const S = SV.createMatch({ rules, players: robots(3 + (m % 4), 'normal'), games: 2, seed: 200 + m });
      while (!S.matchOver) { SV.startGame(S); check('sevens', snapSevens(S)); playSevens(S, 5000, (T) => check('sevens', snapSevens(T))); }
    }
    for (let m = 0; m < 12; m++) {
      const S = SP.createMatch({ rules: { wrap: m % 2 === 0, same: m % 3 !== 0 }, players: robots(2, 'normal'), games: 3, seed: 300 + m });
      const rng = C.mulberry32(300 + m);
      while (!S.matchOver) { SP.startGame(S); check('speed', snapSpeed(S)); playSpeed(S, 100000, rng, (T) => check('speed', snapSpeed(T))); }
    }
    cur.msgs.push('確認した局面 ' + n);
  });

  // backup_tests.js でも使う
  globalThis.STORAGE_FIX = { faulty, repoOf, quotaErr, fixture0925, fixture0926, fixture0927, daifugoMid, sevensMid, speedMid, snapDaifugo, snapSevens, snapSpeed, canon };
  globalThis.STORAGE_TEST_DONE = { pass: lines.filter((l) => l.ok).length, total: lines.length, failed: lines.filter((l) => !l.ok).map((l) => l.name + ': ' + l.msgs.join(' | ')) };
})();
