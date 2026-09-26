/* スピード — 時間の進行（AIが出すタイミングと「せーの」）。画面とサーバーで共通
 * 予定は S.clock に入れる（保存・復元できるように、ただの数字だけ） */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const SP = D.Speed, AI = D.SpeedAI;

  const FLIP_DELAY = { start: 1700, stuck: 1300 }; // 「せーの」までの間

  function clock(S) {
    if (!S.clock) S.clock = { aiAt: [null, null], flipAt: null, afterFlip: false };
    return S.clock;
  }

  /**
   * 状態が変わったら呼ぶ。levelOf(seat) はAIの強さ（人なら null）
   * AIは出せる手があるときだけ「出す時刻」を予約する（すでに予約があればそのまま＝反応の途中）
   */
  function schedule(S, now, levelOf, rng) {
    const k = clock(S);
    if (S.phase === 'over' || S.phase === 'idle') { k.aiAt = [null, null]; k.flipAt = null; return; }
    if (S.phase === 'stuck') {
      k.aiAt = [null, null];
      if (k.flipAt == null) k.flipAt = now + FLIP_DELAY[S.stuckReason === 'start' ? 'start' : 'stuck'];
      return;
    }
    k.flipAt = null;
    for (let seat = 0; seat < 2; seat++) {
      const lv = levelOf(seat);
      if (!lv || !SP.playable(S, seat).length) { k.aiAt[seat] = null; continue; }
      if (k.aiAt[seat] == null) k.aiAt[seat] = now + AI.reaction(lv, rng, k.afterFlip);
    }
    k.afterFlip = false;
  }

  /** 次に何かが起きるまでの時間（なければ null） */
  function nextDelay(S, now) {
    const k = clock(S);
    const ts = [k.flipAt].concat(k.aiAt).filter((t) => t != null);
    if (!ts.length) return null;
    return Math.max(0, Math.min.apply(null, ts) - now);
  }

  /** 時刻 now までに予定されていたことを1つ行う。行ったら { events } を返す */
  function tick(S, now, levelOf, rng) {
    const k = clock(S);
    if (k.flipAt != null && k.flipAt <= now && S.phase === 'stuck') {
      k.flipAt = null;
      k.afterFlip = true;
      const events = SP.flip(S);
      schedule(S, now, levelOf, rng);
      return { events };
    }
    let due = -1;
    for (let seat = 0; seat < 2; seat++) {
      const t = k.aiAt[seat];
      if (t != null && t <= now && (due < 0 || t < k.aiAt[due])) due = seat;
    }
    if (due < 0) return null;
    k.aiAt[due] = null;
    if (S.phase !== 'play') { schedule(S, now, levelOf, rng); return null; }
    const mv = AI.choose(S, due, levelOf(due));
    if (!mv) { schedule(S, now, levelOf, rng); return null; }
    const events = SP.play(S, due, mv.slot, mv.pile);
    schedule(S, now, levelOf, rng);
    return { events, seat: due };
  }

  D.SpeedHost = { schedule, nextDelay, tick, FLIP_DELAY, clock };
})();
