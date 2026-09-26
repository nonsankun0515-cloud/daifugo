/* 七並べ — AIロボット（やさしい / ふつう / つよい） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const C = D.Cards, SV = D.Sevens;

  // マスのカード名（毎回文字列を作らないように先に作っておく）
  const IDS = {};
  for (const s of SV.SUITS) { IDS[s] = []; for (let n = 1; n <= 13; n++) IDS[s][n] = SV.idOf(s, n); }

  /**
   * (s, n) を埋めたときに開く方向の価値。となりから空きマスをたどり（トンネルなら一周）、
   * 自分のカードが先にあるほど良い。ほかの人のカードが開くのは悪いが、
   * 自分の次のカードより先は、まだ自分が止めているので数えない。
   * （つよいAIが何百回も呼ぶので、配列を作らずに数える）
   */
  function openValue(S, s, n, own) {
    const row = S.board[s], ids = IDS[s], tunnel = S.rules.tunnel;
    let v = 0;
    for (let dir = -1; dir <= 1; dir += 2) {
      let blocked = false, m = n;
      for (let k = 1; k <= 12; k++) {
        m += dir;
        if (m < 1 || m > 13) {
          if (!tunnel) break;
          m = m < 1 ? 13 : 1;
        }
        if (row[m]) break;
        if (own.has(ids[m])) { v += W.own / Math.pow(k, W.ownPow); blocked = true; }
        else if (!blocked) v -= W.other / Math.pow(k, W.otherPow);
      }
    }
    return v;
  }
  // 重み（tools で自己対戦させて調整）
  const W = { own: 1.0, ownPow: 0.6, other: 0.8, otherPow: 0.35, passBase: 0.75, passLeft: 1.0, jokerKeep: 0.8 };

  /** own：自分の手札の Set（同じ番の手を何通りも比べるときは使い回す。出すカード自身はたどるマスに出てこない） */
  function scoreMove(S, seat, a, own) {
    const P = S.players[seat];
    if (a.type === 'pass') {
      const limit = S.rules.passLimit;
      if (limit > 0 && P.passes >= limit) return -1000; // 次のパスで失格
      const left = limit > 0 ? limit - P.passes : 3;
      return -W.passBase - W.passLeft / Math.max(1, left) - 0.08 * P.hand.length;
    }
    if (P.hand.length === 1) return 1000;
    own = own || new Set(P.hand);
    if (a.type === 'joker') {
      // ジョーカーは手元にあるほど強いので、使うのは自分の札がたくさん開くときだけ
      return openValue(S, a.suit, a.n, own) + 0.4 - W.jokerKeep + (P.hand.length <= 3 ? 0.8 : 0);
    }
    return openValue(S, C.suitOf(a.card), SV.numOf(a.card), own) + 0.15;
  }

  function chooseHeuristic(S, seat, noise, rng) {
    const moves = SV.legalMoves(S, seat);
    const own = new Set(S.players[seat].hand);
    const r = rng || Math.random;
    let best = null, bestV = -Infinity;
    for (const a of moves) {
      const v = scoreMove(S, seat, a, own) + (noise ? (r() - 0.5) * noise : 0);
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

  function rollout(T, seat, rng) {
    let q, guard = 0;
    while ((q = SV.getRequest(T)) && guard++ < 400) SV.apply(T, chooseHeuristic(T, q.seat, 0.6, rng));
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

  /**
   * 候補の手を、同じ「見えないカードの配り方」と同じ乱数で比べる（手ごとに別の配り方で試すと、
   * 配り方の運の差が手の差より大きくなり、良い手を見分けられない）。パスは作戦なので必ず候補に入れる。
   * 試す回数は ITERS で決まっている（時間で決めると、遅い端末ほど弱くなりレートが合わなくなる）。
   * maxMs はとても遅い端末で待たせすぎないための上限。
   */
  const ITERS = 300;
  async function chooseMC(S, seat, maxMs) {
    const moves = SV.legalMoves(S, seat);
    if (moves.length <= 1) return moves[0];
    const ranked = moves.map((a) => ({ a, s: scoreMove(S, seat, a) })).sort((x, y) => y.s - x.s);
    if (ranked[0].s >= 1000) return ranked[0].a;
    const cands = ranked.slice(0, 6);
    const pass = ranked.find((x) => x.a.type === 'pass');
    if (pass && !cands.includes(pass)) cands[cands.length - 1] = pass;
    const sum = cands.map(() => 0);
    const t0 = now();
    let it = 0;
    while (it < ITERS && now() - t0 < maxMs) {
      const base = SV.clone(S);
      determinize(base, seat);
      const seed = (Math.random() * 4294967296) >>> 0;
      cands.forEach((c, i) => {
        const T = SV.clone(base);
        try { SV.apply(T, c.a); sum[i] += rollout(T, seat, C.mulberry32(seed)); } catch (e) { sum[i] -= 3; }
      });
      it++;
      if (it % 2 === 0) await yieldUI();
    }
    let best = 0;
    cands.forEach((c, i) => { if (sum[i] > sum[best]) best = i; }); // 同点なら評価関数の順
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

  async function decide(S, q, level, maxMs) {
    if (level === 'hard') return chooseMC(S, q.seat, maxMs || 3000);
    return decideSync(S, q, level);
  }

  /** 人間向けヒント（ふつうのAIの考え） */
  function suggest(S, seat) { return chooseHeuristic(S, seat, 0); }

  D.SevensAI = { decide, decideSync, suggest, scoreMove, W, ITERS };
})();
