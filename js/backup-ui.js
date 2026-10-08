/* バックアップの画面：書き出す・読み込む・1つ前のデータに戻す
 * マイページの「データの引き継ぎ」と、保存できないときの帯（common.js）から開く。中身の作り方・確かめ方は backup.js */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const CM = D.Common, UI = D.UI, BK = D.Backup, RT = D.Rating, SND = D.Sound;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const GAMES = ['daifugo', 'sevens', 'speed'];
  const platform = () => (D.Install ? D.Install.platform : 'desktop');

  const two = (n) => String(n).padStart(2, '0');
  function fmtDate(t) {
    const d = new Date(t);
    return isNaN(d) ? '' : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + two(d.getMinutes());
  }
  function matchText(g, m) {
    if (!m) return 'なし';
    if (g === 'speed') return (m.rated ? 'レート戦 ' : '') + m.wins.join(' - ');
    return (m.rated ? 'レート戦 ' : '') + '第' + m.gameNo + (m.maxGames ? '/' + m.maxGames : '') + 'ゲーム';
  }
  function button(label, cls, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm ' + cls;
    b.textContent = label;
    b.addEventListener('click', () => { SND.play('select'); onClick(); });
    return b;
  }
  const lastText = () => (CM.store.backupAt ? '最後に書き出した日：' + fmtDate(CM.store.backupAt) : 'AI戦のレート・設定・ルール・途中の対局を1つのファイルに');

  // ─────────────────────────────────────────────
  // 書き出す
  // ─────────────────────────────────────────────
  function done(msg) {
    CM.markBackup();
    const el = $('bk-last');
    if (el) el.textContent = lastText();
    UI.toast(msg, 3500);
  }

  function openExport() {
    const b = BK.create(CM.store, Date.now());
    const sum = BK.summary(CM.store);
    let file = null;
    try { file = new File([b.text], b.name, { type: 'application/json' }); } catch (e) { file = null; }
    let canShare = false;
    try { canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] })); } catch (e) { canShare = false; }
    // iPhone は共有シートの「"ファイル"に保存」が確実（ホーム画面のアプリでダウンロードのリンクを開くと戻れなくなることがある）
    const shareFirst = canShare && platform() === 'ios';
    // Claude上のページではファイルを保存できない（ダウンロードが許可されていない）ので「コピー」だけ
    const inArtifact = !!(globalThis.claude && globalThis.claude.hot) || /claude(usercontent)?\.(ai|com)$/i.test(location.hostname);
    const playing = GAMES.filter((g) => sum.games[g].match).map((g) => RT.cfg(g).label);
    const btns = (inArtifact ? '' : shareFirst ? '<button class="btn btn-gold" type="button" id="bk-share">共有・ファイルに保存</button>'
      : '<button class="btn btn-gold" type="button" id="bk-dl">ファイルに保存</button>' + (canShare && platform() === 'android' ? '<button class="btn btn-ghost" type="button" id="bk-share">共有</button>' : '')) +
      '<button class="btn ' + (inArtifact ? 'btn-gold' : 'btn-ghost') + '" type="button" id="bk-copy">コピー</button><button class="btn btn-ghost" type="button" id="bk-close">閉じる</button>';
    UI.openDialog('<h3>書き出す</h3>' +
      '<p>この端末の記録を1つのファイルにします。別の端末・ブラウザ・ホーム画面のアプリで「読み込む」と、続きから遊べます。</p>' +
      '<ul class="bk-list"><li>AI戦のレート：' + GAMES.map((g) => esc(RT.cfg(g).label) + ' <b>' + sum.games[g].r + '</b>').join('・') + '</li>' +
      '<li>設定・ルール（名前「' + esc(sum.name) + '」）</li><li>途中の対局：' + (playing.length ? esc(playing.join('・')) : 'なし') + '</li></ul>' +
      '<p class="bk-note">オンラインのIDとオンラインのレートは入りません（読み込んだ先の端末のものになります）。</p>' +
      '<div class="btns">' + btns + '</div>' +
      '<div id="bk-copybox" hidden><p class="bk-note">コピーできませんでした。下の文字を全部選んでコピーしてください。</p>' +
      '<textarea class="name-input wide bk-text" id="bk-out" rows="3" readonly></textarea></div>', { onBackdrop: UI.closeDialog });
    $('bk-close').addEventListener('click', UI.closeDialog);
    if ($('bk-share')) {
      $('bk-share').addEventListener('click', () => {
        navigator.share({ files: [file], title: 'Cards Table のバックアップ' }).then(() => done('書き出しました'), (e) => {
          if (e && e.name === 'AbortError') return; // 共有をやめた
          UI.toast('共有できませんでした。「コピー」を使ってください', 3500);
        });
      });
    }
    if ($('bk-dl')) {
      $('bk-dl').addEventListener('click', () => {
        try {
          const url = URL.createObjectURL(new Blob([b.text], { type: 'application/json' }));
          const a = document.createElement('a');
          a.href = url;
          a.download = b.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          done('「' + b.name + '」を保存しました（ダウンロード）');
        } catch (e) {
          UI.toast('ファイルに保存できませんでした。「コピー」を使ってください', 3500);
        }
      });
    }
    $('bk-copy').addEventListener('click', () => {
      const manual = () => {
        $('bk-copybox').hidden = false;
        const ta = $('bk-out');
        ta.value = b.text;
        ta.focus();
        ta.setSelectionRange(0, ta.value.length);
      };
      if (!navigator.clipboard || !navigator.clipboard.writeText) { manual(); return; }
      navigator.clipboard.writeText(b.text).then(() => done('コピーしました。読み込む側の「読み込む」に貼り付けてください'), manual);
    });
  }

  // ─────────────────────────────────────────────
  // 読み込む・1つ前のデータに戻す
  // ─────────────────────────────────────────────
  const REPLACE_ERR = {
    conflict: '別のタブ（ウィンドウ）で保存データが更新されています。ページを再読み込みしてから、もう一度読み込んでください。',
    quota: '空き容量が足りないため、いまのデータの控えを残せませんでした。いまのデータはそのままです。',
    protect: 'いまの保存データの一部が読めず、その控えも残せていないため、読み込めません。画面の上の知らせから先に保存を直してください。',
    incompatible: '新しいバージョンのアプリのデータがあるため、このページでは読み込めません。',
    unavailable: 'このブラウザでは保存が使えないため、読み込めません。',
    denied: 'このブラウザでは保存が許可されていないため、読み込めません。',
  };
  function showErr(msg) {
    const e = $('bk-err');
    if (!e) return;
    e.textContent = msg;
    e.hidden = false;
    SND.play('error');
  }

  function openImport() {
    if (D.OnlineClient && D.OnlineClient.cur) { UI.toast('オンラインの部屋にいる間は読み込めません。部屋を出てから読み込んでください', 3500); return; }
    UI.openDialog('<h3>読み込む</h3>' +
      '<p>書き出したバックアップのファイルを選ぶか、コピーした内容を貼り付けてください。</p>' +
      '<div class="btns"><button class="btn btn-gold" type="button" id="bk-pick">ファイルを選ぶ</button></div>' +
      '<input type="file" id="bk-file" accept=".json,application/json,text/plain" hidden>' +
      '<label class="bk-paste"><span>または貼り付け</span><textarea class="name-input wide bk-text" id="bk-text" rows="3" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea></label>' +
      '<p class="bk-err" id="bk-err" role="alert" hidden></p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="bk-cancel">やめる</button><button class="btn btn-gold" type="button" id="bk-check">確かめる</button></div>',
    { onBackdrop: UI.closeDialog });
    $('bk-cancel').addEventListener('click', UI.closeDialog);
    $('bk-pick').addEventListener('click', () => $('bk-file').click());
    $('bk-file').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      if (f.size > BK.MAX_CHARS * 4) { showErr(BK.MESSAGES['too-big']); return; }
      const rd = new FileReader();
      rd.onload = () => check(String(rd.result));
      rd.onerror = () => showErr('ファイルを読めませんでした。');
      rd.readAsText(f);
    });
    $('bk-check').addEventListener('click', () => check($('bk-text').value));
  }

  function check(text) {
    const r = BK.read(text, CM.store);
    if (!r.ok) { showErr(r.message); return; }
    openPreview(r.store, { kind: 'import', when: r.exportedAt ? fmtDate(r.exportedAt) + ' に書き出したバックアップです。' : '' });
  }

  function openUndo() {
    const c = CM.prerestore();
    if (!c) { UI.toast('1つ前のデータはありません'); return; }
    const when = c.store.savedAt ? fmtDate(c.store.savedAt) + ' まで使っていたデータです。' : '';
    openPreview(BK.carry(c.store, CM.store), { kind: 'undo', when });
  }

  /** いまの内容と、置き換えたあとの内容を並べて確かめてから置き換える */
  function openPreview(next, opt) {
    const undo = opt.kind === 'undo';
    const a = BK.summary(CM.store), b = BK.summary(next);
    // x・y は表示する HTML（esc 済み）
    const row = (label, x, y) => '<tr><th>' + esc(label) + '</th><td>' + x + '</td><td' + (x !== y ? ' class="chg"' : '') + '>' + y + '</td></tr>';
    const rate = (v) => v.r + '<small>' + v.matches + '試合</small>';
    let rows = row('名前', esc(a.name), esc(b.name));
    for (const g of GAMES) rows += row(RT.cfg(g).label + 'のレート', rate(a.games[g]), rate(b.games[g]));
    for (const g of GAMES) rows += row(RT.cfg(g).label + 'の途中', esc(matchText(g, a.games[g].match)), esc(matchText(g, b.games[g].match)));
    UI.openDialog('<h3>' + (undo ? '1つ前に戻しますか？' : '読み込みますか？') + '</h3>' +
      (opt.when ? '<p>' + esc(opt.when) + '</p>' : '') +
      '<div class="score-wrap"><table class="bk-cmp"><thead><tr><th></th><th>いま</th><th>' + (undo ? '戻したあと' : '読み込んだあと') + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="bk-note">いまの設定・ルール・AI戦のレート・途中の対局は、すべてこの内容に置き換わります。いまのデータは控えとして残すので、マイページの「1つ前のデータに戻す」で戻せます。オンラインのIDとレートは、この端末のものをそのまま使います。</p>' +
      '<p class="bk-err" id="bk-err" role="alert" hidden></p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="bk-no">やめる</button><button class="btn btn-gold" type="button" id="bk-yes">' + (undo ? '戻す' : '読み込む') + '</button></div>',
    { onBackdrop: UI.closeDialog });
    $('bk-no').addEventListener('click', UI.closeDialog);
    $('bk-yes').addEventListener('click', () => {
      if (D.OnlineClient && D.OnlineClient.cur) { showErr('オンラインの部屋にいる間は読み込めません。'); return; }
      const r = CM.replaceStore(next, opt.kind); // 成功したらページを読み込み直す
      if (!r.ok) showErr(REPLACE_ERR[r.reason] || '読み込めませんでした（' + r.reason + '）。いまのデータはそのままです。');
    });
  }

  // ─────────────────────────────────────────────
  // マイページの「データの引き継ぎ」
  // ─────────────────────────────────────────────
  function mySection() {
    const sec = CM.section('データの引き継ぎ', 'バックアップ');
    const ex = CM.row('書き出す', lastText(), button('書き出す', 'btn-gold', openExport));
    const desc = ex.querySelector('.row-desc');
    if (desc) desc.id = 'bk-last';
    sec.panel.appendChild(ex);
    sec.panel.appendChild(CM.row('読み込む', '別の端末・ブラウザ・ホーム画面のアプリで書き出したものを読み込みます', button('読み込む', 'btn-ghost', openImport)));
    if (CM.prerestore()) sec.panel.appendChild(CM.row('1つ前のデータに戻す', 'バックアップを読み込む前のデータに戻せます', button('戻す', 'btn-ghost', openUndo)));
    const hint = document.createElement('p');
    hint.className = 'bk-hint';
    hint.textContent = 'iPhone では Safari とホーム画面のアプリで保存場所が別です。オンラインのIDとオンラインのレートは引き継がれません。';
    sec.panel.appendChild(hint);
    return sec.s;
  }

  D.BackupUI = { openExport, openImport, openUndo, mySection };
})();
