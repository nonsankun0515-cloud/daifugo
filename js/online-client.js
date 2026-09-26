/* オンライン対戦（画面側・共通）：部屋への接続・待合室・チャット・招待。
 * 対局中の表示と操作は各ゲームの online（D.Games[game].online）が受け持つ */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, SND = D.Sound, UI = D.UI, RT = D.Rating, CM = D.Common;
  const $ = (id) => document.getElementById(id);
  const esc = UI.esc;
  const store = CM.store;

  // 待合室で選べる設定（サーバーの online-room.js と同じ）
  const LOBBY = {
    daifugo: { players: [3, 4, 5, 6], games: [{ v: 5, label: '5' }, { v: 10, label: '10' }, { v: 0, label: '無制限' }], ai: ['easy', 'normal'] },
    sevens: { players: [3, 4, 5, 6], games: [{ v: 5, label: '5' }, { v: 10, label: '10' }, { v: 0, label: '無制限' }], ai: ['easy', 'normal'] },
    speed: { players: [2], games: [{ v: 1, label: '1ゲーム' }, { v: 3, label: '3本勝負' }, { v: 5, label: '5本勝負' }], ai: ['easy', 'normal', 'hard'] },
  };

  const OC = { cur: null, draftCode: '', entryGame: 'daifugo' };
  const mod = (o) => D.Games[(o && o.game) || OC.entryGame];

  /** 招待リンク。LINE で送っても LINE の中ではなく、いつものブラウザ（Safari・Chrome）で開くように openExternalBrowser を付ける
   * （いつものブラウザならホーム画面にも追加できる。開いたあとアドレスからは消す：Install.cleanURL） */
  function inviteURL(code) {
    const h = location.hostname;
    const here = h === 'localhost' || h === '127.0.0.1' || /github\.io$/.test(h);
    return (here ? location.origin + location.pathname : D.Net.APP_URL) + '?openExternalBrowser=1#r-' + code;
  }

  function showOnlineScreen() {
    CM.showScreen('scr-online');
    renderOnline();
  }

  /** オンライン対戦の入口（game のタブから）。code があればその部屋へ */
  function openOnline(game, code) {
    if (game) OC.entryGame = game;
    for (const g of Object.keys(D.Games)) if (D.Games[g].stopLocal) D.Games[g].stopLocal();
    if (!D.Net.available()) { UI.toast('オンライン対戦はアプリ版（GitHubのページ）で遊べます', 4000); return; }
    if (code && !OC.cur) {
      OC.draftCode = code;
      if (CM.playerName()) { joinRoom(code); return; }
    }
    showOnlineScreen();
  }

  function setConn(s) {
    const o = OC.cur;
    if (!o) return;
    o.status = s;
    $('online-conn').textContent = { connecting: '接続中…', retry: '再接続中…', closed: '切断' }[s] || '';
    if (s === 'retry' && o.gameShown) UI.toast('通信が切れました。つなぎ直しています…', 2500);
    if (CM.visible('scr-online') && !o.view) renderOnline();
  }

  function joinRoom(code) {
    const name = CM.playerName();
    if (!name) { UI.toast('名前を入れてください'); return; }
    leaveRoom(true);
    const o = { code, game: null, conn: null, view: null, queue: [], busy: false, waiting: false, sig: '', waitingSig: '', sentSig: '',
      seat: -1, gameShown: false, resultsOpen: false, status: 'connecting', chat: [], unread: 0 };
    OC.cur = o;
    UI.roomCode = code;
    updateChatButtons();
    o.conn = D.Net.connect(code, {
      onOpen: () => { if (OC.cur === o) o.conn.send({ t: 'hello', cid: D.Net.clientId(), name, game: OC.entryGame }); },
      onMessage: (m) => { if (OC.cur === o) onMessage(o, m); },
      onStatus: (s) => { if (OC.cur === o) setConn(s); },
      onClosed: (c) => {
        if (OC.cur !== o) return;
        OC.cur = null;
        UI.roomCode = null;
        closeChat();
        updateChatButtons();
        if (c === 4000) UI.toast('ほかの画面でこの部屋に入ったので、こちらは切断しました', 4000);
        showOnlineScreen();
      },
    });
    try { history.replaceState(null, '', location.pathname + location.search + '#r-' + code); } catch (e) { /* 無視 */ }
    showOnlineScreen();
  }

  /** 部屋を出る（対局中ならその席はAIが引き継ぐ） */
  function leaveRoom(silent) {
    const o = OC.cur;
    if (!o) return;
    OC.cur = null;
    UI.roomCode = null;
    UI.seatInfo = null;
    closeChat();
    updateChatButtons();
    const m = D.Games[o.game];
    if (m && m.online && m.online.cancelInput) m.online.cancelInput();
    o.conn.send({ t: 'leave' });
    setTimeout(() => o.conn.close(), 200);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 無視 */ }
    if (!silent) { UI.closeDialog(); UI.hidePrompt(); D.Shell.showHome(o.game || OC.entryGame); }
  }

  function onMessage(o, m) {
    if (m.t === 'error') {
      const gm = o.game && D.Games[o.game];
      if (gm && gm.online.onError && gm.online.onError(m.error)) return;
      UI.toast(m.error, 3000);
      SND.play('error');
      return;
    }
    if (m.t === 'chat') { onChatItem(o, m.item, false); return; }
    if (m.t === 'chatlog') { o.chat = Array.isArray(m.items) ? m.items.slice(-60) : []; renderChat(); updateChatButtons(); return; }
    if (m.t !== 'room') return;
    if (!o.game) o.game = m.game || 'daifugo';
    const gm = D.Games[o.game];
    if (gm.online.quickUpdate && gm.online.quickUpdate(o, m)) return;
    o.queue.push(m);
    pump(o);
  }

  async function pump(o) {
    if (o.busy) return;
    o.busy = true;
    try {
      while (OC.cur === o && o.queue.length) await handleView(o, o.queue.shift());
    } catch (e) {
      console.error(e);
    }
    o.busy = false;
  }

  function rememberRating(o, v) {
    const me = v.members && v.members.find((m) => m.you);
    if (!me || me.rating == null) return;
    const g = o.game || 'daifugo';
    const cur = store.onlineRatings[g] || {};
    if (cur.r === me.rating && cur.matches === me.matches) return;
    store.onlineRatings[g] = { r: me.rating, matches: me.matches || 0 };
    CM.save();
  }

  async function handleView(o, v) {
    o.view = v;
    rememberRating(o, v);
    if (v.phase === 'lobby') {
      if (o.gameShown) { o.gameShown = false; o.resultsOpen = false; UI.closeDialog(); UI.hidePrompt(); }
      if (!CM.visible('scr-online')) showOnlineScreen(); else renderOnline();
      return;
    }
    if (!(v.seat >= 0)) return;
    await mod(o).online.handleView(o, v);
  }

  function reask() {
    const o = OC.cur;
    if (o && o.game) mod(o).online.reask(o);
  }

  function confirmLeave(fromResults) {
    const o = OC.cur;
    const playing = o && o.gameShown;
    const S = playing && mod(o).state();
    const ratedLive = playing && S && S.rated && !S.matchOver && o.view && o.view.youRated;
    const winloss = RT.cfg(o && o.game).kind === 'winloss';
    UI.openDialog('<h3>部屋を出ますか？</h3><p>' + (playing ? '対局中のあなたの席は、AIロボットが引き継ぎます。' : 'もう一度入るには、招待リンクか部屋コードが必要です。') +
      (ratedLive ? '<br><b>レート戦の途中なので棄権になり、</b>' + (winloss ? '負けとして計算されます。' : '残りのゲームは最下位（−3点）として計算されます。') : '') + '</p>' +
      '<div class="btns"><button class="btn btn-ghost" type="button" id="lv-no">やめる</button><button class="btn btn-gold" type="button" id="lv-yes">部屋を出る</button></div>',
    { onBackdrop: () => back() });
    function back() {
      UI.closeDialog();
      if (fromResults && OC.cur) mod(OC.cur).online.showResults(OC.cur);
      else reask();
    }
    $('lv-no').addEventListener('click', back);
    $('lv-yes').addEventListener('click', () => leaveRoom(false));
  }

  function openMenu(onClose) {
    const o = OC.cur;
    UI.openDialog('<h3>メニュー</h3><div class="menu-list">' +
      '<button class="btn btn-gold" type="button" id="m-close">対局に戻る</button>' +
      '<button class="btn btn-ghost" type="button" id="m-invite">友だちを招待</button>' +
      '<button class="btn btn-ghost" type="button" id="m-book">ルールブック</button>' +
      '<button class="btn btn-ghost" type="button" id="m-leave">部屋を出る</button></div>', { onBackdrop: close });
    function close() { UI.closeDialog(); if (onClose) onClose(); reask(); }
    $('m-close').addEventListener('click', close);
    $('m-invite').addEventListener('click', () => { if (OC.cur) invite(OC.cur.code); });
    $('m-book').addEventListener('click', () => { close(); CM.openBook(o.game, 'rules', 'game'); });
    $('m-leave').addEventListener('click', () => confirmLeave(false));
  }

  async function invite(code) {
    const url = inviteURL(code);
    const g = RT.cfg((OC.cur && OC.cur.game) || OC.entryGame).label;
    const text = g + 'で遊ぼう！ 部屋コード ' + code;
    if (navigator.share) {
      try { await navigator.share({ title: g, text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text + '\n' + url);
      UI.toast('招待リンクをコピーしました。LINEなどに貼り付けて送ってください', 3500);
    } catch (e) {
      UI.toast('このリンクを送ってください：' + url, 6000);
    }
  }

  // ── チャット（部屋の人だけに届く。サーバーは直近30件だけ持つ） ──
  const CHAT_PRESETS = ['よろしく！', 'ナイス！', 'やられた〜', 'すごい！', 'ありがとう', 'もう1回！', 'ちょっと待って', '強すぎ😂'];
  const CHAT_COLORS = ['#f3dd9b', '#8ecae6', '#f4a3b5', '#a7d98b', '#c9b3ff', '#f6bd7c'];

  function chatColor(pid) {
    let h = 0;
    for (const ch of String(pid || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return CHAT_COLORS[h % CHAT_COLORS.length];
  }
  function myPid() {
    const v = OC.cur && OC.cur.view;
    const me = v && v.members && v.members.find((m) => m.you);
    return me ? me.pid : null;
  }
  function hhmm(t) {
    const d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function updateChatButtons() {
    const o = OC.cur;
    const n = o ? o.unread : 0;
    document.querySelectorAll('[data-chat-btn]').forEach((b) => {
      b.hidden = !o;
      b.setAttribute('aria-label', n ? 'チャット（未読' + n + '件）' : 'チャット');
      const badge = b.querySelector('.badge');
      if (badge) { badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n); }
    });
    const lb = $('on-chat');
    if (lb) lb.textContent = n ? 'チャット（未読 ' + n + '）' : 'チャット';
  }

  function openChat() {
    const o = OC.cur;
    if (!o) return;
    CM.closeBook();
    $('chat').hidden = false;
    o.unread = 0;
    updateChatButtons();
    renderChat();
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => $('chat-input').focus(), 30);
  }
  function closeChat() { const c = $('chat'); if (c) c.hidden = true; }

  function renderChat() {
    const o = OC.cur;
    if (!o || $('chat').hidden) return;
    const list = $('chat-list');
    const me = myPid();
    if (!o.chat.length) {
      list.innerHTML = '<li class="empty">まだメッセージはありません。<br>下のボタンからひとこと送れます。</li>';
      return;
    }
    list.innerHTML = o.chat.map((it) => {
      const mine = it.pid === me;
      return '<li class="' + (mine ? 'me' : '') + '"><span class="who" style="color:' + chatColor(it.pid) + '">' + esc(mine ? 'あなた' : it.name) +
        '<time>' + hhmm(it.at) + '</time></span><span class="msg">' + esc(it.text) + '</span></li>';
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  function onChatItem(o, item, fromLog) {
    if (!item || typeof item.text !== 'string') return;
    o.chat.push(item);
    if (o.chat.length > 60) o.chat.splice(0, o.chat.length - 60);
    const mine = item.pid === myPid();
    if (!mine && $('chat').hidden) o.unread++;
    updateChatButtons();
    renderChat();
    if (fromLog) return;
    if (!mine) SND.play('chat');
    // 対局中は、送った人の席の上に吹き出しで出す
    const gm = o.game && D.Games[o.game];
    if (o.gameShown && gm && gm.online.bubble) {
      const short = Array.from(item.text).length > 22 ? Array.from(item.text).slice(0, 21).join('') + '…' : item.text;
      gm.online.bubble(mine ? -1 : item.seat, item.name, short, mine);
    }
  }

  function sendChat(text) {
    const o = OC.cur;
    if (!o) return false;
    text = String(text || '').trim();
    if (!text) return false;
    if (!o.conn.send({ t: 'chat', text })) { UI.toast('通信が切れています。つながり直してから送ってください'); return false; }
    return true;
  }

  function init() {
    $('chat-close').innerHTML = A.icon('close');
    document.querySelectorAll('[data-chat-btn]').forEach((b) => {
      b.querySelector('.ic-slot').innerHTML = A.icon('chat');
      b.addEventListener('click', () => ($('chat').hidden ? openChat() : closeChat()));
    });
    $('chat-close').addEventListener('click', closeChat);
    $('chat-presets').innerHTML = CHAT_PRESETS.map((p) => '<button type="button">' + esc(p) + '</button>').join('');
    $('chat-presets').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => sendChat(b.textContent)));
    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('chat-input');
      if (sendChat(input.value)) input.value = '';
    });
    // スマホのキーボードでチャット欄が隠れないように、キーボードの高さだけ持ち上げる
    const vv = globalThis.visualViewport;
    if (vv) {
      const fit = () => {
        const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--kb', Math.round(kb) + 'px');
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }
    $('online-back').innerHTML = A.icon('back');
    $('online-back').addEventListener('click', () => { if (OC.cur) confirmLeave(false); else D.Shell.showHome(OC.entryGame); });
    updateChatButtons();
  }

  // ── 画面：入口・待合室 ──
  function renderOnline() {
    const wrap = $('online-wrap');
    const o = OC.cur;
    const g = (o && o.game) || OC.entryGame;
    $('online-title').textContent = 'オンライン・' + RT.cfg(g).label;
    if (!o) { renderEntry(wrap); return; }
    const v = o.view;
    if (!v) {
      wrap.innerHTML = '<section class="online-wait"><p class="wait-big">' + (o.status === 'retry' ? 'サーバーにつなぎ直しています…' : '部屋に入っています…') +
        '</p><p class="row-desc">部屋コード <b class="code-inline">' + esc(o.code) + '</b></p><button class="btn btn-ghost" type="button" id="on-cancel">やめる</button></section>';
      $('on-cancel').addEventListener('click', () => leaveRoom(false));
      return;
    }
    if (v.phase === 'lobby') { renderLobby(wrap, o, v); return; }
    wrap.innerHTML = '<section class="online-wait"><p class="wait-big">対局中です</p><button class="btn btn-gold" type="button" id="on-return">対局に戻る</button></section>';
    $('on-return').addEventListener('click', () => { mod(o).online.showTable(o); reask(); });
  }

  function renderEntry(wrap) {
    const g = OC.entryGame;
    const orr = store.onlineRatings[g];
    wrap.innerHTML =
      '<section class="online-rate"><span class="lbl">' + esc(RT.cfg(g).label) + '・オンラインレート</span><b>' + (orr ? orr.r : RT.START) + '</b><span class="sub">' +
      (orr && orr.matches ? orr.matches + '試合' : 'レート戦の部屋で遊ぶと変わります') + '</span></section>' +
      '<section><h3 class="sect-title">あなたの名前<small>ほかの人に表示されます</small></h3><div class="card-panel"><div class="row">' +
      '<input class="name-input wide" id="on-name" maxlength="8" placeholder="名前（8文字まで）" autocomplete="nickname" value="' + esc(CM.playerName()) + '"></div></div></section>' +
      '<section><h3 class="sect-title">部屋を作る<small>' + esc(RT.cfg(g).label) + 'の部屋</small></h3><div class="card-panel"><div class="row col"><div class="row-desc">部屋を作ると招待リンクができます。LINEなどで友だちに送ってください。人数が足りない席にはAIロボットが入ります。</div>' +
      '<button class="btn btn-gold" type="button" id="on-create">部屋を作る</button></div></div></section>' +
      '<section><h3 class="sect-title">部屋に入る<small>招待された5文字のコード（どのゲームの部屋でも入れます）</small></h3><div class="card-panel"><div class="row join-row">' +
      '<input class="code-input" id="on-code" maxlength="5" placeholder="ABCDE" autocomplete="off" autocapitalize="characters" spellcheck="false" value="' + esc(OC.draftCode) + '">' +
      '<button class="btn btn-ghost" type="button" id="on-join">入る</button></div></div></section>';
    const nameIn = $('on-name');
    const saveName = () => { CM.settings.name = nameIn.value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8) || 'あなた'; CM.save(); };
    nameIn.addEventListener('change', saveName);
    $('on-create').addEventListener('click', () => { saveName(); SND.unlock(); joinRoom(D.Net.newRoomCode()); });
    const doJoin = () => {
      saveName();
      SND.unlock();
      const code = $('on-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-Z0-9]{5}$/.test(code)) { UI.toast('部屋コードは英数字5文字です'); return; }
      OC.draftCode = code;
      joinRoom(code);
    };
    $('on-join').addEventListener('click', doJoin);
    $('on-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
    if (OC.draftCode && !CM.playerName()) setTimeout(() => nameIn.focus(), 50);
  }

  function renderLobby(wrap, o, v) {
    const g = o.game;
    const L = LOBBY[g], c = RT.cfg(g), gm = D.Games[g];
    const n = v.settings.players;
    const rated = v.settings.mode === 'rated';
    const gamesLabel = (x) => (L.games.find((y) => y.v === x) || { label: String(x) }).label;
    const rows = v.members.map((m) => '<div class="member"><span class="dot ' + (m.connected ? 'on' : 'off') + '"></span>' +
      '<span class="mname">' + esc(m.name) + (m.you ? '<small>（あなた）</small>' : '') + '</span>' + (m.host ? '<span class="host-chip">ホスト</span>' : '') +
      '<span class="rt-chip" title="オンラインレート">' + (m.rating == null ? RT.START : m.rating) + '</span></div>').join('');
    let ai = '';
    for (let i = v.members.length; i < n; i++) {
      ai += '<div class="member ai"><span class="dot ai"></span><span class="mname">AIロボット</span>' +
        (rated ? '<span class="rt-chip">' + (c.ai[v.settings.aiLevel] || c.ai.normal) + '</span>' : '') + '</div>';
    }
    const fixed = c.kind === 'winloss' ? c.players + '人・' + c.games + '本勝負' : c.players + '人・' + c.games + 'ゲーム';
    wrap.innerHTML =
      '<section class="room-head"><div class="room-game">' + esc(c.label) + '</div><div class="room-label">部屋コード</div><div class="room-code">' + esc(v.code) + '</div>' +
      '<button class="btn btn-gold" type="button" id="on-invite">友だちを招待</button>' +
      '<p class="row-desc invite-url">' + esc(inviteURL(v.code)) + '</p></section>' +
      '<section><h3 class="sect-title">参加者<small>' + v.members.length + '人 ＋ AIロボット' + Math.max(0, n - v.members.length) + '体</small></h3>' +
      '<div class="card-panel member-list">' + rows + ai + '</div></section>' +
      '<section id="on-settings"></section>' +
      '<section class="lobby-actions" id="on-actions"></section>';
    $('on-invite').addEventListener('click', () => invite(v.code));
    const box = $('on-settings');
    const { row, seg } = CM;
    if (v.host) {
      box.innerHTML = '<h3 class="sect-title">設定<small>ホストだけが変えられます</small></h3>';
      const panel = document.createElement('div');
      panel.className = 'card-panel';
      panel.appendChild(row('遊び方', rated ? fixed + '・' + c.rulesLabel + 'で固定。結果でオンラインレートが上下します' : 'レートは変わりません',
        seg([{ v: 'free', label: 'フリー対戦' }, { v: 'rated', label: 'レート戦' }], v.settings.mode, (x) => {
          if (x === 'rated' && v.members.length > c.players) { UI.toast('レート戦は' + c.players + '人までです'); return; }
          o.conn.send({ t: 'config', mode: x });
        })));
      if (rated) {
        panel.appendChild(row('人数・ゲーム数', fixed + '（固定）。足りない席はAIロボット', null));
      } else {
        if (L.players.length > 1) {
          const min = Math.max(L.players[0], v.members.length);
          panel.appendChild(row('人数', '足りない席はAIロボット', seg(L.players.map((x) => ({ v: x, label: x + '人' })), n,
            (x) => { if (x >= min) o.conn.send({ t: 'config', players: x }); else UI.toast('部屋にいる人数より少なくはできません'); })));
        }
        panel.appendChild(row(c.kind === 'winloss' ? '試合の長さ' : '1試合のゲーム数', '', seg(L.games, v.settings.games, (x) => o.conn.send({ t: 'config', games: x }))));
      }
      panel.appendChild(row('AIの強さ', rated ? 'AIのレート：' + L.ai.map((lv) => CM.LEVEL_LABEL[lv] + ' ' + c.ai[lv]).join('・') : '',
        seg(L.ai.map((lv) => ({ v: lv, label: CM.LEVEL_LABEL[lv] })), v.settings.aiLevel, (x) => o.conn.send({ t: 'config', aiLevel: x }))));
      panel.appendChild(row('ルール', rated ? c.rulesLabel + '（固定）' : gm.online.rulesDesc(), null));
      box.appendChild(panel);
      $('on-actions').innerHTML = '<button class="btn btn-gold btn-lg" type="button" id="on-start">この部屋で始める</button>' +
        '<button class="btn btn-ghost" type="button" id="on-chat">チャット</button>' +
        '<button class="btn btn-ghost" type="button" id="on-leave">部屋を出る</button>';
      $('on-start').addEventListener('click', () => { SND.unlock(); o.conn.send({ t: 'start', rules: gm.online.startRules() }); $('on-start').disabled = true; });
    } else {
      const what = rated ? 'レート戦（' + fixed + '）' : 'フリー対戦・' + n + '人・' + (c.kind === 'winloss' ? gamesLabel(v.settings.games) : v.settings.games ? v.settings.games + 'ゲーム' : 'ゲーム数は無制限');
      box.innerHTML = '<h3 class="sect-title">設定</h3><div class="card-panel"><div class="row"><div class="row-text"><div class="row-name">' + esc(what) + '</div>' +
        '<div class="row-desc">' + (rated ? '結果でオンラインレートが上下します。' : '') + 'ルールと人数はホストが決めます。AIの強さ：' + CM.LEVEL_LABEL[v.settings.aiLevel] + '</div></div></div></div>';
      $('on-actions').innerHTML = '<p class="wait-big">ホストが始めるのを待っています…</p>' +
        '<button class="btn btn-ghost" type="button" id="on-chat">チャット</button>' +
        '<button class="btn btn-ghost" type="button" id="on-leave">部屋を出る</button>';
    }
    $('on-chat').addEventListener('click', openChat);
    updateChatButtons();
    $('on-leave').addEventListener('click', () => confirmLeave(false));
  }

  Object.assign(OC, {
    init, openOnline, joinRoom, leaveRoom, reask, confirmLeave, openMenu, invite, openChat, closeChat, updateChatButtons,
    renderOnline, showOnlineScreen, inviteURL,
  });
  D.OnlineClient = OC;
})();
