/* 大富豪 — ローカルルールの定義とプリセット */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  const CATEGORIES = [
    { key: 'basic', label: '基本' },
    { key: 'reverse', label: '革命・逆転' },
    { key: 'flow', label: '場を流す・止める' },
    { key: 'number', label: '数字の効果' },
    { key: 'lock', label: 'しばり' },
    { key: 'finish', label: '上がり・身分' },
  ];

  // type: bool | choice（options: [{v, label}]）
  const RULES = [
    // 基本
    { key: 'jokers', cat: 'basic', type: 'choice', label: 'ジョーカー', def: 1,
      options: [{ v: 0, label: 'なし' }, { v: 1, label: '1枚' }, { v: 2, label: '2枚' }],
      desc: 'ジョーカーは好きなカードの代わりになる。1枚で出すと2より強い。' },
    { key: 'sequence', cat: 'basic', type: 'bool', label: '階段', def: true,
      desc: '同じマークの連番を3枚以上まとめて出せる。' },
    { key: 'seqCompare', cat: 'basic', type: 'choice', label: '階段の強さ比べ', def: 'lowest', needs: 'sequence',
      options: [{ v: 'lowest', label: '一番弱いカードで比べる' }, { v: 'all', label: '全部が上回る' }],
      desc: '「一番弱いカード」なら 3-4-5 に 4-5-6 を出せる。「全部」なら 6-7-8 以上が必要。' },
    { key: 'exchange', cat: 'basic', type: 'bool', label: 'カード交換', def: true,
      desc: '2ゲーム目から、大貧民→大富豪に一番強い2枚、貧民→富豪に1枚。お返しは好きなカード。' },
    { key: 'firstLead', cat: 'basic', type: 'choice', label: '最初の親', def: 'D3',
      options: [{ v: 'D3', label: '♦3を持つ人' }, { v: 'S3', label: '♠3を持つ人' }, { v: 'random', label: 'ランダム' }],
      desc: '1ゲーム目に最初に出す人。' },
    { key: 'nextLead', cat: 'basic', type: 'choice', label: '2ゲーム目からの親', def: 'poorest',
      options: [{ v: 'poorest', label: '大貧民' }, { v: 'same', label: '最初と同じ' }],
      desc: '2ゲーム目以降に最初に出す人。' },
    { key: 'passLock', cat: 'basic', type: 'bool', label: 'パスしたら流れるまで出せない', def: false,
      desc: '一度パスすると、場が流れるまでその人は出せない。' },

    // 革命・逆転
    { key: 'revolution', cat: 'reverse', type: 'bool', label: '革命', def: true,
      desc: '同じ数字を4枚以上出すと、カードの強さが逆転する。もう一度起きると元に戻る（革命返し）。' },
    { key: 'seqRevolution', cat: 'reverse', type: 'choice', label: '階段革命', def: 'off', needs: 'sequence',
      options: [{ v: 'off', label: 'なし' }, { v: 4, label: '4枚以上' }, { v: 5, label: '5枚以上' }],
      desc: '長い階段を出しても革命が起きる。' },
    { key: 'jBack', cat: 'reverse', type: 'bool', label: 'Jバック', def: true,
      desc: 'Jを出すと、場が流れるまで強さが逆転する（一時的な革命）。' },
    { key: 'twoBack', cat: 'reverse', type: 'bool', label: '2バック', def: false,
      desc: '2を出すと、場が流れるまで強さが逆転する。' },
    { key: 'coup', cat: 'reverse', type: 'bool', label: 'クーデター', def: false,
      desc: '9を3枚出すと革命が起きる。' },
    { key: 'omen', cat: 'reverse', type: 'bool', label: 'オーメン', def: false,
      desc: '6を3枚出すと革命が起き、このゲーム中はもう革命できない。' },
    { key: 'greatRevolution', cat: 'reverse', type: 'bool', label: '大革命', def: false,
      desc: '2を4枚出すと革命が起き、手札が残っていてもその場で上がり。' },

    // 場を流す・止める
    { key: 'eightCut', cat: 'flow', type: 'bool', label: '8切り', def: true,
      desc: '8を出すと（何枚でも）場が流れ、出した人からもう一度始める。' },
    { key: 'rokurokubi', cat: 'flow', type: 'bool', label: 'ろくろ首', def: false,
      desc: '6を2枚出すと8切りと同じ効果。止められるのは砂嵐だけ。' },
    { key: 'kyukyusha', cat: 'flow', type: 'bool', label: '救急車', def: false,
      desc: '9を2枚出すと8切りと同じ効果。止められるのは砂嵐だけ。' },
    { key: 'sandstorm', cat: 'flow', type: 'bool', label: '砂嵐', def: false,
      desc: '3を3枚。自分の番ならどんな場にも出せる最強の役で、場が流れる。8切り・ろくろ首も止められる（スキップは自分が飛ばされたときだけ）。' },
    { key: 'spade3', cat: 'flow', type: 'bool', label: 'スペ3返し', def: true,
      desc: 'ジョーカー1枚に対して♠3を出せる。場が流れて♠3を出した人が親。' },
    { key: 'fourStop', cat: 'flow', type: 'bool', label: '4止め', def: false,
      desc: '8切りを4の2枚で止める。場が流れて、止めた人が親。' },
    { key: 'threeStop', cat: 'flow', type: 'bool', label: '3止め', def: false,
      desc: '5スキップ・13スキップで飛ばされた人だけが、3の2枚で止められる。場が流れて、止めた人が親。' },
    { key: 'stopScope', cat: 'flow', type: 'choice', label: '4止め・3止めが使える相手', def: 'single',
      options: [{ v: 'single', label: '1枚出しだけ' }, { v: 'any', label: '何枚出しでも' }],
      desc: '「1枚出しだけ」なら、8を2枚出した8切りは4止めできない（砂嵐なら止められる）。' },
    { key: 'luckySeven', cat: 'flow', type: 'bool', label: 'ラッキーセブン', def: false,
      desc: '7を3枚出して誰も出さずに場が流れたら、手札が残っていても上がり。' },

    // 数字の効果
    { key: 'fiveSkip', cat: 'number', type: 'bool', label: '5スキップ', def: false,
      desc: '5を出した枚数ぶん、次の人を飛ばす（2枚なら2人）。' },
    { key: 'kingSkip', cat: 'number', type: 'bool', label: '13スキップ', def: false,
      desc: 'Kを出した枚数ぶん、次の人を飛ばす。' },
    { key: 'sevenPass', cat: 'number', type: 'bool', label: '7渡し', def: false,
      desc: '7を出した枚数まで、次の人に手札を渡せる。' },
    { key: 'nineBack', cat: 'number', type: 'bool', label: '9戻し', def: false,
      desc: '9を出した枚数まで、前の人に手札を渡せる。' },
    { key: 'tenDiscard', cat: 'number', type: 'bool', label: '10捨て', def: false,
      desc: '10を出した枚数まで、手札を捨てられる。' },
    { key: 'queenBomber', cat: 'number', type: 'bool', label: '12ボンバー', def: false,
      desc: 'Qを出した枚数ぶん、自分の手札にある数字を指名。全員がその数字のカードを全部捨てる。' },
    { key: 'aceTake', cat: 'number', type: 'bool', label: 'A拾い', def: false,
      desc: 'Aを出すと、1つ前に出されたカードを手札にできる（取るかは自由）。' },
    { key: 'sixNine', cat: 'number', type: 'bool', label: '6→9', def: false,
      desc: '6を1枚出すと、次は9しか出せない（強さは関係なし）。' },
    { key: 'nineSix', cat: 'number', type: 'bool', label: '9→6', def: false,
      desc: '9を1枚出すと、次は6しか出せない（強さは関係なし）。' },
    { key: 'nineReverse', cat: 'number', type: 'bool', label: '9リバース', def: false,
      desc: '9を出すと、順番が逆回りになる。' },
    { key: 'downNumber', cat: 'number', type: 'bool', label: 'ダウンナンバー', def: false,
      desc: '1枚出しのとき、場と同じマークで1つ弱いカードも出せる。' },
    { key: 'seqEffects', cat: 'number', type: 'choice', label: '階段に入った数字の効果', def: 'eight', needs: 'sequence',
      options: [{ v: 'eight', label: '8切りだけ' }, { v: 'none', label: 'なし' }, { v: 'all', label: 'すべて' }],
      desc: '階段の中に8や5などが入っていたときに効果を出すか。' },

    // しばり
    { key: 'suitLock', cat: 'lock', type: 'bool', label: 'スート縛り', def: false,
      desc: '同じマークが2回続くと、場が流れるまでそのマークしか出せない。' },
    { key: 'partialLock', cat: 'lock', type: 'bool', label: '片縛り', def: false,
      desc: '2枚以上のとき、マークが一部だけ同じでも、その同じマークが縛られる。' },
    { key: 'numberLock', cat: 'lock', type: 'bool', label: '階段縛り', def: false,
      desc: '数字が1つずつ続くと（5→6など）、次も1つ上（革命中は下）の数字しか出せない。' },
    { key: 'gekiLock', cat: 'lock', type: 'bool', label: '激縛り', def: false,
      desc: 'マークと数字が同時に続くと両方縛られる。5♠→6♠なら次は7♠だけ。' },

    // 上がり・身分
    { key: 'forbidJoker', cat: 'finish', type: 'bool', label: 'ジョーカー上がり禁止', def: true,
      desc: 'ジョーカーを含む出し方で上がると反則（最下位）。' },
    { key: 'forbidTwo', cat: 'finish', type: 'bool', label: '2上がり禁止', def: true,
      desc: '一番強い数字（ふだんは2、革命中・Jバック中は3）で上がると反則（最下位）。' },
    { key: 'forbidEight', cat: 'finish', type: 'bool', label: '8上がり禁止', def: false,
      desc: '8を含む出し方で上がると反則（最下位）。' },
    { key: 'forbidSpade3', cat: 'finish', type: 'bool', label: 'スペ3上がり禁止', def: false,
      desc: '♠3を含む出し方で上がると反則（最下位）。' },
    { key: 'miyakoOchi', cat: 'finish', type: 'bool', label: '都落ち', def: false,
      desc: '前のゲームの大富豪が1位で上がれないと、その場で大貧民になる。' },
    { key: 'gekokujo', cat: 'finish', type: 'bool', label: '下剋上', def: false,
      desc: '前のゲームの大貧民が1位で上がると、全員の身分がひっくり返る。' },
    { key: 'tenpen', cat: 'finish', type: 'bool', label: '天変地異', def: false,
      desc: '配られた大貧民の手札が10以下だけなら、大富豪と手札を全部交換できる。' },
  ];

  const BY_KEY = {};
  for (const r of RULES) BY_KEY[r.key] = r;

  function defaults() {
    const o = {};
    for (const r of RULES) o[r.key] = r.def;
    return o;
  }

  // あなたのルール（2026-09 に聞き取り。09-25 に救急車を追加）
  const MINE = {
    jokers: 1, sequence: true, seqCompare: 'lowest', exchange: true, firstLead: 'D3', nextLead: 'poorest', passLock: false,
    revolution: true, seqRevolution: 'off', jBack: true, twoBack: false, coup: false, omen: false, greatRevolution: false,
    eightCut: true, rokurokubi: true, kyukyusha: true, sandstorm: true, spade3: true, fourStop: true, threeStop: true,
    stopScope: 'single', luckySeven: false,
    fiveSkip: true, kingSkip: true, sevenPass: true, nineBack: false, tenDiscard: true, queenBomber: true, aceTake: true,
    sixNine: true, nineSix: true, nineReverse: false, downNumber: false, seqEffects: 'eight',
    suitLock: true, partialLock: true, numberLock: true, gekiLock: true,
    forbidJoker: true, forbidTwo: true, forbidEight: false, forbidSpade3: false,
    miyakoOchi: false, gekokujo: false, tenpen: false,
  };
  // 以前のマイルール。保存されている設定がこれと同じなら、今のマイルールに置き換える
  const OLD_MINES = [Object.assign({}, MINE, { kyukyusha: false })];

  function only(on, base) {
    const o = Object.assign(defaults(), base || {});
    for (const r of RULES) if (r.type === 'bool' && !(r.key in (base || {}))) o[r.key] = false;
    for (const k of on) o[k] = true;
    return o;
  }

  const PRESETS = [
    { key: 'mine', label: 'マイルール', desc: 'あなたが決めたルール一式', rules: MINE },
    { key: 'league', label: '連盟ルール', desc: '日本大富豪連盟の5ルール（革命・8切り・都落ち・スート縛り・スペ3返し）',
      rules: only(['sequence', 'exchange', 'revolution', 'eightCut', 'miyakoOchi', 'suitLock', 'spade3']) },
    { key: 'classic', label: '定番', desc: 'よく遊ばれるルールだけ',
      rules: only(['sequence', 'exchange', 'revolution', 'eightCut', 'jBack', 'spade3', 'suitLock', 'forbidJoker', 'forbidTwo', 'forbidEight', 'miyakoOchi']) },
    { key: 'simple', label: 'シンプル', desc: '革命と階段だけの基本ルール',
      rules: only(['sequence', 'exchange', 'revolution']) },
    { key: 'chaos', label: '全部のせ', desc: 'ほぼすべてのローカルルール',
      rules: Object.assign(only(RULES.filter((r) => r.type === 'bool' && r.key !== 'passLock').map((r) => r.key)),
        { jokers: 2, seqRevolution: 5, seqEffects: 'eight', stopScope: 'single' }) },
  ];

  /** 保存された設定を現在のルール定義に合わせる（欠けた項目は既定値） */
  function normalize(saved) {
    const o = defaults();
    if (saved && typeof saved === 'object') {
      for (const r of RULES) {
        if (!(r.key in saved)) continue;
        const v = saved[r.key];
        if (r.type === 'bool') o[r.key] = !!v;
        else if (r.options.some((op) => op.v === v)) o[r.key] = v;
      }
    }
    return o;
  }

  function presetMatching(rules) {
    for (const p of PRESETS) {
      if (RULES.every((r) => p.rules[r.key] === rules[r.key])) return p.key;
    }
    return null;
  }

  /** 保存された設定を読み込む。古いマイルールのままなら今のマイルールにする */
  function migrate(saved) {
    const r = normalize(saved);
    if (OLD_MINES.some((old) => RULES.every((d) => old[d.key] === r[d.key]))) return Object.assign({}, MINE);
    return r;
  }

  D.Rules = { CATEGORIES, RULES, BY_KEY, PRESETS, MINE, defaults, normalize, presetMatching, migrate };
})();
