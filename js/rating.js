/* 大富豪 — レート戦のレーティング（ブラウザ・サーバー・テストで共通）
 * 10ゲームの総得点を「相手のレートから予想される総得点」と比べて増減する。 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const E = D.Engine;

  const START = 1500; // はじめのレート
  const GAMES = 10; // レート戦のゲーム数
  const PLAYERS = 4; // レート戦の人数
  // AIのレート（強さごとに固定。ふつう=1500 を基準に、tools/calibrate.js でマイルールの対戦を実測して決めた。
  // 2026-09-26：やさしい vs ふつう×3 を4000ゲーム → −191、つよい（420ms）vs ふつう×3 を400ゲーム → +130）
  const AI = { easy: 1310, normal: 1500, hard: 1630 };
  const SCALE = 400; // レート差400で、1対1の勝率が約91%
  const K = 40; // 1試合で動く大きさ（全ゲーム大富豪なら同じ強さの相手に +40）
  const K_NEW = 80; // はじめの数試合は大きく動かして、早く実力に近づける
  const NEW_MATCHES = 5;

  /** レート戦のルール（マイルールで固定） */
  function rules() { return Object.assign({}, D.Rules.MINE); }

  /** 相手1人より上の順位になる確率 */
  function winProb(me, opp) { return 1 / (1 + Math.pow(10, (opp - me) / SCALE)); }

  /** 1ゲームで予想される得点。相手それぞれに勝つ確率から、何人に勝つか（＝順位）の分布を出す */
  function expectedPoints(me, opps) {
    const n = opps.length + 1;
    let dist = [1];
    for (const o of opps) {
      const p = winProb(me, o);
      const nd = new Array(dist.length + 1).fill(0);
      dist.forEach((v, k) => { nd[k] += v * (1 - p); nd[k + 1] += v * p; });
      dist = nd;
    }
    let e = 0;
    dist.forEach((v, k) => { e += v * E.pointsFor(n, n - 1 - k); });
    return e;
  }

  const kFactor = (matches) => ((matches || 0) < NEW_MATCHES ? K_NEW : K);

  /**
   * 試合のレート変動。
   * me：自分のレート、opps：相手のレート、total：総得点、games：ゲーム数、matches：これまでのレート戦の数
   */
  function change(me, opps, total, games, matches) {
    const n = opps.length + 1;
    const g = games || GAMES;
    const expected = expectedPoints(me, opps) * g;
    const max = E.pointsFor(n, 0) * g;
    const delta = Math.round((kFactor(matches) * (total - expected)) / max);
    return { expected, delta, after: me + delta };
  }

  /** 途中でやめたとき：残りのゲームは全部 大貧民 として数える */
  function abandonTotal(scoreSoFar, played, games, n) {
    return scoreSoFar + Math.max(0, (games || GAMES) - played) * E.pointsFor(n || PLAYERS, (n || PLAYERS) - 1);
  }

  /** 試合の結果から、席ごとのレート変動を出す（base：試合開始時の各席のレート） */
  function matchResult(S, base, matchesBySeat) {
    return S.players.map((p, i) => {
      const opps = base.filter((_, j) => j !== i);
      const c = change(base[i], opps, p.score, S.maxGames || GAMES, matchesBySeat ? matchesBySeat[i] : 0);
      return { seat: i, before: base[i], after: c.after, delta: c.delta, expected: c.expected, total: p.score };
    });
  }

  function fmtDelta(d) { return d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : '±0'; }

  D.Rating = { START, GAMES, PLAYERS, AI, SCALE, K, K_NEW, NEW_MATCHES, rules, winProb, expectedPoints, change, abandonTotal, matchResult, fmtDelta, kFactor };
})();
