/* 大富豪 — AIロボット（やさしい / ふつう / つよい） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const E = D.Engine, C = D.Cards;
  const { CARDS, strength } = C;

  // ─────────────────────────────────────────────
  // 見えている情報：自分以外の誰かが持っている（まだ出ていない）カード
  // ─────────────────────────────────────────────
  function unknownInfo(S, seat) {
    const seen = new Set(S.players[seat].hand);
    for (const id of S.discard) seen.add(id);
    for (const e of S.pile) for (const id of e.shown) seen.add(id);
    const cards = C.makeDeck(S.rules.jokers).filter((id) => !seen.has(id));
    const byRank = new Array(17).fill(0);
    let jokers = 0;
    for (const id of cards) { if (C.isJoker(id)) jokers++; else byRank[C.rankOf(id)]++; }
    return { cards, byRank, jokers };
  }

  function makeCtx(S, seat) {
    let oppMin = 99;
    for (const p of S.players) if (p.seat !== seat && !p.out) oppMin = Math.min(oppMin, p.hand.length);
    return { R: S.rules, rev: S.revolution, unk: unknownInfo(S, seat), oppMin, seat };
  }

  // ─────────────────────────────────────────────
  // 手札の評価（大きいほど良い）
  //   ・コントロール札（流せる/勝てる組）は「親を取り返せる」ので価値が高い
  //   ・それ以外の組の数と弱さが少ないほど良い
  // ─────────────────────────────────────────────
  function isControlSet(r, k, ctx) {
    const R = ctx.R;
    if (R.eightCut && r === 8) return true;
    if (R.sandstorm && r === 3 && k === 3) return true;
    if (R.rokurokubi && r === 6 && k === 2) return true;
    if (R.kyukyusha && r === 9 && k === 2) return true;
    if (k >= 4) return true;
    const unk = ctx.unk;
    const s = strength(r, ctx.rev);
    for (let r2 = 3; r2 <= 15; r2++) {
      if (strength(r2, ctx.rev) > s && unk.byRank[r2] >= 1 && unk.byRank[r2] + unk.jokers >= k) return false;
    }
    if (k === 1 && unk.jokers > 0) return false;
    if (k === 2 && unk.jokers >= 2) return false;
    return true;
  }

  function forbiddenRank(r, ctx) {
    const R = ctx.R;
    return (R.forbidTwo && r === (ctx.rev ? 3 : 15)) || (R.forbidEight && r === 8);
  }

  function findRuns(hand) {
    const bySuit = { S: [], H: [], D: [], C: [] };
    for (const id of hand) { const c = CARDS[id]; if (!c.joker) bySuit[c.suit].push(c.rank); }
    const runs = [];
    for (const s of C.SUITS) {
      const rs = bySuit[s].sort((a, b) => a - b);
      let i = 0;
      while (i < rs.length) {
        let j = i;
        while (j + 1 < rs.length && rs[j + 1] === rs[j] + 1) j++;
        const L = j - i + 1;
        if (L >= 3) {
          const lo = rs[i], hi = rs[j];
          if (L <= 6) {
            for (let a = lo; a <= hi - 2; a++) for (let b = a + 2; b <= hi; b++) runs.push({ suit: s, low: a, high: b });
          } else runs.push({ suit: s, low: lo, high: hi });
        }
        i = j + 1;
      }
    }
    return runs;
  }

  function scoreGroups(cnt, runs, J, handSize, ctx) {
    let nonControl = 0, controls = 0, weak = 0, allForbidden = true;
    for (let r = 3; r <= 15; r++) {
      const k = cnt[r];
      if (!k) continue;
      const st = (strength(r, ctx.rev) - 3) / 12;
      if (isControlSet(r, k, ctx)) controls++;
      else { nonControl++; weak += 1 - st; }
      if (!forbiddenRank(r, ctx)) allForbidden = false;
    }
    for (const run of runs) {
      const L = run.high - run.low + 1;
      const st = Math.min(1, (Math.min(strength(run.low, ctx.rev), strength(run.high, ctx.rev)) - 3) / 12 + 0.25);
      if (L >= 4 || st > 0.8) controls++;
      else { nonControl++; weak += 1 - st; }
      const R = ctx.R;
      const bad = (R.forbidTwo && run.low <= (ctx.rev ? 3 : 15) && (ctx.rev ? 3 : 15) <= run.high) || (R.forbidEight && run.low <= 8 && 8 <= run.high);
      if (!bad) allForbidden = false;
    }
    if (J) { controls += J; if (!ctx.R.forbidJoker) allForbidden = false; }
    const cw = 0.8 + 0.03 * handSize;
    let v = -1.0 * nonControl - 0.45 * weak + cw * controls - 0.05 * handSize;
    if (nonControl === 0) v += 1.0;
    else if (nonControl === 1) v += 0.6;
    if (allForbidden && handSize > 0) v -= 2.2;
    return { v, nonControl, controls };
  }

  function analyze(hand, ctx) {
    if (!hand.length) return { v: 100, nonControl: 0, controls: 0 };
    const cnt = new Array(16).fill(0);
    let J = 0;
    for (const id of hand) { const c = CARDS[id]; if (c.joker) J++; else cnt[c.rank]++; }
    let best = scoreGroups(cnt, [], J, hand.length, ctx);
    if (ctx.R.sequence) {
      const runs = findRuns(hand).slice(0, 12);
      const bySuitRank = new Set(hand.filter((id) => !C.isJoker(id)));
      const tryRuns = (list) => {
        const c2 = cnt.slice();
        const used = new Set();
        for (const run of list) {
          for (let r = run.low; r <= run.high; r++) {
            const id = run.suit + r;
            if (used.has(id) || !bySuitRank.has(id)) return;
            used.add(id);
            c2[r]--;
          }
        }
        const sc = scoreGroups(c2, list, J, hand.length, ctx);
        if (sc.v > best.v) best = sc;
      };
      for (let i = 0; i < runs.length; i++) {
        tryRuns([runs[i]]);
        for (let j = i + 1; j < runs.length; j++) tryRuns([runs[i], runs[j]]);
      }
    }
    return best;
  }
  const evaluate = (hand, ctx) => analyze(hand, ctx).v;

  function minus(hand, cards) {
    const out = hand.slice();
    for (const id of cards) { const i = out.indexOf(id); if (i >= 0) out.splice(i, 1); }
    return out;
  }

  /** 価値の低いカードを k 枚選ぶ（渡す・捨てる用） */
  function worstCards(hand, k, ctx) {
    let cur = hand.slice();
    const picked = [];
    for (let t = 0; t < k && cur.length; t++) {
      let best = null, bestV = -Infinity;
      for (const id of cur) {
        const v = evaluate(minus(cur, [id]), ctx) - (C.isJoker(id) ? 3 : 0);
        if (v > bestV) { bestV = v; best = id; }
      }
      picked.push(best);
      cur = minus(cur, [best]);
    }
    return picked;
  }

  // 12ボンバー：自分の手札にある数字から、自分に得で相手に損なものを選ぶ（得がなければ指名しない）
  function chooseBomb(S, seat, count, hand, ctx) {
    const base = evaluate(hand, ctx);
    const scored = [];
    for (const r of E.bombableRanks(hand)) {
      const mine = hand.filter((id) => !C.isJoker(id) && C.rankOf(id) === r);
      const myDelta = evaluate(minus(hand, mine), ctx) - base;
      const st = (strength(r, ctx.rev) - 3) / 12;
      const opp = ctx.unk.byRank[r];
      const oppGain = opp * (0.35 - 0.6 * st);
      scored.push({ r, s: myDelta - 0.7 * oppGain });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.filter((x) => x.s > 0).slice(0, count).map((x) => x.r);
  }

  // ─────────────────────────────────────────────
  // 自分の番：出す／パス
  // ─────────────────────────────────────────────
  function beatableAfter(S, p, ctx, revAfterTrick) {
    const unk = ctx.unk;
    if (p.type === 'seq') return p.n < 5;
    if (p.wild) return ctx.R.spade3 && unk.cards.includes('S3') && p.n === 1;
    const s = strength(p.rank, revAfterTrick);
    for (let r = 3; r <= 15; r++) {
      if (strength(r, revAfterTrick) > s && unk.byRank[r] >= 1 && unk.byRank[r] + unk.jokers >= p.n) return true;
    }
    if (p.n === 1 && unk.jokers > 0) return true;
    return false;
  }

  function scorePlay(S, seat, p, ctx) {
    const R = S.rules;
    const P = S.players[seat];
    const fx = E.effectsOf(p, S);
    const revNow = E.effRev(S);
    let after = minus(P.hand, p.cards);
    const ctx2 = Object.assign({}, ctx, { rev: fx.revolution ? !S.revolution : S.revolution });
    if (!after.length) return E.isForbiddenFinish(p, R, revNow) ? -40 : 1000;
    let bonus = 0;
    if (fx.give) after = minus(after, worstCards(after, Math.min(fx.give, after.length), ctx2));
    if (fx.back) after = minus(after, worstCards(after, Math.min(fx.back, after.length), ctx2));
    if (fx.discard) after = minus(after, worstCards(after, Math.min(fx.discard, after.length), ctx2));
    if (fx.bomb) {
      const ranks = chooseBomb(S, seat, fx.bomb, after, ctx2);
      after = after.filter((id) => C.isJoker(id) || !ranks.includes(C.rankOf(id)));
      for (const r of ranks) bonus += ctx.unk.byRank[r] * (0.6 * (strength(r, ctx2.rev) - 3) / 12 - 0.2);
    }
    if (!after.length) return E.isForbiddenFinish(p, R, revNow) ? -40 : 900;
    const an = analyze(after, ctx2);
    let v = an.v + bonus;
    const jAfter = fx.jToggles % 2 === 1 ? !S.jback : S.jback;
    const trickRev = ctx2.rev !== jAfter;
    const top = E.topPlay(S);
    const takesLead = fx.sand || !!fx.flow || fx.greatRev ||
      (top && top.wild && p.cards[0] === 'S3' && R.spade3) || !beatableAfter(S, p, ctx, trickRev);
    if (takesLead) v += 0.8 + (an.nonControl <= 1 ? 1.2 : 0);
    v += 0.12 * fx.skip;
    // 相手が上がりそうなとき
    if (!top && ctx.oppMin === 1 && p.n === 1 && !takesLead) v -= 1.6;
    if (!top && ctx.oppMin === 2 && p.n === 2 && !takesLead) v -= 0.6;
    // 革命：自分の手が強い時は起こしたくない（評価に反映済み）が、相手の枚数が少ない時は慎重に
    return v;
  }

  function passScore(S, seat, ctx) {
    const P = S.players[seat];
    let v = evaluate(P.hand, ctx);
    const winner = S.lastSeat;
    if (winner !== null && winner !== seat) {
      const wl = S.players[winner].hand.length;
      if (!S.players[winner].out && wl <= 2) v -= 1.6;
      else if (ctx.oppMin <= 2) v -= 0.5;
    }
    return v;
  }

  /** 終盤の定石：コントロール札を先に出し、最後の1組で上がる */
  function endgamePlay(S, seat, plays, ctx) {
    const P = S.players[seat];
    if (E.topPlay(S)) return null;
    const an = analyze(P.hand, ctx);
    if (an.nonControl > 1 || an.controls < 1) return null;
    let best = null, bestKey = -Infinity;
    for (const p of plays) {
      const after = minus(P.hand, p.cards);
      if (!after.length) continue;
      const a2 = analyze(after, ctx);
      if (a2.nonControl > 1) continue;
      if (beatableAfter(S, p, ctx, E.effRev(S)) && !E.effectsOf(p, S).flow) continue;
      const forbiddenLast = E.isForbiddenFinish(p, S.rules, E.effRev(S)) ? 1 : 0;
      const key = forbiddenLast * 10 + p.n - a2.nonControl;
      if (key > bestKey) { bestKey = key; best = p; }
    }
    return best;
  }

  function chooseTurnHeuristic(S, seat, noise) {
    const ctx = makeCtx(S, seat);
    const plays = E.legalPlays(S, seat);
    const canPass = !!E.topPlay(S);
    const scored = [];
    for (const p of plays) {
      const after = S.players[seat].hand.length - p.cards.length;
      if (after === 0 && !E.isForbiddenFinish(p, S.rules, E.effRev(S))) return { action: { type: 'play', seat, play: p }, scored: [] };
    }
    const eg = endgamePlay(S, seat, plays, ctx);
    if (eg) return { action: { type: 'play', seat, play: eg }, scored: [] };
    if (canPass) scored.push({ a: { type: 'pass', seat }, s: passScore(S, seat, ctx) });
    for (const p of plays) scored.push({ a: { type: 'play', seat, play: p }, s: scorePlay(S, seat, p, ctx) + (noise ? (Math.random() - 0.5) * noise : 0) });
    scored.sort((a, b) => b.s - a.s);
    return { action: scored[0].a, scored };
  }

  // ─────────────────────────────────────────────
  // ロールアウト用の速い方針（つよいAIのシミュレーション）
  // ─────────────────────────────────────────────
  function fastTurn(S, seat) {
    const P = S.players[seat];
    const plays = E.legalPlays(S, seat);
    const top = E.topPlay(S);
    const rev = E.effRev(S);
    if (!plays.length) return { type: 'pass', seat };
    const cnt = {};
    for (const id of P.hand) { const c = CARDS[id]; if (!c.joker) cnt[c.rank] = (cnt[c.rank] || 0) + 1; }
    let best = null, bestS = -Infinity;
    for (const p of plays) {
      if (p.cards.length === P.hand.length && !E.isForbiddenFinish(p, S.rules, rev)) return { type: 'play', seat, play: p };
      let s;
      if (p.wild) s = -8;
      else if (p.type === 'seq') s = -(Math.min(strength(p.low, rev), strength(p.high, rev))) + p.n * 0.8;
      else {
        s = -strength(p.rank, rev) + p.n * 0.6;
        if (cnt[p.rank] && cnt[p.rank] > p.n) s -= 3;
        if (p.jokers) s -= 4;
      }
      if (s > bestS) { bestS = s; best = p; }
    }
    if (top) {
      let near = false;
      for (const q of S.players) if (q.seat !== seat && !q.out && q.hand.length <= 2) near = true;
      const strong = best.wild || (best.type !== 'seq' && strength(best.rank, rev) >= 14);
      if (!near && strong && P.hand.length > 4 && Math.random() < 0.7) return { type: 'pass', seat };
      if (!near && Math.random() < 0.12) return { type: 'pass', seat };
    }
    return { type: 'play', seat, play: best };
  }

  function weakest(hand, k, rev) {
    return C.sortHand(hand.filter((id) => !C.isJoker(id)), rev).slice(0, k);
  }

  function fastAction(S, q) {
    const seat = q.seat;
    const hand = S.players[seat].hand;
    const rev = S.revolution;
    switch (q.kind) {
      case 'turn': return fastTurn(S, seat);
      case 'stop': return { type: 'stop', seat, kind: E.stopOptions(S, seat)[0].kind };
      case 'give': case 'discard': return { type: q.kind, seat, cards: weakest(hand, q.count, rev) };
      case 'pickup': return { type: 'pickup', seat, cards: [] };
      case 'bomb': {
        // 手札で一番弱い数字を捨てる
        let best = null, bs = Infinity;
        for (const r of q.ranks) { const s = strength(r, rev); if (s < bs) { bs = s; best = r; } }
        return { type: 'bomb', seat, ranks: best === null ? [] : [best] };
      }
      case 'exchange': return { type: 'exchange', seat, cards: weakest(hand, q.count, false).concat(hand.filter(C.isJoker)).slice(0, q.count) };
      case 'tenpen': return { type: 'tenpen', seat, accept: true };
    }
    throw new Error('unknown request');
  }

  let ROLLOUT = 'normal';
  function rolloutPlace(T, seat) {
    let guard = 0;
    let q;
    const smart = ROLLOUT === 'normal';
    while ((q = E.getRequest(T)) && guard++ < 800) E.apply(T, smart ? decideSync(T, q, 'normal') : fastAction(T, q));
    if (T.phase !== 'over') return 0.5;
    const place = T.prevRanking.indexOf(seat);
    return 1 - place / (T.n - 1);
  }

  function determinize(T, seat, unk) {
    const pool = C.shuffle(unk.cards.slice());
    for (const p of T.players) {
      if (p.seat === seat || p.out) continue;
      const k = p.hand.length;
      p.hand = C.sortHand(pool.splice(0, k), false);
    }
  }

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // 考えている間も画面が止まらないように、ときどき処理を譲る（タイマーより間引かれにくい MessageChannel を使う）
  const yieldUI = (() => {
    if (typeof MessageChannel === 'undefined') return () => new Promise((r) => setTimeout(r, 0));
    const ch = new MessageChannel();
    const waiting = [];
    ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
    return () => new Promise((r) => { waiting.push(r); ch.port2.postMessage(0); });
  })();

  async function chooseTurnMC(S, seat, budgetMs) {
    const h = chooseTurnHeuristic(S, seat, 0);
    if (!h.scored.length) return h.action;
    const seen = new Set();
    const cands = [];
    for (const x of h.scored) {
      const key = x.a.type === 'pass' ? 'pass' : x.a.play.type + x.a.play.n + ':' + (x.a.play.rank || x.a.play.low) + ':' + x.a.play.jokers;
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push(x);
      if (cands.length >= 5) break;
    }
    if (cands.length === 1) return cands[0].a;
    const unk = unknownInfo(S, seat);
    const stats = cands.map(() => ({ sum: 0, n: 0 }));
    const t0 = now();
    let it = 0;
    while (now() - t0 < budgetMs && it < 1500) {
      const ci = it % cands.length;
      const T = E.clone(S);
      determinize(T, seat, unk);
      try {
        E.apply(T, cands[ci].a);
        stats[ci].sum += rolloutPlace(T, seat);
        stats[ci].n++;
      } catch (e) { stats[ci].n++; }
      it++;
      if (it % 8 === 0) await yieldUI();
    }
    let best = 0, bestV = -Infinity;
    cands.forEach((c, i) => {
      const mean = stats[i].n ? stats[i].sum / stats[i].n : 0;
      const v = mean + (i === 0 ? 0.02 : 0);
      if (v > bestV) { bestV = v; best = i; }
    });
    return cands[best].a;
  }

  // ─────────────────────────────────────────────
  // 公開API
  // ─────────────────────────────────────────────
  function decideSync(S, q, level) {
    const seat = q.seat;
    const P = S.players[seat];
    const ctx = makeCtx(S, seat);
    const easy = level === 'easy';
    const rnd = Math.random;
    switch (q.kind) {
      case 'turn': {
        if (easy && rnd() < 0.35) {
          const plays = E.legalPlays(S, seat);
          if (E.topPlay(S) && (!plays.length || rnd() < 0.3)) return { type: 'pass', seat };
          if (plays.length) return { type: 'play', seat, play: plays[Math.floor(rnd() * plays.length)] };
        }
        return chooseTurnHeuristic(S, seat, easy ? 1.2 : 0.08).action;
      }
      case 'stop': {
        const opts = E.stopOptions(S, seat);
        if (easy) return rnd() < 0.55 ? { type: 'stop', seat, kind: opts[0].kind } : { type: 'nostop', seat };
        // 止めた後の手札＋親を取れる価値 と 止めない場合（相手が親のまま）を比べる
        const trig = q.trigger;
        const trigLeft = S.players[trig.seat].hand.length;
        let bestV = evaluate(P.hand, ctx) - (trig.flow ? (trigLeft <= 3 ? 1.4 : 0.35) : 0.15);
        let best = null;
        for (const o of opts) {
          const after = minus(P.hand, o.play.cards);
          let v;
          if (!after.length) v = E.isForbiddenFinish(o.play, S.rules, E.effRev(S)) ? -40 : 1000;
          else {
            const an = analyze(after, ctx);
            v = an.v + 0.8 + (an.nonControl <= 1 ? 1.2 : 0);
          }
          if (v > bestV) { bestV = v; best = o; }
        }
        return best ? { type: 'stop', seat, kind: best.kind } : { type: 'nostop', seat };
      }
      case 'give': case 'discard': {
        if (easy) return { type: q.kind, seat, cards: C.shuffle(P.hand.slice()).slice(0, q.count) };
        return { type: q.kind, seat, cards: worstCards(P.hand, q.count, ctx) };
      }
      case 'pickup': {
        if (easy) return { type: 'pickup', seat, cards: [] };
        let take = [];
        let base = evaluate(P.hand, ctx);
        for (const id of q.cards) {
          const v = evaluate(P.hand.concat(take, [id]), ctx);
          if (v > base + 0.15) { take.push(id); base = v; }
        }
        return { type: 'pickup', seat, cards: take };
      }
      case 'bomb': {
        if (easy) return { type: 'bomb', seat, ranks: [q.ranks[Math.floor(rnd() * q.ranks.length)]] };
        return { type: 'bomb', seat, ranks: chooseBomb(S, seat, q.count, P.hand, ctx) };
      }
      case 'exchange': {
        const ctxN = Object.assign({}, ctx, { rev: false });
        return { type: 'exchange', seat, cards: worstCards(P.hand, q.count, ctxN) };
      }
      case 'tenpen': return { type: 'tenpen', seat, accept: true };
    }
    throw new Error('unknown request ' + q.kind);
  }

  async function decide(S, q, level, budgetMs) {
    if (q.kind === 'turn' && level === 'hard') return chooseTurnMC(S, q.seat, budgetMs || 450);
    return decideSync(S, q, level);
  }

  /** 人間向けヒント（ふつうのAIの考え） */
  function suggest(S, seat) {
    return chooseTurnHeuristic(S, seat, 0).action;
  }

  D.AI = {
    decide, decideSync, suggest, evaluate, analyze, unknownInfo, makeCtx, worstCards, chooseBomb, fastAction,
    setRollout(p) { ROLLOUT = p; },
  };
})();
