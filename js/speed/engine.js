/* スピード — ルール判定（リアルタイムのゲーム。時間の管理は外側：画面のループかサーバー） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const C = D.Cards;

  const RULES = [
    { key: 'wrap', type: 'bool', label: 'AとKがつながる', def: true,
      desc: 'Kの上にA、Aの上にKも出せる。' },
    { key: 'same', type: 'bool', label: '同じ数字も重ねられる', def: true,
      desc: '台札と同じ数字も出せる（7の上に7など）。' },
  ];
  function defaults() { const o = {}; for (const r of RULES) o[r.key] = r.def; return o; }
  function normalize(saved) {
    const o = defaults();
    if (saved && typeof saved === 'object') for (const r of RULES) if (r.key in saved) o[r.key] = !!saved[r.key];
    return o;
  }
  const BY_KEY = {};
  for (const r of RULES) BY_KEY[r.key] = r;
  D.SpeedRules = { RULES, BY_KEY, defaults, normalize, STANDARD: defaults() };

  const FIELD = 4; // 場札の枚数
  const COLORS = [['H', 'D'], ['S', 'C']]; // 席0は赤、席1は黒
  const numOf = (id) => { const r = C.rankOf(id); return r === 14 ? 1 : r === 15 ? 2 : r; };
  const numLabel = (n) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] || String(n));
  const cardName = (id) => C.SUIT_SYM[C.suitOf(id)] + numLabel(numOf(id));

  /** 台札 top の上に card を出せるか */
  function canStack(R, card, top) {
    if (!top) return false;
    const a = numOf(card), b = numOf(top);
    if (R.same && a === b) return true;
    if (Math.abs(a - b) === 1) return true;
    return !!R.wrap && ((a === 1 && b === 13) || (a === 13 && b === 1));
  }

  const topOf = (S, i) => { const p = S.piles[i]; return p.length ? p[p.length - 1] : null; };

  /** opt: { rules, players: [{name, human, level}] ×2, games（何本勝負か。0なら終わりなし）, rated, seed } */
  function createMatch(opt) {
    const S = {
      game: 'speed',
      rules: normalize(opt.rules),
      n: 2,
      players: opt.players.slice(0, 2).map((p, i) => ({
        seat: i, name: p.name, human: !!p.human, level: p.level || 'normal',
        deck: [], field: new Array(FIELD).fill(null), wins: 0, score: 0,
      })),
      gameNo: 0,
      maxGames: opt.games > 0 ? Math.floor(opt.games) : 0,
      matchOver: false,
      history: [],
      rated: opt.rated || null,
      piles: [[], []],
      phase: 'idle',
      stuckReason: null,
      winner: null,
      moves: 0,
      rng: opt.seed != null ? C.mulberry32(opt.seed) : Math.random,
      events: [],
      silent: !!opt.silent,
    };
    return S;
  }
  const winsNeeded = (S) => (S.maxGames > 0 ? Math.floor(S.maxGames / 2) + 1 : Infinity);

  function emit(S, ev) { if (!S.silent) S.events.push(ev); }

  /** 配る：自分の色の26枚を山札にし、4枚を場札に並べる。台札は「せーの」で出す（phase=stuck） */
  function startGame(S, presetDecks) {
    if (S.matchOver) throw new Error('この試合は終わりました');
    S.events = [];
    S.gameNo++;
    S.piles = [[], []];
    S.winner = null;
    S.moves = 0;
    S.players.forEach((P, i) => {
      let deck;
      if (presetDecks) deck = presetDecks[i].slice();
      else {
        deck = [];
        for (const s of COLORS[i]) for (const r of C.RANKS) deck.push(s + r);
        C.shuffle(deck, S.rng);
      }
      P.deck = deck; // 末尾が山札のいちばん上
      P.field = new Array(FIELD).fill(null);
      for (let k = 0; k < FIELD && P.deck.length; k++) P.field[k] = P.deck.pop();
    });
    S.phase = 'stuck';
    S.stuckReason = 'start';
    emit(S, { t: 'deal', game: S.gameNo });
    return S.events;
  }

  function playable(S, seat) {
    const P = S.players[seat];
    const out = [];
    P.field.forEach((card, slot) => {
      if (!card) return;
      for (let pile = 0; pile < 2; pile++) if (canStack(S.rules, card, topOf(S, pile))) out.push({ slot, pile });
    });
    return out;
  }
  const anyPlayable = (S) => playable(S, 0).length > 0 || playable(S, 1).length > 0;
  const cardsLeft = (P) => P.deck.length + P.field.filter(Boolean).length;

  function checkWin(S) {
    const empty = S.players.filter((P) => cardsLeft(P) === 0);
    if (!empty.length) return false;
    S.phase = 'over';
    const winner = empty.length === 1 ? empty[0].seat : null; // 同時になくなったら引き分け
    S.winner = winner;
    const pts = [0, 0];
    if (winner !== null) { S.players[winner].wins++; S.players[winner].score = S.players[winner].wins; pts[winner] = 1; }
    S.history.push({ winner, pts });
    const need = winsNeeded(S);
    S.matchOver = S.players.some((P) => P.wins >= need);
    emit(S, { t: 'over', winner, wins: S.players.map((P) => P.wins), matchOver: S.matchOver });
    return true;
  }

  function afterChange(S) {
    if (checkWin(S)) return;
    if (!anyPlayable(S)) {
      S.phase = 'stuck';
      S.stuckReason = 'stuck';
      emit(S, { t: 'stuck' });
    } else S.phase = 'play';
  }

  /** 場札（slot）を台札（pile）に出す。どちらの席もいつでも出せる */
  function play(S, seat, slot, pile) {
    S.events = [];
    if (S.phase !== 'play') throw new Error(S.phase === 'stuck' ? '「せーの」を待っています' : '今は出せません');
    const P = S.players[seat];
    if (!P) throw new Error('席がありません');
    slot = Number(slot); pile = Number(pile);
    const card = P.field[slot];
    if (!card) throw new Error('そこにカードがありません');
    if (!(pile === 0 || pile === 1)) throw new Error('台札が正しくありません');
    if (!canStack(S.rules, card, topOf(S, pile))) throw new Error('そのカードはそこに出せません');
    S.piles[pile].push(card);
    P.field[slot] = P.deck.length ? P.deck.pop() : null;
    S.moves++;
    emit(S, { t: 'play', seat, slot, pile, card, refill: P.field[slot] });
    afterChange(S);
    return S.events;
  }

  /** せーの：両方が山札の上から1枚ずつ自分の台札に出す（山札がなければ場札から） */
  function flip(S) {
    S.events = [];
    if (S.phase !== 'stuck') throw new Error('今は「せーの」ではありません');
    const cards = [];
    S.players.forEach((P, i) => {
      let card = null, from = 'deck', slot = -1;
      if (P.deck.length) card = P.deck.pop();
      else {
        slot = P.field.findIndex(Boolean);
        if (slot >= 0) { card = P.field[slot]; P.field[slot] = null; from = 'field'; }
      }
      if (card) { S.piles[i].push(card); cards.push({ seat: i, card, from, slot }); }
    });
    S.moves++;
    const reason = S.stuckReason;
    S.stuckReason = null;
    emit(S, { t: 'flip', cards, reason });
    afterChange(S);
    return S.events;
  }

  // ─────────────────────────────────────────────
  // 複製・保存・表示用
  // ─────────────────────────────────────────────
  function clone(S) {
    const T = Object.assign({}, S);
    T.players = S.players.map((P) => Object.assign({}, P, { deck: P.deck.slice(), field: P.field.slice() }));
    T.piles = S.piles.map((p) => p.slice());
    T.history = S.history.slice();
    T.events = [];
    T.silent = true;
    return T;
  }
  function serialize(S) {
    const o = Object.assign({}, S);
    delete o.rng;
    o.events = [];
    return JSON.parse(JSON.stringify(o));
  }
  function deserialize(o) {
    const S = Object.assign({}, o);
    S.rules = normalize(o.rules);
    S.rng = Math.random;
    S.events = [];
    if (!Array.isArray(S.history)) S.history = [];
    return S;
  }
  /** 他の人に見せる形（山札の中身は伏せる。場札と台札は表向き） */
  function publicView(S) {
    const T = serialize(S);
    T.players.forEach((P) => { P.deckCount = P.deck.length; P.deck = []; });
    T.piles = T.piles.map((p) => p.slice(-6));
    return T;
  }
  const deckCount = (P) => (P.deckCount != null ? P.deckCount : P.deck.length);

  function standings(S) {
    const rows = S.players.map((P) => ({ seat: P.seat, score: P.wins, place: 0 }));
    rows.sort((a, b) => b.score - a.score || a.seat - b.seat);
    rows.forEach((r, i) => { r.place = i && r.score === rows[i - 1].score ? rows[i - 1].place : i + 1; });
    return rows;
  }

  D.Speed = {
    FIELD, COLORS, numOf, numLabel, cardName, canStack, topOf, winsNeeded, cardsLeft, deckCount,
    createMatch, startGame, play, flip, playable, anyPlayable, clone, serialize, deserialize, publicView, standings,
  };
})();
