/* オンラインのレートの精算のテスト（js/rating-ledger.js と RoomCore の ratingOut）
 * Ratings の保存先は、Durable Object の storage と同じ形のメモリ（get(配列) → Map、put(オブジェクト) はまとめて書く）。
 * 故障（保存の失敗・答えが届かない・部屋の再起動）は手で起こす。非同期なので、結果は LEDGER_TEST_DONE が入ってから見る */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const L = D.RatingLedger, RT = D.Rating, RU = D.Rules;
  const out = document.getElementById('out');
  const lines = [];
  let cur = null;
  async function test(name, fn) {
    cur = { name, ok: true, msgs: [] };
    try { await fn(); } catch (e) { cur.ok = false; cur.msgs.push('例外: ' + (e && e.stack || e)); }
    lines.push(cur);
    const li = document.createElement('li');
    li.className = cur.ok ? 'ok' : 'ng';
    li.textContent = (cur.ok ? '✔ ' : '✘ ') + '[ledger] ' + name + (cur.msgs.length ? '\n   ' + cur.msgs.join('\n   ') : '');
    out.appendChild(li);
  }
  const ok = (c, m) => { if (!c) { cur.ok = false; cur.msgs.push('NG: ' + m); } };
  const eq = (a, b, m) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) { cur.ok = false; cur.msgs.push('NG: ' + m + ' 期待=' + sb + ' 実際=' + sa); } };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const T0 = Date.UTC(2026, 9, 9, 3, 0, 0);
  const START = RT.START;

  /** Durable Object の storage の代わり。f.failPut(n, entries) が例外を返すと、その put は1つも書かれない */
  function fakeStore() {
    const m = new Map();
    const f = { puts: 0, failPut: null };
    return {
      f, m,
      async get(keys) { const r = new Map(); for (const k of keys) if (m.has(k)) r.set(k, clone(m.get(k))); return r; },
      async put(obj) {
        f.puts++;
        const e = f.failPut && f.failPut(f.puts, obj);
        if (e) throw e;
        for (const k of Object.keys(obj)) m.set(k, clone(obj[k]));
      },
    };
  }
  const keyOf = async (cid, game) => 'r:' + cid + (game === 'daifugo' ? '' : ':' + game);
  const record = (store, list, now) => L.apply(store, clone(list), now || T0, keyOf, START);
  const ev = (eventId, cid, delta, extra) => Object.assign({ eventId, cid, game: 'daifugo', delta, at: T0 }, extra);

  /** レート戦の部屋（4人：人2・AI2）を始めて、guest が抜ける（棄権）→ 精算が1つ */
  function abandonedRoom(code) {
    const r = new D.RoomCore(code || 'LEDGR');
    r.join('host_00000001', 'ホスト', T0, { r: 1600, n: 12 });
    r.join('guest_00000001', 'ゲスト', T0, { r: 1450, n: 3 });
    r.configure('host_00000001', { mode: 'rated' }, T0);
    r.start('host_00000001', RU.defaults(), T0);
    r.leave('guest_00000001', T0 + 5000);
    return r;
  }
  const reload = (r) => D.RoomCore.fromJSON(clone(r.toJSON()));

  (async () => {
    await test('同じ精算を100回送っても、レートと試合数は1回分', async () => {
      const s = fakeStore();
      const e = ev('m-AAAAA-1:0', 'p1', 12);
      let res;
      for (let i = 0; i < 100; i++) res = await record(s, [e]);
      const v = s.m.get('r:p1');
      eq([v.r, v.n], [START + 12, 1], '1回分');
      eq([res[0].status, res[0].r, res[0].n], ['duplicate', START + 12, 1], '2回目からは反映済み（そのときの値を返す）');
      ok(s.m.has('e:m-AAAAA-1:0'), '印は eventId で残す');
    });

    await test('同じIDで中身が違う精算は反映しない（conflict）', async () => {
      const s = fakeStore();
      await record(s, [ev('m-AAAAA-1:0', 'p1', 12)]);
      const res = await record(s, [ev('m-AAAAA-1:0', 'p1', -40)]);
      eq(res[0].status, 'conflict', 'conflict');
      eq(s.m.get('r:p1').r, START + 12, 'レートは変わらない');
      const res2 = await record(s, [ev('m-AAAAA-1:0', 'p2', 12)]);
      eq(res2[0].status, 'conflict', '別の人の同じIDも conflict');
    });

    await test('まとめて送った途中で保存に失敗しても、送り直せば合計は正しい（二重にならない）', async () => {
      const s = fakeStore();
      const list = [ev('m-BBBBB-1:0', 'p1', 10), ev('m-BBBBB-1:1', 'p2', -10), ev('m-BBBBB-1:2', 'p3', 5)];
      s.f.failPut = (n) => (n === 2 ? new Error('storage failure') : null);
      let threw = false;
      try { await record(s, list); } catch (e) { threw = true; }
      ok(threw, '1回目は途中で失敗（部屋には答えが届かない）');
      eq([s.m.get('r:p1').r, s.m.has('r:p2'), s.m.has('r:p3')], [START + 10, false, false], '書けたのは1件目だけ（2件目は1つも書かれない）');
      s.f.failPut = null;
      const res = await record(s, list);
      eq(res.map((x) => x.status), ['duplicate', 'applied', 'applied'], '送り直し：1件目は反映済み');
      eq([s.m.get('r:p1').r, s.m.get('r:p2').r, s.m.get('r:p3').r], [START + 10, START - 10, START + 5], '合計が正しい');
      eq([s.m.get('r:p1').n, s.m.get('r:p2').n], [1, 1], '試合数も1回分');
    });

    await test('部屋：精算に ID（試合ID:席）が付き、保存して読み直しても同じ ID', async () => {
      const r = abandonedRoom();
      eq(r.ratingOut.length, 1, '棄権の精算');
      const e = r.ratingOut[0];
      ok(/^m-LEDGR-[0-9a-z]+-[0-9a-z]+:1$/.test(e.eventId), 'eventId: ' + e.eventId);
      eq([e.cid, e.game, e.reason, e.at], ['guest_00000001', 'daifugo', 'abandoned', T0 + 5000], '中身');
      eq(reload(r).ratingOut[0].eventId, e.eventId, '再起動しても同じ ID');
      const r2 = abandonedRoom();
      ok(r2.S.rated.matchId !== r.S.rated.matchId, '試合ごとに matchId が違う（同じ部屋コードでも）');
    });

    await test('答えが届かなかった（ACK喪失）→ 部屋は精算を残す → 送り直しは反映済みになり、部屋から消える', async () => {
      const s = fakeStore();
      const r = abandonedRoom();
      const delta = r.ratingOut[0].delta;
      await record(s, r.ratingOut); // Ratings は反映したが、答えが部屋に届かなかった
      const saved = clone(r.toJSON()); // 部屋は先に保存してある（精算は残っている）
      const r2 = D.RoomCore.fromJSON(saved); // 部屋が再起動
      eq(r2.ratingOut.length, 1, '精算は残っている');
      const res = await record(s, r2.ratingOut);
      eq(res[0].status, 'duplicate', '送り直しは反映済み');
      ok(r2.ackRatings(res), '部屋から取り除く');
      eq(r2.ratingOut.length, 0, '空になる');
      eq(s.m.get('r:guest_00000001').r, START + delta, 'レートは1回分');
      eq(s.m.get('r:guest_00000001').n, 1, '試合数も1回分');
      eq(r2.ackRatings(res), false, '同じ答えをもう一度受けても何もしない');
    });

    await test('Ratings 側が再起動しても（印は保存先に残る）二重にならない', async () => {
      const s = fakeStore();
      const r = abandonedRoom();
      await record(s, r.ratingOut);
      const s2 = { get: s.get, put: s.put, f: s.f, m: s.m }; // 同じ保存先を、新しい Ratings が使う
      const res = await L.apply(s2, clone(r.ratingOut), T0 + 9999, keyOf, START);
      eq(res[0].status, 'duplicate', '再起動後も反映済み');
    });

    await test('答えが来たものだけ取り除き、表示するレートをサーバーの値にする', () => {
      const r = abandonedRoom();
      r.ratingOut.push({ eventId: 'x-other:9', cid: 'host_00000001', game: 'daifugo', delta: 3, at: T0 });
      const before = r.ratingOut.length;
      const changed = r.ackRatings([{ eventId: r.ratingOut[0].eventId, status: 'applied', cid: 'guest_00000001', r: 1234, n: 7 }, { eventId: 'x-other:9', status: 'retry-later' }]);
      ok(changed, '取り除いた');
      eq(r.ratingOut.length, before - 1, '答えのないもの（知らない status）は残す');
      eq(r.ratingOut[0].eventId, 'x-other:9', '残ったもの');
    });

    await test('棄権した人に、試合の完了分をもう一度足さない（同じ席の ID は1つ）', async () => {
      const s = fakeStore();
      const r = abandonedRoom();
      const first = r.ratingOut[0];
      // もし部屋が同じ席の精算をもう一度積んでしまっても、ID が同じなので反映は1回
      const dup = Object.assign({}, first);
      const res = await record(s, [first, dup]);
      eq(res.map((x) => x.status), ['applied', 'duplicate'], '2つ目は反映済み');
      eq(s.m.get('r:guest_00000001').n, 1, '1回分');
    });

    await test('同じ人の、別の試合（別の部屋）の精算は両方反映する', async () => {
      const s = fakeStore();
      const a = abandonedRoom('AAAAA'), b = abandonedRoom('BBBBB');
      await record(s, a.ratingOut);
      await record(s, b.ratingOut);
      eq(s.m.get('r:guest_00000001').n, 2, '2試合分');
      eq(s.m.get('r:guest_00000001').r, START + a.ratingOut[0].delta + b.ratingOut[0].delta, '合計');
    });

    await test('ゲームごとに別のレート（七並べ・スピードはキーが別）', async () => {
      const s = fakeStore();
      await record(s, [ev('m-CCCCC-1:0', 'p1', 8, { game: 'speed' }), ev('m-CCCCC-2:0', 'p1', -4)]);
      eq([s.m.get('r:p1:speed').r, s.m.get('r:p1').r], [START + 8, START - 4], 'スピードと大富豪');
    });

    await test('不正な精算・古すぎる精算は反映せず、部屋から取り除く', async () => {
      const s = fakeStore();
      const res = await record(s, [
        ev('m-DDDDD-1:0', 'p1', 1000),
        ev('m-DDDDD-1:1', '', 5),
        ev('bad id!', 'p1', 5),
        ev('m-DDDDD-1:2', 'p1', 5, { at: T0 - L.RETENTION - 1 }),
        null,
      ]);
      eq(res.map((x) => x.status), ['invalid', 'invalid', 'invalid', 'expired', 'invalid'], '状態');
      eq(s.m.size, 0, '何も書かない');
      ok(['invalid', 'expired', 'applied', 'duplicate', 'conflict'].every(L.settled), 'どれも片付いた扱い（送り直さない）');
      ok(!L.settled(undefined), '答えがなければ残す');
      const many = Array.from({ length: 20 }, (_, i) => ev('m-EEEEE-1:' + i, 'q' + i, 1));
      eq((await record(s, many)).length, L.MAX_BATCH, '1回に受け付けるのは12件まで');
    });

    await test('ID がない頃の部屋の精算：読み込むときに ID を付け、保存して読み直しても同じ ID', () => {
      const r = abandonedRoom('OLDRM');
      const o = clone(r.toJSON());
      o.updatedAt = T0 + 77;
      delete o.S.rated.matchId;
      o.ratingOut = o.ratingOut.map((it) => ({ cid: it.cid, game: it.game, delta: it.delta })); // 以前の形
      o.ratingOut.push({ cid: 'host_00000001', game: 'daifugo', delta: 4 });
      const a = D.RoomCore.fromJSON(clone(o));
      ok(a.dirty, '付けたことがわかる（サーバーがすぐ保存する）');
      ok(a.S.rated.matchId, '試合ID');
      eq(a.ratingOut.map((it) => it.eventId), ['legacy-OLDRM-' + (T0 + 77).toString(36) + '-0', 'legacy-OLDRM-' + (T0 + 77).toString(36) + '-1'], 'ID');
      const b = D.RoomCore.fromJSON(clone(o));
      eq(b.ratingOut.map((it) => it.eventId), a.ratingOut.map((it) => it.eventId), '同じ保存データからは同じ ID');
      delete a.dirty;
      const c = D.RoomCore.fromJSON(clone(a.toJSON()));
      ok(!c.dirty, '一度保存したら、もう付けない');
      eq(c.ratingOut.map((it) => it.eventId), a.ratingOut.map((it) => it.eventId), '保存後も同じ');
    });

    await test('ID がない精算が直接来ても（念のため）、これまでどおり反映する', async () => {
      const s = fakeStore();
      const res = await record(s, [{ cid: 'p9', game: 'daifugo', delta: 6 }]);
      eq([res[0].status, s.m.get('r:p9').r], ['applied', START + 6], '反映');
    });

    await test('送り直すまでの間：5秒・15秒・1分・5分、そのあとは10分', () => {
      eq([1, 2, 3, 4, 5, 9].map(L.retryDelay), [5000, 15000, 60000, 300000, 600000, 600000], '間');
      eq(L.retryDelay(0), 0, '失敗していなければ待たない');
    });

    await test('スピードのレート戦を最後まで：完了の精算は1つ、送り直しても1回分', async () => {
      const r = new D.RoomCore('SPDLG');
      r.join('host_00000001', 'ホスト', T0, { r: 1500, n: 10 }, 'speed');
      r.configure('host_00000001', { mode: 'rated', aiLevel: 'hard' }, T0);
      r.start('host_00000001', {}, T0);
      let now = T0, guard = 0;
      while (!(r.S.matchOver && r.S.phase === 'over') && guard++ < 20000) {
        if (r.S.phase === 'over') { r.next('host_00000001', now); continue; }
        const v = r.viewFor('host_00000001', false);
        const view = D.Speed.deserialize(v.state);
        if (view.phase === 'play' && guard % 3 === 0) {
          const mv = D.Speed.playable(view, v.seat)[0];
          if (mv) r.act('host_00000001', { type: 'play', slot: mv.slot, pile: mv.pile }, now);
        }
        const d = r.nextAiDelay(now);
        now += d == null ? 500 : Math.min(d, 700);
        r.aiStep(now);
      }
      ok(r.S.matchOver, '試合が終わる');
      eq(r.ratingOut.length, 1, '完了の精算は1つ（人の席だけ）');
      eq([r.ratingOut[0].reason, r.ratingOut[0].game, r.ratingOut[0].eventId.endsWith(':0')], ['completed', 'speed', true], '中身');
      const s = fakeStore();
      for (let i = 0; i < 3; i++) await record(s, r.ratingOut, now);
      eq(s.m.get('r:host_00000001:speed').n, 1, '1回分');
      eq(s.m.get('r:host_00000001:speed').r, START + r.ratingOut[0].delta, 'レート');
    });

    globalThis.LEDGER_TEST_DONE = { pass: lines.filter((l) => l.ok).length, total: lines.length, failed: lines.filter((l) => !l.ok).map((l) => l.name + ': ' + l.msgs.join(' | ')) };
  })();
})();
