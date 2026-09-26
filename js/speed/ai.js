/* スピード — AIロボット。強さは「反応の速さ」と「次の一手を考えるか」で変わる */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const SP = D.Speed;

  // 1枚出すまでの時間（ミリ秒）。はじめの1枚（せーのの直後）は少し長め
  const REACTION = {
    easy: [1500, 2300],
    normal: [950, 1400],
    hard: [560, 850],
  };

  function reaction(level, rng, afterFlip) {
    const [a, b] = REACTION[level] || REACTION.normal;
    const r = rng || Math.random;
    return Math.round(a + (b - a) * r() + (afterFlip ? 260 : 0));
  }

  /** 出したあとに自分の場札がまだ出せるか（連続で出せるか）を数える */
  function followUps(S, seat, mv) {
    const T = SP.clone(S);
    const P = T.players[seat];
    const card = P.field[mv.slot];
    T.piles[mv.pile].push(card);
    P.field[mv.slot] = null; // 補充されるカードは見えないものとして扱う
    return SP.playable(T, seat).length;
  }

  /** 相手が出せる手の数（つよいAIは相手を止める手を選ぶ） */
  function oppAfter(S, seat, mv) {
    const T = SP.clone(S);
    const P = T.players[seat];
    T.piles[mv.pile].push(P.field[mv.slot]);
    P.field[mv.slot] = null;
    return SP.playable(T, 1 - seat).length;
  }

  function choose(S, seat, level) {
    const moves = SP.playable(S, seat);
    if (!moves.length) return null;
    if (level === 'easy') return moves[Math.floor(Math.random() * moves.length)];
    let best = null, bestV = -Infinity;
    for (const mv of moves) {
      let v = followUps(S, seat, mv) + Math.random() * 0.3;
      if (level === 'hard') v -= 0.45 * oppAfter(S, seat, mv);
      if (v > bestV) { bestV = v; best = mv; }
    }
    return best;
  }

  D.SpeedAI = { choose, reaction, REACTION };
})();
