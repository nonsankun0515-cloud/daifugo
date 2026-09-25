/* 大富豪 — エンジンのテスト（ブラウザで tests/test.html を開くと実行） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const E = D.Engine, C = D.Cards, RU = D.Rules;
  const results = [];
  let current = null;

  function test(name, fn) {
    current = { name, ok: true, msgs: [] };
    try { fn(); } catch (e) { current.ok = false; current.msgs.push('例外: ' + (e && e.stack || e)); }
    results.push(current);
  }
  function ok(cond, msg) { if (!cond) { current.ok = false; current.msgs.push('NG: ' + msg); } }
  function eq(a, b, msg) {
    const sa = JSON.stringify(a), sb = JSON.stringify(b);
    if (sa !== sb) { current.ok = false; current.msgs.push('NG: ' + msg + ' 期待=' + sb + ' 実際=' + sa); }
  }
  function throws(fn, msg) {
    try { fn(); } catch (e) { return; }
    current.ok = false; current.msgs.push('NG（例外が出るはず）: ' + msg);
  }

  // 全ルールOFF（階段だけON）＋指定ルール
  function rulesWith(over) {
    const r = RU.defaults();
    for (const def of RU.RULES) if (def.type === 'bool') r[def.key] = false;
    r.sequence = true;
    r.jokers = 2;
    return Object.assign(r, over || {});
  }
  // 手札を指定して対局途中の状態を作る
  function mk(over, hands, turn) {
    const S = E.createMatch({ rules: rulesWith(over), players: hands.map((_, i) => ({ name: 'P' + i })), seed: 7 });
    S.gameNo = 1;
    S.phase = 'play';
    hands.forEach((h, i) => { S.players[i].hand = h.slice(); });
    S.turn = turn || 0;
    return S;
  }
  function play(S, seat, cards, pick) {
    const ps = E.playsForCards(S, seat, cards);
    const p = pick ? ps.find(pick) : ps[0];
    if (!p) throw new Error('出せない: P' + seat + ' ' + cards.join(',') + ' / ' + E.explainIllegal(S, seat, cards));
    return E.apply(S, { type: 'play', seat, play: p });
  }
  const pass = (S, seat) => E.apply(S, { type: 'pass', seat });
  const can = (S, seat, cards) => E.playsForCards(S, seat, cards).length > 0;
  const req = (S) => E.getRequest(S);
  const types = (evs) => evs.map((e) => e.t);

  // ───────── 基本 ─────────
  test('強い1枚を出せる・弱いと出せない', () => {
    const S = mk({}, [['S5', 'H9'], ['D4', 'C7', 'S10'], ['H3', 'D12']]);
    play(S, 0, ['S5']);
    ok(!can(S, 1, ['D4']), '4は5に出せない');
    ok(can(S, 1, ['C7']), '7は5に出せる');
    eq(req(S), { kind: 'turn', seat: 1 }, '次はP1');
  });

  test('全員パスで場が流れ、最後に出した人が親', () => {
    const S = mk({}, [['S5', 'H9'], ['D4', 'C7'], ['H3', 'D6']]);
    play(S, 0, ['S5']);
    pass(S, 1);
    const ev = pass(S, 2);
    ok(types(ev).includes('flow'), '流れる');
    eq(S.pile.length, 0, '場が空');
    eq(S.turn, 0, 'P0が親');
  });

  test('親はパスできない', () => {
    const S = mk({}, [['S5'], ['D4'], ['H3']]);
    throws(() => pass(S, 0), '親のパス');
  });

  test('上がった人の次の人から（全員パス）', () => {
    const S = mk({}, [['S13'], ['D4', 'C7'], ['H3', 'D6'], ['C5', 'S6']]);
    play(S, 0, ['S13']);
    ok(S.players[0].out, 'P0上がり');
    pass(S, 1); pass(S, 2); pass(S, 3);
    eq(S.turn, 1, 'P1が親');
  });

  test('ペア・階段・ジョーカー', () => {
    const S = mk({}, [['S5', 'H5', 'D9'], ['C7', 'D7', 'X1', 'S3'], ['H6', 'H7', 'H8', 'C3']]);
    play(S, 0, ['S5', 'H5']);
    ok(can(S, 1, ['C7', 'D7']), '7ペア');
    ok(can(S, 1, ['C7', 'X1']), '7+ジョーカーでペア');
    ok(!can(S, 1, ['C7']), '1枚は不可');
    const S2 = mk({}, [['S4', 'S5', 'S6', 'D9'], ['H6', 'H7', 'H8', 'C3'], ['C9', 'C10', 'X1', 'D3']]);
    play(S2, 0, ['S4', 'S5', 'S6']);
    ok(can(S2, 1, ['H6', 'H7', 'H8']), '階段 6-8');
    const opts = E.playsForCards(S2, 2, ['C9', 'C10', 'X1']);
    eq(opts.length, 2, 'ジョーカー入り階段は 8-10 と 9-J の2通り');
  });

  test('階段の比較：一番弱いカード / 全部', () => {
    const S = mk({}, [['S4', 'S5', 'S6', 'D9'], ['H5', 'H6', 'H7', 'C3'], ['C7', 'C8', 'C9', 'D3']]);
    play(S, 0, ['S4', 'S5', 'S6']);
    ok(can(S, 1, ['H5', 'H6', 'H7']), 'lowest: 5-7 は 4-6 に出せる');
    const S2 = mk({ seqCompare: 'all' }, [['S4', 'S5', 'S6', 'D9'], ['H5', 'H6', 'H7', 'C3'], ['C7', 'C8', 'C9', 'D3']]);
    play(S2, 0, ['S4', 'S5', 'S6']);
    ok(!can(S2, 1, ['H5', 'H6', 'H7']), 'all: 5-7 は不可');
    ok(can(S2, 2, ['C7', 'C8', 'C9']), 'all: 7-9 は可');
  });

  // ───────── 革命・逆転 ─────────
  test('革命で強さが逆転', () => {
    const S = mk({ revolution: true }, [['S5', 'H5', 'D5', 'C5', 'S9'], ['C3', 'D15', 'H4'], ['H3', 'D6']]);
    const ev = play(S, 0, ['S5', 'H5', 'D5', 'C5']);
    ok(types(ev).includes('revolution'), '革命イベント');
    ok(S.revolution, '革命中');
    pass(S, 1); pass(S, 2);
    play(S, 0, ['S9']);
    ok(can(S, 1, ['C3']), '革命中は3が9より強い');
    ok(!can(S, 1, ['D15']), '革命中は2は弱い');
  });

  test('Jバック：場が流れるまで逆転', () => {
    const S = mk({ jBack: true }, [['S11', 'H9'], ['C10', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S11']);
    ok(S.jback, 'Jバック中');
    ok(can(S, 1, ['C10']), '10をJに出せる');
    ok(!can(S, 1, ['D12']), 'Qは出せない');
    pass(S, 1); pass(S, 2);
    ok(!S.jback, '流れて解除');
  });

  test('クーデター・オーメン・大革命', () => {
    const S = mk({ coup: true }, [['S9', 'H9', 'D9', 'C4'], ['C3'], ['H3']]);
    play(S, 0, ['S9', 'H9', 'D9']);
    ok(S.revolution, 'クーデターで革命');
    const S2 = mk({ omen: true, revolution: true }, [['S6', 'H6', 'D6', 'C4', 'H4', 'D4', 'S4'], ['C3', 'C9'], ['H3', 'H9']]);
    play(S2, 0, ['S6', 'H6', 'D6']);
    ok(S2.revolution && S2.revoLocked, 'オーメンで革命＋ロック');
    pass(S2, 1); pass(S2, 2);
    play(S2, 0, ['C4', 'H4', 'D4', 'S4']);
    ok(S2.revolution, 'オーメン後は革命が起きない');
    const S3 = mk({ greatRevolution: true, revolution: true }, [['S15', 'H15', 'D15', 'C15', 'S5', 'S6'], ['C3', 'C9'], ['H3', 'H9']]);
    play(S3, 0, ['S15', 'H15', 'D15', 'C15']);
    ok(S3.players[0].out && S3.finished[0] === 0, '大革命で即上がり（反則にならない）');
  });

  // ───────── 場を流す・止める ─────────
  test('8切り：何枚でも流れて同じ人が親', () => {
    const S = mk({ eightCut: true }, [['S8', 'H8', 'D9', 'C5'], ['C10', 'D12'], ['H3', 'D6']]);
    const ev = play(S, 0, ['S8', 'H8']);
    ok(types(ev).includes('cut'), '8切り');
    eq(S.pile.length, 0, '流れた');
    eq(S.turn, 0, 'P0が続ける');
  });

  test('4止め：1枚の8切りを44で止めて親に', () => {
    const S = mk({ eightCut: true, fourStop: true }, [['S8', 'D9'], ['C10', 'D12'], ['H4', 'D4', 'D6']]);
    play(S, 0, ['S8']);
    const r = req(S);
    eq([r.kind, r.seat], ['stop', 2], 'P2に止めるか確認');
    const ev = E.apply(S, { type: 'stop', seat: 2, kind: 'four' });
    ok(types(ev).includes('stop'), '止めた');
    eq(S.pile.length, 0, '流れた');
    eq(S.turn, 2, 'P2が親');
    eq(S.players[2].hand, ['D6'], '4が2枚減った');
  });

  test('4止め：止めないと通常の8切り', () => {
    const S = mk({ eightCut: true, fourStop: true }, [['S8', 'D9'], ['C10', 'D12'], ['H4', 'D4', 'D6']]);
    play(S, 0, ['S8']);
    E.apply(S, { type: 'nostop', seat: 2 });
    eq(S.turn, 0, 'P0が親');
    eq(S.pile.length, 0, '流れた');
  });

  test('4止め：2枚の8切りは止められない（1枚出しだけ）', () => {
    const S = mk({ eightCut: true, fourStop: true, stopScope: 'single' }, [['S8', 'H8', 'D9'], ['C10', 'D12'], ['H4', 'D4', 'D6']]);
    play(S, 0, ['S8', 'H8']);
    eq(req(S).kind, 'turn', '止め確認なし');
    eq(S.turn, 0, 'P0が親');
    const S2 = mk({ eightCut: true, fourStop: true, stopScope: 'any' }, [['S8', 'H8', 'D9'], ['C10', 'D12'], ['H4', 'D4', 'D6']]);
    play(S2, 0, ['S8', 'H8']);
    eq(req(S2).kind, 'stop', '何枚でも設定なら止められる');
  });

  test('3止め：飛ばされた人が33で止める（5スキップ・13スキップ）', () => {
    const S = mk({ fiveSkip: true, threeStop: true }, [['S5', 'D9'], ['H3', 'D3', 'D6'], ['C10', 'D12'], ['C9', 'C11']]);
    play(S, 0, ['S5']);
    eq([req(S).kind, req(S).seat], ['stop', 1], '飛ばされるP1に確認');
    E.apply(S, { type: 'stop', seat: 1, kind: 'three' });
    eq(S.turn, 1, 'P1が親');
    eq(S.pile.length, 0, '流れた');
    const S2 = mk({ kingSkip: true, threeStop: true }, [['S13', 'D9'], ['H3', 'D3', 'D6'], ['C10', 'D12'], ['C9', 'C11']]);
    play(S2, 0, ['S13']);
    eq(req(S2).kind, 'stop', '13スキップも止められる');
  });

  test('3止め：飛ばされていない人は止められない', () => {
    const S = mk({ fiveSkip: true, threeStop: true }, [['S5', 'D9'], ['C10', 'D12'], ['H3', 'D3', 'D6'], ['C9', 'C11']]);
    play(S, 0, ['S5']);
    eq(req(S), { kind: 'turn', seat: 2 }, 'P2は飛ばされていないので確認なしでP2の番');
    const S2 = mk({ fiveSkip: true, threeStop: true, stopScope: 'any' }, [['S5', 'H5', 'D9'], ['C10', 'D12'], ['H3', 'D3', 'D6'], ['C9', 'C11'], ['C4', 'C6']]);
    play(S2, 0, ['S5', 'H5']);
    eq([req(S2).kind, req(S2).seat], ['stop', 2], '2人スキップなら2人目のP2も止められる（何枚出しでも設定）');
    const S3 = mk({ fiveSkip: true, threeStop: true, stopScope: 'single' }, [['S5', 'H5', 'D9'], ['C10', 'D12'], ['H3', 'D3', 'D6'], ['C9', 'C11'], ['C4', 'C6']]);
    play(S3, 0, ['S5', 'H5']);
    eq(req(S3).kind, 'turn', '1枚出しだけの設定なら2枚の5スキップは止められない');
  });

  test('砂嵐：スキップを止められるのは飛ばされた人だけ（8切りは誰でも）', () => {
    const S = mk({ fiveSkip: true, sandstorm: true }, [['S5', 'D9'], ['C10', 'D12'], ['H3', 'D3', 'C3', 'D6'], ['C9', 'C11']]);
    play(S, 0, ['S5']);
    eq(req(S).kind, 'turn', '飛ばされていないP2は砂嵐で止められない');
    const S2 = mk({ eightCut: true, sandstorm: true }, [['S8', 'D9'], ['C10', 'D12'], ['H3', 'D3', 'C3', 'D6'], ['C9', 'C11']]);
    play(S2, 0, ['S8']);
    eq([req(S2).kind, req(S2).seat], ['stop', 2], '8切りは誰でも砂嵐で止められる');
  });

  test('砂嵐：どんな場にも出せて流れる', () => {
    const S = mk({ sandstorm: true }, [['S15', 'D9'], ['C3', 'D3', 'H3', 'C9'], ['H4', 'D6']]);
    play(S, 0, ['S15']);
    ok(can(S, 1, ['C3', 'D3', 'H3']), '2の1枚に砂嵐');
    const ev = play(S, 1, ['C3', 'D3', 'H3']);
    ok(types(ev).includes('sand'), '砂嵐イベント');
    eq(S.pile.length, 0, '流れた');
    eq(S.turn, 1, 'P1が親');
    const S2 = mk({ sandstorm: true, suitLock: true }, [['S4', 'S5', 'S6', 'D9'], ['C3', 'D3', 'X1', 'C9'], ['H4', 'D6']]);
    play(S2, 0, ['S4', 'S5', 'S6']);
    ok(can(S2, 1, ['C3', 'D3', 'X1']), '階段にもジョーカー入り砂嵐');
  });

  test('ろくろ首：66で流れ、止められるのは砂嵐だけ', () => {
    const S = mk({ rokurokubi: true, fourStop: true, threeStop: true, sandstorm: true, eightCut: true },
      [['S6', 'H6', 'D9'], ['C4', 'D4', 'C9'], ['H3', 'D3', 'C3', 'D10']]);
    play(S, 0, ['S6', 'H6']);
    const r = req(S);
    eq([r.kind, r.seat], ['stop', 2], '44のP1は飛ばされ、砂嵐のP2に確認');
    eq(E.stopOptions(S, 2).map((o) => o.kind), ['sand'], '選べるのは砂嵐だけ');
    E.apply(S, { type: 'stop', seat: 2, kind: 'sand' });
    eq(S.turn, 2, 'P2が親');
  });

  test('マイルール：救急車がオン、古い保存設定も更新される', () => {
    ok(RU.MINE.kyukyusha, 'マイルールに救急車');
    const old = Object.assign({}, RU.MINE, { kyukyusha: false });
    eq(RU.migrate(old), RU.MINE, '古いマイルール → 今のマイルール');
    const custom = Object.assign({}, RU.MINE, { kyukyusha: false, jokers: 2 });
    eq(RU.migrate(custom).kyukyusha, false, '自分で変えた設定はそのまま');
  });

  test('救急車：99は砂嵐でしか止められない', () => {
    const S = mk({ kyukyusha: true, fourStop: true, threeStop: true, sandstorm: true, eightCut: true, fiveSkip: true },
      [['S9', 'H9', 'D5'], ['C4', 'D4', 'C3', 'H3'], ['S3', 'D3', 'X1', 'D10']]);
    play(S, 0, ['S9', 'H9']);
    eq([req(S).kind, req(S).seat], ['stop', 2], '44・33のP1は止められず、砂嵐のP2に確認');
    eq(E.stopOptions(S, 2).map((o) => o.kind), ['sand'], '砂嵐だけ');
    E.apply(S, { type: 'nostop', seat: 2 });
    eq(S.turn, 0, '止めなければ出した人が親');
    eq(S.pile.length, 0, '流れた');
  });

  test('救急車：99で流れる', () => {
    const S = mk({ kyukyusha: true }, [['S9', 'H9', 'D5'], ['C4', 'C10'], ['H3', 'D10']]);
    const ev = play(S, 0, ['S9', 'H9']);
    ok(types(ev).includes('cut'), '流れた');
    eq(S.turn, 0, 'P0が親');
  });

  test('スペ3返し', () => {
    const S = mk({ spade3: true }, [['X1', 'D9'], ['C3', 'S3', 'C10'], ['H3', 'D10']]);
    play(S, 0, ['X1']);
    ok(!can(S, 1, ['C3']), '♣3は出せない');
    ok(can(S, 1, ['S3']), '♠3は出せる');
    const ev = play(S, 1, ['S3']);
    ok(types(ev).includes('spade3'), 'スペ3返し');
    eq(S.turn, 1, 'P1が親');
  });

  test('ラッキーセブン', () => {
    const S = mk({ luckySeven: true }, [['S7', 'H7', 'D7', 'D5', 'D9'], ['C4', 'C10'], ['H3', 'D10']]);
    play(S, 0, ['S7', 'H7', 'D7']);
    pass(S, 1);
    const ev = pass(S, 2);
    ok(types(ev).includes('lucky'), 'ラッキーセブン');
    ok(S.players[0].out && S.finished[0] === 0, '上がり');
  });

  // ───────── 数字の効果 ─────────
  test('5スキップ：枚数ぶん飛ばす', () => {
    const S = mk({ fiveSkip: true }, [['S5', 'D9'], ['C10', 'D12'], ['H3', 'D6'], ['C9', 'C11']]);
    const ev = play(S, 0, ['S5']);
    eq(ev.find((e) => e.t === 'skip').seats, [1], 'P1を飛ばす');
    eq(S.turn, 2, 'P2の番');
    const S2 = mk({ fiveSkip: true }, [['S5', 'H5', 'D9'], ['C10', 'D12'], ['H3', 'D6'], ['C9', 'C11'], ['D3', 'D4']]);
    play(S2, 0, ['S5', 'H5']);
    eq(S2.turn, 3, '2枚なら2人飛ばしてP3');
    const S3 = mk({ fiveSkip: true }, [['S5', 'H5', 'D5', 'D9'], ['C10', 'D12'], ['H3', 'D6'], ['C9', 'C11']]);
    const ev3 = play(S3, 0, ['S5', 'H5', 'D5']);
    ok(types(ev3).includes('flow'), '全員飛ばすと流れる');
    eq(S3.turn, 0, 'P0が親');
  });

  test('7渡し：次の人に渡す', () => {
    const S = mk({ sevenPass: true }, [['S7', 'H7', 'D3', 'D4', 'D9'], ['C10', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S7', 'H7']);
    const r = req(S);
    eq([r.kind, r.seat, r.to, r.count], ['give', 0, 1, 2], '2枚まで渡せる');
    E.apply(S, { type: 'give', seat: 0, cards: ['D3', 'D4'] });
    eq(S.players[0].hand, ['D9'], '渡した');
    ok(S.players[1].hand.includes('D3') && S.players[1].hand.includes('D4'), 'P1が受け取った');
    eq(S.turn, 1, 'P1の番');
  });

  test('7渡しで手札がなくなると上がり', () => {
    const S = mk({ sevenPass: true }, [['S7', 'D3'], ['C10', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S7']);
    E.apply(S, { type: 'give', seat: 0, cards: ['D3'] });
    ok(S.players[0].out && S.finished[0] === 0, '上がり');
  });

  test('9戻し：前の人に渡す', () => {
    const S = mk({ nineBack: true }, [['S9', 'D3', 'D4'], ['C10', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S9']);
    const r = req(S);
    eq([r.kind, r.to], ['give', 2], '前の人（P2）');
  });

  test('10捨て', () => {
    const S = mk({ tenDiscard: true }, [['S10', 'D3', 'D4'], ['C11', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S10']);
    eq(req(S).kind, 'discard', '捨てる確認');
    E.apply(S, { type: 'discard', seat: 0, cards: ['D3'] });
    eq(S.players[0].hand, ['D4'], '1枚捨てた');
    ok(S.discard.includes('D3'), '捨て札に');
  });

  test('12ボンバー：全員が指名数字を捨てる', () => {
    const S = mk({ queenBomber: true }, [['S12', 'D5', 'D9'], ['C5', 'H5', 'D13'], ['H9', 'D6']]);
    play(S, 0, ['S12']);
    eq([req(S).kind, req(S).ranks, req(S).count], ['bomb', [5, 9], 1], '手札にある5と9から1つ指名');
    const ev = E.apply(S, { type: 'bomb', seat: 0, ranks: [5] });
    const b = ev.find((e) => e.t === 'bomb');
    eq(b.removed, { 0: ['D5'], 1: ['C5', 'H5'] }, '5が消えた');
    eq(S.players[1].hand, ['D13'], 'P1の残り');
  });

  test('12ボンバー：手札にない数字は指名できない', () => {
    const S = mk({ queenBomber: true }, [['S12', 'D5', 'D9'], ['C5', 'H13', 'D13'], ['H9', 'D6']]);
    play(S, 0, ['S12']);
    throws(() => E.apply(S, { type: 'bomb', seat: 0, ranks: [13] }), '手札にないKは指名できない');
    E.apply(S, { type: 'bomb', seat: 0, ranks: [] });
    eq(S.turn, 1, '指名しないこともできる');
  });

  test('12ボンバー：最後の1枚がQなら不発', () => {
    const S = mk({ queenBomber: true }, [['S12'], ['C5', 'H13'], ['H9', 'D6'], ['C4', 'C6']]);
    const ev = play(S, 0, ['S12']);
    ok(ev.some((e) => e.t === 'bomb' && e.none), '指名できる数字がない');
    eq(req(S), { kind: 'turn', seat: 1 }, 'そのまま次の人');
  });

  test('12ボンバーで全部なくなった人は上がり（反則なし）', () => {
    const S = mk({ queenBomber: true, forbidTwo: true }, [['S12', 'D5', 'D9'], ['C15', 'H15', 'D13'], ['H9', 'D6']]);
    play(S, 0, ['S12']);
    E.apply(S, { type: 'bomb', seat: 0, ranks: [9] });
    eq(S.players[2].hand, ['D6'], 'P2の9が消えた');
    const S2 = mk({ queenBomber: true }, [['S12', 'H12', 'D5', 'S15'], ['C15', 'H15'], ['H9', 'D6']]);
    play(S2, 0, ['S12', 'H12']);
    E.apply(S2, { type: 'bomb', seat: 0, ranks: [15, 5] });
    ok(S2.players[0].out && S2.players[1].out, 'P0とP1が上がり');
    eq(S2.finished.slice(0, 2), [0, 1], '出した人が先');
  });

  test('A拾い：1つ前のカードを手札に', () => {
    const S = mk({ aceTake: true }, [['S13', 'D9'], ['C14', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S13']);
    play(S, 1, ['C14']);
    const r = req(S);
    eq([r.kind, r.cards], ['pickup', ['S13']], 'Kを拾える');
    E.apply(S, { type: 'pickup', seat: 1, cards: ['S13'] });
    ok(S.players[1].hand.includes('S13'), '拾った');
    eq(S.pile[0].shown, [], '場から消えた');
  });

  test('6→9：6の次は9だけ（強さ無関係・革命中も）', () => {
    const S = mk({ sixNine: true }, [['S6', 'D5'], ['C9', 'D12', 'X1'], ['H3', 'D6']]);
    play(S, 0, ['S6']);
    ok(can(S, 1, ['C9']), '9は出せる');
    ok(!can(S, 1, ['D12']), 'Qは出せない');
    const jk = E.playsForCards(S, 1, ['X1']);
    eq(jk.map((p) => [p.rank, !!p.declared]), [[9, true]], 'ジョーカーは9としてだけ出せる');
  });

  test('9→6：9の次は6だけ', () => {
    const S = mk({ nineSix: true }, [['S9', 'D5'], ['C6', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S9']);
    ok(can(S, 1, ['C6']), '6を9に出せる');
    ok(!can(S, 1, ['D12']), 'Qは出せない');
  });

  test('9リバース', () => {
    const S = mk({ nineReverse: true }, [['S9', 'D5'], ['C10', 'D12'], ['H3', 'D6'], ['C11', 'C12']]);
    play(S, 0, ['S9']);
    eq(S.dir, -1, '逆回り');
    eq(S.turn, 3, 'P3の番');
  });

  test('ダウンナンバー', () => {
    const S = mk({ downNumber: true }, [['S9', 'D5'], ['S8', 'H8', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['S9']);
    ok(can(S, 1, ['S8']), '♠8を♠9に');
    ok(!can(S, 1, ['H8']), '♥8は不可');
  });

  test('階段の効果：8切りだけ', () => {
    const S = mk({ eightCut: true, fiveSkip: true, seqEffects: 'eight' }, [['S6', 'S7', 'S8', 'D5'], ['C10', 'D12'], ['H3', 'D6']]);
    const ev = play(S, 0, ['S6', 'S7', 'S8']);
    ok(types(ev).includes('cut'), '階段の8で8切り');
    const S2 = mk({ eightCut: true, fiveSkip: true, seqEffects: 'eight' }, [['S4', 'S5', 'S6', 'D5'], ['C10', 'D12'], ['H3', 'D6']]);
    const ev2 = play(S2, 0, ['S4', 'S5', 'S6']);
    ok(!types(ev2).includes('skip'), '階段の5ではスキップしない');
  });

  // ───────── しばり（あなたの例） ─────────
  test('階段縛り：5♠→6♥ なら次は7（マーク自由）', () => {
    const S = mk({ numberLock: true, suitLock: true, gekiLock: true, partialLock: true },
      [['S5', 'D9'], ['H6', 'D12'], ['D7', 'S8', 'H7', 'X1']]);
    play(S, 0, ['S5']);
    play(S, 1, ['H6']);
    ok(S.lock.number && !S.lock.suits, '数字だけ縛り');
    ok(can(S, 2, ['D7']), '♦7');
    ok(can(S, 2, ['H7']), '♥7');
    ok(!can(S, 2, ['S8']), '8は不可');
    const jk = E.playsForCards(S, 2, ['X1']);
    eq(jk.map((p) => p.rank), [7], 'ジョーカーは7として');
  });

  test('激縛り：5♠→6♠ なら次は7♠だけ', () => {
    const S = mk({ numberLock: true, suitLock: true, gekiLock: true, partialLock: true },
      [['S5', 'D9'], ['S6', 'D12'], ['S7', 'H7', 'S8']]);
    play(S, 0, ['S5']);
    play(S, 1, ['S6']);
    ok(S.lock.number && S.lock.suits, '激縛り');
    ok(can(S, 2, ['S7']), '♠7');
    ok(!can(S, 2, ['H7']), '♥7は不可');
    ok(!can(S, 2, ['S8']), '♠8は不可');
  });

  test('スート縛り（ペア）：5♠5♣→7♠7♣ なら次は♠♣のペア', () => {
    const S = mk({ numberLock: true, suitLock: true, gekiLock: true, partialLock: true },
      [['S5', 'C5', 'D9'], ['S7', 'C7', 'D12'], ['S8', 'C8', 'H8', 'D8', 'S9', 'C9']]);
    play(S, 0, ['S5', 'C5']);
    play(S, 1, ['S7', 'C7']);
    eq(S.lock.suits, ['S', 'C'], '♠♣縛り');
    ok(!S.lock.number, '数字は縛られない（5→7）');
    ok(can(S, 2, ['S8', 'C8']), '8♠8♣');
    ok(!can(S, 2, ['H8', 'D8']), '8♥8♦は不可');
    ok(can(S, 2, ['S9', 'C9']), '9♠9♣');
  });

  test('激縛り（ペア）：Q♥Q♦→K♥K♦ なら次はA♥A♦だけ', () => {
    const S = mk({ numberLock: true, suitLock: true, gekiLock: true, partialLock: true },
      [['H12', 'D12', 'C3'], ['H13', 'D13', 'C4'], ['H14', 'D14', 'S14', 'H15', 'D15']]);
    play(S, 0, ['H12', 'D12']);
    play(S, 1, ['H13', 'D13']);
    ok(can(S, 2, ['H14', 'D14']), 'A♥A♦');
    ok(!can(S, 2, ['S14', 'H14']), 'A♠A♥は不可');
    ok(!can(S, 2, ['H15', 'D15']), '2♥2♦は不可');
  });

  test('片縛り：5♠5♥→7♠7♦ なら♠を含むペア', () => {
    const S = mk({ partialLock: true }, [['S5', 'H5', 'D9'], ['S7', 'D7', 'D12'], ['H8', 'D8', 'S8', 'C8']]);
    play(S, 0, ['S5', 'H5']);
    play(S, 1, ['S7', 'D7']);
    eq(S.lock.partial, ['S'], '♠が縛られる');
    ok(!can(S, 2, ['H8', 'D8']), '♠なしは不可');
    ok(can(S, 2, ['S8', 'C8']), '♠入りは可');
  });

  test('縛りは流れると解除', () => {
    const S = mk({ suitLock: true }, [['S5', 'D9', 'S3'], ['S6', 'D12'], ['H8', 'D8']]);
    play(S, 0, ['S5']);
    play(S, 1, ['S6']);
    ok(S.lock.suits, '縛り');
    pass(S, 2); pass(S, 0);
    ok(!S.lock.suits, '解除');
  });

  // ───────── 上がり ─────────
  test('反則上がり：2・ジョーカー・革命中の3', () => {
    const S = mk({ forbidTwo: true, forbidJoker: true }, [['S15'], ['C10', 'D12'], ['H3', 'D6']]);
    const ev = play(S, 0, ['S15']);
    ok(types(ev).includes('foul'), '2上がりは反則');
    ok(S.bottom.includes(0), '最下位グループ');
    const S2 = mk({ forbidTwo: true, forbidJoker: true }, [['X1'], ['C10', 'D12'], ['H3', 'D6']]);
    ok(types(play(S2, 0, ['X1'])).includes('foul'), 'ジョーカー上がりは反則');
    const S3 = mk({ forbidTwo: true, revolution: true }, [['S3'], ['C10', 'D12'], ['H3', 'D6']]);
    S3.revolution = true;
    ok(types(play(S3, 0, ['S3'])).includes('foul'), '革命中の3上がりは反則');
    const S4 = mk({ forbidTwo: true }, [['S15'], ['C10', 'D12'], ['H3', 'D6']]);
    S4.revolution = true;
    ok(!types(play(S4, 0, ['S15'])).includes('foul'), '革命中の2上がりはOK');
  });

  test('反則した人は最下位（先に反則した人ほど下）', () => {
    const S = mk({ forbidTwo: true }, [['S15'], ['H15'], ['H3', 'D6'], ['C4', 'C5']]);
    play(S, 0, ['S15']);
    pass(S, 1); pass(S, 2); pass(S, 3);
    play(S, 1, ['H15']);
    pass(S, 2); pass(S, 3);
    play(S, 2, ['H3']);
    play(S, 3, ['C4']);
    play(S, 2, ['D6']);
    eq(S.phase, 'over', '終了');
    eq(S.prevRanking, [2, 3, 1, 0], 'P0が最下位');
  });

  function nextGameWith(over, prevRanking, hands) {
    const S = mk(over, hands.map(() => []));
    S.gameNo = 1;
    S.prevRanking = prevRanking;
    S.phase = 'over';
    // 次のゲームを手札指定で開始
    S.gameNo = 2;
    S.phase = 'play';
    hands.forEach((h, i) => { S.players[i].hand = h.slice(); S.players[i].out = false; });
    return S;
  }

  test('都落ち', () => {
    const S = nextGameWith({ miyakoOchi: true }, [0, 1, 2, 3], [['C4', 'C5'], ['S13'], ['H3', 'D6'], ['D4', 'D5']]);
    S.turn = 1;
    const ev = play(S, 1, ['S13']);
    ok(types(ev).includes('miyako'), '都落ち');
    ok(S.players[0].out && S.bottom[0] === 0, '前の大富豪が最下位へ');
  });

  test('下剋上', () => {
    const S = nextGameWith({ gekokujo: true, miyakoOchi: true }, [0, 1, 2, 3], [['C4', 'C5'], ['S12', 'H9'], ['H3', 'D6'], ['D13']]);
    S.turn = 3;
    const ev = play(S, 3, ['D13']);
    ok(types(ev).includes('gekokujo'), '下剋上');
    eq(S.prevRanking, [3, 2, 1, 0], '身分が逆転');
    ok(!types(ev).includes('miyako'), '都落ちはしない');
  });

  test('カード交換と天変地異', () => {
    const S = E.createMatch({ rules: rulesWith({ exchange: true, tenpen: true, jokers: 0 }), players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], seed: 3 });
    S.gameNo = 1;
    S.prevRanking = [0, 1, 2, 3];
    E.startGame(S);
    let r = req(S);
    if (r && r.kind === 'tenpen') {
      E.apply(S, { type: 'tenpen', seat: 3, accept: true });
      r = req(S);
    }
    eq(r.kind, 'exchange', '交換の返し');
    const total = S.players.reduce((k, p) => k + p.hand.length, 0);
    eq(total, 52, '枚数は変わらない');
    while (req(S) && req(S).kind === 'exchange') {
      const q = req(S);
      E.apply(S, { type: 'exchange', seat: q.seat, cards: S.players[q.seat].hand.slice(0, q.count) });
    }
    eq(S.phase, 'play', '対局開始');
    eq(S.turn, 3, '大貧民から');
  });

  test('天変地異：大貧民の手札が10以下なら大富豪と全交換', () => {
    const S = E.createMatch({ rules: rulesWith({ exchange: true, tenpen: true }), players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], seed: 1 });
    S.gameNo = 1;
    S.prevRanking = [0, 1, 2];
    E.startGame(S, [['S15', 'X1', 'S14'], ['C11', 'C12'], ['H3', 'D6', 'D10']]);
    const r = req(S);
    eq([r.kind, r.seat, r.rich], ['tenpen', 2, 0], '大貧民に確認');
    E.apply(S, { type: 'tenpen', seat: 2, accept: true });
    eq(S.players[2].hand, C.sortHand(['S15', 'X1', 'S14'], false), '入れ替わった');
    eq(S.phase, 'play', '3人なので通常の交換はなしで開始');
    eq(S.turn, 2, '大貧民から');
  });

  test('カード交換：大貧民は一番強い2枚を渡す', () => {
    const S = E.createMatch({ rules: rulesWith({ exchange: true }), players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }], seed: 1 });
    S.gameNo = 1;
    S.prevRanking = [0, 1, 2, 3];
    E.startGame(S, [['S3', 'S4'], ['H3', 'H4'], ['D3', 'D14'], ['C3', 'X1', 'C15', 'C9']]);
    eq(S.players[0].hand, C.sortHand(['S3', 'S4', 'C15', 'X1'], false), '大富豪がジョーカーと2を受け取る');
    eq(S.players[1].hand, C.sortHand(['H3', 'H4', 'D14'], false), '富豪がAを受け取る');
    const r = req(S);
    eq([r.kind, r.seat, r.to, r.count], ['exchange', 0, 3, 2], '大富豪が2枚返す');
  });

  test('パスしたら流れるまで出せない（パスロック）', () => {
    const S = mk({ passLock: true }, [['S5', 'D9'], ['C10', 'D12'], ['H3', 'D6', 'H11']]);
    play(S, 0, ['S5']);
    pass(S, 1);
    play(S, 2, ['D6']);
    play(S, 0, ['D9']);
    // P1はパス済みなので自動でパス → P2
    eq(S.turn, 2, 'P1は飛ばされる');
  });

  test('ジョーカー単体に同じくジョーカーは出せない', () => {
    const S = mk({}, [['X1', 'D9'], ['X2', 'D12'], ['H3', 'D6']]);
    play(S, 0, ['X1']);
    ok(!can(S, 1, ['X2']), 'ジョーカーにジョーカー不可');
  });

  // ───────── ランダム対戦で矛盾がないか ─────────
  function randomRules(rng) {
    const r = RU.defaults();
    for (const def of RU.RULES) {
      if (def.type === 'bool') r[def.key] = rng() < 0.5;
      else r[def.key] = def.options[Math.floor(rng() * def.options.length)].v;
    }
    return r;
  }

  function randomAction(S, q, rng) {
    const seat = q.seat;
    const hand = S.players[seat].hand;
    const pickN = (arr, k) => C.shuffle(arr.slice(), rng).slice(0, k);
    switch (q.kind) {
      case 'turn': {
        const plays = E.legalPlays(S, seat);
        if (S.pile.length && (!plays.length || rng() < 0.35)) return { type: 'pass', seat };
        return { type: 'play', seat, play: plays[Math.floor(rng() * plays.length)] };
      }
      case 'stop': {
        const o = E.stopOptions(S, seat);
        return rng() < 0.6 ? { type: 'stop', seat, kind: o[Math.floor(rng() * o.length)].kind } : { type: 'nostop', seat };
      }
      case 'give': case 'discard': return { type: q.kind, seat, cards: pickN(hand, Math.floor(rng() * (q.count + 1))) };
      case 'pickup': return { type: 'pickup', seat, cards: rng() < 0.3 ? pickN(q.cards, 1) : [] };
      case 'bomb': return { type: 'bomb', seat, ranks: pickN(q.ranks, Math.floor(rng() * (q.count + 1))) };
      case 'exchange': return { type: 'exchange', seat, cards: pickN(hand, q.count) };
      case 'tenpen': return { type: 'tenpen', seat, accept: rng() < 0.5 };
    }
    throw new Error('unknown request ' + q.kind);
  }

  function checkInvariants(S, deckSize) {
    const all = [];
    for (const p of S.players) all.push(...p.hand);
    all.push(...S.discard);
    for (const e of S.pile) all.push(...e.shown);
    if (all.length !== deckSize) throw new Error('枚数が合わない: ' + all.length + ' / ' + deckSize);
    if (new Set(all).size !== all.length) throw new Error('カードが重複');
    if (S.phase === 'play' && !S.pending) {
      if (S.players[S.turn].out) throw new Error('上がった人の番になっている: P' + S.turn);
    }
    for (const p of S.players) if (p.out && p.hand.length && S.phase !== 'over') throw new Error('上がった人に手札');
  }

  test('ランダム対戦 1500ゲーム（ルールもランダム）で矛盾なし', () => {
    const rng = C.mulberry32(12345);
    let games = 0, actions = 0, longest = 0;
    const counters = {};
    for (let m = 0; m < 300; m++) {
      const rules = randomRules(rng);
      const np = 3 + Math.floor(rng() * 4);
      const S = E.createMatch({ rules, players: Array.from({ length: np }, (_, i) => ({ name: 'P' + i })), seed: m + 1 });
      const deckSize = 52 + S.rules.jokers;
      for (let g = 0; g < 5; g++) {
        E.startGame(S);
        checkInvariants(S, deckSize);
        let steps = 0;
        let q;
        while ((q = E.getRequest(S))) {
          const a = randomAction(S, q, rng);
          const evs = E.apply(S, a);
          for (const ev of evs) counters[ev.t] = (counters[ev.t] || 0) + 1;
          checkInvariants(S, deckSize);
          if (++steps > 6000) throw new Error('終わらない（ルール: ' + JSON.stringify(S.rules) + '）');
        }
        eq(S.phase, 'over', 'ゲーム終了');
        eq(S.prevRanking.slice().sort((a, b) => a - b), Array.from({ length: np }, (_, i) => i), '全員の順位');
        games++;
        actions += steps;
        longest = Math.max(longest, steps);
      }
    }
    current.msgs.push('ゲーム数 ' + games + ' / 行動数 ' + actions + ' / 最長 ' + longest);
    current.msgs.push('イベント: ' + Object.keys(counters).sort().map((k) => k + '=' + counters[k]).join(' '));
  });

  // ───────── 得点・試合の長さ・レート ─────────
  test('得点表：大富豪+3・富豪+1・平民0・貧民−1・大貧民−3（合計0）', () => {
    const tbl = (n) => Array.from({ length: n }, (_, i) => E.pointsFor(n, i));
    eq(tbl(3), [3, 0, -3], '3人');
    eq(tbl(4), [3, 1, -1, -3], '4人');
    eq(tbl(5), [3, 1, 0, -1, -3], '5人');
    eq(tbl(6), [3, 1, 0, 0, -1, -3], '6人');
  });

  function playOut(S) {
    let q, guard = 0;
    while ((q = E.getRequest(S)) && guard++ < 5000) E.apply(S, D.AI.decideSync(S, q, 'normal'));
    if (S.phase !== 'over') throw new Error('終わらない');
  }

  test('試合は決めたゲーム数で終わり、得点はゲームごとに記録', () => {
    const S = E.createMatch({ rules: RU.MINE, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i })), seed: 11, games: 3 });
    let lastOver = null;
    for (let g = 0; g < 3; g++) {
      S.events = [];
      E.startGame(S);
      let q, guard = 0;
      while ((q = E.getRequest(S)) && guard++ < 5000) {
        const evs = E.apply(S, D.AI.decideSync(S, q, 'normal'));
        for (const ev of evs) if (ev.t === 'over') lastOver = ev;
      }
      eq(S.phase, 'over', (g + 1) + 'ゲーム目が終わる');
      eq(S.matchOver, g === 2, '試合が終わるのは3ゲーム目');
    }
    eq(S.history.length, 3, '3ゲーム分の記録');
    ok(lastOver && lastOver.matchOver === true, '最後の over イベントに matchOver');
    eq(lastOver.pts.slice().sort((a, b) => a - b), [-3, -1, 1, 3], 'over イベントに得点');
    for (const h of S.history) eq(h.pts.reduce((a, b) => a + b, 0), 0, '1ゲームの合計は0');
    S.players.forEach((p, i) => eq(p.score, S.history.reduce((a, h) => a + h.pts[i], 0), 'P' + i + ' の総得点'));
    throws(() => E.startGame(S), '終わった試合は続けられない');
    const st = E.standings(S);
    ok(st[0].score >= st[3].score, '順位は総得点の高い順');
  });

  test('ゲーム数なし（無制限）なら試合は終わらない', () => {
    const S = E.createMatch({ rules: RU.MINE, players: [0, 1, 2].map((i) => ({ name: 'P' + i })), seed: 3 });
    for (let g = 0; g < 2; g++) { E.startGame(S); playOut(S); }
    eq(S.matchOver, false, '終わらない');
    eq(S.maxGames, 0, 'maxGames=0');
  });

  test('古い保存データ：得点は0から・ゲーム数は無制限', () => {
    const S = E.createMatch({ rules: RU.MINE, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i })), seed: 5 });
    E.startGame(S);
    const o = E.serialize(S);
    delete o.history; delete o.maxGames; delete o.matchOver; delete o.rated;
    o.players[0].score = 9;
    const T = E.deserialize(o);
    eq(T.history, [], '記録は空');
    eq(T.players[0].score, 0, '得点は0');
    eq([T.maxGames, T.matchOver, T.rated], [0, false, null], '既定値');
  });

  test('同点は同じ順位', () => {
    const S = E.createMatch({ rules: RU.MINE, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i })) });
    [4, -2, 4, -6].forEach((v, i) => { S.players[i].score = v; });
    eq(E.standings(S).map((r) => [r.seat, r.place]), [[0, 1], [2, 1], [1, 3], [3, 4]], '順位');
  });

  test('レート：予想の総得点と増減', () => {
    const RT = D.Rating;
    ok(Math.abs(RT.expectedPoints(1500, [1500, 1500, 1500])) < 1e-9, '同じ強さなら予想0');
    ok(RT.expectedPoints(1600, [1500, 1500, 1500]) > 0, '強ければ予想はプラス');
    ok(Math.abs(RT.expectedPoints(1600, [1500, 1500, 1500]) + RT.expectedPoints(1400, [1500, 1500, 1500])) < 1e-9, '上下対称');
    ok(RT.expectedPoints(3000, [1500, 1500, 1500]) < 3 && RT.expectedPoints(3000, [1500, 1500, 1500]) > 2.99, '最大は+3に近づく');
    eq(RT.change(1500, [1500, 1500, 1500], 9, 10, 10).delta, 12, '+9点 → +12');
    eq(RT.change(1500, [1500, 1500, 1500], -6, 10, 10).delta, -8, '−6点 → −8');
    eq(RT.change(1500, [1500, 1500, 1500], 9, 10, 0).delta, 24, 'はじめの試合は2倍');
    ok(RT.change(1500, [1700, 1700, 1700], 0, 10, 10).delta > 0, '強い相手に0点なら上がる');
    ok(RT.change(1500, [1300, 1300, 1300], 0, 10, 10).delta < 0, '弱い相手に0点なら下がる');
    eq(RT.abandonTotal(4, 6, 10, 4), 4 - 12, '棄権：残り4ゲームは−3点ずつ');
    const S = E.createMatch({ rules: RU.MINE, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i })), games: 10 });
    [8, 3, -2, -9].forEach((v, i) => { S.players[i].score = v; });
    const res = RT.matchResult(S, [1500, 1500, 1500, 1500], [10, 10, 10, 10]);
    eq(res.reduce((a, r) => a + r.delta, 0), 0, '同じ強さ・同じKなら増減の合計は0');
    eq(RT.rules(), RU.MINE, 'レート戦はマイルール');
  });

  // 結果表示
  const out = document.getElementById('out');
  const pass_ = results.filter((r) => r.ok).length;
  const summary = document.getElementById('summary');
  summary.textContent = pass_ + ' / ' + results.length + ' 件成功';
  summary.className = pass_ === results.length ? 'ok' : 'ng';
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'ok' : 'ng';
    li.textContent = (r.ok ? '✔ ' : '✘ ') + r.name + (r.msgs.length ? '\n   ' + r.msgs.join('\n   ') : '');
    out.appendChild(li);
  }
  globalThis.TEST_RESULTS = { pass: pass_, total: results.length, failed: results.filter((r) => !r.ok) };
})();
