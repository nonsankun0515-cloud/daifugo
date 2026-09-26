/* 七並べ — AIロボット（やさしい / ふつう / つよい） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const C = D.Cards, SV = D.Sevens;

  /** (s, n) から dir 方向に続く空きマス（トンネルなら一周）。自分のカードとそれ以外に分けて距離つきで返す */
  function chain(S, s, n, dir, own) {
    const out = [];
    let m = n;
    for (let k = 1; k <= 12; k++) {
      m += dir;
      if (m < 1 || m > 13) {
        if (!S.rules.tunnel) break;
        m = m < 1 ? 13 : 1;
      }
      if (S.board[s][m]) break;
      out.push({ k, mine: own.has(SV.idOf(s, m)) });
    }
    return out;
  }

  /**
   * (s, n) を埋めたときに開く方向の価値。
   * 自分のカードが先にあるほど良い。ほかの人のカードが開くのは悪いが、
   * 自分の次のカードより先は、まだ自分が止めているので数えない。
   */
  function openValue(S, s, n, own) {
    let v = 0;
    for (const dir of [-1, 1]) {
      let blocked = false;
      for (const x of chain(S, s, n, dir, own)) {
        if (x.mine) { v += W.own / Math.pow(x.k, W.ownPow); blocked = true; }
        else if (!blocked) v -= W.other / Math.pow(x.k, W.otherPow);
      }
    }
    return v;
  }
  // 重み（tools で自己対戦させて調整）
  const W = { own: 1.0, ownPow: 0.6, other: 0.8, otherPow: 0.35, passBase: 0.75, passLeft: 1.0, jokerKeep: 0.8 };

  function scoreMove(S, seat, a) {
    const P = S.players[seat];
    const own = new Set(P.hand);
    if (a.type === 'pass') {
      const limit = S.rules.passLimit;
      if (limit > 0 && P.passes >= limit) return -1000; // 次のパスで失格
      const left = limit > 0 ? limit - P.passes : 3;
      return -W.passBase - W.passLeft / Math.max(1, left) - 0.08 * P.hand.length;
    }
    if (a.type === 'joker') {
      if (P.hand.length === 1) return 1000;
      own.delete('X1');
      // ジョーカーは手元にあるほど強いので、使うのは自分の札がたくさん開くときだけ
      return openValue(S, a.suit, a.n, own) + 0.4 - W.jokerKeep + (P.hand.length <= 3 ? 0.8 : 0);
    }
    if (P.hand.length === 1) return 1000;
    own.delete(a.card);
    return openValue(S, C.suitOf(a.card), SV.numOf(a.card), own) + 0.15;
  }

  function chooseHeuristic(S, seat, noise) {
    const moves = SV.legalMoves(S, seat);
    let best = null, bestV = -Infinity;
    for (const a of moves) {
      const v = scoreMove(S, seat, a) + (noise ? (Math.random() - 0.5) * noise : 0);
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }

  // ─────────────────────────────────────────────
  // つよい：見えないカードをランダムに配り直して、何百回も最後まで試す
  // ─────────────────────────────────────────────
  function unknownPool(S, seat) {
    const seen = new Set(S.players[seat].hand);
    // 場のカード（ジョーカーが置かれた場所の本物のカードは、まだだれかの手札にある）
    for (const s of SV.SUITS) for (let n = 1; n <= 13; n++) { const c = S.board[s][n]; if (c && !c.joker) seen.add(c.id); }
    const pool = [];
    for (const id of SV.makeDeck(false)) if (!seen.has(id)) pool.push(id);
    const jokerSeen = seen.has('X1') || !!S.joker || S.jokerGone;
    if (S.rules.joker && !jokerSeen) pool.push('X1');
    return pool;
  }

  function determinize(T, seat) {
    const pool = C.shuffle(unknownPool(T, seat));
    const forced = T.forced && T.forced.seat !== seat ? T.forced : null;
    if (forced) { const i = pool.indexOf(forced.card); if (i >= 0) pool.splice(i, 1); }
    for (const p of T.players) {
      if (p.seat === seat || p.out) continue;
      const k = p.hand.length;
      let h = [];
      if (forced && forced.seat === p.seat) h.push(forced.card);
      h = h.concat(pool.splice(0, k - h.length));
      p.hand = SV.sortHand(h);
    }
  }

  function rollout(T, seat) {
    let q, guard = 0;
    while ((q = SV.getRequest(T)) && guard++ < 400) SV.apply(T, chooseHeuristic(T, q.seat, 0.6));
    if (T.phase !== 'over') return 0;
    return D.Engine.pointsFor(T.n, T.prevRanking.indexOf(seat));
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let yieldImpl = null;
  function yieldUI() {
    if (!yieldImpl) {
      if (typeof MessageChannel === 'undefined') yieldImpl = () => new Promise((r) => setTimeout(r, 0));
      else {
        const ch = new MessageChannel();
        const waiting = [];
        ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
        yieldImpl = () => new Promise((r) => { waiting.push(r); ch.port2.postMessage(0); });
      }
    }
    return yieldImpl();
  }

  async function chooseMC(S, seat, budgetMs) {
    const moves = SV.legalMoves(S, seat);
    if (moves.length <= 1) return moves[0];
    const ranked = moves.map((a) => ({ a, s: scoreMove(S, seat, a) })).sort((x, y) => y.s - x.s);
    if (ranked[0].s >= 1000) return ranked[0].a;
    const cands = ranked.slice(0, 5);
    const stats = cands.map(() => ({ sum: 0, n: 0 }));
    const t0 = now();
    let it = 0;
    while (now() - t0 < budgetMs && it < 1200) {
      const ci = it % cands.length;
      const T = SV.clone(S);
      determinize(T, seat);
      try { SV.apply(T, cands[ci].a); stats[ci].sum += rollout(T, seat); } catch (e) { stats[ci].sum -= 3; }
      stats[ci].n++;
      it++;
      if (it % 6 === 0) await yieldUI();
    }
    let best = 0, bestV = -Infinity;
    cands.forEach((c, i) => {
      const v = (stats[i].n ? stats[i].sum / stats[i].n : -9) + (i === 0 ? 0.05 : 0);
      if (v > bestV) { bestV = v; best = i; }
    });
    return cands[best].a;
  }

  function decideSync(S, q, level) {
    const seat = q.seat;
    if (level === 'easy') {
      const moves = SV.legalMoves(S, seat, true);
      if (moves.length && Math.random() < 0.4) return moves[Math.floor(Math.random() * moves.length)];
      return chooseHeuristic(S, seat, 2.2);
    }
    return chooseHeuristic(S, seat, 0.15);
  }

  async function decide(S, q, level, budgetMs) {
    if (level === 'hard') return chooseMC(S, q.seat, budgetMs || 400);
    return decideSync(S, q, level);
  }

  /** 人間向けヒント（ふつうのAIの考え） */
  function suggest(S, seat) { return chooseHeuristic(S, seat, 0); }

  D.SevensAI = { decide, decideSync, suggest, scoreMove, W };
})();
