/* 大富豪 — AIの対戦テスト（強さの比較と、長時間の安定性） */
(async function () {
  'use strict';
  const D = globalThis.DFG;
  const E = D.Engine, C = D.Cards, RU = D.Rules, AI = D.AI;
  const out = document.getElementById('out');
  const lines = [];
  function log(ok, text) {
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'ng';
    li.textContent = (ok ? '✔ ' : '✘ ') + text;
    out.appendChild(li);
    lines.push({ ok, text });
  }

  function randomRules(rng) {
    const r = RU.defaults();
    for (const def of RU.RULES) {
      if (def.type === 'bool') r[def.key] = rng() < 0.5;
      else r[def.key] = def.options[Math.floor(rng() * def.options.length)].v;
    }
    return r;
  }

  async function runMatch(levels, rules, games, budget) {
    const S = E.createMatch({ rules, players: levels.map((lv, i) => ({ name: 'P' + i, level: lv })) });
    const places = levels.map(() => 0);
    for (let g = 0; g < games; g++) {
      E.startGame(S);
      let q, steps = 0;
      while ((q = E.getRequest(S))) {
        const lv = levels[q.seat];
        const a = lv === 'hard' ? await AI.decide(S, q, 'hard', budget) : AI.decideSync(S, q, lv);
        E.apply(S, a);
        if (++steps > 5000) throw new Error('終わらない');
      }
      S.prevRanking.forEach((seat, i) => { places[seat] += i; });
    }
    return places.map((p) => p / games);
  }

  const t0 = performance.now();
  try {
    // 1) ふつう vs やさしい×3（マイルール）
    const p1 = await runMatch(['normal', 'easy', 'easy', 'easy'], RU.MINE, 300);
    log(p1[0] < 1.2, 'ふつうAI vs やさしい×3（マイルール300戦）平均順位 ' + p1.map((x) => x.toFixed(2)).join(' / ') + '（0が大富豪）');

    // 2) ふつう vs ランダム方針（定番ルール）
    const p2 = await runMatch(['normal', 'easy', 'normal', 'easy'], D.Rules.PRESETS.find((p) => p.key === 'classic').rules, 300);
    log(p2[0] + p2[2] < p2[1] + p2[3], 'ふつう×2 vs やさしい×2（定番300戦）平均順位 ' + p2.map((x) => x.toFixed(2)).join(' / '));

    // 3) ランダムなルールでふつうAI同士 400戦（安定性）
    const rng = C.mulberry32(99);
    let games = 0;
    for (let m = 0; m < 80; m++) {
      const np = 3 + Math.floor(rng() * 4);
      await runMatch(Array.from({ length: np }, () => 'normal'), randomRules(rng), 5);
      games += 5;
    }
    log(true, 'ランダムなルールでふつうAI同士 ' + games + '戦 完走');

    // 4) つよい vs ふつう×3（短い思考時間で）
    const t1 = performance.now();
    const p4 = await runMatch(['hard', 'normal', 'normal', 'normal'], RU.MINE, 40, 60);
    log(true, 'つよいAI vs ふつう×3（マイルール40戦・思考60ms）平均順位 ' + p4.map((x) => x.toFixed(2)).join(' / ') + ' 所要 ' + ((performance.now() - t1) / 1000).toFixed(1) + '秒');
  } catch (e) {
    log(false, 'AIテストで例外: ' + (e && e.stack || e));
  }
  log(true, 'AIテスト所要 ' + ((performance.now() - t0) / 1000).toFixed(1) + '秒');
  globalThis.AI_TEST_DONE = lines;
})();
