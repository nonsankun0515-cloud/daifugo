/* 大富豪 — カードの基本定義 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣', X: '' };
  const SUIT_NAME = { S: 'スペード', H: 'ハート', D: 'ダイヤ', C: 'クラブ' };
  const RED = { H: true, D: true };
  // 11=J 12=Q 13=K 14=A 15=2
  const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const RANK_LABEL = { 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2' };
  const JOKER = 16; // ジョーカー単体（ジョーカーそのもの）として出すときのランク

  const CARDS = {};
  for (const s of SUITS) for (const r of RANKS) CARDS[s + r] = { id: s + r, suit: s, rank: r, joker: false };
  CARDS.X1 = { id: 'X1', suit: 'X', rank: JOKER, joker: true };
  CARDS.X2 = { id: 'X2', suit: 'X', rank: JOKER, joker: true };

  function makeDeck(jokers) {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(s + r);
    for (let i = 1; i <= jokers; i++) d.push('X' + i);
    return d;
  }

  const isJoker = (id) => id.charCodeAt(0) === 88; // 'X'
  const rankOf = (id) => CARDS[id].rank;
  const suitOf = (id) => CARDS[id].suit;

  /** ランクの強さ。reversed = 革命とJバックの合成（XOR） */
  function strength(rank, reversed) {
    if (rank === JOKER) return 100;
    return reversed ? 18 - rank : rank;
  }

  const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3, X: 4 };
  /** 手札の表示順：弱い→強い（革命中は逆）、同じ数字はマーク順、ジョーカーは右端 */
  function sortHand(ids, reversed) {
    return ids.slice().sort((a, b) => {
      const ca = CARDS[a], cb = CARDS[b];
      if (ca.joker !== cb.joker) return ca.joker ? 1 : -1;
      if (ca.joker) return a < b ? -1 : 1;
      const sa = strength(ca.rank, reversed), sb = strength(cb.rank, reversed);
      if (sa !== sb) return sa - sb;
      return SUIT_ORDER[ca.suit] - SUIT_ORDER[cb.suit];
    });
  }

  function cardLabel(id) {
    const c = CARDS[id];
    if (c.joker) return 'JOKER';
    return SUIT_SYM[c.suit] + RANK_LABEL[c.rank];
  }
  const rankLabel = (r) => (r === JOKER ? 'JOKER' : RANK_LABEL[r]);

  // 再現可能な乱数（テスト・シミュレーション用）
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    const r = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  D.Cards = {
    SUITS, SUIT_SYM, SUIT_NAME, RED, RANKS, RANK_LABEL, JOKER, CARDS, SUIT_ORDER,
    makeDeck, isJoker, rankOf, suitOf, strength, sortHand, cardLabel, rankLabel, mulberry32, shuffle,
  };
})();
