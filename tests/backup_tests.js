/* バックアップ（書き出し・読み込み）のテスト（js/backup.js と storage.js の repo.replace）
 * fixture と故障を起こせる保存先は storage_tests.js のもの（STORAGE_FIX） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const ST = D.Storage, BK = D.Backup, E = D.Engine, RU = D.Rules, SV = D.Sevens, SP = D.Speed;
  const F = globalThis.STORAGE_FIX;
  const K = ST.KEYS;
  const out = document.getElementById('out');
  const lines = [];
  let cur = null;
  function test(name, fn) {
    cur = { name, ok: true, msgs: [] };
    try { fn(); } catch (e) { cur.ok = false; cur.msgs.push('例外: ' + (e && e.stack || e)); }
    lines.push(cur);
    const li = document.createElement('li');
    li.className = cur.ok ? 'ok' : 'ng';
    li.textContent = (cur.ok ? '✔ ' : '✘ ') + '[backup] ' + name + (cur.msgs.length ? '\n   ' + cur.msgs.join('\n   ') : '');
    out.appendChild(li);
  }
  const ok = (c, m) => { if (!c) { cur.ok = false; cur.msgs.push('NG: ' + m); } };
  const eq = (a, b, m) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) { cur.ok = false; cur.msgs.push('NG: ' + m + ' 期待=' + sb + ' 実際=' + sa); } };
  const eqv = (a, b, m) => eq(F.canon(a), F.canon(b), m);
  const NOW = Date.UTC(2026, 9, 8, 5, 3, 0);

  /** 端末A：9/27の形式（3ゲームの途中・レート）＋大富豪はレート戦の途中。オンラインの控えなど端末だけの情報もある */
  function deviceA() {
    const fx = F.fixture0927();
    fx.match = F.snapDaifugo(F.daifugoMid(51, { rated: { level: 'hard', base: [1488, 1630, 1630, 1630], matches: 1, result: null } }));
    fx.secretThing = 'should-not-export';
    const be = F.faulty({ [K.main]: JSON.stringify(fx), 'daifugo.cid': 'cid_SECRET_0123456789' });
    const repo = F.repoOf(be);
    const store = repo.load().store;
    store.backupAt = NOW - 86400000;
    repo.save(store);
    return { be, repo, store, fx };
  }
  /** 端末B：別のデータ（はじめて開いてレート戦を1回、オンラインのレートの控えもある） */
  function deviceB() {
    const be = F.faulty({ 'daifugo.cid': 'cid_OTHER_DEVICE_000' });
    const repo = F.repoOf(be);
    const store = repo.load().store;
    store.rating = { r: 1460, matches: 1, best: 1500, hist: [{ at: 1, before: 1500, after: 1460, d: -40 }] };
    store.onlineRatings = { daifugo: { r: 1720, matches: 12 } };
    store.tab = 'speed';
    store.installTipOff = 1790000300000;
    repo.save(store);
    return { be, repo, store };
  }
  /** env を書き換えてチェックサムを付け直す */
  function reseal(text, edit) {
    const env = JSON.parse(text);
    edit(env);
    env.checksum = BK.checksum(env.data);
    return JSON.stringify(env);
  }

  test('往復：書き出して別の端末で読み込むと、設定・ルール・AI戦のレート・3ゲームの途中（レート戦も）が同じ', () => {
    const A = deviceA(), B = deviceB();
    const b = BK.create(A.store, NOW);
    const r = BK.read(b.text, B.store);
    eq(r.ok, true, '読める: ' + r.message);
    const s = r.store;
    for (const k of ['settings', 'rules', 'rating', 'match']) eqv(s[k], A.store[k], '大富豪 ' + k);
    for (const g of ['sevens', 'speed']) for (const k of ['settings', 'rules', 'rating', 'match']) eqv(s[g][k], A.store[g][k], g + ' ' + k);
    eq(r.exportedAt, '2026-10-08T05:03:00.000Z', '書き出した日時');
    // 置き換えて、起動し直しても同じ
    const w = B.repo.replace(s);
    eq(w.ok, true, '置き換え');
    const t = F.repoOf(B.be).load();
    eq(t.status, 'ok', '次の起動で普通に読める');
    eqv(t.store.rating, A.store.rating, 'レート');
    eqv(t.store.speed.match, A.store.speed.match, 'スピードの途中');
    // 端末Bだけのもの（オンラインのレートの控え・タブ・ホーム画面の案内）は端末Bのまま
    eq([t.store.onlineRatings, t.store.tab, t.store.installTipOff], [{ daifugo: { r: 1720, matches: 12 } }, 'speed', 1790000300000], 'この端末だけのものはそのまま');
    eq(t.store.revision, B.store.revision + 1, '書いた回数は続きから');
    eq(B.be.raw('daifugo.cid'), 'cid_OTHER_DEVICE_000', 'オンラインのIDは変わらない');
  });

  test('途中再開：読み込んだ3ゲームの対局が、手番・手札・得点・ルール・レート戦の情報まで同じ', () => {
    const A = deviceA(), B = deviceB();
    const r = BK.read(BK.create(A.store, NOW).text, B.store);
    const d0 = E.deserialize(A.store.match), d1 = E.deserialize(r.store.match);
    eq([d1.turn, d1.phase, d1.gameNo, d1.rated, d1.players.map((p) => [p.score, p.hand])], [d0.turn, d0.phase, d0.gameNo, d0.rated, d0.players.map((p) => [p.score, p.hand])], '大富豪');
    eq(E.getRequest(d1), E.getRequest(d0), '大富豪：次の要求');
    const s0 = SV.deserialize(A.store.sevens.match), s1 = SV.deserialize(r.store.sevens.match);
    eq([s1.turn, s1.board, s1.players.map((p) => [p.hand, p.passes, p.score])], [s0.turn, s0.board, s0.players.map((p) => [p.hand, p.passes, p.score])], '七並べ');
    const p0 = SP.deserialize(A.store.speed.match), p1 = SP.deserialize(r.store.speed.match);
    eq([p1.phase, p1.piles, p1.players.map((p) => [p.deck, p.field, p.wins])], [p0.phase, p0.piles, p0.players.map((p) => [p.deck, p.field, p.wins])], 'スピード');
    for (const g of ['daifugo', 'sevens', 'speed']) ok(ST.checkMatch(g, g === 'daifugo' ? r.store.match : r.store[g].match) === null, g + '：つづきから遊べる');
  });

  test('書き出しに入れないもの：オンラインのID・オンラインのレート・タブ・案内・知らない項目・履歴', () => {
    const A = deviceA();
    A.store.log = ['テスト：♠3']; // もし残っていても入れない
    const b = BK.create(A.store, NOW);
    eq(Object.keys(b.env.data), ['settings', 'rules', 'rating', 'match', 'sevens', 'speed'], 'data の項目');
    eq(Object.keys(b.env.data.sevens), ['settings', 'rules', 'rating', 'match'], '七並べの項目');
    for (const s of ['cid_SECRET', 'onlineRatings', 'installTipOff', '"tab"', 'backupAt', 'secretThing', 'should-not-export', '"log"', 'revision', 'savedAt']) ok(!b.text.includes(s), '入れない: ' + s);
    eq([b.env.format, b.env.version, b.env.storeSchemaVersion, b.env.app], ['cards-table-backup', 1, 2, 'Cards Table'], '形式');
    eq(b.name, BK.fileName(NOW), 'ファイル名');
    ok(/^cards-table-backup-\d{8}-\d{4}\.json$/.test(b.name), 'ファイル名の形: ' + b.name);
    ok(b.text.length < 200000, '大きさ: ' + b.text.length);
  });

  test('読み込めないもの：空・JSONでない・別のファイル・新しい形式・壊れた・大きすぎる（理由を返し、今のデータは変えない）', () => {
    const A = deviceA(), B = deviceB();
    const before = B.be.raw(K.main);
    const text = BK.create(A.store, NOW).text;
    const cases = [
      ['', 'empty'], ['   ', 'empty'], ['abc', 'not-json'], [text.slice(0, text.length - 40), 'not-json'],
      ['{}', 'not-backup'], ['{"format":"other","version":1}', 'not-backup'], [JSON.stringify({ format: 'cards-table-backup', version: 'x' }), 'not-backup'],
      [reseal(text, (e) => { e.version = 2; }), 'newer'],
      [reseal(text, (e) => { e.storeSchemaVersion = 3; }), 'newer'],
      [text.replace('"r":1516', '"r":1517'), 'broken'],
      [reseal(text, (e) => { e.checksum = 'x'; }).replace(/"checksum":"[^"]*"/, '"checksum":"x"'), 'broken'],
      [reseal(text, (e) => { e.storeSchemaVersion = 0; }), 'broken'],
      ['x'.repeat(BK.MAX_CHARS + 1), 'too-big'],
    ];
    for (const [t, code] of cases) {
      const r = BK.read(t, B.store);
      eq([r.ok, r.code], [false, code], code + ': ' + t.slice(0, 30));
      ok(typeof r.message === 'string' && r.message.length > 5, '理由の文: ' + code);
    }
    eq(B.be.raw(K.main), before, '端末Bのデータは変わらない');
  });

  test('中身が正しくないバックアップは読み込まない（不正なカード・数値でないレート・形の違うゲーム）', () => {
    const A = deviceA(), B = deviceB();
    const text = BK.create(A.store, NOW).text;
    const cases = [
      ['大富豪の途中の対局', (e) => { e.data.match.players[0].hand[0] = 'Z9'; }],
      ['大富豪の途中の対局', (e) => { e.data.match.players[1].hand.push(e.data.match.players[0].hand[0]); }],
      ['大富豪のAI戦レート', (e) => { e.data.rating.r = 'abc'; }],
      ['七並べの保存データ', (e) => { e.data.sevens = 5; }],
      ['スピードの途中の対局', (e) => { e.data.speed.match.engineVersion = 99; }],
      ['設定', (e) => { e.data.settings.players = 99; }],
    ];
    for (const [label, edit] of cases) {
      const r = BK.read(reseal(text, edit), B.store);
      eq([r.ok, r.code], [false, 'invalid'], label);
      ok(r.message.includes(label), '読めない部分を知らせる: ' + r.message);
    }
  });

  test('__proto__ などを含むバックアップでも、ほかのオブジェクトを汚さない', () => {
    const A = deviceA(), B = deviceB();
    const text = BK.create(A.store, NOW).text;
    const evil = (() => {
      const env = JSON.parse(text.replace('"data":{', '"data":{"__proto__":{"polluted":1},"constructor":{"x":1},').replace('"settings":{', '"settings":{"__proto__":{"polluted":2},'));
      env.checksum = BK.checksum(env.data);
      return JSON.stringify(env);
    })();
    const r = BK.read(evil, B.store);
    eq(r.ok, true, '読める（知らない項目は入れない）');
    ok(({}).polluted === undefined && r.store.polluted === undefined && r.store.settings.polluted === undefined, '汚染なし');
    ok(Object.getPrototypeOf(r.store) === Object.prototype && Object.getPrototypeOf(r.store.settings) === Object.prototype, 'プロトタイプはそのまま');
  });

  test('貼り付けたときの前後の空白・BOM・改行は気にしない', () => {
    const A = deviceA(), B = deviceB();
    const text = BK.create(A.store, NOW).text;
    eq(BK.read('﻿  \n' + text + '\r\n ', B.store).ok, true, '読める');
  });

  test('形式の番号が古いデータのバックアップ（storeSchemaVersion 1）も移行して読める', () => {
    const B = deviceB();
    const fx = F.fixture0925();
    const data = BK.pick(fx);
    const text = JSON.stringify({ format: 'cards-table-backup', version: 1, exportedAt: '2026-09-25T00:00:00.000Z', storeSchemaVersion: 1, data, checksum: BK.checksum(data) });
    const r = BK.read(text, B.store);
    eq(r.ok, true, '読める: ' + r.message);
    eqv(r.store.rules, RU.MINE, '古いマイルール → 今のマイルール');
    eq(r.store.settings.games, 10, '欠けた設定は既定値');
    ok(!('log' in r.store), '履歴は入れない');
    eq(r.store.match.engineVersion, 1, '途中の対局');
  });

  test('置き換え：今のデータを控え（.prerestore）に残す。残せない・ほかのタブ・保存できない状態なら置き換えない', () => {
    const A = deviceA();
    const text = BK.create(A.store, NOW).text;
    // 容量不足で控えを残せない
    const B = deviceB();
    const before = B.be.raw(K.main);
    B.be.f.failSet = (k) => (k === K.prerestore ? F.quotaErr() : null);
    const r1 = B.repo.replace(BK.read(text, B.store).store);
    eq([r1.ok, r1.reason, r1.stage], [false, 'quota', 'prerestore'], '控えを残せない');
    eq(B.be.raw(K.main), before, '本体はそのまま');
    B.be.f.failSet = null;
    // ほかのタブが書いた
    const B2 = deviceB();
    const other = F.repoOf(B2.be);
    const os = other.load().store;
    os.settings.name = 'ほかのタブ';
    other.save(os);
    const r2 = B2.repo.replace(BK.read(text, B2.store).store);
    eq([r2.ok, r2.reason], [false, 'conflict'], 'ほかのタブ');
    eq(JSON.parse(B2.be.raw(K.main)).settings.name, 'ほかのタブ', '上書きしない');
    // 新しい形式のデータがある・保存できない環境
    const fut = F.faulty({ [K.main]: JSON.stringify({ schemaVersion: 9 }) });
    const rf = F.repoOf(fut);
    rf.load();
    eq(rf.replace(BK.read(text, B.store).store).reason, 'incompatible', '新しい形式のデータは置き換えない');
    eq(ST.createRepository(null).replace({}).reason, 'unavailable', '保存できない環境');
    // 成功
    const B3 = deviceB();
    const prev = B3.be.raw(K.main);
    eq(B3.repo.replace(BK.read(text, B3.store).store).ok, true, '置き換えた');
    eq(B3.be.raw(K.prerestore), prev, '前の本体を控えに残した');
  });

  test('1つ前のデータに戻す：控えを読んで戻すと前の内容になり、読み込んだ内容が新しい控えになる', () => {
    const A = deviceA(), B = deviceB();
    const imported = BK.read(BK.create(A.store, NOW).text, B.store).store;
    B.repo.replace(imported);
    const repo2 = F.repoOf(B.be);
    const now = repo2.load().store;
    const prev = repo2.peek(K.prerestore);
    ok(prev && prev.store, '控えが読める');
    eq(prev.store.rating.r, 1460, '控えは端末Bの前のデータ');
    eq(repo2.replace(BK.carry(prev.store, now)).ok, true, '戻した');
    const after = F.repoOf(B.be).load().store;
    eq([after.rating.r, after.match, after.tab], [1460, null, 'speed'], '前のデータに戻った');
    eq(F.repoOf(B.be).peek(K.prerestore).store.rating.r, A.store.rating.r, '読み込んだ内容が新しい控え（もう一度戻せる）');
    eq(F.repoOf(F.faulty()).peek(K.prerestore), null, '控えがなければ null');
  });

  test('要約：名前・ゲームごとのレートと途中の対局', () => {
    const A = deviceA();
    const s = BK.summary(A.store);
    eq(s.name, 'テスト', '名前');
    eq(s.games.daifugo.r, A.store.rating.r, '大富豪のレート');
    eq([s.games.daifugo.match.rated, s.games.daifugo.match.gameNo, s.games.daifugo.match.maxGames], [true, 1, 10], '大富豪はレート戦の第1/10ゲーム');
    eq(s.games.speed.match.wins, A.store.speed.match.players.map((p) => p.wins), 'スピードは勝ち数');
    const fresh = BK.summary(ST.fresh());
    eq([fresh.name, fresh.games.sevens.r, fresh.games.sevens.match], ['あなた', 1500, null], 'はじめての端末');
  });

  globalThis.BACKUP_TEST_DONE = { pass: lines.filter((l) => l.ok).length, total: lines.length, failed: lines.filter((l) => !l.ok).map((l) => l.name + ': ' + l.msgs.join(' | ')) };
})();
