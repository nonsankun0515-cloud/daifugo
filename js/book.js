/* 大富豪 — ルールブック（はじめての人向け。対局中でも開ける） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, RU = D.Rules, E = D.Engine, RT = D.Rating;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TABS = [
    { key: 'basics', label: '遊び方' },
    { key: 'rules', label: 'ルール' },
    { key: 'score', label: '得点・レート' },
    { key: 'words', label: '用語' },
  ];

  function cards(ids, cls) {
    return '<span class="bk-cards' + (cls ? ' ' + cls : '') + '">' + ids.map((id) => '<span class="bk-card">' + A.faceSVG(id) + '</span>').join('') + '</span>';
  }
  const sect = (title, body) => '<section class="bk-sect"><h4>' + esc(title) + '</h4>' + body + '</section>';

  function isOn(R, key) {
    const d = RU.BY_KEY[key];
    if (!d) return false;
    if (d.type === 'bool') return !!R[key];
    if (key === 'jokers') return R[key] > 0;
    if (key === 'seqRevolution') return R[key] !== 'off';
    return true;
  }
  function optLabel(R, key) {
    const d = RU.BY_KEY[key];
    const op = d.options && d.options.find((o) => o.v === R[key]);
    return op ? op.label : '';
  }

  // ─────────────── 遊び方 ───────────────
  function basics(R) {
    const order = ['S3', 'H4', 'D5', 'C6', 'S7', 'H8', 'D9', 'C10', 'S11', 'H12', 'D13', 'C14', 'S15'];
    if (R.jokers > 0) order.push('X1');
    let h = '';
    h += sect('ゲームのねらい',
      '<p>手札を<b>いちばん早くなくした人の勝ち</b>です。上がった順に<b>大富豪・富豪・平民・貧民・大貧民</b>という身分がつきます（4人なら平民はいません）。</p>');
    h += sect('カードの強さ',
      '<div class="bk-strength">' + cards(order, 'row') + '<div class="bk-axis"><span>弱い</span><span>強い</span></div></div>' +
      '<p>3がいちばん弱く、<b>2がいちばん強い</b>数字です。マーク（♠♥♦♣）は強さに関係ありません。' +
      (R.jokers > 0 ? 'ジョーカーは好きなカードの代わりになり、<b>1枚で出すと2より強い</b>最強のカードです。' : '') + '</p>' +
      (R.revolution ? '<p class="bk-tip"><b>革命</b>が起きると強さが逆になり、3がいちばん強くなります。</p>' : ''));
    h += sect('出し方',
      '<div class="bk-ways">' +
      '<div class="bk-way">' + cards(['H9']) + '<b>1枚</b></div>' +
      '<div class="bk-way">' + cards(['S6', 'D6']) + '<b>同じ数字を2〜4枚</b></div>' +
      (R.sequence ? '<div class="bk-way">' + cards(['H4', 'H5', 'H6']) + '<b>階段</b><small>同じマークの連番を3枚以上</small></div>' : '') +
      (R.jokers > 0 ? '<div class="bk-way">' + cards(['C7', 'X1']) + '<b>ジョーカー入り</b><small>7のペアとして出せる</small></div>' : '') +
      '</div>' +
      '<p>場にカードがあるときは、<b>場と同じ出し方・同じ枚数で、もっと強いカード</b>しか出せません。1枚には1枚、ペアにはペアです。</p>' +
      '<div class="bk-example">' + cards(['D5', 'C5']) + '<span class="bk-arrow">→</span>' + cards(['S9', 'H9']) + '<span class="bk-ok">出せる</span></div>' +
      '<div class="bk-example">' + cards(['D5', 'C5']) + '<span class="bk-arrow">→</span>' + cards(['S12']) + '<span class="bk-ng">出せない（枚数が違う）</span></div>');
    h += sect('順番の進み方',
      '<ol class="bk-steps">' +
      '<li><b>親</b>（最初に出す人）は、好きな出し方で出します。' + (R.firstLead === 'D3' ? '1ゲーム目の親は♦3を持っている人です。' : R.firstLead === 'S3' ? '1ゲーム目の親は♠3を持っている人です。' : '') + '</li>' +
      '<li>次の人からは、場より強いカードを出すか、<b>パス</b>します。出せるカードがあってもパスしてかまいません。</li>' +
      '<li>自分以外の全員がパスすると<b>場が流れ</b>ます。最後に出した人が次の親になって、また好きな出し方で出せます。</li>' +
      '<li>手札がなくなったら<b>上がり</b>。最後の1人が決まるまで続けます。</li>' +
      '</ol>');
    if (R.exchange) {
      h += sect('身分とカード交換',
        '<p>2ゲーム目からは、ゲームの前にカードを交換します。</p>' +
        '<ul class="bk-list"><li><b>大貧民 → 大富豪</b>：いちばん強いカードを2枚渡し、大富豪は好きなカードを2枚返します。</li>' +
        '<li><b>貧民 → 富豪</b>：いちばん強いカードを1枚渡し、富豪は好きなカードを1枚返します。</li></ul>' +
        (R.nextLead === 'poorest' ? '<p>2ゲーム目からの親は、前のゲームの大貧民です。</p>' : ''));
    }
    h += sect('画面の使い方',
      '<ul class="bk-list">' +
      '<li>カードをタップして選び、<b>「出す」</b>。もう一度タップすると選ぶのをやめます。</li>' +
      '<li>明るく見えるのが今出せるカードです（「ルールと設定」で切り替え）。</li>' +
      '<li>迷ったら<b>「ヒント」</b>でおすすめの出し方がわかります。</li>' +
      '<li>止め札・カードを渡す・捨てるなど、選べる場面では画面がたずねてくれます。</li>' +
      '<li>上の' + A.icon('log', 14) + 'で今までの流れ、' + A.icon('book', 14) + 'でこのルールブックが見られます。</li>' +
      '</ul>');
    return h;
  }

  // ─────────────── ルール（そのゲームで使うもの） ───────────────
  // 数字ごとの効果：[ルール, 見本のカード, 出し方]
  const CARD_RULES = [
    ['spade3', ['S3'], '♠3を1枚'],
    ['threeStop', ['H3', 'D3'], '3を2枚'],
    ['sandstorm', ['S3', 'H3', 'D3'], '3を3枚'],
    ['fourStop', ['S4', 'H4'], '4を2枚'],
    ['fiveSkip', ['D5'], '5'],
    ['sixNine', ['C6'], '6を1枚'],
    ['rokurokubi', ['S6', 'H6'], '6を2枚'],
    ['omen', ['S6', 'H6', 'D6'], '6を3枚'],
    ['sevenPass', ['H7'], '7'],
    ['luckySeven', ['S7', 'H7', 'D7'], '7を3枚'],
    ['eightCut', ['S8'], '8'],
    ['nineSix', ['D9'], '9を1枚'],
    ['kyukyusha', ['S9', 'H9'], '9を2枚'],
    ['coup', ['S9', 'H9', 'D9'], '9を3枚'],
    ['nineReverse', ['C9'], '9'],
    ['nineBack', ['C9'], '9'],
    ['tenDiscard', ['C10'], '10'],
    ['jBack', ['H11'], 'J'],
    ['queenBomber', ['S12'], 'Q'],
    ['kingSkip', ['D13'], 'K'],
    ['aceTake', ['C14'], 'A'],
    ['twoBack', ['H15'], '2'],
    ['greatRevolution', ['S15', 'H15', 'D15', 'C15'], '2を4枚'],
  ];
  // 例を足すと分かりやすいもの
  const EXTRA = {
    suitLock: '例：♥5 → ♥8 と続いたら、場が流れるまで♥しか出せません。',
    numberLock: '例：5 → 6 と続いたら、次は7しか出せません。',
    eightCut: '8切りのあとは、出した人がそのまま親になります。',
    sevenPass: '渡さなくてもかまいません。',
    tenDiscard: '捨てなくてもかまいません。',
    fiveSkip: '例：5を2枚出すと、次の2人を飛ばします。',
  };
  const FIELD_RULES = ['jokers', 'sequence', 'seqCompare', 'revolution', 'seqRevolution', 'suitLock', 'partialLock', 'numberLock', 'gekiLock',
    'downNumber', 'passLock', 'stopScope', 'seqEffects'];
  const FINISH_RULES = ['forbidJoker', 'forbidTwo', 'forbidEight', 'forbidSpade3', 'miyakoOchi', 'gekokujo', 'tenpen', 'exchange', 'firstLead', 'nextLead'];

  function ruleItem(R, key, extraHead) {
    const d = RU.BY_KEY[key];
    const choice = d.type === 'choice' ? '<span class="bk-opt">' + esc(optLabel(R, key)) + '</span>' : '';
    return '<div class="bk-rule"><div class="bk-rule-head"><b>' + esc(d.label) + '</b>' + choice + (extraHead || '') + '</div>' +
      '<p>' + esc(d.desc) + (EXTRA[key] ? ' ' + esc(EXTRA[key]) : '') + '</p></div>';
  }

  function relevant(R, key) {
    // 親のルールがないと意味がない選択肢は出さない
    if (key === 'seqCompare' || key === 'seqEffects' || key === 'seqRevolution') return R.sequence;
    if (key === 'stopScope') return R.fourStop || R.threeStop;
    return true;
  }

  function rulesTab(R) {
    let h = '';
    const cardOn = CARD_RULES.filter(([k]) => isOn(R, k));
    if (cardOn.length) {
      h += sect('数字ごとの効果',
        '<div class="bk-cardrules">' + cardOn.map(([k, ids, how]) => {
          const d = RU.BY_KEY[k];
          return '<div class="bk-cr">' + cards(ids, 'fan') + '<div class="bk-cr-text"><div class="bk-rule-head"><b>' + esc(d.label) + '</b><span class="bk-opt">' + esc(how) + '</span></div>' +
            '<p>' + esc(d.desc) + (EXTRA[k] ? ' ' + esc(EXTRA[k]) : '') + '</p></div></div>';
        }).join('') + '</div>' +
        (R.fourStop || R.threeStop || R.sandstorm
          ? '<p class="bk-tip">止め札（' + [R.threeStop && '3止め', R.fourStop && '4止め', R.sandstorm && '砂嵐'].filter(Boolean).join('・') +
            '）で止めると、場が流れて<b>止めた人が親</b>になります。止められる場面では画面がたずねます。</p>' : '') +
        (R.sequence && R.seqEffects === 'eight' ? '<p class="bk-tip">階段の中に8が入っていると8切りになります（ほかの数字の効果は1枚・同じ数字で出したときだけ）。</p>' : ''));
    }
    const field = FIELD_RULES.filter((k) => isOn(R, k) && relevant(R, k));
    if (field.length) {
      h += sect('場のルール', field.map((k) => ruleItem(R, k)).join('') +
        (R.jokers > 0 && (R.suitLock || R.numberLock) ? '<p class="bk-tip">ジョーカーを含む出し方では、新しい縛りは起きません。</p>' : ''));
    }
    const fin = FINISH_RULES.filter((k) => isOn(R, k));
    if (fin.length) h += sect('上がり・身分', fin.map((k) => ruleItem(R, k)).join(''));
    // 使わないルール
    const off = RU.RULES.filter((d) => d.type === 'bool' && !R[d.key]);
    if (off.length) {
      h += '<details class="bk-off"><summary>このルールで使わないローカルルール（' + off.length + '個）</summary>' +
        off.map((d) => '<div class="bk-rule off"><div class="bk-rule-head"><b>' + esc(d.label) + '</b></div><p>' + esc(d.desc) + '</p></div>').join('') + '</details>';
    }
    return h;
  }

  // ─────────────── 得点・レート ───────────────
  function score(n) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const t = E.titleOf(n, i), p = E.pointsFor(n, i);
      rows.push('<tr><td>' + (i + 1) + '位</td><td><span class="title-chip ' + D.UI.TITLE_CLASS[t] + '">' + t + '</span></td><td class="' + (p > 0 ? 'pos' : p < 0 ? 'neg' : 'zero') + '">' +
        (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(p) + '点</td></tr>');
    }
    const ai = RT.AI;
    let h = '';
    h += sect('1ゲームの得点（' + n + '人）',
      '<table class="bk-table">' + rows.join('') + '</table>' +
      '<p>全員の得点を足すと、いつも0点になります。反則上がりは最下位の得点です。</p>');
    h += sect('1試合',
      '<p><b>レート戦は10ゲームで1試合</b>です。10ゲームの総得点がいちばん多い人が優勝です。' +
      'フリー対戦は「ルールと設定」でゲーム数（5・10・無制限）を選べます。</p>');
    h += sect('レート戦',
      '<ul class="bk-list">' +
      '<li><b>4人・マイルール・10ゲーム</b>で固定です（ルールの中身は「ルール」タブ）。</li>' +
      '<li>レートは<b>1500</b>から始まります。</li>' +
      '<li>相手のレートから<b>「予想の総得点」</b>を出します。強い相手ほど予想は低く、弱い相手ほど高くなります。</li>' +
      '<li>10ゲームの総得点が予想より<b>多ければ上がり、少なければ下がり</b>ます。</li>' +
      '<li>増減 ＝ ' + RT.K + ' ×（総得点 − 予想）÷ 30。はじめの' + RT.NEW_MATCHES + '試合は ' + RT.K + ' のかわりに ' + RT.K_NEW +
      ' で計算するので、早く実力に近いレートになります。</li>' +
      '</ul>' +
      '<div class="bk-example-box">例：レート1500のあなたが、レート1500の相手3人と対戦（' + (RT.NEW_MATCHES + 1) + '試合目から）。予想は0点。<br>' +
      '総得点 <b class="pos">+9点</b> なら レート <b class="pos">+12</b>、<b class="neg">−6点</b> なら <b class="neg">−8</b>。</div>');
    h += sect('AIのレート',
      '<table class="bk-table"><tr><td>やさしい</td><td>' + ai.easy + '</td></tr><tr><td>ふつう</td><td>' + ai.normal + '</td></tr><tr><td>つよい</td><td>' + ai.hard + '</td></tr></table>' +
      '<p>マイルールでAIどうしを何百〜何千ゲームも対戦させて測った強さです。</p>');
    h += sect('棄権',
      '<p>レート戦を途中でやめる（棄権する）と、<b>残りのゲームは大貧民（−3点）</b>として計算します。' +
      'タイトルに戻るだけなら棄権にはならず、「つづきから」で再開できます。</p>');
    h += sect('オンラインのレート',
      '<ul class="bk-list">' +
      '<li>AI戦のレートとは別に、サーバーに記録されます（端末ごと。サインインは不要）。</li>' +
      '<li>部屋のホストが「レート戦」を選ぶと、4人・マイルール・10ゲームになります。空いた席にはAIが入ります。</li>' +
      '<li>途中で部屋を出ると棄権になります。途中から入った人のレートは変わりません。</li>' +
      '</ul>');
    return h;
  }

  // ─────────────── 用語 ───────────────
  const WORDS = [
    ['親', '場にカードがないときに最初に出す人。好きな出し方で出せます。'],
    ['場', 'テーブルの真ん中。いちばん上のカードより強いカードを出していきます。'],
    ['パス', '出さずに順番をとばすこと。出せるカードがあってもパスできます。'],
    ['場が流れる', '場のカードが片づけられること。全員がパスしたときや8切りのときなど。'],
    ['上がり', '手札が全部なくなること。'],
    ['反則上がり', '禁止されている出し方（ジョーカー・2など）で上がること。最下位になります。'],
    ['階段', '同じマークの連番を3枚以上まとめて出す出し方。'],
    ['革命', '同じ数字を4枚出すと強さが逆になること。3が最強、2が最弱になります。'],
    ['縛り', '同じマークや連番が続くと、場が流れるまで出せるカードが限られること。'],
    ['止め札', '8切りやスキップを止められる出し方（3止め・4止め・砂嵐）。'],
    ['身分', '上がった順番で決まる肩書き。大富豪・富豪・平民・貧民・大貧民。'],
    ['カード交換', '2ゲーム目から、身分に応じて強いカードと好きなカードを交換すること。'],
    ['総得点', '1試合（10ゲームなど）の得点の合計。レートはこれで決まります。'],
    ['レート', '強さの目安の数字。1500から始まり、レート戦の結果で上下します。'],
  ];
  function words() {
    return '<dl class="bk-words">' + WORDS.map(([w, d]) => '<dt>' + esc(w) + '</dt><dd>' + esc(d) + '</dd>').join('') + '</dl>';
  }

  /** tab：TABS の key、R：説明するルール、n：人数（得点表用） */
  function render(tab, R, n) {
    if (tab === 'rules') return rulesTab(R);
    if (tab === 'score') return score(n || RT.PLAYERS);
    if (tab === 'words') return words();
    return basics(R);
  }

  D.Book = { TABS, render };
})();
