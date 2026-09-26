/* 七並べ — ルールの定義と判定（画面から独立した状態機械。サーバーでも同じものを使う） */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});
  const C = D.Cards;

  // ─────────────────────────────────────────────
  // ルール（どれも「ルールと設定」で切り替えられる）
  // ─────────────────────────────────────────────
  const RULES = [
    { key: 'passLimit', type: 'choice', label: 'パスの回数', def: 3,
      options: [{ v: 3, label: '3回まで' }, { v: 5, label: '5回まで' }, { v: 0, label: '無制限' }],
      desc: 'この回数をこえてパスすると失格。失格した人の手札はすべて場に並べられ、順位は最下位。' },
    { key: 'joker', type: 'bool', label: 'ジョーカー', def: true,
      desc: 'ジョーカー1枚入り。出せる場所に置くと、そのカードを持っている人は次の番で必ずそのカードを出し、代わりにジョーカーを受け取る。' },
    { key: 'tunnel', type: 'bool', label: 'トンネル', def: true,
      desc: 'AとKがつながる。Aまで並んだらKから、Kまで並んだらAからも出せる。' },
    { key: 'mustPlay', type: 'bool', label: '出せるときはパス禁止', def: false,
      desc: '出せるカードがあるときはパスできない（わざと止める作戦が使えなくなる）。' },
  ];
  const BY_KEY = {};
  for (const r of RULES) BY_KEY[r.key] = r;

  function defaults() {
    const o = {};
    for (const r of RULES) o[r.key] = r.def;
    return o;
  }
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
  D.SevensRules = { RULES, BY_KEY, defaults, normalize, STANDARD: defaults() };

  // ─────────────────────────────────────────────
  // カード：数字は A=1 … K=13 で扱う（cards.js では A=14, 2=15）
  // ─────────────────────────────────────────────
  const SUITS = ['S', 'H', 'D', 'C'];
  const numOf = (id) => { const r = C.rankOf(id); return r === 14 ? 1 : r === 15 ? 2 : r; };
  const idOf = (suit, n) => suit + (n === 1 ? 14 : n === 2 ? 15 : n);
  const isJoker = C.isJoker;
  const numLabel = (n) => ({ 1: 'A', 11: 'J', 12: 'Q', 13: 'K' }[n] || String(n));
  const cardName = (id) => (isJoker(id) ? 'ジョーカー' : C.SUIT_SYM[C.suitOf(id)] + numLabel(numOf(id)));

  function makeDeck(joker) {
    const d = [];
    for (const s of SUITS) for (let n = 1; n <= 13; n++) d.push(idOf(s, n));
    if (joker) d.push('X1');
    return d;
  }

  function emptyBoard() {
    const b = {};
    for (const s of SUITS) b[s] = new Array(14).fill(null); // 1〜13 を使う
    return b;
  }

  // ─────────────────────────────────────────────
  // 状態
  // ─────────────────────────────────────────────
  /** opt: { rules, players: [{name, human, level}], games, rated, seed } */
  function createMatch(opt) {
    const S = {
      game: 'sevens',
      rules: normalize(opt.rules),
      n: opt.players.length,
      players: opt.players.map((p, i) => ({
        seat: i, name: p.name, human: !!p.human, level: p.level || 'normal',
        hand: [], out: false, elim: false, passes: 0, score: 0,
      })),
      gameNo: 0,
      maxGames: opt.games > 0 ? Math.floor(opt.games) : 0,
      matchOver: false,
      history: [],
      rated: opt.rated || null,
      prevRanking: null,
      phase: 'idle',
      rng: opt.seed != null ? C.mulberry32(opt.seed) : Math.random,
      events: [],
      silent: !!opt.silent,
    };
    resetGame(S);
    return S;
  }

  function resetGame(S) {
    S.board = emptyBoard();
    S.joker = null; // 場に置かれたジョーカー { suit, n, by }
    S.forced = null; // ジョーカーの場所のカードを持つ人 { seat, card }
    S.jokerGone = false; // 失格した人が持っていたジョーカーは取り除かれる
    S.passRun = 0; // 続けてパスした回数（だれかが出したら0）
    S.finished = [];
    S.elims = [];
    S.turn = 0;
    S.moves = 0;
  }

  function emit(S, ev) { if (!S.silent) S.events.push(ev); }

  const activeSeats = (S) => S.players.filter((p) => !p.out).map((p) => p.seat);
  function nextActive(S, s) {
    for (let i = 1; i <= S.n; i++) {
      const t = (s + i) % S.n;
      if (!S.players[t].out) return t;
    }
    return null;
  }

  /** 新しいゲームを配る。7は全部自動で場に置き、♦7を持っていた人から始める */
  function startGame(S, presetHands) {
    if (S.matchOver) throw new Error('この試合は終わりました');
    S.gameNo++;
    resetGame(S);
    for (const p of S.players) { p.hand = []; p.out = false; p.elim = false; p.passes = 0; }
    if (presetHands) presetHands.forEach((h, i) => { S.players[i].hand = h.slice(); });
    else {
      const deck = C.shuffle(makeDeck(S.rules.joker), S.rng);
      let seat = Math.floor(S.rng() * S.n);
      for (const id of deck) { S.players[seat].hand.push(id); seat = (seat + 1) % S.n; }
    }
    let leader = 0;
    const sevens = [];
    for (const p of S.players) {
      for (const id of p.hand.slice()) {
        if (!isJoker(id) && numOf(id) === 7) {
          if (id === 'D7') leader = p.seat;
          S.board[C.suitOf(id)][7] = { id };
          p.hand.splice(p.hand.indexOf(id), 1);
          sevens.push({ seat: p.seat, card: id });
        }
      }
      p.hand = sortHand(p.hand);
    }
    S.phase = 'play';
    S.turn = leader;
    emit(S, { t: 'deal', game: S.gameNo });
    emit(S, { t: 'sevens', placed: sevens });
    emit(S, { t: 'start', leader });
    // 7 だけで手札がなくなる人はいないが、念のため
    for (const p of S.players) if (!p.hand.length && !p.out) finishPlayer(S, p.seat);
  }

  /** 手札の並び：マーク順（♠♥♦♣）、同じマークは数字順、ジョーカーは右端 */
  const SUIT_IDX = { S: 0, H: 1, D: 2, C: 3 };
  function sortHand(hand) {
    return hand.slice().sort((a, b) => {
      if (isJoker(a) !== isJoker(b)) return isJoker(a) ? 1 : -1;
      if (isJoker(a)) return 0;
      return SUIT_IDX[C.suitOf(a)] - SUIT_IDX[C.suitOf(b)] || numOf(a) - numOf(b);
    });
  }

  // ─────────────────────────────────────────────
  // 出せる場所
  // ─────────────────────────────────────────────
  const filled = (S, s, n) => !!S.board[s][n];
  function neighbors(S, n) {
    const out = [];
    if (n > 1) out.push(n - 1); else if (S.rules.tunnel) out.push(13);
    if (n < 13) out.push(n + 1); else if (S.rules.tunnel) out.push(1);
    return out;
  }
  /** (s, n) が空いていて、となり（トンネルならAとKもとなり）にカードがあれば出せる */
  function openSpot(S, s, n) {
    if (filled(S, s, n)) return false;
    return neighbors(S, n).some((m) => filled(S, s, m));
  }
  function openSpots(S) {
    const out = [];
    for (const s of SUITS) for (let n = 1; n <= 13; n++) if (openSpot(S, s, n)) out.push({ suit: s, n });
    return out;
  }
  function canPlayCard(S, id) {
    if (isJoker(id)) return false;
    return openSpot(S, C.suitOf(id), numOf(id));
  }

  /**
   * ジョーカーを置ける場所：出せる場所のうち、そのカードをほかの人が持っている所。
   * 場にないカードは必ずだれかの手札にあるので「自分が持っていない」で判定できる（相手の手札が見えないオンラインでも同じ）
   */
  function jokerSpots(S, seat) {
    const own = new Set(S.players[seat].hand);
    return openSpots(S).filter((sp) => !own.has(idOf(sp.suit, sp.n)));
  }
  function holderOf(S, id) {
    for (const p of S.players) if (!p.out && p.hand.includes(id)) return p.seat;
    return -1;
  }

  /** パスが無制限でも、全員が2周続けてパスしたら、出せる人は出さなければならない（止まり続けないように） */
  const stalled = (S) => S.rules.passLimit === 0 && S.passRun >= activeSeats(S).length * 2;
  function canPass(S, seat) {
    if (S.forced && S.forced.seat === seat) return false;
    if ((S.rules.mustPlay || stalled(S)) && legalMoves(S, seat, true).length) return false;
    return true;
  }

  /** 出せる手（type: play / joker）。noPass=true ならパスを含めない */
  function legalMoves(S, seat, noPass) {
    const P = S.players[seat];
    if (S.forced && S.forced.seat === seat) return [{ type: 'play', seat, card: S.forced.card }];
    const out = [];
    for (const id of P.hand) {
      if (isJoker(id)) { for (const sp of jokerSpots(S, seat)) out.push({ type: 'joker', seat, suit: sp.suit, n: sp.n }); }
      else if (canPlayCard(S, id)) out.push({ type: 'play', seat, card: id });
    }
    if (!noPass && canPass(S, seat)) out.push({ type: 'pass', seat });
    return out;
  }

  /** 次に誰が何をする必要があるか */
  function getRequest(S) {
    if (S.phase !== 'play') return null;
    const q = { kind: 'turn', seat: S.turn };
    if (S.forced && S.forced.seat === S.turn) q.forced = S.forced.card;
    return q;
  }

  // ─────────────────────────────────────────────
  // 行動
  // ─────────────────────────────────────────────
  function removeCard(P, id) {
    const i = P.hand.indexOf(id);
    if (i < 0) throw new Error('手札にないカードです');
    P.hand.splice(i, 1);
  }

  function doPlay(S, seat, id) {
    const P = S.players[seat];
    if (!P.hand.includes(id)) throw new Error('手札にないカードです');
    if (S.forced && S.forced.seat === seat && id !== S.forced.card) throw new Error(cardName(S.forced.card) + ' を出してください（ジョーカーの場所）');
    const s = C.suitOf(id), n = numOf(id);
    const onJoker = S.joker && S.joker.suit === s && S.joker.n === n;
    if (!onJoker && !canPlayCard(S, id)) throw new Error('そのカードはまだ出せません');
    removeCard(P, id);
    S.board[s][n] = { id };
    S.moves++;
    if (onJoker) {
      // ジョーカーの場所に本物のカードを出したら、ジョーカーを受け取る
      S.joker = null;
      S.forced = null;
      P.hand.push('X1');
      P.hand = sortHand(P.hand);
      emit(S, { t: 'jokerBack', seat, card: id });
    } else emit(S, { t: 'play', seat, card: id });
    afterMove(S, seat);
  }

  function doJoker(S, seat, suit, n) {
    const P = S.players[seat];
    if (!P.hand.includes('X1')) throw new Error('ジョーカーを持っていません');
    if (S.forced && S.forced.seat === seat) throw new Error(cardName(S.forced.card) + ' を出してください（ジョーカーの場所）');
    n = Number(n);
    if (!SUITS.includes(suit) || !(n >= 1 && n <= 13)) throw new Error('場所が正しくありません');
    if (!jokerSpots(S, seat).some((sp) => sp.suit === suit && sp.n === n)) throw new Error('そこにはジョーカーを置けません');
    const card = idOf(suit, n);
    const holder = holderOf(S, card);
    if (holder < 0) throw new Error('そこにはジョーカーを置けません');
    removeCard(P, 'X1');
    S.board[suit][n] = { id: 'X1', joker: true };
    S.joker = { suit, n, by: seat };
    S.forced = { seat: holder, card };
    S.moves++;
    emit(S, { t: 'joker', seat, suit, n });
    afterMove(S, seat);
  }

  function doPass(S, seat) {
    if (!canPass(S, seat)) throw new Error(S.forced && S.forced.seat === seat ? 'ジョーカーの場所のカードを出してください' : '出せるカードがあるのでパスできません');
    const P = S.players[seat];
    P.passes++;
    S.passRun++;
    const limit = S.rules.passLimit;
    if (limit > 0 && P.passes > limit) { eliminate(S, seat); return; }
    emit(S, { t: 'pass', seat, passes: P.passes, limit });
    S.turn = nextActive(S, seat);
  }

  /** 失格：手札を全部場に並べる（ジョーカーは取り除く） */
  function eliminate(S, seat) {
    const P = S.players[seat];
    const placed = [];
    for (const id of P.hand) {
      if (isJoker(id)) { S.jokerGone = true; continue; }
      const s = C.suitOf(id), n = numOf(id);
      S.board[s][n] = { id, elim: true };
      placed.push(id);
    }
    P.hand = [];
    P.out = true;
    P.elim = true;
    S.elims.push(seat);
    emit(S, { t: 'elim', seat, cards: placed });
    if (!checkEnd(S)) S.turn = nextActive(S, seat);
  }

  function finishPlayer(S, seat) {
    const P = S.players[seat];
    if (P.out) return;
    P.out = true;
    S.finished.push(seat);
    emit(S, { t: 'finish', seat, place: S.finished.length });
  }

  function afterMove(S, seat) {
    S.passRun = 0;
    const P = S.players[seat];
    if (!P.hand.length) finishPlayer(S, seat);
    if (checkEnd(S)) return;
    S.turn = nextActive(S, seat);
  }

  /** 残りが1人以下になったら終わり。順位：上がった順 → 最後の1人 → 失格（後に失格した人ほど上） */
  function checkEnd(S) {
    const left = activeSeats(S);
    if (left.length > 1) return false;
    if (left.length === 1) {
      const L = S.players[left[0]];
      L.out = true;
      S.finished.push(L.seat);
      emit(S, { t: 'last', seat: L.seat });
    }
    endGame(S, S.finished.concat(S.elims.slice().reverse()));
    return true;
  }

  function endGame(S, ranking) {
    S.phase = 'over';
    S.forced = null;
    S.prevRanking = ranking.slice();
    const pts = new Array(S.n).fill(0);
    ranking.forEach((seat, i) => {
      pts[seat] = D.Engine.pointsFor(S.n, i);
      S.players[seat].score += pts[seat];
    });
    S.history.push({ ranking: ranking.slice(), pts });
    S.matchOver = S.maxGames > 0 && S.gameNo >= S.maxGames;
    emit(S, { t: 'over', ranking: ranking.slice(), pts: pts.slice(), matchOver: S.matchOver });
  }

  function apply(S, a) {
    S.events = [];
    const q = getRequest(S);
    if (!q) throw new Error('今は操作できません');
    if (!a || a.seat !== q.seat) throw new Error('あなたの番ではありません');
    switch (a.type) {
      case 'play': doPlay(S, a.seat, a.card); break;
      case 'joker': doJoker(S, a.seat, a.suit, a.n); break;
      case 'pass': doPass(S, a.seat); break;
      default: throw new Error('今はその操作はできません');
    }
    return S.events;
  }

  // ─────────────────────────────────────────────
  // 複製・保存
  // ─────────────────────────────────────────────
  function cloneBoard(b) {
    const o = {};
    for (const s of SUITS) o[s] = b[s].slice();
    return o;
  }
  function clone(S) {
    const T = Object.assign({}, S);
    T.players = S.players.map((p) => Object.assign({}, p, { hand: p.hand.slice() }));
    T.board = cloneBoard(S.board);
    T.joker = S.joker && Object.assign({}, S.joker);
    T.forced = S.forced && Object.assign({}, S.forced);
    T.finished = S.finished.slice();
    T.elims = S.elims.slice();
    T.history = S.history.slice();
    T.prevRanking = S.prevRanking && S.prevRanking.slice();
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
    if (!(S.maxGames > 0)) S.maxGames = 0;
    S.matchOver = !!S.matchOver;
    if (S.rated === undefined) S.rated = null;
    return S;
  }

  function standings(S) { return D.Engine.standings(S); }

  function describe(a) {
    if (a.type === 'pass') return 'パス';
    if (a.type === 'joker') return 'ジョーカーを ' + C.SUIT_SYM[a.suit] + numLabel(a.n) + ' の場所へ';
    return cardName(a.card);
  }

  D.Sevens = {
    SUITS, numOf, idOf, numLabel, cardName, makeDeck, sortHand,
    createMatch, startGame, getRequest, apply, legalMoves, canPass, canPlayCard, openSpot, openSpots, jokerSpots, holderOf,
    clone, serialize, deserialize, standings, describe, nextActive,
  };
})();
