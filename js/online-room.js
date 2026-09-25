/* 大富豪 — オンライン対戦の部屋（サーバーの Durable Object とテストで共通） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const E = D.Engine, RU = D.Rules, AI = D.AI;

  const ROBOT_NAMES = ['ロボ太', 'メカ子', 'ギア丸', 'ボルト', 'ネジ美'];
  const MAX_PLAYERS = 6;
  const MIN_PLAYERS = 3;
  const AWAY_GRACE = 15000; // 切断した人の番をAIが代わるまで
  // 演出が大きいイベント（AIの次の手までの待ち時間を延ばす）
  const BIG = new Set(['revolution', 'jback', 'cut', 'sand', 'spade3', 'stop', 'skip', 'give', 'discard', 'bomb', 'pickup',
    'reverse', 'lock', 'finish', 'foul', 'miyako', 'gekokujo', 'tenpen', 'greatRevolution', 'lucky', 'deal', 'exchange']);

  function cleanName(name) {
    return String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 8);
  }

  const CHAT_MAX = 60; // 1通の長さ（文字）
  const CHAT_KEEP = 30; // 部屋に残す件数
  const CHAT_BURST = 6; // 10秒あたりに送れる数
  function cleanChat(text) {
    const s = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, CHAT_MAX).join('');
  }
  // チャットで見せる公開ID（再接続用のIDは他の人に見せない）
  function pidOf(m) {
    if (!m.pid) m.pid = Math.random().toString(36).slice(2, 8);
    return m.pid;
  }

  class RoomCore {
    constructor(code) {
      this.code = code;
      this.members = []; // 部屋にいる人（入った順。先頭がホスト）: { cid, name, connected, awaySince }
      this.settings = { players: 4, aiLevel: 'normal' };
      this.phase = 'lobby'; // lobby | playing
      this.seats = []; // 対局中の席: { type: 'human'|'ai', cid, name, level, robot }
      this.S = null;
      this.lastEvents = [];
      this.rev = 0;
      this.updatedAt = 0;
      this.chatLog = [];
      this.chatSeq = 0;
    }

    toJSON() {
      return {
        code: this.code, members: this.members, settings: this.settings, phase: this.phase, seats: this.seats,
        S: this.S ? E.serialize(this.S) : null, lastEvents: this.lastEvents, rev: this.rev, updatedAt: this.updatedAt,
        chatLog: this.chatLog, chatSeq: this.chatSeq,
      };
    }

    static fromJSON(o) {
      const r = new RoomCore(o.code);
      Object.assign(r, o);
      r.S = o.S ? E.deserialize(o.S) : null;
      if (!Array.isArray(r.chatLog)) r.chatLog = [];
      if (!r.chatSeq) r.chatSeq = r.chatLog.length ? r.chatLog[r.chatLog.length - 1].id : 0;
      return r;
    }

    /** チャットを1通受け付ける（部屋にいる人だけ・長さと連投を制限） */
    chat(cid, text, now) {
      const m = this.member(cid);
      if (!m) return { ok: false, error: '部屋にいません' };
      text = cleanChat(text);
      if (!text) return { ok: false, error: 'メッセージが空です' };
      m.chatTimes = (m.chatTimes || []).filter((t) => now - t < 10000);
      if (m.chatTimes.length >= CHAT_BURST) return { ok: false, error: '送りすぎです。少し待ってからどうぞ' };
      m.chatTimes.push(now);
      const item = { id: ++this.chatSeq, pid: pidOf(m), name: m.name, seat: this.phase === 'playing' ? this.seatOf(cid) : -1, text, at: now };
      this.chatLog.push(item);
      if (this.chatLog.length > CHAT_KEEP) this.chatLog.splice(0, this.chatLog.length - CHAT_KEEP);
      this.updatedAt = now;
      return { ok: true, item };
    }

    touch(now) { this.rev++; this.updatedAt = now || Date.now(); }
    member(cid) { return this.members.find((m) => m.cid === cid) || null; }
    isHost(cid) { return this.members.length > 0 && this.members[0].cid === cid; }
    seatOf(cid) { return this.seats.findIndex((s) => s.type === 'human' && s.cid === cid); }

    /** 入室（同じ人の再接続もここ） */
    join(cid, name, now) {
      name = cleanName(name);
      const m = this.member(cid);
      if (m) {
        m.connected = true;
        m.awaySince = 0;
        if (name) m.name = name;
        pidOf(m);
        this.touch(now);
        return { ok: true };
      }
      if (this.phase === 'playing') {
        // 対局中は、AIの席を引き継いで途中参加
        const i = this.seats.findIndex((s) => s.type === 'ai');
        if (i < 0) return { ok: false, error: '満席です' };
        const nm = name || 'プレイヤー';
        const nmb = { cid, name: nm, connected: true, awaySince: 0 };
        pidOf(nmb);
        this.members.push(nmb);
        this.seats[i] = { type: 'human', cid, name: nm, level: 'normal', robot: -1 };
        this.S.players[i].name = nm;
        this.S.players[i].human = true;
        this.touch(now);
        return { ok: true };
      }
      if (this.members.length >= MAX_PLAYERS) return { ok: false, error: '満員です（6人まで）' };
      const nm = { cid, name: name || 'プレイヤー' + (this.members.length + 1), connected: true, awaySince: 0 };
      pidOf(nm);
      this.members.push(nm);
      this.settings.players = Math.max(this.settings.players, this.members.length);
      this.touch(now);
      return { ok: true };
    }

    disconnect(cid, now) {
      const m = this.member(cid);
      if (!m || !m.connected) return;
      m.connected = false;
      m.awaySince = now;
      this.touch(now);
    }

    /** 退室：ロビーなら抜ける、対局中ならその席はAIが引き継ぐ */
    leave(cid, now) {
      const i = this.members.findIndex((m) => m.cid === cid);
      if (i < 0) return;
      this.members.splice(i, 1);
      if (this.phase === 'playing') {
        const s = this.seatOf(cid);
        if (s >= 0) this.toAI(s);
        if (!this.members.length) { this.phase = 'lobby'; this.seats = []; this.S = null; this.lastEvents = []; }
      }
      this.touch(now);
    }

    toAI(s) {
      const used = new Set(this.seats.filter((x) => x.type === 'ai').map((x) => x.robot));
      let robot = 0;
      while (used.has(robot) && robot < ROBOT_NAMES.length - 1) robot++;
      this.seats[s] = { type: 'ai', cid: null, name: ROBOT_NAMES[robot], level: this.settings.aiLevel, robot };
      this.S.players[s].name = ROBOT_NAMES[robot];
      this.S.players[s].human = false;
    }

    configure(cid, cfg, now) {
      if (!this.isHost(cid)) return { ok: false, error: '設定を変えられるのはホストだけです' };
      if (this.phase !== 'lobby') return { ok: false, error: '対局中は変えられません' };
      if (cfg.players != null) {
        const n = Math.round(Number(cfg.players));
        if (!(n >= MIN_PLAYERS && n <= MAX_PLAYERS)) return { ok: false, error: '人数は3〜6人です' };
        if (n < this.members.length) return { ok: false, error: '部屋にいる人数より少なくはできません' };
        this.settings.players = n;
      }
      if (cfg.aiLevel != null) {
        if (!['easy', 'normal'].includes(cfg.aiLevel)) return { ok: false, error: 'AIの強さが不正です' };
        this.settings.aiLevel = cfg.aiLevel;
      }
      this.touch(now);
      return { ok: true };
    }

    /** 対局開始（ホストのルールで） */
    start(cid, rules, now) {
      if (!this.isHost(cid)) return { ok: false, error: '始められるのはホストだけです' };
      if (this.phase !== 'lobby') return { ok: false, error: 'もう始まっています' };
      const n = Math.max(this.settings.players, this.members.length, MIN_PLAYERS);
      const seats = this.members.map((m) => ({ type: 'human', cid: m.cid, name: m.name, level: 'normal', robot: -1 }));
      for (let r = 0; seats.length < n; r++) {
        seats.push({ type: 'ai', cid: null, name: ROBOT_NAMES[r], level: this.settings.aiLevel, robot: r });
      }
      this.seats = seats;
      this.S = E.createMatch({ rules: RU.normalize(rules || RU.MINE), players: seats.map((s) => ({ name: s.name, human: s.type === 'human', level: s.level })) });
      this.S.events = [];
      E.startGame(this.S);
      this.lastEvents = this.S.events;
      this.S.events = [];
      this.phase = 'playing';
      this.touch(now);
      return { ok: true };
    }

    /** プレイヤーの操作 */
    act(cid, action, now) {
      if (this.phase !== 'playing' || !this.S) return { ok: false, error: '対局中ではありません' };
      const seat = this.seatOf(cid);
      if (seat < 0) return { ok: false, error: '席がありません' };
      const q = E.getRequest(this.S);
      if (!q || q.seat !== seat) return { ok: false, error: 'あなたの番ではありません' };
      if (!action || typeof action !== 'object') return { ok: false, error: '操作が不正です' };
      const a = Object.assign({}, action, { seat });
      this.lastEvents = E.apply(this.S, a);
      this.touch(now);
      return { ok: true };
    }

    /** 次のゲーム（部屋にいる人なら誰でも） */
    next(cid, now) {
      if (this.phase !== 'playing' || !this.S || this.S.phase !== 'over') return { ok: false, error: 'まだゲーム中です' };
      if (!this.member(cid)) return { ok: false, error: '部屋にいません' };
      this.S.events = [];
      E.startGame(this.S);
      this.lastEvents = this.S.events;
      this.S.events = [];
      this.touch(now);
      return { ok: true };
    }

    /** いま誰かがAIとして動く必要があるか。あるなら何ms後か（なければ null） */
    nextAiDelay(now) {
      if (this.phase !== 'playing' || !this.S) return null;
      const q = E.getRequest(this.S);
      if (!q) return null;
      const seat = this.seats[q.seat];
      const big = this.lastEvents.filter((e) => BIG.has(e.t)).length;
      const base = Math.min(4500, 1000 + big * 750);
      if (seat.type === 'ai') return base;
      const m = this.member(seat.cid);
      if (!m) return base;
      if (!m.connected) return Math.max(base, m.awaySince + AWAY_GRACE - now);
      return null;
    }

    /** AI（または切断中の人の代わり）が1手進める。進めたら true */
    aiStep(now) {
      const d = this.nextAiDelay(now);
      if (d === null) return false;
      const q = E.getRequest(this.S);
      const seat = this.seats[q.seat];
      if (seat.type !== 'ai') {
        const m = this.member(seat.cid);
        if (m && (m.connected || now - m.awaySince < AWAY_GRACE)) return false;
      }
      const level = seat.type === 'ai' ? seat.level : 'normal';
      const a = AI.decideSync(this.S, q, level === 'easy' ? 'easy' : 'normal');
      this.lastEvents = E.apply(this.S, a);
      this.touch(now);
      return true;
    }

    connectedHumans() { return this.members.filter((m) => m.connected).length; }

    // ── 各プレイヤーに送る内容（他人の手札は伏せる） ──
    viewFor(cid, withEvents) {
      const hostCid = this.members.length ? this.members[0].cid : null;
      const v = {
        t: 'room',
        code: this.code,
        rev: this.rev,
        phase: this.phase,
        host: cid === hostCid,
        members: this.members.map((m) => ({ pid: pidOf(m), name: m.name, connected: m.connected, host: m.cid === hostCid, you: m.cid === cid })),
        settings: this.settings,
      };
      if (this.phase === 'playing' && this.S) {
        const seat = this.seatOf(cid);
        v.seat = seat;
        v.seats = this.seats.map((s) => {
          const m = s.type === 'human' ? this.member(s.cid) : null;
          return { name: s.name, type: s.type, robot: s.robot, connected: s.type === 'ai' ? true : !!(m && m.connected) };
        });
        v.state = sanitize(this.S, seat);
        v.events = withEvents ? filterEvents(this.lastEvents, seat) : [];
        const q = E.getRequest(this.S);
        v.request = q && q.seat === seat && seat >= 0 ? sanitizeRequest(q) : null;
      }
      return v;
    }
  }

  function sanitize(S, seat) {
    const T = E.serialize(S);
    T.players.forEach((p, i) => { if (i !== seat) p.hand = p.hand.map(() => '?'); });
    if (T.pending) {
      delete T.pending.rest;
      if (T.pending.seat !== seat) {
        if (T.pending.kind === 'bomb') T.pending.ranks = [];
        if (T.pending.kind === 'exchange') T.pending.got = [];
      }
    }
    T.queue = (T.queue || []).map((q) => (q.seat === seat ? q : Object.assign({}, q, { got: [] })));
    return T;
  }

  function sanitizeRequest(q) {
    const r = JSON.parse(JSON.stringify(q));
    delete r.rest;
    return r;
  }

  function filterEvents(events, seat) {
    return events.map((ev) => {
      if ((ev.t === 'give' || ev.t === 'exchange') && ev.from !== seat && ev.to !== seat) {
        return Object.assign({}, ev, { cards: ev.cards.map(() => '?') });
      }
      return ev;
    });
  }

  D.RoomCore = RoomCore;
  D.Online = { ROBOT_NAMES, AWAY_GRACE, sanitize, filterEvents, cleanName, cleanChat, CHAT_MAX, CHAT_KEEP };
})();
