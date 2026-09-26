/* ホーム画面に追加（アプリとして使う）の案内。
 * Android・PCの Chrome / Edge は「追加する」でそのままインストール画面を出す（beforeinstallprompt）。
 * iPhone は Safari でも Chrome でも共有ボタンから追加できるので、開いているブラウザに合わせた手順を見せる。
 * LINE などアプリの中のブラウザでは追加できないので、ふつうのブラウザで開き直す案内をする。 */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, UI = D.UI, CM = D.Common, SND = D.Sound;
  const esc = UI.esc;

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIPadOS = /Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1;
  const platform = /iPhone|iPad|iPod/.test(ua) || isIPadOS ? 'ios' : /Android/.test(ua) ? 'android' : 'desktop';
  function browserName() {
    if (/ Line\//i.test(ua)) return 'line';
    if (/Instagram|FBAN|FBAV|Twitter|; wv\)/.test(ua)) return 'inapp';
    if (platform === 'ios') return /CriOS/.test(ua) ? 'chrome' : /EdgiOS/.test(ua) ? 'edge' : /FxiOS/.test(ua) ? 'firefox' : 'safari';
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Edg(A)?\//.test(ua)) return 'edge';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }
  const browser = browserName();

  // Chrome / Edge がくれる「インストールしてよいか」を聞く画面（出せるときだけ届く）
  let deferred = null;
  let installed = false;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refresh(); });
  addEventListener('appinstalled', () => { installed = true; deferred = null; refresh(); UI.toast('ホーム画面に追加しました', 2500); });
  let onChange = null;
  function refresh() { if (onChange) onChange(); }

  const standalone = () => installed ||
    (typeof matchMedia === 'function' && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches)) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);
  const inArtifact = () => !!(globalThis.claude && globalThis.claude.hot) || /claude(usercontent)?\.(ai|com)$/i.test(location.hostname);

  /** 案内を出してよい環境か（Claude のページの中やアプリとして開いているときは出さない） */
  const available = () => !inArtifact() && !standalone();

  // ── ホームの上の小さな案内（スマホだけ。閉じたら30日は出さない） ──
  const TIP_OFF_DAYS = 30;
  function showTip() {
    if (!available() || platform === 'desktop') return false;
    const off = CM.store.installTipOff || 0;
    return Date.now() - off > TIP_OFF_DAYS * 86400000;
  }
  function hideTip() { CM.store.installTipOff = Date.now(); CM.save(); refresh(); }

  // ── 手順 ──
  const ic = (name) => '<span class="step-ic">' + A.icon(name, 18) + '</span>';
  function steps() {
    if (browser === 'line' || browser === 'inapp') {
      const app = browser === 'line' ? 'LINE' : 'このアプリ';
      return {
        lead: app + 'の中のブラウザでは、ホーム画面に追加できません。いつものブラウザ（' + (platform === 'ios' ? 'Safari や Chrome' : 'Chrome') + '）で開き直してから追加してください。',
        list: ['下の「ブラウザで開く」をタップ（開かないときは、画面の ' + ic('dots') + ' や「…」メニューから「ブラウザで開く」／「Safariで開く」）',
          '開いたブラウザで、もう一度「ホーム画面に追加」を押す'],
        external: true,
      };
    }
    if (platform === 'ios') {
      if (browser === 'chrome' || browser === 'edge' || browser === 'firefox') {
        const name = { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }[browser];
        return {
          lead: name + ' でもホーム画面に追加できます。',
          list: ['アドレスバーの右にある 共有ボタン ' + ic('share') + ' をタップ（見つからないときは、右下の「…」メニュー →「共有」）',
            '下にスクロールして「<b>ホーム画面に追加</b>」' + ic('addHome'),
            '「Webアプリとして開く」がオンなのを確かめて、右上の「<b>追加</b>」'],
        };
      }
      return {
        lead: 'Safari の共有ボタンから追加できます。',
        list: ['画面の下（または上）の 共有ボタン ' + ic('share') + ' をタップ',
          '下にスクロールして「<b>ホーム画面に追加</b>」' + ic('addHome'),
          '「Webアプリとして開く」がオンなのを確かめて、右上の「<b>追加</b>」'],
      };
    }
    if (platform === 'android') {
      const menu = browser === 'samsung' ? '下の「≡」メニュー' : browser === 'firefox' ? '右上（または右下）の ' + ic('dots') + ' メニュー' : '右上の ' + ic('dots') + ' メニュー';
      return {
        lead: 'ブラウザのメニューから追加できます。',
        list: [menu + ' を開く', '「<b>ホーム画面に追加</b>」または「<b>アプリをインストール</b>」', '確認の画面で「<b>インストール</b>」／「<b>追加</b>」'],
      };
    }
    if (browser === 'safari') {
      return { lead: 'Mac の Safari では Dock に追加できます。', list: ['メニューバーの「ファイル」→「<b>Dockに追加</b>」', '「<b>追加</b>」'] };
    }
    return {
      lead: 'Chrome / Edge ではアプリとしてインストールできます。',
      list: ['アドレスバーの右端のインストールボタン、または ' + ic('dots') + ' メニューを開く', '「<b>インストール</b>」（Chrome は「キャスト、保存、共有」の中）を選ぶ'],
    };
  }

  /** 開いているページを、アプリの中のブラウザの外（ふつうのブラウザ）で開き直す URL（LINE の openExternalBrowser） */
  function externalURL() {
    return location.origin + location.pathname + '?openExternalBrowser=1' + location.hash;
  }

  function showGuide() {
    const s = steps();
    const dlg = UI.openDialog('<h3>ホーム画面に追加</h3><p>アイコンから、アプリのように全画面で遊べます。' + esc(s.lead) + '</p>' +
      '<ol class="install-steps">' + s.list.map((t) => '<li>' + t + '</li>').join('') + '</ol>' +
      '<p class="menu-note">追加したアプリの記録（レート・途中の対局）は、ブラウザで遊んだ記録とは別になります。</p>' +
      '<div class="btns">' + (s.external ? '<a class="btn btn-gold" id="ins-ext" href="' + esc(externalURL()) + '">ブラウザで開く</a>' : '') +
      '<button class="btn ' + (s.external ? 'btn-ghost' : 'btn-gold') + '" type="button" id="ins-ok">わかった</button></div>', { onBackdrop: UI.closeDialog });
    dlg.querySelector('#ins-ok').addEventListener('click', UI.closeDialog);
  }

  /** 「追加する」：Chrome / Edge ならインストール画面、ほかは手順 */
  async function start() {
    SND.play('select');
    if (deferred) {
      const ev = deferred;
      deferred = null;
      try {
        ev.prompt();
        const r = await ev.userChoice;
        if (r && r.outcome === 'accepted') { installed = true; refresh(); }
      } catch (e) { showGuide(); }
      refresh();
      return;
    }
    showGuide();
  }

  // ── 画面の部品 ──
  /** ホームの上に出す案内の中身（出さないときは空） */
  function tipHTML() {
    if (!showTip()) return '';
    return '<span class="it-ic">' + A.icon('addHome', 22) + '</span>' +
      '<span class="it-text"><b>ホーム画面に追加</b>すると、アプリのように全画面で遊べます</span>' +
      '<button class="btn btn-gold btn-sm" type="button" data-ins="go">' + (deferred ? '追加する' : '追加のしかた') + '</button>' +
      '<button class="icon-btn it-close" type="button" data-ins="off" aria-label="案内を閉じる">' + A.icon('close', 16) + '</button>';
  }
  function bindTip(el) {
    const go = el.querySelector('[data-ins="go"]');
    const off = el.querySelector('[data-ins="off"]');
    if (go) go.addEventListener('click', start);
    if (off) off.addEventListener('click', hideTip);
  }

  /** マイページの1行（アプリとして開いているときは「追加済み」） */
  function mySection() {
    if (inArtifact()) return null;
    const sec = CM.section('アプリとして使う', standalone() ? '' : 'アイコンから全画面で遊べます');
    if (standalone()) {
      sec.panel.appendChild(CM.row('ホーム画面のアプリで遊んでいます', 'ブラウザで開いたときとは別に、記録が保存されます', null));
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-gold btn-sm';
      b.textContent = deferred ? '追加する' : '追加のしかた';
      b.addEventListener('click', start);
      sec.panel.appendChild(CM.row(platform === 'desktop' ? 'アプリとしてインストール' : 'ホーム画面に追加', guideLabel(), b));
    }
    return sec.s;
  }
  function guideLabel() {
    if (browser === 'line' || browser === 'inapp') return 'いまはアプリの中のブラウザです。ふつうのブラウザで開き直してください';
    if (platform === 'ios') return ({ chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox' }[browser] || 'Safari') + ' の共有ボタンから追加できます';
    return deferred ? 'ボタンを押すと、すぐに追加できます' : 'ブラウザのメニューから追加できます';
  }

  /** 開いたときに付いてきた LINE 用のしるし（?openExternalBrowser=1）は、アドレスから消しておく */
  function cleanURL() {
    if (!/[?&]openExternalBrowser=/.test(location.search)) return;
    const q = location.search.replace(/[?&]openExternalBrowser=[^&]*/g, '').replace(/^&/, '?');
    try { history.replaceState(null, '', location.pathname + (q === '?' ? '' : q) + location.hash); } catch (e) { /* 無視 */ }
  }

  D.Install = {
    platform, browser, available, standalone, showTip, tipHTML, bindTip, mySection, start, showGuide, cleanURL,
    set onChange(f) { onChange = f; },
    get canPrompt() { return !!deferred; },
  };
})();
