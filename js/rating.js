/* レート戦のレーティング（ブラウザ・サーバー・テストで共通）
 * 得点のゲーム（大富豪・七並べ）：試合の総得点を「相手のレートから予想される総得点」と比べて増減する。
 * 勝ち負けのゲーム（スピード）：試合（3本勝負）の勝ち負けを、勝つ確率と比べて増減する（イロレーティング）。 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const E = D.Engine;

  const START = 1500; // はじめのレート
  const SCALE = 400; // レート差400で、1対1の勝率が約91%
  const K = 40; // 得点のゲーム：1試合で動く大きさ（全ゲーム1位なら同じ強さの相手に +40）
  const K_NEW = 80; // はじめの数試合は大きく動かして、早く実力に近づける
  const K_WIN = 32; // 勝ち負けのゲーム：同じ強さの相手に勝つと +16
  const K_WIN_NEW = 64;
  const NEW_MATCHES = 5;

  /**
   * ゲームごとのレート戦の決まり。AIのレートは強さごとに固定（ふつう=1500 を基準に実測）
   *   大富豪 2026-09-26：やさしい vs ふつう×3 を4000ゲーム → −191、つよい（420ms）vs ふつう×3 を400ゲーム → +130
   *   七並べ 2026-09-26：やさしい vs ふつう×3 を6000ゲーム → −71、つよい（候補を同じ配り方で比べる・300回）vs ふつう×3 を560ゲーム → +91
   *     （以前の、時間で試すつよいは +48。運の要素が大きいゲームなので差は小さめ）
   *   スピード 2026-09-26：AI同士1000試合ずつ。やさしい→ふつう +254、ふつう→つよい +345
   */
  const CFG = {
    daifugo: { label: '大富豪', kind: 'points', games: 10, players: 4, ai: { easy: 1310, normal: 1500, hard: 1630 },
      rules: () => Object.assign({}, D.Rules.MINE), rulesLabel: 'マイルール' },
    sevens: { label: '七並べ', kind: 'points', games: 10, players: 4, ai: { easy: 1430, normal: 1500, hard: 1590 },
      rules: () => Object.assign({}, D.SevensRules.STANDARD), rulesLabel: '標準ルール（パス3回・ジョーカー・トンネル）' },
    speed: { label: 'スピード', kind: 'winloss', games: 3, players: 2, ai: { easy: 1250, normal: 1500, hard: 1850 },
      rules: () => Object.assign({}, D.SpeedRules.STANDARD), rulesLabel: '標準ルール（AとKがつながる・同じ数字も出せる）' },
  };
  const cfg = (game) => CFG[game || 'daifugo'];

  // 大富豪の値（以前からの呼び方）
  const GAMES = CFG.daifugo.games;
  const PLAYERS = CFG.daifugo.players;
  const AI = CFG.daifugo.ai;
  function rules() { return CFG.daifugo.rules(); }

  /** 相手1人より上の順位になる（勝つ）確率 */
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
  const kWin = (matches) => ((matches || 0) < NEW_MATCHES ? K_WIN_NEW : K_WIN);

  /**
   * 得点のゲームの試合のレート変動。
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

  /** 勝ち負けのゲームの試合のレート変動。result は勝ち=1・負け=0 */
  function changeWin(me, opp, result, matches) {
    const expected = winProb(me, opp);
    const delta = Math.round(kWin(matches) * (result - expected));
    return { expected, delta, after: me + delta };
  }

  /** 途中でやめたとき：残りのゲームは全部 最下位 として数える（得点のゲーム） */
  function abandonTotal(scoreSoFar, played, games, n) {
    return scoreSoFar + Math.max(0, (games || GAMES) - played) * E.pointsFor(n || PLAYERS, (n || PLAYERS) - 1);
  }

  /** 試合の結果から、席ごとのレート変動を出す（base：試合開始時の各席のレート） */
  function matchResult(S, base, matchesBySeat) {
    if (cfg(S.game).kind === 'winloss') {
      const w = S.players.map((p) => p.wins || 0);
      return S.players.map((p, i) => {
        const result = w[i] > w[1 - i] ? 1 : w[i] < w[1 - i] ? 0 : 0.5;
        const c = changeWin(base[i], base[1 - i], result, matchesBySeat ? matchesBySeat[i] : 0);
        return { seat: i, before: base[i], after: c.after, delta: c.delta, expected: c.expected, total: w[i], result };
      });
    }
    return S.players.map((p, i) => {
      const opps = base.filter((_, j) => j !== i);
      const c = change(base[i], opps, p.score, S.maxGames || GAMES, matchesBySeat ? matchesBySeat[i] : 0);
      return { seat: i, before: base[i], after: c.after, delta: c.delta, expected: c.expected, total: p.score };
    });
  }

  /** 途中でやめた席のレート変動（得点のゲームは残りを最下位、勝ち負けのゲームは負け） */
  function abandonResult(S, seat, base, matches) {
    if (cfg(S.game).kind === 'winloss') {
      const c = changeWin(base[seat], base[1 - seat], 0, matches);
      return { before: base[seat], after: c.after, delta: c.delta, expected: c.expected, total: S.players[seat].wins || 0 };
    }
    const total = abandonTotal(S.players[seat].score, S.history.length, S.maxGames, S.n);
    const c = change(base[seat], base.filter((_, j) => j !== seat), total, S.maxGames, matches);
    return { before: base[seat], after: c.after, delta: c.delta, expected: c.expected, total };
  }

  function fmtDelta(d) { return d > 0 ? '+' + d : d < 0 ? '−' + Math.abs(d) : '±0'; }

  D.Rating = {
    START, GAMES, PLAYERS, AI, SCALE, K, K_NEW, K_WIN, K_WIN_NEW, NEW_MATCHES, CFG, cfg,
    rules, winProb, expectedPoints, change, changeWin, abandonTotal, abandonResult, matchResult, fmtDelta, kFactor, kWin,
  };
})();
