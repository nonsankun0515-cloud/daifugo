/* 大富豪 オンライン対戦サーバー（Cloudflare Workers + Durable Objects）
 * ルール判定はブラウザ版と同じ js/ のエンジンをそのまま使う。部屋ごとに1つの Durable Object。 */
import { DurableObject } from 'cloudflare:workers';
import '../../js/cards.js';
import '../../js/rules.js';
import '../../js/engine.js';
import '../../js/rating.js';
import '../../js/ai.js';
import '../../js/online-room.js';

const { RoomCore, Rating } = globalThis.DFG;

// 接続を受け付けるページ（公開アプリ版と開発用）
const ALLOWED_ORIGINS = new Set([
  'https://nonsankun0515-cloud.github.io',
  'http://localhost:8793',
  'http://127.0.0.1:8793',
]);
const CODE_RE = /^[A-Z0-9]{5}$/;
const DAY = 24 * 3600 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]{5})$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      const origin = request.headers.get('Origin');
      if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response('forbidden', { status: 403 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(new Request('https://room/' + code, request));
    }
    if (url.pathname === '/') return new Response('daifugo online: ok', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response('not found', { status: 404 });
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = null;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      if (saved) this.core = RoomCore.fromJSON(saved);
    });
  }

  async fetch(request) {
    const code = new URL(request.url).pathname.slice(1);
    if (!this.core) this.core = new RoomCore(code);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ cid: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 20000) return;
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'ping') { ws.send('{"t":"pong"}'); return; }
    const core = this.core;
    const now = Date.now();
    const att = ws.deserializeAttachment() || {};
    let res = { ok: true };
    let withEvents = false;
    try {
      if (msg.t === 'hello') {
        const cid = String(msg.cid || '');
        if (!/^[A-Za-z0-9_-]{8,40}$/.test(cid)) { this.sendError(ws, '接続情報が不正です'); return; }
        // 同じ人の古い接続は閉じる
        for (const other of this.ctx.getWebSockets()) {
          if (other !== ws && (other.deserializeAttachment() || {}).cid === cid) { try { other.close(4000, 'replaced'); } catch (e) { /* 無視 */ } }
        }
        res = core.join(cid, msg.name, now, await this.lookupRating(cid));
        if (!res.ok) { this.sendError(ws, res.error); try { ws.close(4001, 'rejected'); } catch (e) { /* 無視 */ } return; }
        ws.serializeAttachment({ cid });
        // 入った人（戻ってきた人）には、最近のチャットを渡す
        try { ws.send(JSON.stringify({ t: 'chatlog', items: core.chatLog })); } catch (e) { /* 無視 */ }
      } else {
        if (!att.cid) { this.sendError(ws, '先に部屋に入ってください'); return; }
        if (msg.t === 'chat') {
          // チャットは対局の状態を変えないので、メッセージだけを全員に配る
          const c = core.chat(att.cid, msg.text, now);
          if (!c.ok) { this.sendError(ws, c.error); return; }
          await this.persist();
          const payload = JSON.stringify({ t: 'chat', item: c.item });
          for (const other of this.ctx.getWebSockets()) {
            if ((other.deserializeAttachment() || {}).cid) { try { other.send(payload); } catch (e) { /* 無視 */ } }
          }
          return;
        }
        switch (msg.t) {
          case 'config': res = core.configure(att.cid, msg, now); break;
          case 'start': res = core.start(att.cid, msg.rules, now); withEvents = res.ok; break;
          case 'action': res = core.act(att.cid, msg.action, now); withEvents = res.ok; break;
          case 'next': res = core.next(att.cid, now); withEvents = res.ok; break;
          case 'lobby': res = core.toLobby(att.cid, now); break;
          case 'leave': core.leave(att.cid, now); ws.serializeAttachment({ cid: null }); try { ws.close(1000, 'bye'); } catch (e) { /* 無視 */ } break;
          default: return;
        }
      }
    } catch (e) {
      res = { ok: false, error: String((e && e.message) || e) };
    }
    if (!res.ok) {
      this.sendError(ws, res.error);
      this.sendView(ws, false);
      return;
    }
    await this.flushRatings();
    await this.persist();
    this.broadcast(withEvents);
    await this.schedule();
  }

  async webSocketClose(ws) { await this.dropped(ws); }
  async webSocketError(ws) { await this.dropped(ws); }

  async dropped(ws) {
    const att = ws.deserializeAttachment() || {};
    if (!att.cid || !this.core) return;
    // 同じ人が別の接続でつながっているなら何もしない
    const still = this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() || {}).cid === att.cid);
    if (still) return;
    this.core.disconnect(att.cid, Date.now());
    await this.persist();
    this.broadcast(false);
    await this.schedule();
  }

  async alarm() {
    if (!this.core) return;
    const now = Date.now();
    const moved = this.core.connectedHumans() > 0 && this.core.aiStep(now);
    if (moved) {
      await this.flushRatings();
      await this.persist();
      this.broadcast(true);
    } else if (this.ctx.getWebSockets().length === 0 && now - this.core.updatedAt > DAY - 60000) {
      // 1日だれも来ない部屋は片付ける
      await this.ctx.storage.deleteAll();
      this.core = null;
      return;
    }
    await this.schedule();
  }

  // ── レート（全部屋で共通の Ratings に保存） ──
  ratings() { return this.env.RATINGS.get(this.env.RATINGS.idFromName('global')); }

  async lookupRating(cid) {
    try { return await this.ratings().lookup(cid); } catch (e) { console.error('rating lookup', e); return null; }
  }

  /** 部屋で決まったレート変動を保存する（失敗したら次の機会にもう一度） */
  async flushRatings() {
    const core = this.core;
    if (!core || !core.ratingOut.length) return;
    const out = core.ratingOut.slice();
    try {
      const saved = await this.ratings().record(out);
      core.ratingOut.splice(0, out.length);
      for (const r of saved) {
        const m = core.member(r.cid);
        if (m) { m.rating = r.r; m.matches = r.n; }
      }
    } catch (e) {
      console.error('rating record', e);
    }
  }

  async schedule() {
    if (!this.core) return;
    const now = Date.now();
    const d = this.core.connectedHumans() > 0 ? this.core.nextAiDelay(now) : null;
    await this.ctx.storage.setAlarm(now + (d === null ? DAY : Math.max(50, d)));
  }

  async persist() {
    if (this.core) await this.ctx.storage.put('room', this.core.toJSON());
  }

  sendError(ws, error) {
    try { ws.send(JSON.stringify({ t: 'error', error })); } catch (e) { /* 無視 */ }
  }

  sendView(ws, withEvents) {
    const att = ws.deserializeAttachment() || {};
    if (!att.cid || !this.core) return;
    try { ws.send(JSON.stringify(this.core.viewFor(att.cid, withEvents))); } catch (e) { /* 無視 */ }
  }

  broadcast(withEvents) {
    for (const ws of this.ctx.getWebSockets()) this.sendView(ws, withEvents);
  }
}

/** オンライン対戦のレート（端末ごと。キーは再接続用IDのハッシュで、IDそのものは保存しない） */
export class Ratings extends DurableObject {
  async key(cid) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('daifugo-rating:' + cid));
    return 'r:' + Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  async lookup(cid) {
    if (typeof cid !== 'string' || !cid) return null;
    const v = await this.ctx.storage.get(await this.key(cid));
    return v ? { r: v.r, n: v.n } : { r: Rating.START, n: 0 };
  }

  /** list: [{ cid, delta }] → [{ cid, r, n }] */
  async record(list) {
    const out = [];
    for (const it of Array.isArray(list) ? list.slice(0, 12) : []) {
      const delta = Math.round(Number(it && it.delta));
      if (typeof it.cid !== 'string' || !it.cid || !Number.isFinite(delta) || Math.abs(delta) > 400) continue;
      const k = await this.key(it.cid);
      const v = (await this.ctx.storage.get(k)) || { r: Rating.START, n: 0, best: Rating.START };
      v.r += delta;
      v.n += 1;
      v.best = Math.max(v.best || Rating.START, v.r);
      v.at = Date.now();
      await this.ctx.storage.put(k, v);
      out.push({ cid: it.cid, r: v.r, n: v.n });
    }
    return out;
  }
}
