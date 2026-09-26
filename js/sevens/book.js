/* 七並べ — ルールブック */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, RT = D.Rating, E = D.Engine, SR = D.SevensRules;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TABS = [
    { key: 'basics', label: '遊び方' },
    { key: 'rules', label: 'ルール' },
    { key: 'score', label: '得点・レート' },
  ];
  const cards = (ids, cls) => '<span class="bk-cards' + (cls ? ' ' + cls : '') + '">' + ids.map((id) => '<span class="bk-card">' + A.faceSVG(id) + '</span>').join('') + '</span>';
  const sect = (title, body) => '<section class="bk-sect"><h4>' + esc(title) + '</h4>' + body + '</section>';
  const R0 = () => SR.defaults();

  function basics(R) {
    R = R || R0();
    let h = '';
    h += sect('ゲームのねらい', '<p>手札を<b>いちばん早くなくした人の勝ち</b>です。上がった順に順位が決まります。</p>');
    h += sect('はじめ', '<p>カードを全部配ったら、<b>7を4枚とも場に並べて</b>スタートします（アプリが自動で並べます）。<b>♦7を持っていた人</b>から順番に出していきます。</p>' +
      '<div class="bk-ways"><div class="bk-way">' + cards(['S7', 'H7', 'D7', 'C7']) + '<b>最初の場</b><small>マークごとに1列</small></div></div>');
    h += sect('出し方',
      '<p>場に並んでいるカードの<b>となり（同じマークで1つ大きいか小さい数字）</b>に、1枚だけ出せます。</p>' +
      '<div class="bk-example">' + cards(['S6', 'S7', 'S8']) + '<span class="bk-arrow">→</span>' + cards(['S5']) + '<span class="bk-ok">出せる</span></div>' +
      '<div class="bk-example">' + cards(['S6', 'S7', 'S8']) + '<span class="bk-arrow">→</span>' + cards(['S4']) + '<span class="bk-ng">まだ出せない（5がない）</span></div>' +
      '<p>出せないとき・出したくないときは<b>パス</b>します。' +
      (R.passLimit > 0 ? 'パスは<b>' + R.passLimit + '回まで</b>。' + (R.passLimit + 1) + '回目のパスで<b>失格</b>になり、手札はすべて場に並べられます（順位は最下位）。' : 'パスは何回でもできます（ただし全員が2周続けてパスしたら、出せる人は出さなければなりません）。') + '</p>' +
      '<p class="bk-tip">作戦：自分が止めているカードがあると、その先のカードを持つ人は出せません。わざとパスして相手を困らせることもできます。</p>');
    if (R.tunnel) {
      h += sect('トンネル', '<p><b>AとKがつながります</b>。Aまで並んだらKから、Kまで並んだらAからも出せます。</p>' +
        '<div class="bk-example">' + cards(['H14', 'H15', 'H3']) + '<span class="bk-arrow">→</span>' + cards(['H13']) + '<span class="bk-ok">Aのとなりに出せる</span></div>');
    }
    if (R.joker) {
      h += sect('ジョーカー', '<p>ジョーカーは<b>出せる場所ならどこにでも置けます</b>。置いた場所のカードを持っている人は、<b>次の自分の番で必ずそのカードを出し</b>、代わりにジョーカーを受け取ります（その番はパスできません）。</p>' +
        '<p>ジョーカーを置くと、その先のカードも出せるようになります。</p>');
    }
    h += sect('画面の使い方', '<ul class="bk-list">' +
      '<li>明るく見えるのが今出せるカードです。タップして選び、<b>「出す」</b>。</li>' +
      '<li>ジョーカーを選ぶと、置ける場所が場で光ります。置く場所をタップしてください。</li>' +
      '<li>パスのボタンに、残りのパスの回数が出ます。各プレイヤーの名札の点がパスした回数です。</li>' +
      '<li>迷ったら<b>「ヒント」</b>でおすすめがわかります。</li></ul>');
    return h;
  }

  function rulesTab(R) {
    R = R || R0();
    const items = SR.RULES.map((d) => {
      const val = d.type === 'bool' ? (R[d.key] ? 'あり' : 'なし') : (d.options.find((o) => o.v === R[d.key]) || {}).label;
      const on = d.type === 'bool' ? R[d.key] : true;
      return '<div class="bk-rule' + (on ? '' : ' off') + '"><div class="bk-rule-head"><b>' + esc(d.label) + '</b><span class="bk-opt">' + esc(val) + '</span></div><p>' + esc(d.desc) + '</p></div>';
    }).join('');
    return sect('このルール', items) +
      sect('順位の決まり方', '<ul class="bk-list"><li>手札がなくなった順に 1位・2位…</li><li>最後まで残った人は、上がった人の次の順位。</li><li>失格した人は最下位（先に失格した人ほど下）。</li></ul>');
  }

  function score(n) {
    n = n || 4;
    const c = RT.cfg('sevens');
    const rows = [];
    for (let i = 0; i < n; i++) {
      const p = E.pointsFor(n, i);
      rows.push('<tr><td>' + (i + 1) + '位</td><td class="' + (p > 0 ? 'pos' : p < 0 ? 'neg' : 'zero') + '">' + (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + '点</td></tr>');
    }
    return sect('1ゲームの得点（' + n + '人）', '<table class="bk-table">' + rows.join('') + '</table><p>全員の得点を足すと0点になります。</p>') +
      sect('レート戦', '<ul class="bk-list">' +
        '<li><b>' + c.players + '人・' + esc(c.rulesLabel) + '・' + c.games + 'ゲーム</b>で固定です。</li>' +
        '<li>レートは1500から。相手のレートから「予想の総得点」を出し、' + c.games + 'ゲームの総得点が予想より多ければ上がります。</li>' +
        '<li>途中で棄権すると、残りのゲームは最下位として計算します。</li></ul>') +
      sect('AIのレート', '<table class="bk-table"><tr><td>やさしい</td><td>' + c.ai.easy + '</td></tr><tr><td>ふつう</td><td>' + c.ai.normal + '</td></tr><tr><td>つよい</td><td>' + c.ai.hard + '</td></tr></table>' +
        '<p>七並べは配られたカードの運の要素が大きいので、AIの強さの差は小さめです。</p>');
  }

  function render(tab, R, n) {
    if (tab === 'rules') return rulesTab(R);
    if (tab === 'score') return score(n);
    return basics(R);
  }

  D.Books = D.Books || {};
  D.Books.sevens = { TABS, render };
})();
