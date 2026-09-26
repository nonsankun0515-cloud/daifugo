/* アプリの外枠：下のナビ（ゲームの切り替え）・各ゲームのホーム・マイページ */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, UI = D.UI, RT = D.Rating, CM = D.Common, SND = D.Sound;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const store = CM.store;

  const TABS = [
    { key: 'daifugo', label: '大富豪', icon: 'crown' },
    { key: 'sevens', label: '七並べ', icon: 'seven' },
    { key: 'speed', label: 'スピード', icon: 'bolt' },
    { key: 'me', label: 'マイページ', icon: 'user' },
  ];
  let current = 'daifugo';

  /** AI戦レートの帯（ホームの上部） */
  function rateStripHTML(game) {
    const rt = CM.ratingOf(game);
    return '<span class="lbl">AI戦レート</span><b>' + rt.r + '</b><span class="sub">' +
      (rt.matches ? rt.matches + '試合 · 最高 ' + rt.best : 'まだレート戦をしていません') + '</span>';
  }

  /** ホームの見出し部分（フェルトの上にカードの絵とゲーム名） */
  function heroHTML(o) {
    return '<header class="hero"><div class="hero-art">' + (o.art || '') + '</div>' +
      '<h1 class="hero-title"><span class="kanji">' + esc(o.title) + '</span><span class="en">' + esc(o.en) + '</span></h1>' +
      '<p class="hero-tag">' + esc(o.tag) + '</p></header>';
  }

  /** 七並べ・スピードのホーム（大富豪は index.html に同じ形で書いてある） */
  function homeHTML(o) {
    const p = o.prefix;
    return heroHTML(o) +
      '<p class="rate-strip" id="' + p + '-rating"></p>' +
      '<div class="home-cta">' +
      '<button class="btn btn-gold btn-lg" id="' + p + '-rated" type="button">レート戦</button>' +
      '<button class="btn btn-ghost btn-lg" id="' + p + '-free" type="button">フリー対戦</button>' +
      '<button class="btn btn-ghost btn-lg" id="' + p + '-resume" type="button" hidden>つづきから</button></div>' +
      '<div class="home-tiles">' +
      tileHTML(p + '-online', 'globe', 'オンライン') + tileHTML(p + '-book', 'book', 'ルールブック') + tileHTML(p + '-settings', 'sliders', 'ルールと設定') +
      '</div><p class="home-note" id="' + p + '-note"></p>';
  }
  function tileHTML(id, icon, label) {
    return '<button class="tile" id="' + id + '" type="button"><span class="ti">' + A.icon(icon, 22) + '</span><span>' + esc(label) + '</span></button>';
  }

  /** ホームに飾るカード（扇形に開く） */
  function fanHTML(ids, spread, tilt) {
    const k = ids.length;
    return '<div class="hero-fan">' + ids.map((id, i) => {
      const t = i - (k - 1) / 2;
      return '<div class="card" style="transform:translateX(calc(-50% + ' + (t * (spread || 30)) + 'px)) rotate(' + (t * (tilt == null ? 12 : tilt)) + 'deg);z-index:' + (i + 1) + '">' + A.faceSVG(id) + '</div>';
    }).join('') + '</div>';
  }

  function showHome(tab) {
    if (!TABS.some((t) => t.key === tab)) tab = 'daifugo';
    current = tab;
    CM.showScreen('scr-home');
    document.querySelectorAll('#tabbar button').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    document.querySelectorAll('.home-view').forEach((v) => { v.hidden = v.dataset.tab !== tab; });
    if (tab === 'me') renderMe();
    else if (D.Games[tab]) D.Games[tab].renderHome();
    renderInstallTip();
    $('home-scroll').scrollTop = 0;
    if (store.tab !== tab) { store.tab = tab; CM.save(); }
  }

  // ─────────────────────────────────────────────
  // マイページ：名前・全ゲームのレート・共通の設定
  // ─────────────────────────────────────────────
  function renderMe() {
    const wrap = $('home-me');
    const s = CM.settings;
    wrap.innerHTML = '';
    const head = document.createElement('section');
    head.className = 'me-card';
    head.innerHTML = '<span class="me-ava">' + A.humanSVG() + '</span><div class="me-name-box"><label for="me-name">あなたの名前</label>' +
      '<input class="name-input wide" id="me-name" maxlength="8" placeholder="名前（8文字まで）" autocomplete="nickname" value="' + esc(s.name === 'あなた' ? '' : s.name) + '">' +
      '<small>オンライン対戦でほかの人に表示されます</small></div>';
    wrap.appendChild(head);
    const nameIn = head.querySelector('#me-name');
    nameIn.addEventListener('change', () => { s.name = nameIn.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || 'あなた'; CM.save(); });

    // レート一覧
    const rs = document.createElement('section');
    rs.innerHTML = '<h3 class="sect-title">レート<small>AI戦はこの端末、オンラインはサーバーに記録</small></h3>';
    const tbl = document.createElement('div');
    tbl.className = 'card-panel rate-table';
    tbl.innerHTML = '<div class="rt-row rt-head"><span></span><span>AI戦</span><span>オンライン</span></div>' +
      ['daifugo', 'sevens', 'speed'].map((g) => {
        const a = CM.ratingOf(g), o = store.onlineRatings[g];
        return '<button class="rt-row" type="button" data-g="' + g + '"><span class="rt-game"><span class="ti">' + A.icon(TABS.find((t) => t.key === g).icon, 18) + '</span>' + esc(RT.cfg(g).label) + '</span>' +
          '<span><b>' + a.r + '</b><small>' + a.matches + '試合</small></span><span><b>' + (o ? o.r : '—') + '</b><small>' + (o ? o.matches + '試合' : '未') + '</small></span></button>';
      }).join('');
    tbl.querySelectorAll('.rt-row[data-g]').forEach((b) => b.addEventListener('click', () => showHome(b.dataset.g)));
    rs.appendChild(tbl);
    wrap.appendChild(rs);

    // 共通の設定
    const set = (k, v) => { s[k] = v; CM.save(); CM.applySettings(); renderMe(); };
    const st = CM.section('設定', 'すべてのゲームで共通');
    st.panel.appendChild(CM.row('スピード', '演出とAIの速さ', CM.seg([{ v: 'slow', label: 'ゆっくり' }, { v: 'normal', label: 'ふつう' }, { v: 'fast', label: 'はやい' }], s.speed, (v) => set('speed', v))));
    const sw = document.createElement('div');
    sw.className = 'swatches';
    for (const key of Object.keys(A.BACKS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.backgroundImage = A.backDataURI(key);
      b.setAttribute('aria-label', 'カードの裏：' + A.BACKS[key].label);
      b.setAttribute('aria-pressed', String(s.back === key));
      b.addEventListener('click', () => set('back', key));
      sw.appendChild(b);
    }
    st.panel.appendChild(CM.row('カードの裏', '', sw));
    st.panel.appendChild(CM.row('効果音', '', CM.toggle('opt-sound', s.sound, (v) => set('sound', v), false, '効果音')));
    st.panel.appendChild(CM.row('BGM', 'ゲームごとに曲が変わります', CM.toggle('opt-bgm', s.bgm, (v) => set('bgm', v), false, 'BGM')));
    st.panel.appendChild(CM.row('BGMの音量', '', CM.seg([{ v: 'low', label: '小' }, { v: 'mid', label: '中' }, { v: 'high', label: '大' }], s.bgmVol, (v) => set('bgmVol', v), !s.bgm)));
    st.panel.appendChild(CM.row('出せないときは自動でパス', '大富豪・七並べ', CM.toggle('opt-autopass', s.autoPass, (v) => set('autoPass', v), false, '自動パス')));
    st.panel.appendChild(CM.row('出せるカードを明るく表示', '', CM.toggle('opt-playable', s.showPlayable, (v) => set('showPlayable', v), false, '出せるカードを表示')));
    wrap.appendChild(st.s);

    const ins = D.Install.mySection();
    if (ins) wrap.appendChild(ins);

    const about = document.createElement('section');
    about.className = 'me-about';
    // BGM のクレジット（CC BY 4.0 の決まり：曲名・作曲者・ライセンス・変更したこと）
    const T = D.BGM.TRACKS;
    about.innerHTML = '<p class="muted">Cards Table — 大富豪・七並べ・スピード</p>' +
      '<p class="credit">BGM：' + [T.lobby, T.daifugo, T.sevens, T.speed].map((t) => '“' + esc(t.title) + '”').join('、') +
      '<br>Kevin MacLeod (incompetech.com)<br>Licensed under Creative Commons: By Attribution 4.0<br>' +
      '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">creativecommons.org/licenses/by/4.0</a>（アプリ用に音質を変換）</p>';
    wrap.appendChild(about);
  }

  /** ホームの上の「ホーム画面に追加」の案内（スマホのブラウザで開いているときだけ） */
  function renderInstallTip() {
    const el = $('install-tip');
    const html = current === 'me' ? '' : D.Install.tipHTML();
    el.hidden = !html;
    el.innerHTML = html;
    if (html) D.Install.bindTip(el);
  }

  function init() {
    const bar = $('tabbar');
    bar.innerHTML = TABS.map((t) => '<button type="button" data-tab="' + t.key + '"><span class="tb-ic">' + A.icon(t.icon, 24) + '</span><span class="tb-lb">' + esc(t.label) + '</span></button>').join('');
    bar.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.tab === current && CM.visible('scr-home')) { $('home-scroll').scrollTo({ top: 0, behavior: 'smooth' }); return; }
      SND.play('select');
      showHome(b.dataset.tab);
    }));
    // 「追加する」ボタンが使えるようになった・追加し終わったら、案内を書き直す
    D.Install.onChange = () => {
      if (!CM.visible('scr-home')) return;
      renderInstallTip();
      if (current === 'me') renderMe();
    };
    // 大富豪のホームのボタン（index.html に書いてあるもの）
    $('btn-online').querySelector('.ti').innerHTML = A.icon('globe', 22);
    $('btn-book').querySelector('.ti').innerHTML = A.icon('book', 22);
    $('btn-rules').querySelector('.ti').innerHTML = A.icon('sliders', 22);
  }

  D.Shell = { init, showHome, rateStripHTML, homeHTML, heroHTML, fanHTML, tileHTML, TABS, get current() { return current; } };
})();
