/* 大富豪 — オンライン対戦の通信（切れたら自動でつなぎ直す） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  const PROD_SERVER = 'wss://daifugo-nonsankun0515.daifugo-nonsankun0515.workers.dev';

  /** 接続先：開発中（localhost）は手元のサーバー、それ以外は Cloudflare */
  function serverURL() {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return 'ws://127.0.0.1:8787';
    return PROD_SERVER;
  }

  /** この端末のID（部屋に戻るときに同じ席に座るため） */
  function clientId() {
    let id = null;
    try { id = localStorage.getItem('daifugo.cid'); } catch (e) { /* 保存できない環境 */ }
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      const a = new Uint8Array(12);
      crypto.getRandomValues(a);
      id = Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      try { localStorage.setItem('daifugo.cid', id); } catch (e) { /* 保存できない環境 */ }
    }
    return id;
  }

  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function newRoomCode() {
    const a = new Uint8Array(5);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  }

  /**
   * 部屋につなぐ。handlers: onMessage(msg), onStatus('connecting'|'open'|'retry'|'closed'), onOpen()
   * 戻り値: { send(obj), close() }
   */
  function connect(code, handlers) {
    let ws = null;
    let closedByUser = false;
    let retry = 0;
    let timer = 0;
    let ping = 0;
    const url = serverURL() + '/room/' + code;

    function status(s) { if (handlers.onStatus) handlers.onStatus(s); }

    function open() {
      clearTimeout(timer);
      status(retry ? 'retry' : 'connecting');
      try { ws = new WebSocket(url); } catch (e) { schedule(); return; }
      ws.onopen = () => {
        retry = 0;
        status('open');
        if (handlers.onOpen) handlers.onOpen();
        clearInterval(ping);
        ping = setInterval(() => send({ t: 'ping' }), 25000);
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg.t === 'pong') return;
        handlers.onMessage(msg);
      };
      ws.onclose = (e) => {
        clearInterval(ping);
        ws = null;
        if (closedByUser || e.code === 4001 || e.code === 4000) { status('closed'); if (handlers.onClosed) handlers.onClosed(e.code); return; }
        schedule();
      };
      ws.onerror = () => { /* onclose で扱う */ };
    }

    function schedule() {
      if (closedByUser) return;
      retry++;
      status('retry');
      timer = setTimeout(open, Math.min(8000, 600 * Math.pow(1.7, retry)));
    }

    function send(obj) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
      return false;
    }

    // スマホでアプリに戻ってきたら、すぐつなぎ直す
    function onVisible() {
      if (document.visibilityState === 'visible' && !closedByUser && (!ws || ws.readyState > 1)) { retry = 0; open(); }
    }
    document.addEventListener('visibilitychange', onVisible);

    open();
    return {
      send,
      close() {
        closedByUser = true;
        clearTimeout(timer);
        clearInterval(ping);
        document.removeEventListener('visibilitychange', onVisible);
        if (ws) { try { ws.close(1000, 'bye'); } catch (e) { /* 無視 */ } }
      },
      get open() { return !!ws && ws.readyState === 1; },
    };
  }

  /** オンライン対戦が使える環境か（Claude のページ内では外部と通信できない） */
  function available() {
    const inArtifact = !!(globalThis.claude && globalThis.claude.hot) || /claude(usercontent)?\.(ai|com)$/i.test(location.hostname);
    return !inArtifact && typeof WebSocket !== 'undefined';
  }

  D.Net = { connect, clientId, newRoomCode, serverURL, available, APP_URL: 'https://nonsankun0515-cloud.github.io/daifugo/' };
})();
