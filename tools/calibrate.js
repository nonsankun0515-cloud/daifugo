/* AIのレートを決めるための実測（Node で実行）
 *   node tools/calibrate.js <level> <games> [budgetMs]
 * 挑戦者（level）1体 vs ふつう3体で、マイルール・10ゲームの試合を繰り返し、挑戦者の1ゲーム平均得点を出す。
 * 平均得点から「ふつう（1500）との差」を逆算して表示する。 */
'use strict';
const path = require('path');
for (const f of ['cards', 'rules', 'engine', 'ai', 'rating']) require(path.join(__dirname, '..', 'js', f + '.js'));
const D = globalThis.DFG, E = D.Engine, AI = D.AI, RT = D.Rating;

const level = process.argv[2] || 'easy';
const games = +(process.argv[3] || 200);
const budget = +(process.argv[4] || 420);

(async function () {
  let sum = 0, sq = 0, played = 0;
  const t0 = Date.now();
  for (let m = 0; played < games; m++) {
    const me = m % 4;
    const S = E.createMatch({ rules: RT.rules(), games: 10, players: [0, 1, 2, 3].map((i) => ({ name: 'P' + i, level: i === me ? level : 'normal' })) });
    for (let g = 0; g < 10 && played < games; g++) {
      E.startGame(S);
      let q, guard = 0;
      while ((q = E.getRequest(S)) && guard++ < 3000) {
        const lv = S.players[q.seat].level;
        const a = lv === 'hard' ? await AI.decide(S, q, 'hard', budget) : AI.decideSync(S, q, lv);
        E.apply(S, a);
      }
      const p = S.history[S.history.length - 1].pts[me];
      sum += p; sq += p * p; played++;
    }
    if (m % 5 === 4) process.stderr.write(level + ' ' + played + '/' + games + ' avg ' + (sum / played).toFixed(3) + ' ' + ((Date.now() - t0) / 1000).toFixed(0) + 's\n');
  }
  const avg = sum / played;
  const se = Math.sqrt((sq / played - avg * avg) / played);
  // 予想得点が avg になるレート差を二分法で探す
  let lo = -1200, hi = 1200;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (RT.expectedPoints(1500 + mid, [1500, 1500, 1500]) < avg) lo = mid; else hi = mid;
  }
  console.log(JSON.stringify({ level, games: played, avg: +avg.toFixed(3), se: +se.toFixed(3), diffVsNormal: Math.round(lo), budget, sec: Math.round((Date.now() - t0) / 1000) }));
  process.exit(0); // AIの MessageChannel が残るので明示的に終わる
})();
