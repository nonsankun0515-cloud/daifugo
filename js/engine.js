/* 大富豪 — ルールエンジン（UI・AI・将来のオンライン対戦で共通） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const C = D.Cards;
  const { CARDS, JOKER, strength } = C;

  // ─────────────────────────────────────────────
  // 出し方（Play）
  //   type: 'single' | 'set' | 'seq'
  //   cards: カードID配列, n: 枚数
  //   rank: single/set の数字（ジョーカー単体・ジョーカー2枚は JOKER）
  //   low/high/suit: 階段の範囲とマーク
  //   nat: 本物のカードのマーク（single/set）
  //   jokers: 使ったジョーカーの枚数
  //   wild: ジョーカーそのものとして出した（単体 or 2枚）
  //   declared: ジョーカー1枚を特定の数字として出した（6→9 や 階段縛りのとき）
  // ─────────────────────────────────────────────

  function makeSingle(id) {
    const c = CARDS[id];
    if (c.joker) return { type: 'single', cards: [id], n: 1, rank: JOKER, nat: [], jokers: 1, wild: true };
    return { type: 'single', cards: [id], n: 1, rank: c.rank, nat: [c.suit], jokers: 0 };
  }

  function playKey(p) {
    const range = p.type === 'seq' ? p.low + '-' + p.high : String(p.rank);
    return p.type + '|' + p.cards.slice().sort().join(',') + '|' + range + (p.declared ? '|d' : '');
  }

  function combinations(arr, m) {
    const out = [];
    const acc = [];
    (function rec(start) {
      if (acc.length === m) { out.push(acc.slice()); return; }
      for (let i = start; i < arr.length; i++) { acc.push(arr[i]); rec(i + 1); acc.pop(); }
    })(0);
    return out;
  }

  function indexHand(hand) {
    const byRank = {};
    const jokers = [];
    const bySuit = { S: {}, H: {}, D: {}, C: {} };
    for (const id of hand) {
      const c = CARDS[id];
      if (c.joker) { jokers.push(id); continue; }
      (byRank[c.rank] || (byRank[c.rank] = [])).push(id);
      bySuit[c.suit][c.rank] = id;
    }
    return { byRank, jokers, bySuit };
  }

  /** 手札から作れる出し方をすべて列挙（AI用。本物のカードがある所にジョーカーを使う出し方は省く） */
  function enumerate(hand, R, requireRank) {
    const { byRank, jokers, bySuit } = indexHand(hand);
    const J = jokers.length;
    const out = [];
    for (const id of hand) out.push(makeSingle(id));
    if (requireRank && J) out.push({ type: 'single', cards: [jokers[0]], n: 1, rank: requireRank, nat: [], jokers: 1, declared: true });
    for (const r in byRank) {
      const nats = byRank[r];
      const rank = +r;
      for (let m = 1; m <= nats.length; m++) {
        for (const sub of combinations(nats, m)) {
          for (let j = 0; j <= J; j++) {
            if (m + j < 2) continue;
            out.push({ type: 'set', cards: sub.concat(jokers.slice(0, j)), n: m + j, rank, nat: sub.map(C.suitOf), jokers: j });
          }
        }
      }
    }
    if (J === 2) out.push({ type: 'set', cards: jokers.slice(), n: 2, rank: JOKER, nat: [], jokers: 2, wild: true });
    if (R.sequence) {
      for (const s of C.SUITS) {
        const have = bySuit[s];
        for (let a = 3; a <= 13; a++) {
          let missing = 0;
          const ids = [];
          for (let b = a; b <= 15; b++) {
            if (have[b]) ids.push(have[b]); else missing++;
            if (missing > J) break;
            if (b - a + 1 >= 3 && ids.length >= 1) {
              out.push({ type: 'seq', cards: ids.concat(jokers.slice(0, missing)), n: b - a + 1, low: a, high: b, suit: s, nat: [], jokers: missing });
            }
          }
        }
      }
    }
    return out;
  }

  /** 選んだカードの組み合わせとして成り立つ出し方（人間の操作用） */
  function interpret(cards, R, requireRank) {
    const out = [];
    const n = cards.length;
    if (!n || new Set(cards).size !== n) return out;
    const nats = cards.filter((id) => !C.isJoker(id));
    const jk = cards.filter(C.isJoker);
    const J = jk.length;
    if (n === 1) {
      out.push(makeSingle(cards[0]));
      if (J === 1 && requireRank) out.push({ type: 'single', cards: cards.slice(), n: 1, rank: requireRank, nat: [], jokers: 1, declared: true });
      return out;
    }
    if (!nats.length) {
      if (n === 2) out.push({ type: 'set', cards: cards.slice(), n: 2, rank: JOKER, nat: [], jokers: 2, wild: true });
    } else {
      const r0 = C.rankOf(nats[0]);
      if (nats.every((id) => C.rankOf(id) === r0)) {
        out.push({ type: 'set', cards: nats.concat(jk), n, rank: r0, nat: nats.map(C.suitOf), jokers: J });
      }
    }
    if (R.sequence && n >= 3 && nats.length >= 1) {
      const s0 = C.suitOf(nats[0]);
      if (nats.every((id) => C.suitOf(id) === s0)) {
        const rs = nats.map(C.rankOf).sort((a, b) => a - b);
        let distinct = true;
        for (let i = 1; i < rs.length; i++) if (rs[i] === rs[i - 1]) distinct = false;
        if (distinct) {
          const gaps = rs[rs.length - 1] - rs[0] + 1 - rs.length;
          if (gaps <= J) {
            const extra = J - gaps;
            const ordered = nats.slice().sort((a, b) => C.rankOf(a) - C.rankOf(b));
            for (let e1 = extra; e1 >= 0; e1--) {
              const low = rs[0] - e1, high = rs[rs.length - 1] + (extra - e1);
              if (low < 3 || high > 15) continue;
              out.push({ type: 'seq', cards: ordered.concat(jk), n, low, high, suit: s0, nat: [], jokers: J });
            }
          }
        }
      }
    }
    return out;
  }

  // ─────────────────────────────────────────────
  // 強さ・合法手
  // ─────────────────────────────────────────────

  const effRev = (S) => S.revolution !== S.jback;
  const topEntry = (S) => (S.pile.length ? S.pile[S.pile.length - 1] : null);
  const topPlay = (S) => (S.pile.length ? S.pile[S.pile.length - 1].play : null);
  const nextRank = (r, rev) => (rev ? r - 1 : r + 1);
  const suitsOf = (p) => (p.type === 'seq' ? [p.suit] : p.nat);
  const isSand = (p, R) => R.sandstorm && p.type === 'set' && p.rank === 3 && p.n === 3;

  function seqMinSt(p, rev) { return Math.min(strength(p.low, rev), strength(p.high, rev)); }
  function seqMaxSt(p, rev) { return Math.max(strength(p.low, rev), strength(p.high, rev)); }

  function beats(p, top, rev, R) {
    if (p.type === 'seq') {
      if (R.seqCompare === 'all') return seqMinSt(p, rev) > seqMaxSt(top, rev);
      return seqMinSt(p, rev) > seqMinSt(top, rev);
    }
    if (top.wild) return false;
    if (p.wild) return true;
    return strength(p.rank, rev) > strength(top.rank, rev);
  }

  function downNumberOK(p, top, rev, R) {
    return R.downNumber && p.type === 'single' && top.type === 'single' && !p.wild && !top.wild &&
      p.jokers === 0 && top.jokers === 0 && p.nat[0] === top.nat[0] &&
      strength(p.rank, rev) === strength(top.rank, rev) - 1;
  }

  /** 次の出し方に必要な数字（6→9 や 階段縛り）。ジョーカー1枚をその数字として出せる */
  function requiredRank(S) {
    if (S.constraint) return S.constraint.rank;
    const top = topPlay(S);
    if (S.lock.number && top && top.type === 'single' && !top.wild) {
      const r = nextRank(top.rank, effRev(S));
      if (r >= 3 && r <= 15) return r;
    }
    return null;
  }

  function locksOK(S, p, top, rev) {
    const L = S.lock, R = S.rules;
    if (L.number) {
      if (p.wild || top.wild) return false;
      if (p.type === 'seq') {
        if (top.type !== 'seq') return false;
        const want = R.seqCompare === 'all' ? (rev ? top.low - p.n : top.high + 1) : (rev ? top.low - 1 : top.low + 1);
        if (p.low !== want) return false;
      } else if (p.rank !== nextRank(top.rank, rev)) return false;
    }
    if (!p.wild && L.suits) {
      if (p.type === 'seq') { if (L.suits.length !== 1 || L.suits[0] !== p.suit) return false; }
      else for (const s of p.nat) if (!L.suits.includes(s)) return false;
    }
    if (!p.wild && L.partial) {
      if (p.type === 'seq') { if (L.partial.length !== 1 || L.partial[0] !== p.suit) return false; }
      else {
        let missing = 0;
        for (const s of L.partial) if (!p.nat.includes(s)) missing++;
        if (missing > p.jokers) return false;
      }
    }
    return true;
  }

  function isSpade3Return(S, p) {
    const top = topPlay(S);
    return S.rules.spade3 && top && top.type === 'single' && top.wild &&
      p.type === 'single' && p.jokers === 0 && p.cards[0] === 'S3';
  }

  /** この出し方を今出せるか */
  function canPlay(S, seat, p) {
    const R = S.rules;
    const top = topPlay(S);
    if (!top) return !p.declared;
    if (R.passLock && S.passed[seat]) return false;
    if (isSand(p, R)) return true;
    if (isSpade3Return(S, p)) return true;
    const rev = effRev(S);
    if (S.constraint) {
      if (p.type !== 'single' || p.wild || p.rank !== S.constraint.rank) return false;
    } else {
      if (p.type !== top.type || p.n !== top.n) return false;
      if (p.declared && !(S.lock.number && p.rank === requiredRank(S))) return false;
      if (!beats(p, top, rev, R) && !downNumberOK(p, top, rev, R)) return false;
    }
    return locksOK(S, p, top, rev);
  }

  function legalPlays(S, seat) {
    const hand = S.players[seat].hand;
    return enumerate(hand, S.rules, requiredRank(S)).filter((p) => canPlay(S, seat, p));
  }

  function playsForCards(S, seat, cards) {
    return interpret(cards, S.rules, requiredRank(S)).filter((p) => canPlay(S, seat, p));
  }

  /** 出せない理由（人間向けの説明） */
  function explainIllegal(S, seat, cards) {
    const R = S.rules;
    if (!cards.length) return '';
    const cands = interpret(cards, R, requiredRank(S));
    if (!cands.length) return 'その組み合わせでは出せません';
    const top = topPlay(S);
    if (!top) return '';
    if (R.passLock && S.passed[seat]) return 'パスしたので、場が流れるまで出せません';
    const p = cands[0];
    const rev = effRev(S);
    if (S.constraint) return '次は ' + C.rankLabel(S.constraint.rank) + ' を1枚しか出せません（' + C.rankLabel(S.constraint.from) + '→' + C.rankLabel(S.constraint.rank) + '）';
    if (!cands.some((c) => c.type === top.type && c.n === top.n)) return '場と同じ形・枚数で出してください（場：' + shapeLabel(top) + '）';
    const same = cands.filter((c) => c.type === top.type && c.n === top.n);
    if (!same.some((c) => beats(c, top, rev, R) || downNumberOK(c, top, rev, R))) {
      if (top.wild) return R.spade3 && top.type === 'single' ? 'ジョーカーに勝てるのは♠3だけです' : 'ジョーカーには勝てません';
      return '場より強いカードを出してください' + (rev ? '（強さ逆転中）' : '');
    }
    if (S.lock.number) {
      const need = top.type === 'seq' ? '続きの階段' : C.rankLabel(nextRank(top.rank, rev));
      if (!same.some((c) => locksOK(S, Object.assign({}, c, { nat: c.nat }), top, rev))) {
        if (S.lock.suits) return '激縛り中：' + S.lock.suits.map((s) => C.SUIT_SYM[s]).join('') + ' の ' + need + ' だけ出せます';
        return '階段縛り中：' + need + ' だけ出せます';
      }
    }
    if (S.lock.suits) return S.lock.suits.map((s) => C.SUIT_SYM[s]).join('') + ' 縛り中です';
    if (S.lock.partial) return S.lock.partial.map((s) => C.SUIT_SYM[s]).join('') + ' を含めてください（片縛り）';
    return '今は出せません';
  }

  // ─────────────────────────────────────────────
  // カードの効果
  // ─────────────────────────────────────────────

  function effectsOf(p, S) {
    const R = S.rules;
    const fx = { sand: false, revolution: false, omen: false, greatRev: false, revKind: null, jToggles: 0, flow: null,
      skip: 0, give: 0, back: 0, discard: 0, bomb: 0, take: false, reverse: false, lucky: false };
    if (p.wild) return fx;
    const isSeq = p.type === 'seq';
    const cnt = (rank) => (isSeq ? (p.low <= rank && rank <= p.high ? 1 : 0) : (p.rank === rank ? p.n : 0));
    const seqAll = !isSeq || R.seqEffects === 'all';
    const seqEight = !isSeq || R.seqEffects !== 'none';
    if (isSand(p, R)) { fx.sand = true; return fx; }
    if (p.type === 'set') {
      if (p.n >= 4 && R.revolution) { fx.revolution = true; fx.revKind = 'normal'; }
      if (p.n === 3 && p.rank === 9 && R.coup) { fx.revolution = true; fx.revKind = 'coup'; }
      if (p.n === 3 && p.rank === 6 && R.omen) { fx.revolution = true; fx.omen = true; fx.revKind = 'omen'; }
      if (p.n >= 4 && p.rank === 15 && R.greatRevolution) { fx.revolution = true; fx.greatRev = true; fx.revKind = 'great'; }
    } else if (isSeq && R.seqRevolution !== 'off' && p.n >= +R.seqRevolution) { fx.revolution = true; fx.revKind = 'seq'; }
    if (S.revoLocked) { fx.revolution = false; fx.omen = false; }
    if (seqAll) {
      if (R.jBack && cnt(11)) fx.jToggles++;
      if (R.twoBack && cnt(15)) fx.jToggles++;
    }
    if (seqEight && R.eightCut && cnt(8)) fx.flow = '8';
    else if (!isSeq && R.rokurokubi && p.rank === 6 && p.n === 2) fx.flow = '66';
    else if (!isSeq && R.kyukyusha && p.rank === 9 && p.n === 2) fx.flow = '99';
    if (seqAll) {
      if (R.fiveSkip) fx.skip += cnt(5);
      if (R.kingSkip) fx.skip += cnt(13);
      if (R.sevenPass) fx.give = cnt(7);
      if (R.nineBack) fx.back = cnt(9);
      if (R.tenDiscard) fx.discard = cnt(10);
      if (R.queenBomber) fx.bomb = cnt(12);
      if (R.aceTake && cnt(14)) fx.take = true;
      if (R.nineReverse && cnt(9)) fx.reverse = true;
    }
    if (R.luckySeven && p.type === 'set' && p.rank === 7 && p.n === 3) fx.lucky = true;
    return fx;
  }

  function playHasRank(p, r) {
    if (p.wild) return false;
    if (p.type === 'seq') return p.low <= r && r <= p.high;
    return p.rank === r;
  }

  /** 反則上がりか（rev は出したときの強さの向き） */
  function isForbiddenFinish(p, R, rev) {
    if (R.forbidJoker && p.jokers > 0) return true;
    if (R.forbidTwo && playHasRank(p, rev ? 3 : 15)) return true;
    if (R.forbidEight && playHasRank(p, 8)) return true;
    if (R.forbidSpade3 && p.cards.includes('S3')) return true;
    return false;
  }

  function suitMatch(a, b) {
    if (a.wild || b.wild) return false;
    if (a.type === 'seq' && b.type === 'seq') return a.suit === b.suit;
    if (a.type === 'seq' || b.type === 'seq') return false;
    if (a.jokers || b.jokers) return false;
    if (a.nat.length !== b.nat.length) return false;
    return a.nat.every((s) => b.nat.includes(s));
  }

  function consecutive(prev, cur, rev, R) {
    if (prev.wild || cur.wild) return false;
    if (cur.type === 'seq') {
      if (R.seqCompare === 'all') return rev ? cur.high === prev.low - 1 : cur.low === prev.high + 1;
      return rev ? cur.low === prev.low - 1 : cur.low === prev.low + 1;
    }
    return cur.rank === nextRank(prev.rank, rev);
  }

  /** 縛り・6→9 の更新。発生した縛りの種類を返す */
  function updateLocks(S, prev, cur, revBefore) {
    const R = S.rules;
    const evs = [];
    S.constraint = null;
    if (cur.type === 'single' && !cur.wild) {
      if (R.sixNine && cur.rank === 6) S.constraint = { rank: 9, from: 6 };
      else if (R.nineSix && cur.rank === 9) S.constraint = { rank: 6, from: 9 };
    }
    if (!prev || prev.type !== cur.type || prev.n !== cur.n) return evs;
    const same = suitMatch(prev, cur);
    const consec = consecutive(prev, cur, revBefore, R);
    const geki = R.gekiLock && same && consec;
    const wantSuit = (R.suitLock && same) || geki;
    const wantNum = (R.numberLock && consec) || geki;
    if (wantSuit && !S.lock.suits) {
      S.lock.suits = suitsOf(cur).slice();
      S.lock.partial = null;
      evs.push(geki && !S.lock.number ? 'geki' : 'suit');
    } else if (!S.lock.suits && R.partialLock && cur.type === 'set' && cur.n >= 2) {
      const inter = cur.nat.filter((s) => prev.nat.includes(s));
      const before = S.lock.partial || [];
      const merged = before.concat(inter.filter((s) => !before.includes(s)));
      if (merged.length > before.length) { S.lock.partial = merged; evs.push('partial'); }
    }
    if (wantNum && !S.lock.number) {
      S.lock.number = true;
      if (!evs.includes('geki')) evs.push('number');
    }
    return evs;
  }

  // ─────────────────────────────────────────────
  // 状態（試合・ゲーム）
  // ─────────────────────────────────────────────

  const TITLES = {
    3: ['大富豪', '平民', '大貧民'],
    4: ['大富豪', '富豪', '貧民', '大貧民'],
    5: ['大富豪', '富豪', '平民', '貧民', '大貧民'],
    6: ['大富豪', '富豪', '平民', '平民', '貧民', '大貧民'],
  };
  const titleOf = (n, i) => (TITLES[n] || TITLES[4])[i];

  function createMatch(opt) {
    const rules = D.Rules.normalize(opt.rules);
    const S = {
      rules,
      n: opt.players.length,
      players: opt.players.map((p, i) => ({
        seat: i, name: p.name, human: !!p.human, level: p.level || 'normal',
        hand: [], out: false, foul: false, score: 0, lastPlace: null,
      })),
      gameNo: 0,
      prevRanking: null,
      phase: 'idle',
      rng: opt.seed != null ? C.mulberry32(opt.seed) : Math.random,
      events: [],
      silent: !!opt.silent,
    };
    resetGame(S);
    return S;
  }

  function resetGame(S) {
    S.pile = [];
    S.discard = [];
    S.revolution = false;
    S.jback = false;
    S.revoLocked = false;
    S.lock = { suits: null, partial: null, number: false };
    S.constraint = null;
    S.finished = [];
    S.bottom = [];
    S.passCount = 0;
    S.lastSeat = null;
    S.passed = new Array(S.n).fill(false);
    S.dir = 1;
    S.turn = 0;
    S.pending = null;
    S.queue = [];
    S.resolving = null;
    S.exch = null;
    S.moves = 0;
  }

  function emit(S, ev) { if (!S.silent) S.events.push(ev); }

  function removeCards(P, cards) {
    for (const id of cards) {
      const i = P.hand.indexOf(id);
      if (i < 0) throw new Error('手札にないカード: ' + id);
      P.hand.splice(i, 1);
    }
  }
  function addCards(S, P, cards) { P.hand = C.sortHand(P.hand.concat(cards), false); }

  function nextActive(S, s, dir) {
    const d = dir || S.dir;
    for (let i = 1; i <= S.n; i++) {
      const t = (((s + d * i) % S.n) + S.n) % S.n;
      if (!S.players[t].out) return t;
    }
    return null;
  }
  const prevActive = (S, s) => nextActive(S, s, -S.dir);
  const activeCount = (S) => S.players.reduce((k, p) => k + (p.out ? 0 : 1), 0);

  /** 新しいゲームを配る。presetHands（テスト・オンライン同期用）を渡すとその手札で始める */
  function startGame(S, presetHands) {
    S.gameNo++;
    resetGame(S);
    for (const p of S.players) { p.hand = []; p.out = false; p.foul = false; }
    if (presetHands) {
      presetHands.forEach((h, i) => { S.players[i].hand = h.slice(); });
    } else {
      const deck = C.shuffle(C.makeDeck(S.rules.jokers), S.rng);
      let seat = Math.floor(S.rng() * S.n);
      for (const id of deck) { S.players[seat].hand.push(id); seat = (seat + 1) % S.n; }
    }
    for (const p of S.players) p.hand = C.sortHand(p.hand, false);
    emit(S, { t: 'deal', game: S.gameNo });
    if (S.gameNo > 1 && S.prevRanking && S.rules.exchange) setupExchange(S);
    else beginPlay(S);
  }

  function strongestCards(hand, k) {
    return C.sortHand(hand, false).slice(-k);
  }

  function setupExchange(S) {
    const rk = S.prevRanking, n = S.n;
    const pairs = [{ rich: rk[0], poor: rk[n - 1], count: 2 }];
    if (n >= 4) pairs.push({ rich: rk[1], poor: rk[n - 2], count: 1 });
    S.phase = 'exchange';
    S.exch = { pairs };
    if (S.rules.tenpen) {
      const poor = rk[n - 1];
      if (S.players[poor].hand.every((id) => !C.isJoker(id) && C.rankOf(id) <= 10)) {
        S.pending = { kind: 'tenpen', seat: poor, rich: rk[0] };
        return;
      }
    }
    exchangeGive(S);
  }

  function exchangeGive(S) {
    S.queue = [];
    for (const pr of S.exch.pairs) {
      if (pr.skip) continue;
      const give = strongestCards(S.players[pr.poor].hand, pr.count);
      removeCards(S.players[pr.poor], give);
      addCards(S, S.players[pr.rich], give);
      emit(S, { t: 'exchange', from: pr.poor, to: pr.rich, cards: give, auto: true });
      S.queue.push({ kind: 'exchange', seat: pr.rich, to: pr.poor, count: pr.count, got: give.slice() });
    }
    nextExchange(S);
  }

  function nextExchange(S) {
    S.pending = S.queue.length ? S.queue.shift() : null;
    if (!S.pending) beginPlay(S);
  }

  function beginPlay(S) {
    const R = S.rules;
    S.phase = 'play';
    S.pending = null;
    let leader;
    if (S.gameNo > 1 && S.prevRanking && R.nextLead === 'poorest') leader = S.prevRanking[S.n - 1];
    else if (R.firstLead === 'random') leader = Math.floor(S.rng() * S.n);
    else {
      const card = R.firstLead === 'S3' ? 'S3' : 'D3';
      leader = S.players.findIndex((p) => p.hand.includes(card));
      if (leader < 0) leader = 0;
    }
    S.turn = leader;
    emit(S, { t: 'start', leader });
  }

  /** 次に誰が何をする必要があるか */
  function getRequest(S) {
    if (S.phase !== 'play' && S.phase !== 'exchange') return null;
    if (S.pending) return S.pending;
    if (S.phase === 'play') return { kind: 'turn', seat: S.turn };
    return null;
  }

  function validatePlay(S, seat, play) {
    const P = S.players[seat];
    if (!play || !Array.isArray(play.cards) || !play.cards.length) throw new Error('カードが選ばれていません');
    for (const id of play.cards) if (!P.hand.includes(id)) throw new Error('手札にないカード: ' + id);
    const key = playKey(play);
    const cand = interpret(play.cards, S.rules, requiredRank(S)).find((p) => playKey(p) === key);
    if (!cand) throw new Error('出し方が正しくありません');
    if (!canPlay(S, seat, cand)) throw new Error('今は出せません');
    return cand;
  }

  function doPlay(S, seat, play) {
    const R = S.rules;
    const P = S.players[seat];
    const p = validatePlay(S, seat, play);
    const revBefore = effRev(S);
    const prevIdx = S.pile.length - 1;
    const spade3 = isSpade3Return(S, p);
    removeCards(P, p.cards);
    S.pile.push({ seat, play: p, shown: p.cards.slice() });
    S.moves++;
    const fx = effectsOf(p, S);
    emit(S, { t: 'play', seat, play: p, rev: revBefore });
    if (P.hand.length === 0) {
      finishPlayer(S, seat, p, revBefore);
      if (S.phase === 'over') return;
    }
    if (fx.sand) { emit(S, { t: 'sand', seat }); flowPile(S, seat, 'sand'); return; }
    if (spade3) { emit(S, { t: 'spade3', seat }); flowPile(S, seat, 'spade3'); return; }
    if (fx.revolution) {
      S.revolution = !S.revolution;
      if (fx.omen) S.revoLocked = true;
      emit(S, { t: 'revolution', seat, on: S.revolution, kind: fx.revKind });
    }
    if (fx.greatRev && !P.out) {
      const rest = P.hand.slice();
      S.discard.push(...rest);
      P.hand = [];
      emit(S, { t: 'greatRevolution', seat, cards: rest });
      finishPlayer(S, seat, null, revBefore);
      if (S.phase === 'over') return;
    }
    if (fx.jToggles % 2 === 1) {
      S.jback = !S.jback;
      emit(S, { t: 'jback', seat, on: S.jback, by: playHasRank(p, 11) && R.jBack ? 'J' : '2' });
    }
    S.lastSeat = seat;
    S.passCount = 0;
    S.resolving = { seat, play: p, fx, prevIdx, revBefore, step: 0 };
    if ((fx.flow || fx.skip > 0) && openStopWindow(S)) return;
    continueResolve(S);
  }

  function pickSet(hand, rank, n) {
    const nats = hand.filter((id) => !C.isJoker(id) && C.rankOf(id) === rank);
    const jk = hand.filter(C.isJoker);
    if (nats.length === 0 || nats.length + jk.length < n) return null;
    const use = nats.slice(0, n);
    const cards = use.concat(jk.slice(0, n - use.length));
    return { type: 'set', cards, n, rank, nat: use.map(C.suitOf), jokers: cards.length - use.length };
  }

  /** スキップで飛ばされる人（advanceAfterPlay と同じ数え方） */
  function skipTargets(S, seat, n, dir) {
    const out = [];
    const need = activeCount(S) - (S.players[seat].out ? 0 : 1);
    let cur = seat;
    for (let i = 0; i < n && out.length < need; i++) {
      const nx = nextActive(S, cur, dir);
      if (nx === null || nx === seat) break;
      out.push(nx);
      cur = nx;
    }
    return out;
  }

  /** 止め札の選択肢（4止め・3止め・砂嵐）。スキップを止められるのは飛ばされる本人だけ */
  function stopOptions(S, seat) {
    const R = S.rules, r = S.resolving;
    if (!r) return [];
    const fx = r.fx;
    const hand = S.players[seat].hand;
    const scopeOK = R.stopScope === 'any' || r.play.n === 1;
    const skipped = !fx.flow && fx.skip > 0 && skipTargets(S, r.seat, fx.skip, fx.reverse ? -S.dir : S.dir).includes(seat);
    const opts = [];
    if (fx.flow === '8' && R.fourStop && scopeOK) { const p = pickSet(hand, 4, 2); if (p) opts.push({ kind: 'four', play: p }); }
    if (skipped && R.threeStop && scopeOK) { const p = pickSet(hand, 3, 2); if (p) opts.push({ kind: 'three', play: p }); }
    if ((fx.flow || skipped) && R.sandstorm) { const p = pickSet(hand, 3, 3); if (p) opts.push({ kind: 'sand', play: p }); }
    return opts;
  }

  function openStopWindow(S) {
    const r = S.resolving;
    const cands = [];
    let s = r.seat;
    for (let i = 0; i < S.n - 1; i++) {
      s = (((s + S.dir) % S.n) + S.n) % S.n;
      if (!S.players[s].out && stopOptions(S, s).length) cands.push(s);
    }
    if (!cands.length) return false;
    S.pending = { kind: 'stop', seat: cands[0], rest: cands.slice(1), trigger: { seat: r.seat, flow: r.fx.flow, skip: r.fx.skip, play: r.play } };
    return true;
  }

  function doStop(S, seat, kind) {
    const opt = stopOptions(S, seat).find((o) => o.kind === kind);
    if (!opt) throw new Error('止められません');
    const P = S.players[seat];
    const against = S.resolving.seat;
    removeCards(P, opt.play.cards);
    S.pile.push({ seat, play: opt.play, shown: opt.play.cards.slice(), stop: kind });
    emit(S, { t: 'stop', seat, kind, play: opt.play, against });
    const rev = effRev(S);
    S.pending = null;
    S.resolving = null;
    if (P.hand.length === 0) {
      finishPlayer(S, seat, opt.play, rev);
      if (S.phase === 'over') return;
    }
    flowPile(S, seat, 'stop');
  }

  function doNoStop(S) {
    const pd = S.pending;
    if (pd.rest.length) {
      S.pending = Object.assign({}, pd, { seat: pd.rest[0], rest: pd.rest.slice(1) });
      return;
    }
    S.pending = null;
    continueResolve(S);
  }

  function continueResolve(S) {
    const r = S.resolving;
    const P = S.players[r.seat];
    const fx = r.fx;
    while (r.step < 5) {
      const step = r.step++;
      if (step === 0 && fx.take && !P.out && r.prevIdx >= 0 && S.pile[r.prevIdx] && S.pile[r.prevIdx].shown.length) {
        S.pending = { kind: 'pickup', seat: r.seat, cards: S.pile[r.prevIdx].shown.slice() };
        return;
      }
      if (step === 1 && fx.give > 0 && !P.out && P.hand.length) {
        const to = nextActive(S, r.seat);
        if (to !== null && to !== r.seat) {
          S.pending = { kind: 'give', seat: r.seat, to, count: Math.min(fx.give, P.hand.length), label: '7渡し' };
          return;
        }
      }
      if (step === 2 && fx.back > 0 && !P.out && P.hand.length) {
        const to = prevActive(S, r.seat);
        if (to !== null && to !== r.seat) {
          S.pending = { kind: 'give', seat: r.seat, to, count: Math.min(fx.back, P.hand.length), label: '9戻し' };
          return;
        }
      }
      if (step === 3 && fx.discard > 0 && !P.out && P.hand.length) {
        S.pending = { kind: 'discard', seat: r.seat, count: Math.min(fx.discard, P.hand.length) };
        return;
      }
      if (step === 4 && fx.bomb > 0) {
        // 指名できるのは自分の手札にある数字だけ
        const ranks = bombableRanks(P.hand);
        if (!ranks.length) { emit(S, { t: 'bomb', seat: r.seat, ranks: [], removed: {}, none: true }); continue; }
        S.pending = { kind: 'bomb', seat: r.seat, count: Math.min(fx.bomb, ranks.length), ranks };
        return;
      }
    }
    finalizePlay(S);
  }

  function finalizePlay(S) {
    const r = S.resolving;
    S.resolving = null;
    S.pending = null;
    const P = S.players[r.seat];
    if (!P.out && P.hand.length === 0) {
      finishPlayer(S, r.seat, r.play, r.revBefore);
      if (S.phase === 'over') return;
    }
    if (r.fx.reverse) {
      S.dir = -S.dir;
      emit(S, { t: 'reverse', seat: r.seat, dir: S.dir });
    }
    if (r.fx.flow) {
      emit(S, { t: 'cut', seat: r.seat, kind: r.fx.flow });
      flowPile(S, r.seat, 'cut');
      return;
    }
    const prev = r.prevIdx >= 0 && S.pile[r.prevIdx] ? S.pile[r.prevIdx].play : null;
    const lockEvs = updateLocks(S, prev, r.play, r.revBefore);
    for (const k of lockEvs) emit(S, { t: 'lock', kind: k, lock: copyLock(S.lock) });
    if (S.constraint) emit(S, { t: 'constraint', rank: S.constraint.rank, from: S.constraint.from });
    if (r.fx.lucky) S.pile[S.pile.length - 1].lucky = true;
    advanceAfterPlay(S, r.seat, r.fx.skip);
  }

  const copyLock = (L) => ({ suits: L.suits && L.suits.slice(), partial: L.partial && L.partial.slice(), number: L.number });

  function neededPasses(S) {
    const n = activeCount(S);
    return S.lastSeat !== null && !S.players[S.lastSeat].out ? n - 1 : n;
  }
  function flowLeader(S) {
    return S.players[S.lastSeat].out ? nextActive(S, S.lastSeat) : S.lastSeat;
  }

  function advanceAfterPlay(S, seat, skipN) {
    let cur = seat;
    const skipped = [];
    for (let i = 0; i < skipN; i++) {
      if (S.passCount >= neededPasses(S)) break;
      const nx = nextActive(S, cur);
      if (nx === null || nx === S.lastSeat) break;
      skipped.push(nx);
      cur = nx;
      S.passCount++;
    }
    if (skipped.length) emit(S, { t: 'skip', seat, seats: skipped });
    if (S.passCount >= neededPasses(S)) { flowPile(S, flowLeader(S), 'pass'); return; }
    S.turn = nextActive(S, cur);
    settleTurn(S);
  }

  function settleTurn(S) {
    if (!S.rules.passLock) return;
    let guard = 0;
    while (S.phase === 'play' && S.pile.length && S.passed[S.turn] && guard++ < 20) {
      emit(S, { t: 'pass', seat: S.turn, auto: true });
      S.passCount++;
      if (S.passCount >= neededPasses(S)) { passFlow(S); return; }
      S.turn = nextActive(S, S.turn);
    }
  }

  function doPass(S, seat) {
    if (!S.pile.length) throw new Error('親はパスできません');
    S.passCount++;
    if (S.rules.passLock) S.passed[seat] = true;
    emit(S, { t: 'pass', seat });
    if (S.passCount >= neededPasses(S)) { passFlow(S); return; }
    S.turn = nextActive(S, seat);
    settleTurn(S);
  }

  function passFlow(S) {
    const top = topEntry(S);
    if (top && top.lucky && top.seat === S.lastSeat && !S.players[top.seat].out) {
      const L = S.players[top.seat];
      const rest = L.hand.slice();
      S.discard.push(...rest);
      L.hand = [];
      emit(S, { t: 'lucky', seat: top.seat, cards: rest });
      finishPlayer(S, top.seat, null, effRev(S));
      if (S.phase === 'over') return;
    }
    flowPile(S, flowLeader(S), 'pass');
  }

  function flowPile(S, s, reason) {
    for (const e of S.pile) S.discard.push(...e.shown);
    S.pile = [];
    const wasJ = S.jback;
    S.jback = false;
    S.lock = { suits: null, partial: null, number: false };
    S.constraint = null;
    S.passCount = 0;
    S.lastSeat = null;
    S.passed.fill(false);
    const leader = S.players[s].out ? nextActive(S, s) : s;
    emit(S, { t: 'flow', reason, leader, jbackEnded: wasJ });
    if (leader !== null) S.turn = leader;
  }

  function finishPlayer(S, seat, play, rev) {
    const R = S.rules, P = S.players[seat];
    if (P.out) return;
    P.out = true;
    const foul = play ? isForbiddenFinish(play, R, rev) : false;
    if (foul) {
      P.foul = true;
      S.bottom.push(seat);
      emit(S, { t: 'foul', seat, play });
    } else {
      S.finished.push(seat);
      emit(S, { t: 'finish', seat, place: S.finished.length });
      if (S.finished.length === 1 && S.prevRanking) {
        const top = S.prevRanking[0], low = S.prevRanking[S.n - 1];
        if (R.gekokujo && seat === low && seat !== top) { gekokujo(S, seat); return; }
        if (R.miyakoOchi && seat !== top && !S.players[top].out) {
          const T = S.players[top];
          const cards = T.hand.slice();
          S.discard.push(...cards);
          T.hand = [];
          T.out = true;
          S.bottom.push(top);
          emit(S, { t: 'miyako', seat: top, cards });
        }
      }
    }
    checkGameEnd(S);
  }

  function gekokujo(S, seat) {
    emit(S, { t: 'gekokujo', seat });
    for (const p of S.players) {
      if (!p.out) { S.discard.push(...p.hand); p.hand = []; p.out = true; }
    }
    endGame(S, S.prevRanking.slice().reverse());
  }

  function checkGameEnd(S) {
    if (S.phase === 'over') return;
    const active = S.players.filter((p) => !p.out);
    if (active.length > 1) return;
    if (active.length === 1) {
      const L = active[0];
      L.out = true;
      S.finished.push(L.seat);
      emit(S, { t: 'last', seat: L.seat, cards: L.hand.slice() });
    }
    endGame(S, S.finished.concat(S.bottom.slice().reverse()));
  }

  function endGame(S, ranking) {
    S.phase = 'over';
    S.pending = null;
    S.resolving = null;
    S.queue = [];
    S.prevRanking = ranking.slice();
    ranking.forEach((seat, i) => {
      S.players[seat].score += S.n - 1 - i;
      S.players[seat].lastPlace = i;
    });
    emit(S, { t: 'over', ranking: ranking.slice(), titles: ranking.map((_, i) => titleOf(S.n, i)) });
  }

  function subsetOf(hand, cards, max) {
    if (!Array.isArray(cards)) throw new Error('カードの指定が不正です');
    if (cards.length > max) throw new Error(max + '枚までです');
    if (new Set(cards).size !== cards.length) throw new Error('同じカードが重複しています');
    for (const id of cards) if (!hand.includes(id)) throw new Error('そのカードは選べません: ' + id);
    return cards.slice();
  }

  function doGive(S, cards) {
    const pd = S.pending;
    const P = S.players[pd.seat];
    cards = subsetOf(P.hand, cards, pd.count);
    if (cards.length) { removeCards(P, cards); addCards(S, S.players[pd.to], cards); }
    emit(S, { t: 'give', from: pd.seat, to: pd.to, cards, label: pd.label });
    S.pending = null;
    continueResolve(S);
  }

  function doDiscard(S, cards) {
    const pd = S.pending;
    const P = S.players[pd.seat];
    cards = subsetOf(P.hand, cards, pd.count);
    if (cards.length) { removeCards(P, cards); S.discard.push(...cards); }
    emit(S, { t: 'discard', seat: pd.seat, cards });
    S.pending = null;
    continueResolve(S);
  }

  function doPickup(S, cards) {
    const pd = S.pending;
    const r = S.resolving;
    const entry = S.pile[r.prevIdx];
    cards = subsetOf(entry.shown, cards, entry.shown.length);
    if (cards.length) {
      entry.shown = entry.shown.filter((id) => !cards.includes(id));
      addCards(S, S.players[pd.seat], cards);
    }
    emit(S, { t: 'pickup', seat: pd.seat, cards, from: entry.seat });
    S.pending = null;
    continueResolve(S);
  }

  /** 12ボンバーで指名できる数字（手札にある本物のカードの数字） */
  function bombableRanks(hand) {
    const set = new Set();
    for (const id of hand) if (!C.isJoker(id)) set.add(C.rankOf(id));
    return Array.from(set).sort((a, b) => a - b);
  }

  function doBomb(S, ranks) {
    const pd = S.pending;
    if (!Array.isArray(ranks)) throw new Error('数字の指定が不正です');
    ranks = Array.from(new Set(ranks.map(Number)));
    if (ranks.length > pd.count) throw new Error(pd.count + 'つまでです');
    for (const r of ranks) if (!pd.ranks.includes(r)) throw new Error('手札にある数字しか指名できません');
    const order = [];
    for (let i = 0, s = pd.seat; i < S.n; i++, s = (((s + S.dir) % S.n) + S.n) % S.n) order.push(s);
    const removed = {};
    for (const seat of order) {
      const P = S.players[seat];
      if (P.out) continue;
      const rm = P.hand.filter((id) => !C.isJoker(id) && ranks.includes(C.rankOf(id)));
      if (rm.length) { removeCards(P, rm); S.discard.push(...rm); removed[seat] = rm; }
    }
    emit(S, { t: 'bomb', seat: pd.seat, ranks, removed });
    S.pending = null;
    const r = S.resolving;
    for (const seat of order) {
      const P = S.players[seat];
      if (P.out || P.hand.length) continue;
      finishPlayer(S, seat, seat === r.seat ? r.play : null, r.revBefore);
      if (S.phase === 'over') return;
    }
    continueResolve(S);
  }

  function doExchange(S, cards) {
    const pd = S.pending;
    const P = S.players[pd.seat];
    cards = subsetOf(P.hand, cards, pd.count);
    if (cards.length !== Math.min(pd.count, P.hand.length)) throw new Error(pd.count + '枚えらんでください');
    removeCards(P, cards);
    addCards(S, S.players[pd.to], cards);
    emit(S, { t: 'exchange', from: pd.seat, to: pd.to, cards });
    nextExchange(S);
  }

  function doTenpen(S, accept) {
    const pd = S.pending;
    if (accept) {
      const a = S.players[pd.seat], b = S.players[pd.rich];
      const t = a.hand;
      a.hand = b.hand;
      b.hand = t;
      S.exch.pairs[0].skip = true;
      emit(S, { t: 'tenpen', seat: pd.seat, with: pd.rich });
    }
    S.pending = null;
    exchangeGive(S);
  }

  /** 行動を適用し、発生したイベント列を返す */
  function apply(S, a) {
    S.events = [];
    const req = getRequest(S);
    if (!req) throw new Error('今は操作できません');
    if (a.seat !== req.seat) throw new Error('あなたの番ではありません');
    const need = { play: 'turn', pass: 'turn', stop: 'stop', nostop: 'stop', give: 'give', discard: 'discard',
      pickup: 'pickup', bomb: 'bomb', exchange: 'exchange', tenpen: 'tenpen' }[a.type];
    if (need !== req.kind) throw new Error('今はその操作はできません');
    switch (a.type) {
      case 'play': doPlay(S, a.seat, a.play); break;
      case 'pass': doPass(S, a.seat); break;
      case 'stop': doStop(S, a.seat, a.kind); break;
      case 'nostop': doNoStop(S); break;
      case 'give': doGive(S, a.cards || []); break;
      case 'discard': doDiscard(S, a.cards || []); break;
      case 'pickup': doPickup(S, a.cards || []); break;
      case 'bomb': doBomb(S, a.ranks || []); break;
      case 'exchange': doExchange(S, a.cards || []); break;
      case 'tenpen': doTenpen(S, !!a.accept); break;
    }
    return S.events;
  }

  /** シミュレーション用の複製（イベントは記録しない） */
  function clone(S) {
    const T = Object.assign({}, S);
    T.players = S.players.map((p) => Object.assign({}, p, { hand: p.hand.slice() }));
    T.pile = S.pile.map((e) => Object.assign({}, e, { shown: e.shown.slice() }));
    T.discard = S.discard.slice();
    T.lock = copyLock(S.lock);
    T.constraint = S.constraint && Object.assign({}, S.constraint);
    T.finished = S.finished.slice();
    T.bottom = S.bottom.slice();
    T.passed = S.passed.slice();
    T.pending = S.pending && Object.assign({}, S.pending, S.pending.rest ? { rest: S.pending.rest.slice() } : {});
    T.queue = S.queue.map((q) => Object.assign({}, q));
    T.resolving = S.resolving && Object.assign({}, S.resolving);
    T.exch = S.exch && { pairs: S.exch.pairs.map((p) => Object.assign({}, p)) };
    T.prevRanking = S.prevRanking && S.prevRanking.slice();
    T.events = [];
    T.silent = true;
    return T;
  }

  /** 保存用（関数を除いたJSON） */
  function serialize(S) {
    const o = Object.assign({}, S);
    delete o.rng;
    o.events = [];
    return JSON.parse(JSON.stringify(o));
  }
  function deserialize(o) {
    const S = Object.assign({}, o);
    S.rules = D.Rules.normalize(o.rules);
    S.rng = Math.random;
    S.events = [];
    return S;
  }

  // ─────────────────────────────────────────────
  // 表示用の説明
  // ─────────────────────────────────────────────

  const SET_NAMES = { 2: 'ペア', 3: 'スリーカード', 4: '4枚' };
  function shapeLabel(p) {
    if (p.type === 'single') return '1枚';
    if (p.type === 'seq') return p.n + '枚の階段';
    return SET_NAMES[p.n] || p.n + '枚';
  }

  function describePlay(p) {
    if (p.wild) return p.n === 1 ? 'ジョーカー' : 'ジョーカー2枚';
    if (p.type === 'seq') {
      return C.SUIT_SYM[p.suit] + C.rankLabel(p.low) + '〜' + C.rankLabel(p.high) + ' の階段';
    }
    if (p.type === 'single') {
      if (p.declared) return 'ジョーカー（' + C.rankLabel(p.rank) + 'として）';
      return C.SUIT_SYM[p.nat[0]] + C.rankLabel(p.rank);
    }
    return C.rankLabel(p.rank) + ' の' + (SET_NAMES[p.n] || p.n + '枚');
  }

  D.Engine = {
    enumerate, interpret, playKey, canPlay, legalPlays, playsForCards, explainIllegal, requiredRank,
    effectsOf, isForbiddenFinish, effRev, topPlay, topEntry, nextActive, prevActive, activeCount, stopOptions, skipTargets, bombableRanks,
    createMatch, startGame, getRequest, apply, clone, serialize, deserialize,
    titleOf, describePlay, shapeLabel, strongestCards, isSand,
  };
})();
