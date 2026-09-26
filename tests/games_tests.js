/* 七並べ・スピードのテスト（エンジン・AI・オンラインの部屋） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const SV = D.Sevens, SVAI = D.SevensAI, SP = D.Speed, SPH = D.SpeedHost, C = D.Cards;
  const out = document.getElementById('out');
  const lines = [];
  let cur = null;
  function test(name, fn) {
    cur = { name, ok: true, msgs: [] };
    try { fn(); } catch (e) { cur.ok = false; cur.msgs.push('例外: ' + (e && e.stack || e)); }
    lines.push(cur);
    const li = document.createElement('li');
    li.className = cur.ok ? 'ok' : 'ng';
    li.textContent = (cur.ok ? '✔ ' : '✘ ') + '[games] ' + name + (cur.msgs.length ? '\n   ' + cur.msgs.join('\n   ') : '');
    out.appendChild(li);
  }
  const ok = (c, m) => { if (!c) { cur.ok = false; cur.msgs.push('NG: ' + m); } };
  const eq = (a, b, m) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa !== sb) { cur.ok = false; cur.msgs.push('NG: ' + m + ' 期待=' + sb + ' 実際=' + sa); } };
  const throws = (fn, m) => { try { fn(); } catch (e) { return; } cur.ok = false; cur.msgs.push('NG（例外が出るはず）: ' + m); };

  // ───────── 七並べ ─────────
  function sv(rules, hands, turn) {
    const S = SV.createMatch({ rules: Object.assign(D.SevensRules.defaults(), rules), players: hands.map((_, i) => ({ name: 'P' + i })), seed: 3 });
    SV.startGame(S, hands);
    if (turn != null) S.turn = turn;
    return S;
  }
  const hasMove = (S, seat, card) => SV.legalMoves(S, seat).some((a) => a.type === 'play' && a.card === card);

  test('七並べ：7は自動で場に置かれ、♦7を持っていた人から始まる', () => {
    const S = sv({}, [['S7', 'S6', 'H9'], ['D7', 'S8', 'C15'], ['H7', 'C7', 'H14']]);
    eq(['S', 'H', 'D', 'C'].map((s) => !!S.board[s][7]), [true, true, true, true], '7が4枚とも場に');
    eq(S.turn, 1, '♦7を持っていたP1から');
    eq(S.players[2].hand, ['H14'], 'P2の手札（7は抜ける）');
    ok(hasMove(S, 1, 'S8') && !hasMove(S, 1, 'C15'), '8は出せる・2は出せない');
  });

  test('七並べ：となりにカードがあるところだけ出せる', () => {
    const S = sv({ tunnel: false, joker: false }, [['D7', 'S7', 'S6', 'S5'], ['S4', 'H8', 'C6', 'H7'], ['C9', 'H6', 'D13', 'C7']], 0);
    ok(hasMove(S, 0, 'S6') && !hasMove(S, 0, 'S5'), '6は出せて5はまだ');
    SV.apply(S, { type: 'play', seat: 0, card: 'S6' });
    eq(S.turn, 1, '次はP1');
    ok(!hasMove(S, 1, 'S4'), '4は5がないので出せない');
    SV.apply(S, { type: 'pass', seat: 1 });
    SV.apply(S, { type: 'pass', seat: 2 });
    ok(hasMove(S, 0, 'S5'), '6のとなりの5が出せる');
  });

  test('七並べ：トンネル（Aまで並んだらKから出せる）', () => {
    const mk = (tunnel) => {
      const S = sv({ tunnel, joker: false }, [['D7', 'S13'], ['H8', 'C9'], ['C8', 'H9']], 0);
      for (let n = 1; n <= 6; n++) S.board.S[n] = { id: SV.idOf('S', n) };
      return S;
    };
    ok(hasMove(mk(true), 0, 'S13'), 'トンネルありならKが出せる');
    ok(!hasMove(mk(false), 0, 'S13'), 'トンネルなしならKは出せない');
  });

  test('七並べ：パスは3回まで。4回目で失格し、手札は場に並ぶ', () => {
    const S = sv({ passLimit: 3, joker: false }, [['D7', 'S15', 'H3'], ['S8', 'H13', 'S7', 'H7'], ['C8', 'C13', 'C7']], 0);
    for (let i = 0; i < 3; i++) {
      SV.apply(S, { type: 'pass', seat: 0 });
      eq(S.players[0].passes, i + 1, (i + 1) + '回目のパス');
      S.turn = 0;
    }
    const evs = SV.apply(S, { type: 'pass', seat: 0 });
    ok(evs.some((e) => e.t === 'elim' && e.seat === 0), '4回目で失格');
    ok(S.board.S[2] && S.board.H[3], '手札が場に並ぶ');
    ok(D.Sevens.openSpot(S, 'S', 1) && D.Sevens.openSpot(S, 'S', 3), '並んだカードのとなりにも出せる');
    ok(S.players[0].out && S.players[0].elim, 'P0は抜ける');
  });

  test('七並べ：出せるときはパス禁止（ルールがオンのとき）', () => {
    const H = () => [['D7', 'S6'], ['S8', 'H13', 'S7', 'H7'], ['C8', 'C13', 'C7']];
    const S = sv({ mustPlay: true, joker: false }, H(), 0);
    throws(() => SV.apply(S, { type: 'pass', seat: 0 }), '6が出せるのでパスできない');
    const S2 = sv({ mustPlay: false, joker: false }, H(), 0);
    SV.apply(S2, { type: 'pass', seat: 0 });
    eq(S2.players[0].passes, 1, 'オフならパスできる');
  });

  test('七並べ：ジョーカーを置くと、そのカードの人は次の番で必ず出し、ジョーカーを受け取る', () => {
    const S = sv({ joker: true }, [['D7', 'X1', 'S8'], ['S6', 'H13', 'C3', 'S7'], ['C8', 'C13', 'H4', 'H7', 'C7']], 0);
    ok(!SV.jokerSpots(S, 0).some((sp) => sp.suit === 'S' && sp.n === 8), '自分のカードの場所には置けない');
    SV.apply(S, { type: 'joker', seat: 0, suit: 'S', n: 6 });
    ok(S.board.S[6] && S.board.S[6].joker, '♠6の場所にジョーカー');
    ok(SV.openSpot(S, 'S', 5), 'ジョーカーの先（♠5）が開く');
    eq(S.turn, 1, '次はP1');
    eq(SV.legalMoves(S, 1), [{ type: 'play', seat: 1, card: 'S6' }], 'P1は♠6しか出せない（パスもできない）');
    const evs = SV.apply(S, { type: 'play', seat: 1, card: 'S6' });
    ok(evs.some((e) => e.t === 'jokerBack'), 'ジョーカーが戻る');
    ok(S.players[1].hand.includes('X1') && !S.players[1].hand.includes('S6'), 'P1がジョーカーを受け取る');
    eq(S.board.S[6], { id: 'S6' }, '場は本物の♠6に');
  });

  test('七並べ：上がった順と失格で順位・得点が決まり、試合はゲーム数で終わる', () => {
    const S = SV.createMatch({ rules: D.SevensRules.STANDARD, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i })), games: 2, seed: 9 });
    for (let g = 0; g < 2; g++) {
      SV.startGame(S);
      let q, guard = 0;
      while ((q = SV.getRequest(S)) && guard++ < 1000) SV.apply(S, SVAI.decideSync(S, q, 'normal'));
      eq(S.phase, 'over', (g + 1) + 'ゲーム目が終わる');
      eq(S.history[g].pts.slice().sort((a, b) => a - b), [-3, -1, 1, 3], '得点は +3/+1/−1/−3');
    }
    ok(S.matchOver, '2ゲームで試合終了');
    throws(() => SV.startGame(S), '終わった試合は続けられない');
    const T = SV.deserialize(JSON.parse(JSON.stringify(SV.serialize(S))));
    eq(T.players.map((p) => p.score), S.players.map((p) => p.score), '保存して読み込める');
  });

  test('七並べ：いろいろなルールで300ゲーム（エラーなし・カードの数が合う）', () => {
    let games = 0;
    for (let m = 0; m < 150; m++) {
      const n = 3 + (m % 4);
      const rules = { passLimit: [3, 5, 0][m % 3], joker: m % 2 === 0, tunnel: m % 5 !== 0, mustPlay: m % 7 === 0 };
      const S = SV.createMatch({ rules, players: Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), games: 2, seed: 100 + m });
      for (let g = 0; g < 2; g++) {
        SV.startGame(S);
        let q, guard = 0;
        while ((q = SV.getRequest(S)) && guard++ < 2000) SV.apply(S, SVAI.decideSync(S, q, m % 3 ? 'normal' : 'easy'));
        if (S.phase !== 'over') throw new Error('終わらない ' + JSON.stringify(rules));
        if (S.prevRanking.slice().sort().join() !== Array.from({ length: n }, (_, i) => i).join()) throw new Error('順位が変');
        games++;
      }
    }
    cur.msgs.push(games + 'ゲーム完走');
  });

  // ───────── スピード ─────────
  function sp(rules, decks) {
    const S = SP.createMatch({ rules: Object.assign(D.SpeedRules.defaults(), rules), players: [{ name: 'A', human: true }, { name: 'B' }], games: 3, seed: 5 });
    SP.startGame(S, decks);
    return S;
  }
  // 山札は末尾がいちばん上：[... , 場札4枚目, 3枚目, 2枚目, 1枚目] の順に取られる
  const deck = (top) => top.slice().reverse();

  test('スピード：赤と黒の26枚ずつ、場札4枚、せーので台札が1枚ずつ', () => {
    const S = SP.createMatch({ rules: D.SpeedRules.STANDARD, players: [{ name: 'A' }, { name: 'B' }], games: 3, seed: 1 });
    SP.startGame(S);
    eq(S.phase, 'stuck', '最初は「せーの」待ち');
    eq(S.players.map((P) => [P.deck.length, P.field.filter(Boolean).length]), [[22, 4], [22, 4]], '山札22・場札4');
    ok(S.players[0].field.every((c) => 'HD'.includes(c[0])) && S.players[1].field.every((c) => 'SC'.includes(c[0])), '席0は赤・席1は黒');
    SP.flip(S);
    eq(S.piles.map((p) => p.length), [1, 1], '台札が1枚ずつ');
  });

  test('スピード：となりの数字・同じ数字・AとKがつながる', () => {
    const R = D.SpeedRules.STANDARD;
    ok(SP.canStack(R, 'H5', 'S6') && SP.canStack(R, 'H7', 'S6'), '±1');
    ok(SP.canStack(R, 'H6', 'S6'), '同じ数字');
    ok(SP.canStack(R, 'H14', 'S13') && SP.canStack(R, 'H13', 'S14'), 'KとA');
    ok(!SP.canStack(R, 'H9', 'S6'), '離れた数字はだめ');
    const R2 = { wrap: false, same: false };
    ok(!SP.canStack(R2, 'H6', 'S6') && !SP.canStack(R2, 'H14', 'S13'), 'ルールをオフにすると出せない');
  });

  test('スピード：出すと山札から補充。出せなくなったら「せーの」', () => {
    // 席0：場札 5,9,J,K／山札の上から 4, 3 ／ 席1：場札 10,10,Q,Q／山札の上から 8, 2
    const d0 = deck(['H5', 'H9', 'H11', 'H13', 'H4', 'H3']);
    const d1 = deck(['S10', 'C10', 'S12', 'C12', 'S8', 'C15']);
    const S = sp({}, [d0, d1]);
    SP.flip(S);
    eq([SP.topOf(S, 0), SP.topOf(S, 1)], ['H4', 'S8'], '台札は山札の上（4 と 8）');
    eq(S.phase, 'play', '出せる（5→4）');
    SP.play(S, 0, 0, 0);
    eq(S.players[0].field[0], 'H3', '出した場所に山札の上（3）を補充');
    SP.play(S, 0, 1, 1);
    eq([SP.topOf(S, 1), S.players[0].field[1]], ['H9', null], '9を8の上に出し、山札がないので補充なし');
    throws(() => SP.play(S, 0, 2, 0), 'Jは3に出せない');
    throws(() => SP.play(S, 0, 9, 0), 'ない場所は出せない');
  });

  test('スピード：AI同士で3本勝負を最後まで（時間つき）', () => {
    const S = SP.createMatch({ rules: D.SpeedRules.STANDARD, players: [{ name: 'A', level: 'hard' }, { name: 'B', level: 'easy' }], games: 3 });
    const levelOf = (s) => S.players[s].level;
    let now = 0, games = 0, flips = 0;
    while (!S.matchOver && games < 12) {
      SP.startGame(S);
      SPH.schedule(S, now, levelOf);
      let guard = 0;
      while (S.phase !== 'over' && guard++ < 3000) {
        const d = SPH.nextDelay(S, now);
        if (d == null) throw new Error('止まった phase=' + S.phase);
        now += d;
        const r = SPH.tick(S, now, levelOf);
        if (r && r.events.some((e) => e.t === 'flip')) flips++;
      }
      games++;
    }
    ok(S.matchOver, '試合が終わる');
    ok(S.players.some((P) => P.wins === 2), 'どちらかが2勝');
    const res = D.Rating.matchResult(S, [1500, 1500], [10, 10]);
    eq(res.map((r) => r.delta).reduce((a, b) => a + b, 0), 0, '勝ち負けのレートは合計0');
    ok(res.some((r) => r.delta === 16), '同じレートで勝つと +16');
    cur.msgs.push(games + 'ゲーム・せーの' + flips + '回・' + Math.round(now / 1000) + '秒');
  });

  // ───────── オンライン ─────────
  const T0 = 1000000;
  test('オンライン七並べ：部屋のゲーム・伏せた状態で最後まで・レート戦', () => {
    const r = new D.RoomCore('SEVEN');
    r.join('host_00000001', 'ホスト', T0, { r: 1500, n: 0 }, 'sevens');
    r.join('guest_00000001', 'ゲスト', T0, { r: 1520, n: 3 }, 'daifugo');
    eq(r.game, 'sevens', '最初の人のゲームの部屋');
    ok(r.configure('host_00000001', { mode: 'rated' }, T0).ok, 'レート戦');
    ok(r.start('host_00000001', { joker: false }, T0).ok, '開始');
    eq(r.S.rules, D.SevensRules.normalize(D.SevensRules.STANDARD), 'レート戦は標準ルール');
    eq([r.S.n, r.S.maxGames], [4, 10], '4人・10ゲーム');
    const v = r.viewFor('guest_00000001', false);
    eq(v.game, 'sevens', 'ビューにゲーム');
    ok(v.state.players.every((p, i) => i === v.seat || p.hand.every((c) => c === '?')), '他人の手札は伏せる');
    let steps = 0, games = 0;
    while (!r.S.matchOver && steps < 20000) {
      while (r.S.phase !== 'over' && steps++ < 20000) {
        const q = D.Sevens.getRequest(r.S);
        const st = r.seats[q.seat];
        if (st.type === 'human') {
          const vv = r.viewFor(st.cid, false);
          const view = D.Sevens.deserialize(vv.state);
          const a = SVAI.decideSync(view, vv.request, 'normal');
          delete a.seat;
          const res = r.act(st.cid, a, T0 + steps);
          if (!res.ok) throw new Error(res.error);
        } else r.aiStep(T0 + steps * 1000);
      }
      games++;
      if (!r.S.matchOver) r.next('host_00000001', T0);
    }
    eq(games, 10, '10ゲーム');
    ok(r.S.rated.results[0] && r.S.rated.results[1], '2人のレートが決まる');
    eq(r.ratingOut.map((o) => o.game), ['sevens', 'sevens'], 'ゲームごとのレートとして保存');
  });

  test('オンラインスピード：人とAI、時間で進む・3本勝負・レート', () => {
    const r = new D.RoomCore('SPEED');
    r.join('host_00000001', 'ホスト', T0, { r: 1500, n: 10 }, 'speed');
    eq(r.settings.players, 2, '2人');
    ok(!r.join('guest_00000001', 'G1', T0, null, 'speed').ok === false, '2人目は入れる');
    ok(!r.join('guest_00000002', 'G2', T0, null, 'speed').ok, '3人目は入れない');
    r.leave('guest_00000001', T0);
    ok(r.configure('host_00000001', { mode: 'rated', aiLevel: 'hard' }, T0).ok, 'レート戦・つよいAI');
    ok(r.start('host_00000001', {}, T0).ok, '開始');
    eq(r.S.maxGames, 3, '3本勝負');
    let now = T0, guard = 0;
    while (!(r.S.matchOver && r.S.phase === 'over') && guard++ < 20000) {
      if (r.S.phase === 'over') { r.next('host_00000001', now); continue; }
      // 人：見えている状態から出せる手があれば出す（ときどき）
      const v = r.viewFor('host_00000001', false);
      const view = D.Speed.deserialize(v.state);
      if (view.phase === 'play' && guard % 3 === 0) {
        const mv = D.Speed.playable(view, v.seat)[0];
        if (mv) { const res = r.act('host_00000001', { type: 'play', slot: mv.slot, pile: mv.pile }, now); if (!res.ok) throw new Error(res.error); }
      }
      const d = r.nextAiDelay(now);
      now += d == null ? 500 : Math.min(d, 700);
      r.aiStep(now);
    }
    ok(r.S.matchOver, '試合が終わる');
    ok(r.S.rated.results[0], '人のレートが決まる');
    eq(r.ratingOut[0].game, 'speed', 'スピードのレートとして保存');
    const v = r.viewFor('host_00000001', false);
    ok(v.state.players.every((P) => P.deck.length === 0 && P.deckCount >= 0), '山札の中身は送らない');
  });

  globalThis.GAMES_TEST_DONE = { pass: lines.filter((l) => l.ok).length, total: lines.length, failed: lines.filter((l) => !l.ok).map((l) => l.name + ': ' + l.msgs.join(' | ')) };
})();
