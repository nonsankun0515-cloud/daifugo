/* オンラインのレートの精算（部屋 → Ratings）。同じ精算を何度送っても1回だけ反映する
 * サーバー（server/src/index.js の Ratings）とテストで共通。保存先は Durable Object の storage と同じ形の窓口
 * （get(キーの配列) → Map、put({ キー: 値, … }) は全部まとめて書く＝途中で半分だけ書かれることはない）
 *
 * 精算（部屋の ratingOut に入る）：{ eventId, cid, game, delta, at, reason }
 *   eventId … 試合ID（部屋が試合の開始時に作る）＋席の番号。同じ試合・同じ席の精算は1つだけ
 *   at      … 精算を決めた時刻。RETENTION より古いものは受け付けない（重複の記録を将来消しても二重にならないように）
 * Ratings に残すもの：
 *   r:<cidのハッシュ>[:game] … レート { r, n, best, at }（以前と同じ）
 *   e:<eventId>              … 反映済みの印 { k, delta, r, n, at }（cid そのものは残さない）
 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  const DAY = 24 * 3600 * 1000;
  const RETENTION = 30 * DAY;
  const MAX_DELTA = 400;
  const MAX_BATCH = 12;
  const GAMES = ['daifugo', 'sevens', 'speed'];
  const ID_RE = /^[A-Za-z0-9:._-]{8,120}$/;
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * 精算をまとめて反映する。keyOf(cid, game) → レートのキー（非同期でよい）。start：はじめのレート
   * 1件ごとに「反映済みか確かめる → レートを変える＋反映済みの印」を、間に別の処理が入らないように続けて書く
   * （storage の読み書きの間は、ほかのリクエストが割り込まない＝Durable Object の input gate）。
   * 途中で失敗しても、書けた分には印があるので、同じ一式を送り直しても二重にならない。
   * 戻り値：[{ eventId, status, cid, game, r, n }]
   *   applied（反映した）／duplicate（前に反映済み。そのときの値）／conflict（同じIDで中身が違う）／invalid／expired
   */
  async function apply(store, list, now, keyOf, start) {
    const out = [];
    for (const it of Array.isArray(list) ? list.slice(0, MAX_BATCH) : []) {
      const res = { eventId: it && it.eventId, cid: it && it.cid, game: it && it.game };
      const delta = Math.round(Number(it && it.delta));
      if (!it || typeof it.cid !== 'string' || !it.cid || !Number.isFinite(delta) || Math.abs(delta) > MAX_DELTA) { out.push(Object.assign(res, { status: 'invalid' })); continue; }
      const legacy = it.eventId === undefined; // eventId がない頃の精算（念のため。部屋は読み込むときに付ける）
      if (!legacy && (typeof it.eventId !== 'string' || !ID_RE.test(it.eventId))) { out.push(Object.assign(res, { status: 'invalid' })); continue; }
      if (!legacy && isNum(it.at) && now - it.at > RETENTION) { out.push(Object.assign(res, { status: 'expired' })); continue; }
      const game = GAMES.includes(it.game) ? it.game : 'daifugo';
      const k = await keyOf(it.cid, game); // ここまでは確かめる前なので、割り込まれてもよい
      const ek = 'e:' + it.eventId;
      const got = await store.get(legacy ? [k] : [k, ek]);
      const rec = legacy ? null : got.get(ek);
      if (rec) {
        if (rec.k !== k || rec.delta !== delta) out.push(Object.assign(res, { status: 'conflict' }));
        else out.push(Object.assign(res, { status: 'duplicate', r: rec.r, n: rec.n }));
        continue;
      }
      const v = got.get(k) || { r: start, n: 0, best: start };
      const r = v.r + delta, n = (v.n || 0) + 1;
      const put = { [k]: { r, n, best: Math.max(v.best || start, r), at: now } };
      if (!legacy) put[ek] = { k, delta, r, n, at: now };
      await store.put(put);
      out.push(Object.assign(res, { status: 'applied', r, n }));
    }
    return out;
  }

  /** 部屋に残っている精算のうち、Ratings が答えたもの（もう送らなくてよいもの）か */
  const settled = (status) => status === 'applied' || status === 'duplicate' || status === 'conflict' || status === 'invalid' || status === 'expired';

  /** 送り直すまでの間（失敗が続くほど長く。最大10分） */
  function retryDelay(fails) {
    const steps = [5000, 15000, 60000, 5 * 60000];
    return fails <= 0 ? 0 : steps[Math.min(fails - 1, steps.length - 1)] * (fails > steps.length ? 2 : 1);
  }

  D.RatingLedger = { apply, settled, retryDelay, RETENTION, MAX_BATCH, MAX_DELTA };
})();
