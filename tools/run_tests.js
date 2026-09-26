/* テストをブラウザなしで実行する（tests/test.html と同じ中身）
 *   node tools/run_tests.js
 * 全部合格なら終了コード 0、失敗があれば 1。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

// テストが結果を書き込む画面の代わり（使う機能だけ）
const el = () => ({ className: '', textContent: '', appendChild() {} });
globalThis.document = { getElementById: el, createElement: el };

const FILES = [
  'js/cards.js', 'js/rules.js', 'js/engine.js', 'js/rating.js', 'js/ai.js',
  'js/sevens/engine.js', 'js/sevens/ai.js', 'js/speed/engine.js', 'js/speed/ai.js', 'js/speed/host.js', 'js/online-room.js',
  'tests/tests.js', 'tests/online_tests.js', 'tests/games_tests.js', 'tests/ai_tests.js',
];
for (const f of FILES) require(path.join(ROOT, f));

(async function () {
  const t0 = Date.now();
  while (!globalThis.AI_TEST_DONE && Date.now() - t0 < 600000) await new Promise((r) => setTimeout(r, 200));
  const G = globalThis;
  const ai = G.AI_TEST_DONE || [{ ok: false, text: 'AIテストが終わりませんでした' }];
  const groups = [
    ['大富豪', G.TEST_RESULTS.pass, G.TEST_RESULTS.total, G.TEST_RESULTS.failed.map((r) => r.name + ': ' + r.msgs.join(' | '))],
    ['オンライン', G.ONLINE_TEST_DONE.pass, G.ONLINE_TEST_DONE.total, G.ONLINE_TEST_DONE.failed],
    ['七並べ・スピード', G.GAMES_TEST_DONE.pass, G.GAMES_TEST_DONE.total, G.GAMES_TEST_DONE.failed],
    ['AI', ai.filter((l) => l.ok).length, ai.length, ai.filter((l) => !l.ok).map((l) => l.text)],
  ];
  let bad = 0;
  for (const [name, pass, total, failed] of groups) {
    console.log((pass === total ? '✔ ' : '✘ ') + name + ' ' + pass + '/' + total);
    for (const f of failed) console.log('   ' + f);
    bad += total - pass;
  }
  for (const l of ai) console.log('   [AI] ' + l.text);
  console.log(bad ? '失敗 ' + bad + '件' : 'すべて合格（' + ((Date.now() - t0) / 1000).toFixed(0) + '秒）');
  process.exit(bad ? 1 : 0);
})();
