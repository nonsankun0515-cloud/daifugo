/* 大富豪 — オンライン対戦の部屋（RoomCore）のテスト */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const E = D.Engine, AI = D.AI, RU = D.Rules;
  const out = document.getElementById('out');
  const lines = [];
  let cur = null;
  function test(name, fn) {
    cur = { name, ok: true, msgs: [] };
    try { fn(); } catch (e) { cur.ok = false; cur.msgs.push('例外: ' + (e && e.stack || e)); }
    lines.push(cur);
    const li = document.createElement('li');
    li.className = cur.ok ? 'ok' : 'ng';
    li.textContent = (cur.ok ? '✔ ' : '✘ ') + '[online] ' + name + (cur.msgs.length ? '\n   ' + cur.msgs.join('\n   ') : '');
    out.appendChild(li);
  }
  const ok = (c, m) => { if (!c) { cur.ok = false; cur.msgs.push('NG: ' + m); } };
  const eq = (a, b, m) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) { cur.ok = false; cur.msgs.push('NG: ' + m + ' 期待=' + sb + ' 実際=' + sa); } };

  const T0 = 1000000;
  function room(n) {
    const r = new D.RoomCore('ABCDE');
    r.join('host_00000001', 'ホスト', T0);
    for (let i = 1; i < n; i++) r.join('guest_0000000' + i, 'ゲスト' + i, T0);
    return r;
  }
  /** 人間の番なら、その人に届いた「伏せた状態」だけを見て AI（ふつう）で決める */
  function humanMove(r, cid, now) {
    const v = r.viewFor(cid, false);
    if (!v.request) return false;
    const view = E.deserialize(v.state);
    const a = AI.decideSync(view, v.request, 'normal');
    delete a.seat;
    const res = r.act(cid, a, now);
    if (!res.ok) throw new Error('伏せた状態から決めた操作が通らない: ' + res.error + ' ' + JSON.stringify(a));
    return true;
  }
  function stepAll(r, now) {
    const q = E.getRequest(r.S);
    if (!q) return false;
    const s = r.seats[q.seat];
    if (s.type === 'human') {
      const m = r.member(s.cid);
      if (m && m.connected) return humanMove(r, s.cid, now);
    }
    return r.aiStep(now + 60000);
  }

  test('ロビー：ホスト・人数設定・満員', () => {
    const r = room(2);
    eq(r.members.map((m) => m.name), ['ホスト', 'ゲスト1'], '入った順');
    ok(!r.configure('guest_00000001', { players: 5 }, T0).ok, 'ゲストは設定できない');
    ok(!r.configure('host_00000001', { players: 1 }, T0).ok, '3人未満は不可');
    ok(r.configure('host_00000001', { players: 5, aiLevel: 'easy' }, T0).ok, 'ホストは設定できる');
    eq(r.settings, { players: 5, aiLevel: 'easy' }, '設定');
    for (let i = 2; i < 6; i++) r.join('guest_0000000' + i, 'G' + i, T0);
    ok(!r.join('guest_00000009', 'あふれ', T0).ok, '7人目は入れない');
    r.leave('host_00000001', T0);
    ok(r.isHost('guest_00000001'), 'ホストが抜けたら次の人がホスト');
  });

  test('開始：人＋AIの席、他人の手札は伏せる', () => {
    const r = room(2);
    ok(r.start('host_00000001', RU.MINE, T0).ok, '開始');
    eq(r.seats.map((s) => s.type), ['human', 'human', 'ai', 'ai'], '4人（AI2体）');
    const v0 = r.viewFor('host_00000001', true), v1 = r.viewFor('guest_00000001', true);
    ok(v0.state.players[0].hand.every((id) => id !== '?'), '自分の手札は見える');
    ok(v0.state.players[1].hand.every((id) => id === '?'), 'ゲストの手札は伏せる');
    ok(v1.state.players[0].hand.every((id) => id === '?'), 'ホストの手札も伏せる');
    eq(v0.state.players[1].hand.length, r.S.players[1].hand.length, '枚数はわかる');
    ok(v0.events.some((e) => e.t === 'deal'), '配るイベント');
    const q = E.getRequest(r.S);
    ok((v0.request !== null) === (q.seat === 0), '要求は本人だけ');
  });

  test('1ゲームを最後まで（伏せた状態から出した手がすべて通る）', () => {
    const r = room(3);
    r.configure('host_00000001', { players: 5 }, T0);
    r.start('host_00000001', RU.MINE, T0);
    let steps = 0;
    while (r.S.phase !== 'over' && steps++ < 3000) if (!stepAll(r, T0 + steps * 1000)) break;
    eq(r.S.phase, 'over', '終了');
    ok(r.next('guest_00000002', T0).ok, '誰でも次のゲームへ');
    eq(r.S.gameNo, 2, '2ゲーム目');
    ok(!r.next('guest_00000002', T0).ok, 'ゲーム中は次へ進めない');
  });

  test('切断：15秒待ってからAIが代わりに進める', () => {
    const r = room(2);
    r.start('host_00000001', RU.MINE, T0);
    // ゲストの番になるまで進める
    let guard = 0;
    while (E.getRequest(r.S).seat !== 1 && guard++ < 500) stepAll(r, T0);
    if (E.getRequest(r.S).seat !== 1) { ok(true, '（ゲストの番が来なかった）'); return; }
    r.disconnect('guest_00000001', T0);
    ok(!r.member('guest_00000001').connected, '切断中');
    const d = r.nextAiDelay(T0);
    ok(d >= 14000 && d <= 15000, '約15秒待つ: ' + d);
    const rev = r.rev;
    ok(!r.aiStep(T0 + 5000), '5秒ではまだ動かない');
    eq(r.rev, rev, '変化なし');
    ok(r.aiStep(T0 + 16000), '16秒でAIが代わりに動く');
    r.join('guest_00000001', 'ゲスト1', T0 + 17000);
    ok(r.member('guest_00000001').connected, '戻ってきたら接続中');
    eq(r.seatOf('guest_00000001'), 1, '同じ席に戻る');
  });

  test('途中退出はAIが引き継ぎ、途中参加はAIの席に座る', () => {
    const r = room(2);
    r.start('host_00000001', RU.MINE, T0);
    const hand = r.S.players[1].hand.slice();
    r.leave('guest_00000001', T0);
    eq(r.seats[1].type, 'ai', '抜けた席はAI');
    eq(r.S.players[1].hand, hand, '手札はそのまま引き継ぐ');
    ok(r.join('late_000000001', 'あとから', T0).ok, '途中参加');
    const s = r.seatOf('late_000000001');
    ok(s >= 0 && r.seats[s].type === 'human', 'AIの席に座る');
    eq(r.S.players[s].name, 'あとから', '名前も変わる');
    let steps = 0;
    while (r.S.phase !== 'over' && steps++ < 3000) if (!stepAll(r, T0 + steps * 1000)) break;
    eq(r.S.phase, 'over', 'そのまま最後まで');
  });

  test('7渡し・交換のカードは当事者にだけ見える', () => {
    const evs = [{ t: 'give', from: 0, to: 1, cards: ['S3', 'H4'] }, { t: 'exchange', from: 2, to: 3, cards: ['D5'] }, { t: 'play', seat: 2, play: { cards: ['C7'] } }];
    eq(D.Online.filterEvents(evs, 0)[0].cards, ['S3', 'H4'], '渡した人');
    eq(D.Online.filterEvents(evs, 1)[0].cards, ['S3', 'H4'], 'もらった人');
    eq(D.Online.filterEvents(evs, 2)[0].cards, ['?', '?'], '関係ない人には伏せる');
    eq(D.Online.filterEvents(evs, 0)[1].cards, ['?'], '他人の交換も伏せる');
    eq(D.Online.filterEvents(evs, 0)[2].play.cards, ['C7'], '出したカードは全員に見える');
  });

  test('保存して読み込んでも続きから遊べる', () => {
    const r = room(2);
    r.start('host_00000001', RU.MINE, T0);
    for (let i = 0; i < 12; i++) stepAll(r, T0 + i * 1000);
    const copy = D.RoomCore.fromJSON(JSON.parse(JSON.stringify(r.toJSON())));
    eq(E.serialize(copy.S), E.serialize(r.S), '状態が同じ');
    let steps = 0;
    while (copy.S.phase !== 'over' && steps++ < 3000) if (!stepAll(copy, T0 + steps * 1000)) break;
    eq(copy.S.phase, 'over', '読み込んだ部屋で最後まで');
  });

  test('チャット：部屋の人だけ・長さと連投の制限・直近30件', () => {
    const r = room(2);
    const v = r.viewFor('host_00000001', false);
    ok(v.members.every((m) => m.pid && !('cid' in m)), '公開IDだけを見せる（再接続用IDは見せない）');
    ok(!r.chat('stranger_0001', 'やあ', T0).ok, '部屋にいない人は送れない');
    ok(!r.chat('host_00000001', '   ', T0).ok, '空は送れない');
    const long = r.chat('host_00000001', 'あ'.repeat(100), T0);
    eq(Array.from(long.item.text).length, 60, '60文字で切る');
    eq(long.item.pid, v.members[0].pid, '送った人の公開ID');
    let sent = 1;
    for (let i = 0; i < 10; i++) if (r.chat('host_00000001', 'れんとう' + i, T0 + i).ok) sent++;
    eq(sent, 6, '10秒に6通まで');
    ok(r.chat('host_00000001', 'また送れる', T0 + 11000).ok, '10秒たてば送れる');
    for (let i = 0; i < 40; i++) r.chat('guest_00000001', 'ゲスト' + i, T0 + 20000 + i * 2000);
    eq(r.chatLog.length, 30, '直近30件だけ残す');
    const copy = D.RoomCore.fromJSON(JSON.parse(JSON.stringify(r.toJSON())));
    eq(copy.chatLog.length, 30, '保存しても残る');
    ok(copy.chat('guest_00000001', 'つづき', T0 + 200000).item.id > r.chatLog[29].id, '番号は続きから');
    r.start('host_00000001', RU.MINE, T0 + 300000);
    const c = r.chat('guest_00000001', '対局中', T0 + 300001);
    eq(c.item.seat, 1, '対局中は席の番号つき');
  });

  test('いろいろなルールで20部屋×3ゲーム（エラーなし）', () => {
    const rng = D.Cards.mulberry32(777);
    let games = 0;
    for (let k = 0; k < 20; k++) {
      const rules = RU.defaults();
      for (const def of RU.RULES) {
        if (def.type === 'bool') rules[def.key] = rng() < 0.5;
        else rules[def.key] = def.options[Math.floor(rng() * def.options.length)].v;
      }
      const r = room(2 + Math.floor(rng() * 3));
      r.configure('host_00000001', { players: Math.max(r.members.length, 3 + Math.floor(rng() * 4)) }, T0);
      r.start('host_00000001', rules, T0);
      for (let g = 0; g < 3; g++) {
        let steps = 0;
        while (r.S.phase !== 'over' && steps++ < 4000) if (!stepAll(r, T0 + steps * 1000)) break;
        if (r.S.phase !== 'over') throw new Error('終わらない: ' + JSON.stringify(rules));
        games++;
        if (g < 2) r.next('host_00000001', T0);
      }
    }
    cur.msgs.push(games + 'ゲーム完走');
  });

  globalThis.ONLINE_TEST_DONE = { pass: lines.filter((l) => l.ok).length, total: lines.length, failed: lines.filter((l) => !l.ok).map((l) => l.name + ': ' + l.msgs.join(' | ')) };
})();
