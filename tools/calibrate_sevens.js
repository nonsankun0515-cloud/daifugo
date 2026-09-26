/* 七並べのAIのレートを決めるための実測（Node で実行）
 *   node tools/calibrate_sevens.js <level> <games> [maxMs]
 * 挑戦者（level）1体 vs ふつう3体で、標準ルールのゲームを繰り返し、挑戦者の1ゲーム平均得点から「ふつう（1500）との差」を出す。
 * つよいAIは決まった回数（SevensAI.ITERS）だけ試すので、maxMs は時間の上限（ふつうは大きいままでよい）。
 * 1ゲーム数秒かかるので、数十ゲームずつ並列に何本も動かして合計する。 */
'use strict';
const path = require('path');
for (const f of ['cards', 'rules', 'engine', 'rating', 'sevens/engine', 'sevens/ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const D = globalThis.DFG, SV = D.Sevens, AI = D.SevensAI, RT = D.Rating;

const level = process.argv[2] || 'easy';
const games = +(process.argv[3] || 400);
const budget = +(process.argv[4] || 30000);

(async function () {
  let sum = 0, sq = 0;
  for (let g = 0; g < games; g++) {
    const me = g % 4;
    const S = SV.createMatch({ rules: D.SevensRules.STANDARD, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i, level: i === me ? level : 'normal' })), games: 1 });
    SV.startGame(S);
    let q;
    while ((q = SV.getRequest(S))) {
      const lv = S.players[q.seat].level;
      SV.apply(S, lv === 'hard' ? await AI.decide(S, q, 'hard', budget) : AI.decideSync(S, q, lv));
    }
    const p = D.Engine.pointsFor(4, S.prevRanking.indexOf(me));
    sum += p; sq += p * p;
  }
  const avg = sum / games;
  let lo = -1200, hi = 1200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (RT.expectedPoints(1500 + mid, [1500, 1500, 1500]) < avg) lo = mid; else hi = mid;
  }
  console.log(JSON.stringify({ level, games, avg: +avg.toFixed(3), se: +Math.sqrt((sq / games - avg * avg) / games).toFixed(3), diffVsNormal: Math.round(lo), budget }));
  process.exit(0);
})();
