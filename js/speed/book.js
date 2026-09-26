/* スピード — ルールブック */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, RT = D.Rating, SR = D.SpeedRules;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TABS = [
    { key: 'basics', label: '遊び方' },
    { key: 'rules', label: 'ルール' },
    { key: 'score', label: '勝敗・レート' },
  ];
  const cards = (ids) => '<span class="bk-cards">' + ids.map((id) => '<span class="bk-card">' + A.faceSVG(id) + '</span>').join('') + '</span>';
  const sect = (title, body) => '<section class="bk-sect"><h4>' + esc(title) + '</h4>' + body + '</section>';

  function basics(R) {
    R = R || SR.defaults();
    let h = '';
    h += sect('ゲームのねらい', '<p>2人で対戦します。自分のカード（場札と山札）を<b>先に全部出しきった方の勝ち</b>です。順番はなく、<b>早い者勝ち</b>です。</p>');
    h += sect('準備', '<p>1人26枚ずつ（あなたは赤の♥♦、相手は黒の♠♣）。自分の前に<b>場札を4枚</b>表向きに並べ、残りは山札にします。</p>' +
      '<p>「<b>せーの</b>」で、2人同時に山札の上から1枚ずつ、真ん中の<b>台札</b>に出してスタートします（アプリが自動で出します）。</p>');
    h += sect('出し方',
      '<p>場札を、2つの台札の<b>どちらか</b>に出せます。出せるのは台札より<b>数字が1つ大きいか小さい</b>カード' +
      (R.same ? '、または<b>同じ数字</b>' : '') + 'です。' + (R.wrap ? '<b>AとKもつながります</b>。' : '') + '</p>' +
      '<div class="bk-example">' + cards(['S8']) + '<span class="bk-arrow">←</span>' + cards(['H9']) + '<span class="bk-ok">出せる</span></div>' +
      '<div class="bk-example">' + cards(['S8']) + '<span class="bk-arrow">←</span>' + cards(['H7']) + '<span class="bk-ok">出せる</span></div>' +
      (R.same ? '<div class="bk-example">' + cards(['S8']) + '<span class="bk-arrow">←</span>' + cards(['H8']) + '<span class="bk-ok">出せる（同じ数字）</span></div>' : '') +
      (R.wrap ? '<div class="bk-example">' + cards(['S13']) + '<span class="bk-arrow">←</span>' + cards(['D14']) + '<span class="bk-ok">出せる（KとA）</span></div>' : '') +
      '<p>場札を出すと、あいた所に山札から1枚補充されます。</p>');
    h += sect('出せなくなったら', '<p>2人とも出せるカードがなくなったら、もう一度「<b>せーの</b>」で山札から1枚ずつ台札に出します。山札がない人は場札から1枚出します。</p>');
    h += sect('勝ち・引き分け', '<p>場札も山札もなくなった方の勝ちです。2人が同時になくなったら<b>引き分け</b>で、そのゲームは数えずにもう1ゲームします。</p>');
    h += sect('画面の使い方', '<ul class="bk-list">' +
      '<li>場札を指でつかんで、台札まで<b>ドラッグ</b>して出します（タップだけでは出ません）。</li>' +
      '<li>台札に向かって<b>はじいても</b>出せます（フリック）。</li>' +
      '<li>カードをつかむと、出せる台札が光ります。明るく見える場札が、今出せるカードです。</li></ul>');
    return h;
  }

  function rulesTab(R) {
    R = R || SR.defaults();
    return sect('このルール', SR.RULES.map((d) => '<div class="bk-rule' + (R[d.key] ? '' : ' off') + '"><div class="bk-rule-head"><b>' + esc(d.label) + '</b><span class="bk-opt">' +
      (R[d.key] ? 'あり' : 'なし') + '</span></div><p>' + esc(d.desc) + '</p></div>').join(''));
  }

  function score() {
    const c = RT.cfg('speed');
    return sect('試合', '<p>1ゲームごとに勝ち負けを決め、<b>' + c.games + '本勝負</b>なら先に' + (Math.floor(c.games / 2) + 1) + '勝した方が試合の勝ち。フリー対戦では1ゲーム・3本・5本から選べます。</p>') +
      sect('レート戦', '<ul class="bk-list">' +
        '<li><b>' + c.games + '本勝負・' + esc(c.rulesLabel) + '</b>で固定です。</li>' +
        '<li>レートは1500から。相手とのレート差から「あなたが勝つ確率」を出し、試合に勝てば上がり、負ければ下がります。</li>' +
        '<li>増減 ＝ ' + RT.K_WIN + ' ×（勝ち=1／負け=0 − 勝つ確率）。同じレートの相手に勝つと +' + RT.K_WIN / 2 + '。はじめの' + RT.NEW_MATCHES + '試合は ' + RT.K_WIN_NEW + ' で計算します。</li>' +
        '<li>途中で棄権すると負けになります。</li></ul>') +
      sect('オンライン対戦で通信が切れたら', '<p>ゲームの途中で通信が<b>30秒以上</b>切れたままだと、そのゲームは<b>切れた人の負け</b>になります（相手の人がつながっているとき）。30秒以内に戻れば、そのまま続きから遊べます。</p>') +
      sect('AIのレート', '<table class="bk-table"><tr><td>やさしい</td><td>' + c.ai.easy + '</td></tr><tr><td>ふつう</td><td>' + c.ai.normal + '</td></tr><tr><td>つよい</td><td>' + c.ai.hard + '</td></tr></table>' +
        '<p>AIどうしを何千試合も対戦させて測った強さです。スピードは反応の速さの差がそのまま出るので、AIの強さの差は大きめです。</p>');
  }

  function render(tab, R) {
    if (tab === 'rules') return rulesTab(R);
    if (tab === 'score') return score();
    return basics(R);
  }

  D.Books = D.Books || {};
  D.Books.speed = { TABS, render };
})();
