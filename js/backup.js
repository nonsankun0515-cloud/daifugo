/* バックアップ（書き出し・読み込み）の中身：作る・確かめる・要約する
 * 画面（DOM）から独立していて、テスト（tools/run_tests.js）でも同じものを動かす。
 * 画面は backup-ui.js、本体の置き換え（今のデータを .prerestore に残してから）は storage.js の repo.replace。
 *
 * 形式（ファイル cards-table-backup-日付.json。中身は1行の JSON。コピーして貼り付けてもよい）
 *   { format: 'cards-table-backup', version: 1, app: 'Cards Table', exportedAt: ISO 8601, storeSchemaVersion: 2,
 *     data: { settings, rules, rating, match, sevens: { settings, rules, rating, match }, speed: { … } },
 *     checksum: 'fnv1a32:…' }
 *   version … このバックアップの形式の版。storeSchemaVersion … data の形（storage.js の schemaVersion）
 *   checksum … data の JSON から計算。途中で切れた・書き換わったことに気づくため（改ざん防止や本人確認ではない）
 * 入れないもの：オンラインの本人ID（daifugo.cid）・オンラインのレートの控え（正しい値はサーバー）・チャット・
 *   最後に開いたタブ・ホーム画面の案内など、この端末だけの情報。AI戦のレートは端末の記録で、だれでも変えられる前提
 */
(function () {
  'use strict';
  const D = (globalThis.DFG = globalThis.DFG || {});

  const FORMAT = 'cards-table-backup';
  const VERSION = 1;
  const MAX_CHARS = 1024 * 1024; // 読み込む上限（ふつうは数十KB）
  const GAMES = ['daifugo', 'sevens', 'speed'];
  const PARTS = ['settings', 'rules', 'rating', 'match']; // ゲームごとに入れるもの
  /** この端末だけのもの（読み込んでも今の値のまま） */
  const DEVICE_ONLY = ['onlineRatings', 'tab', 'installTipOff', 'backupAt'];

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const isInt = (v) => Number.isInteger(v);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** 決まった項目だけを取り出す（知らない項目・__proto__ などは入れない） */
  function pick(src) {
    const o = {};
    if (!isObj(src)) return o;
    for (const k of PARTS) if (src[k] !== undefined) o[k] = src[k];
    for (const g of ['sevens', 'speed']) {
      const s = src[g];
      if (s === undefined) continue;
      if (!isObj(s)) { o[g] = s; continue; } // 形が違うものは、そのまま確認（sanitize）に回して知らせる
      o[g] = {};
      for (const k of PARTS) if (s[k] !== undefined) o[g][k] = s[k];
    }
    return o;
  }

  /** FNV-1a（32bit）。data の JSON の文字（UTF-16）から */
  function checksum(data) {
    const s = JSON.stringify(data);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv1a32:' + h.toString(16).padStart(8, '0');
  }

  const two = (n) => String(n).padStart(2, '0');
  function fileName(now) {
    const d = new Date(now);
    return 'cards-table-backup-' + d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + '.json';
  }

  /** 書き出す：{ text, name, env } */
  function create(store, now) {
    const data = clone(pick(store));
    const env = {
      format: FORMAT, version: VERSION, app: 'Cards Table', exportedAt: new Date(now).toISOString(),
      storeSchemaVersion: D.Storage.SCHEMA_VERSION, data, checksum: checksum(data),
    };
    return { text: JSON.stringify(env), name: fileName(now), env };
  }

  /** 読み込めないときの理由（画面に出す文） */
  const MESSAGES = {
    empty: 'ファイルを選ぶか、書き出した内容を貼り付けてください。',
    'too-big': 'ファイルが大きすぎます。Cards Table で書き出したバックアップを選んでください。',
    'not-json': 'バックアップとして読めませんでした。書き出した内容が全部そろっているか確かめてください。',
    'not-backup': 'Cards Table のバックアップではありません。',
    newer: '新しいバージョンのアプリで作られたバックアップです。アプリを更新してから読み込んでください。',
    broken: 'バックアップが壊れています（途中で切れた・書き換わった）。もう一度書き出してください。',
    invalid: 'バックアップの中に読めない部分があります',
  };
  const bad = (code, detail) => ({ ok: false, code, detail, message: MESSAGES[code] + (detail ? '：' + detail : '') });

  /**
   * 読み込む前の確認。current は今の store（この端末だけのものを引き継ぐ）
   * 問題がなければ { ok: true, store（保存する形）, exportedAt }。だめなら { ok: false, code, message }（今のデータは変えない）
   */
  function read(text, current) {
    if (typeof text !== 'string' || !text.trim()) return bad('empty');
    if (text.length > MAX_CHARS) return bad('too-big');
    let env;
    try { env = JSON.parse(text.replace(/^﻿/, '').trim()); } catch (e) { return bad('not-json'); }
    if (!isObj(env) || env.format !== FORMAT || !isInt(env.version) || env.version < 1) return bad('not-backup');
    if (env.version > VERSION) return bad('newer');
    if (!isObj(env.data) || typeof env.checksum !== 'string' || env.checksum !== checksum(env.data)) return bad('broken');
    const sv = env.storeSchemaVersion;
    if (!isInt(sv) || sv < 1) return bad('broken');
    if (sv > D.Storage.SCHEMA_VERSION) return bad('newer');
    let s;
    try {
      const data = pick(env.data);
      if (sv > 1) data.schemaVersion = sv;
      s = D.Storage.sanitize(D.Storage.migrate(data, sv));
    } catch (e) {
      return bad('not-json');
    }
    const repairs = s.issues.filter((x) => x.level === 'repair');
    if (repairs.length) return bad('invalid', Array.from(new Set(repairs.map((x) => x.label))).join('・'));
    return { ok: true, store: carry(s.store, current), exportedAt: typeof env.exportedAt === 'string' ? env.exportedAt : null };
  }

  /** 置き換える中身 next に、この端末だけのもの（オンラインのレートの控え・タブなど）と書いた回数を今のまま引き継ぐ */
  function carry(next, current) {
    for (const k of DEVICE_ONLY) {
      if (current && current[k] !== undefined) next[k] = clone(current[k]);
      else delete next[k];
    }
    if (!next.onlineRatings) next.onlineRatings = {};
    next.revision = current && isInt(current.revision) ? current.revision : 0; // 書いた回数は今の続きから
    delete next.savedAt;
    return next;
  }

  /** 画面に出す要約：名前・ゲームごとのAI戦のレートと途中の対局 */
  function summary(store) {
    const games = {};
    for (const g of GAMES) {
      const sec = g === 'daifugo' ? store : store[g] || {};
      const rt = sec.rating || {};
      const m = sec.match;
      games[g] = {
        r: rt.r, matches: rt.matches || 0,
        match: m && !m.matchOver && m.phase !== 'idle' ? { gameNo: m.gameNo, maxGames: m.maxGames || 0, rated: !!m.rated, wins: g === 'speed' ? m.players.map((p) => p.wins) : null } : null,
      };
    }
    return { name: (store.settings && store.settings.name) || 'あなた', games };
  }

  D.Backup = { FORMAT, VERSION, MAX_CHARS, MESSAGES, DEVICE_ONLY, create, read, carry, summary, checksum, fileName, pick };
})();
