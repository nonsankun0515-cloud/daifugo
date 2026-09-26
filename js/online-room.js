/* オンライン対戦の部屋（サーバーの Durable Object とテストで共通）
 * 部屋の仕組み（入退室・ホスト・設定・チャット・レート）は共通で、ゲームごとの違いは ADAPTERS にまとめる。 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const RT = D.Rating;

  const ROBOT_NAMES = ['ロボ太', 'メカ子', 'ギア丸', 'ボルト', 'ネジ美'];
  const AWAY_GRACE = 15000; // 切断した人の番をAIが代わるまで（順番のあるゲーム）

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

  // ─────────────────────────────────────────────
  // ゲームごとの違い
  // ─────────────────────────────────────────────
  /** 順番に1手ずつ進むゲーム（大富豪・七並べ）の共通部分 */
  function turnAdapter(spec) {
    return Object.assign({
      realtime: false,
      create(o) { return spec.engine().createMatch(o); },
      start(S) { const E = spec.engine(); S.events = []; E.startGame(S); const ev = S.events; S.events = []; return ev; },
      act(S, seat, action) {
        const E = spec.engine();
        const q = E.getRequest(S);
        if (!q || q.seat !== seat) throw new Error('あなたの番ではありません');
        if (!action || typeof action !== 'object') throw new Error('操作が不正です');
        return E.apply(S, Object.assign({}, action, { seat }));
      },
      /** いま誰かがAIとして動く必要があるか。あるなら何ms後か（なければ null） */
      delay(room, now) {
        const S = room.S;
        const q = spec.engine().getRequest(S);
        if (!q) return null;
        const seat = room.seats[q.seat];
        const big = room.lastEvents.filter((e) => spec.big.has(e.t)).length;
        const base = Math.min(4500, spec.baseDelay + big * 750);
        if (seat.type === 'ai') return base;
        const m = room.member(seat.cid);
        if (!m) return base;
        if (!m.connected) return Math.max(base, m.awaySince + AWAY_GRACE - now);
        return null;
      },
      /** AI（または切断中の人の代わり）が1手進める */
      tick(room, now) {
        const S = room.S;
        const E = spec.engine();
        if (this.delay(room, now) === null) return null;
        const q = E.getRequest(S);
        const seat = room.seats[q.seat];
        if (seat.type !== 'ai') {
          const m = room.member(seat.cid);
          if (m && (m.connected || now - m.awaySince < AWAY_GRACE)) return null;
        }
        const level = seat.type === 'ai' ? seat.level : 'normal';
        const a = spec.ai().decideSync(S, q, level === 'easy' ? 'easy' : 'normal');
        return E.apply(S, a);
      },
      view(S, seat, events) {
        const E = spec.engine();
        const q = E.getRequest(S);
        return {
          state: spec.sanitize(S, seat),
          events: events.map((ev) => spec.filterEvent(ev, seat)),
          request: q && q.seat === seat && seat >= 0 ? spec.sanitizeRequest(q) : null,
        };
      },
    }, spec);
  }

  const BIG_DAIFUGO = new Set(['revolution', 'jback', 'cut', 'sand', 'spade3', 'stop', 'skip', 'give', 'discard', 'bomb', 'pickup',
    'reverse', 'lock', 'finish', 'foul', 'miyako', 'gekokujo', 'tenpen', 'greatRevolution', 'lucky', 'deal', 'exchange']);

  const ADAPTERS = {
    daifugo: turnAdapter({
      id: 'daifugo', minPlayers: 3, maxPlayers: 6, gamesOptions: [0, 5, 10], aiLevels: ['easy', 'normal'], baseDelay: 1000, big: BIG_DAIFUGO,
      defaults: { players: 4, aiLevel: 'normal', mode: 'free', games: 10 },
      engine: () => D.Engine, ai: () => D.AI, normalizeRules: (r) => D.Rules.normalize(r || D.Rules.MINE),
      sanitize: sanitizeDaifugo,
      filterEvent(ev, seat) {
        if ((ev.t === 'give' || ev.t === 'exchange') && ev.from !== seat && ev.to !== seat) return Object.assign({}, ev, { cards: ev.cards.map(() => '?') });
        return ev;
      },
      sanitizeRequest(q) { const r = JSON.parse(JSON.stringify(q)); delete r.rest; return r; },
    }),
    sevens: turnAdapter({
      id: 'sevens', minPlayers: 3, maxPlayers: 6, gamesOptions: [0, 5, 10], aiLevels: ['easy', 'normal'], baseDelay: 900,
      big: new Set(['deal', 'joker', 'jokerBack', 'elim', 'finish', 'sevens']),
      defaults: { players: 4, aiLevel: 'normal', mode: 'free', games: 10 },
      engine: () => D.Sevens, ai: () => D.SevensAI, normalizeRules: (r) => D.SevensRules.normalize(r),
      sanitize(S, seat) {
        const T = D.Sevens.serialize(S);
        T.players.forEach((p, i) => { if (i !== seat) p.hand = p.hand.map(() => '?'); });
        if (T.forced && T.forced.seat !== seat) T.forced = null; // ジョーカーの場所のカードをだれが持っているかは伏せる
        return T;
      },
      filterEvent: (ev) => ev,
      sanitizeRequest: (q) => Object.assign({}, q),
    }),
    speed: {
      id: 'speed', realtime: true, minPlayers: 2, maxPlayers: 2, gamesOptions: [1, 3, 5], aiLevels: ['easy', 'normal', 'hard'],
      defaults: { players: 2, aiLevel: 'normal', mode: 'free', games: 3 },
      normalizeRules: (r) => D.SpeedRules.normalize(r),
      create(o) { return D.Speed.createMatch(o); },
      start(S, room, now) { const ev = D.Speed.startGame(S); D.SpeedHost.schedule(S, now || Date.now(), levelOfSeats(room)); return ev; },
      act(S, seat, action, room, now) {
        if (!action || action.type !== 'play') throw new Error('操作が不正です');
        const ev = D.Speed.play(S, seat, action.slot, action.pile);
        D.SpeedHost.schedule(S, now, levelOfSeats(room));
        return ev;
      },
      delay(room, now) {
        const d = D.SpeedHost.nextDelay(room.S, now);
        const away = speedAway(room);
        if (!away) return d;
        const f = Math.max(0, away.at - now);
        return d == null ? f : Math.min(d, f);
      },
      tick(room, now) {
        // 通信が切れて30秒たった人は、そのゲームの負け
        const away = speedAway(room);
        if (away && away.at <= now) {
          const ev = D.Speed.forfeit(room.S, away.seat);
          D.SpeedHost.schedule(room.S, now, levelOfSeats(room));
          return ev;
        }
        const r = D.SpeedHost.tick(room.S, now, levelOfSeats(room));
        return r ? r.events : null;
      },
      view(S, seat, events) { return { state: D.Speed.publicView(S), events, request: null }; },
    },
  };
  // スピードは人の席にAIが代わりに入らない。通信が切れて AWAY_FORFEIT たったら、その人のゲームの負け（ユーザーが決めた）
  function levelOfSeats(room) {
    return (seat) => { const s = room && room.seats[seat]; return s && s.type === 'ai' ? s.level : null; };
  }
  const AWAY_FORFEIT = 30000;
  /** ゲーム中に通信が切れている人の席と、負けになる時刻（相手が人でつながっているときだけ。いなければ null） */
  function speedAway(room) {
    const S = room.S;
    if (!S || (S.phase !== 'play' && S.phase !== 'stuck')) return null;
    let out = null;
    room.seats.forEach((st, seat) => {
      const m = st.type === 'human' ? room.member(st.cid) : null;
      const other = room.seats[1 - seat];
      const om = other && other.type === 'human' ? room.member(other.cid) : null;
      if (!m || m.connected || !om || !om.connected) return;
      const at = m.awaySince + AWAY_FORFEIT;
      if (!out || at < out.at) out = { seat, at };
    });
    return out;
  }

  function engineOf(game) {
    return game === 'sevens' ? D.Sevens : game === 'speed' ? D.Speed : D.Engine;
  }

  // ─────────────────────────────────────────────
  // 部屋
  // ─────────────────────────────────────────────
  class RoomCore {
    constructor(code) {
      this.code = code;
      this.game = null; // daifugo | sevens | speed（最初に入った人が決める）
      this.members = []; // 部屋にいる人（入った順。先頭がホスト）: { cid, name, connected, awaySince }
      this.settings = Object.assign({}, ADAPTERS.daifugo.defaults); // mode: free | rated
      this.phase = 'lobby'; // lobby | playing
      this.seats = []; // 対局中の席: { type: 'human'|'ai', cid, name, level, robot, ratedCid }
      this.S = null;
      this.lastEvents = [];
      this.rev = 0;
      this.updatedAt = 0;
      this.chatLog = [];
      this.chatSeq = 0;
      this.ratingOut = []; // サーバーが保存するレート変動 { cid, game, delta }
    }

    get adapter() { return ADAPTERS[this.game || 'daifugo']; }

    toJSON() {
      return {
        code: this.code, game: this.game, members: this.members, settings: this.settings, phase: this.phase, seats: this.seats,
        S: this.S ? engineOf(this.game).serialize(this.S) : null, lastEvents: this.lastEvents, rev: this.rev, updatedAt: this.updatedAt,
        chatLog: this.chatLog, chatSeq: this.chatSeq, ratingOut: this.ratingOut,
      };
    }

    static fromJSON(o) {
      const r = new RoomCore(o.code);
      Object.assign(r, o);
      if (!r.game) r.game = 'daifugo'; // ゲームを選べるようになる前の部屋
      r.S = o.S ? engineOf(r.game).deserialize(o.S) : null;
      if (!Array.isArray(r.chatLog)) r.chatLog = [];
      if (!Array.isArray(r.ratingOut)) r.ratingOut = [];
      r.settings = Object.assign({}, r.adapter.defaults, r.settings);
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

    /** 入室（同じ人の再接続もここ）。rec はその人のレート { r, n }、game は新しい部屋のゲーム */
    join(cid, name, now, rec, game) {
      name = cleanName(name);
      const m = this.member(cid);
      if (m) {
        m.connected = true;
        m.awaySince = 0;
        if (name) m.name = name;
        if (rec) setRating(m, rec);
        pidOf(m);
        this.touch(now);
        return { ok: true };
      }
      if (!this.members.length && this.phase === 'lobby') {
        // 空の部屋：最初に入った人のゲームにする
        const g = ADAPTERS[game] ? game : 'daifugo';
        if (g !== this.game) { this.game = g; this.settings = Object.assign({}, this.adapter.defaults); }
      }
      const A = this.adapter;
      if (this.phase === 'playing') {
        // 対局中は、AIの席を引き継いで途中参加
        const i = this.seats.findIndex((s) => s.type === 'ai');
        if (i < 0) return { ok: false, error: '満席です' };
        const nm = name || 'プレイヤー';
        const nmb = { cid, name: nm, connected: true, awaySince: 0 };
        if (rec) setRating(nmb, rec);
        pidOf(nmb);
        this.members.push(nmb);
        this.seats[i] = { type: 'human', cid, name: nm, level: 'normal', robot: -1 };
        this.S.players[i].name = nm;
        this.S.players[i].human = true;
        this.touch(now);
        return { ok: true };
      }
      if (this.members.length >= A.maxPlayers) return { ok: false, error: '満員です（' + A.maxPlayers + '人まで）' };
      if (this.settings.mode === 'rated' && this.members.length >= RT.cfg(this.game).players) {
        return { ok: false, error: '満員です（レート戦は' + RT.cfg(this.game).players + '人まで）' };
      }
      const nm = { cid, name: name || 'プレイヤー' + (this.members.length + 1), connected: true, awaySince: 0 };
      if (rec) setRating(nm, rec);
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
      const gone = this.members.splice(i, 1)[0];
      if (this.phase === 'playing') {
        const s = this.seatOf(cid);
        if (s >= 0) { this.abandon(s, gone); this.toAI(s, now); }
        if (!this.members.length) { this.phase = 'lobby'; this.seats = []; this.S = null; this.lastEvents = []; }
      }
      this.touch(now);
    }

    toAI(s, now) {
      const used = new Set(this.seats.filter((x) => x.type === 'ai').map((x) => x.robot));
      let robot = 0;
      while (used.has(robot) && robot < ROBOT_NAMES.length - 1) robot++;
      this.seats[s] = { type: 'ai', cid: null, name: ROBOT_NAMES[robot], level: this.settings.aiLevel, robot };
      this.S.players[s].name = ROBOT_NAMES[robot];
      this.S.players[s].human = false;
      if (this.adapter.realtime && this.S.phase !== 'over') D.SpeedHost.schedule(this.S, now || Date.now(), levelOfSeats(this));
    }

    configure(cid, cfg, now) {
      if (!this.isHost(cid)) return { ok: false, error: '設定を変えられるのはホストだけです' };
      if (this.phase !== 'lobby') return { ok: false, error: '対局中は変えられません' };
      const A = this.adapter, rc = RT.cfg(this.game);
      if (cfg.mode != null) {
        if (cfg.mode !== 'free' && cfg.mode !== 'rated') return { ok: false, error: '遊び方が不正です' };
        if (cfg.mode === 'rated' && this.members.length > rc.players) return { ok: false, error: 'レート戦は' + rc.players + '人までです' };
        this.settings.mode = cfg.mode;
        if (cfg.mode === 'rated') { this.settings.players = rc.players; this.settings.games = rc.games; }
      }
      if (cfg.games != null) {
        const g = Number(cfg.games);
        if (!A.gamesOptions.includes(g)) return { ok: false, error: 'ゲーム数が不正です' };
        if (this.settings.mode === 'rated' && g !== rc.games) return { ok: false, error: 'レート戦のゲーム数は変えられません' };
        this.settings.games = g;
      }
      if (cfg.players != null) {
        const n = Math.round(Number(cfg.players));
        if (!(n >= A.minPlayers && n <= A.maxPlayers)) return { ok: false, error: '人数は' + A.minPlayers + '〜' + A.maxPlayers + '人です' };
        if (n < this.members.length) return { ok: false, error: '部屋にいる人数より少なくはできません' };
        if (this.settings.mode === 'rated' && n !== rc.players) return { ok: false, error: 'レート戦は' + rc.players + '人で固定です' };
        this.settings.players = n;
      }
      if (cfg.aiLevel != null) {
        if (!A.aiLevels.includes(cfg.aiLevel)) return { ok: false, error: 'AIの強さが不正です' };
        this.settings.aiLevel = cfg.aiLevel;
      }
      this.touch(now);
      return { ok: true };
    }

    /** 対局開始（ホストのルールで。レート戦は決まったルール） */
    start(cid, rules, now) {
      if (!this.isHost(cid)) return { ok: false, error: '始められるのはホストだけです' };
      if (this.phase !== 'lobby') return { ok: false, error: 'もう始まっています' };
      const A = this.adapter, rc = RT.cfg(this.game);
      const rated = this.settings.mode === 'rated';
      if (rated && this.members.length > rc.players) return { ok: false, error: 'レート戦は' + rc.players + '人までです' };
      const n = rated ? rc.players : Math.max(this.settings.players, this.members.length, A.minPlayers);
      // レート戦は、最初から座っている人だけがレートの対象（ratedCid）
      const seats = this.members.slice(0, n).map((m) => ({ type: 'human', cid: m.cid, name: m.name, level: 'normal', robot: -1, ratedCid: rated ? m.cid : null }));
      for (let r = 0; seats.length < n; r++) {
        seats.push({ type: 'ai', cid: null, name: ROBOT_NAMES[r], level: this.settings.aiLevel, robot: r });
      }
      this.seats = seats;
      let info = null;
      if (rated) {
        const base = seats.map((s) => (s.type === 'human' ? ratingOf(this.member(s.cid)) : rc.ai[s.level] || rc.ai.normal));
        const matches = seats.map((s) => (s.type === 'human' ? (this.member(s.cid).matches || 0) : 0));
        info = { online: true, base, matches, results: seats.map(() => null), finished: false };
      }
      this.S = A.create({
        rules: rated ? rc.rules() : A.normalizeRules(rules),
        players: seats.map((s) => ({ name: s.name, human: s.type === 'human', level: s.level })),
        games: rated ? rc.games : this.settings.games,
        rated: info,
      });
      this.lastEvents = A.start(this.S, this, now);
      this.phase = 'playing';
      this.touch(now);
      return { ok: true };
    }

    /** プレイヤーの操作 */
    act(cid, action, now) {
      if (this.phase !== 'playing' || !this.S) return { ok: false, error: '対局中ではありません' };
      const seat = this.seatOf(cid);
      if (seat < 0) return { ok: false, error: '席がありません' };
      this.lastEvents = this.adapter.act(this.S, seat, action, this, now);
      this.finishRated();
      this.touch(now);
      return { ok: true };
    }

    /** 次のゲーム（部屋にいる人なら誰でも） */
    next(cid, now) {
      if (this.phase !== 'playing' || !this.S || this.S.phase !== 'over') return { ok: false, error: 'まだゲーム中です' };
      if (!this.member(cid)) return { ok: false, error: '部屋にいません' };
      if (this.S.matchOver) return { ok: false, error: 'この試合は終わりました' };
      this.lastEvents = this.adapter.start(this.S, this, now);
      this.touch(now);
      return { ok: true };
    }

    /** いまAI（や時間で進むこと）が動く必要があるか。あるなら何ms後か（なければ null） */
    nextAiDelay(now) {
      if (this.phase !== 'playing' || !this.S) return null;
      return this.adapter.delay(this, now);
    }

    /** 時間が来たことを1つ進める。進めたら true */
    aiStep(now) {
      if (this.phase !== 'playing' || !this.S) return false;
      if (this.adapter.delay(this, now) === null) return false;
      const ev = this.adapter.tick(this, now);
      if (!ev) return false;
      this.lastEvents = ev;
      this.finishRated();
      this.touch(now);
      return true;
    }

    connectedHumans() { return this.members.filter((m) => m.connected).length; }

    /** 試合が終わったら部屋（待合室）に戻る。レート戦は最後まで終わってから */
    toLobby(cid, now) {
      if (this.phase !== 'playing' || !this.S) return { ok: false, error: '対局中ではありません' };
      if (!this.member(cid)) return { ok: false, error: '部屋にいません' };
      if (this.S.phase !== 'over' || (this.S.rated && !this.S.matchOver)) return { ok: false, error: '試合の途中です' };
      this.phase = 'lobby';
      this.seats = [];
      this.S = null;
      this.lastEvents = [];
      this.touch(now);
      return { ok: true };
    }

    // ── レート戦 ──
    /** 試合が終わったら、最初から最後まで座っていた人のレートを決める */
    finishRated() {
      const S = this.S, info = S && S.rated;
      if (!info || info.finished || !S.matchOver) return;
      info.finished = true;
      const all = RT.matchResult(S, info.base, info.matches);
      this.seats.forEach((st, i) => {
        if (!st.ratedCid || st.type !== 'human' || st.cid !== st.ratedCid || info.results[i]) return;
        const r = all[i];
        info.results[i] = { name: st.name, before: r.before, after: r.after, delta: r.delta, expected: r.expected, total: r.total };
        this.pushRating(st.ratedCid, r.delta);
      });
    }

    /** 途中で部屋を出た人：棄権（得点のゲームは残りを最下位、勝ち負けのゲームは負け） */
    abandon(s, member) {
      const S = this.S, info = S && S.rated, st = this.seats[s];
      if (!info || info.finished || !st || !st.ratedCid || st.cid !== st.ratedCid || info.results[s]) return;
      const r = RT.abandonResult(S, s, info.base, info.matches[s]);
      info.results[s] = Object.assign({ name: st.name, abandoned: true }, r);
      this.pushRating(st.ratedCid, r.delta, member);
    }

    pushRating(cid, delta, member) {
      this.ratingOut.push({ cid, game: this.game, delta });
      const m = member || this.member(cid);
      if (m) { m.rating = ratingOf(m) + delta; m.matches = (m.matches || 0) + 1; }
    }

    // ── 各プレイヤーに送る内容（他人の手札は伏せる） ──
    viewFor(cid, withEvents) {
      const hostCid = this.members.length ? this.members[0].cid : null;
      const v = {
        t: 'room',
        code: this.code,
        game: this.game || 'daifugo',
        rev: this.rev,
        phase: this.phase,
        host: cid === hostCid,
        members: this.members.map((m) => ({ pid: pidOf(m), name: m.name, connected: m.connected, host: m.cid === hostCid, you: m.cid === cid,
          rating: m.rating == null ? null : m.rating, matches: m.matches || 0 })),
        settings: this.settings,
      };
      if (this.phase === 'playing' && this.S) {
        const seat = this.seatOf(cid);
        v.seat = seat;
        v.youRated = seat >= 0 && this.seats[seat].ratedCid === cid; // レート戦でレートが動く人か
        v.seats = this.seats.map((s) => {
          const m = s.type === 'human' ? this.member(s.cid) : null;
          return { name: s.name, type: s.type, robot: s.robot, connected: s.type === 'ai' ? true : !!(m && m.connected) };
        });
        const pv = this.adapter.view(this.S, seat, withEvents ? this.lastEvents : []);
        v.state = pv.state;
        v.events = pv.events;
        v.request = pv.request;
      }
      return v;
    }
  }

  function setRating(m, rec) {
    if (rec && Number.isFinite(rec.r)) { m.rating = Math.round(rec.r); m.matches = rec.n || 0; }
  }
  const ratingOf = (m) => (m && Number.isFinite(m.rating) ? m.rating : RT.START);

  function sanitizeDaifugo(S, seat) {
    const T = D.Engine.serialize(S);
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

  D.RoomCore = RoomCore;
  D.Online = {
    ROBOT_NAMES, AWAY_GRACE, AWAY_FORFEIT, ADAPTERS, cleanName, cleanChat, CHAT_MAX, CHAT_KEEP,
    sanitize: sanitizeDaifugo, filterEvents: (evs, seat) => evs.map((ev) => ADAPTERS.daifugo.filterEvent(ev, seat)),
  };
})();
