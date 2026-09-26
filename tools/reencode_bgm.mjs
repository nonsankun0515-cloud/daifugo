/* BGM の変換（元の mp3 → アプリ用の 96kbps mp3）。Node で実行：
 *   1. 作業用フォルダ（リポジトリの外）で `npm init -y && npm install mpg123-decoder@1 lamejs@1.2.1`
 *   2. このファイルをそのフォルダにコピーして `node reencode_bgm.mjs 元.mp3 audio/bgm-xxx.mp3 96`
 * lamejs 1.2.1 は Node だと MPEGMode などが見つからないので、下で先に置いている。
 * 出力は 32kHz になる（lame が 96kbps に合わせて自動で変える。長さ・音程は変わらない）。 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MPEGDecoder } from 'mpg123-decoder';
const require = createRequire(import.meta.url);
// lamejs 1.2.1 は Node だとこれらが見つからないので、先に置いておく
globalThis.MPEGMode = require('lamejs/src/js/MPEGMode.js');
globalThis.Lame = require('lamejs/src/js/Lame.js');
globalThis.BitStream = require('lamejs/src/js/BitStream.js');
const lamejs = require('lamejs');

const [src, dst, kbps = '96'] = process.argv.slice(2);
const decoder = new MPEGDecoder();
await decoder.ready;
const { channelData, sampleRate } = decoder.decode(new Uint8Array(fs.readFileSync(src)));
decoder.free();
const [L, R] = channelData.length > 1 ? channelData : [channelData[0], channelData[0]];
const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
const l = toI16(L), r = toI16(R);
const enc = new lamejs.Mp3Encoder(2, sampleRate, +kbps);
const chunks = [];
const N = 1152;
for (let i = 0; i < l.length; i += N) {
  const b = enc.encodeBuffer(l.subarray(i, i + N), r.subarray(i, i + N));
  if (b.length) chunks.push(Buffer.from(b));
}
const end = enc.flush();
if (end.length) chunks.push(Buffer.from(end));
fs.writeFileSync(dst, Buffer.concat(chunks));
console.log(path.basename(dst), sampleRate + 'Hz', (L.length / sampleRate).toFixed(1) + 's', (fs.statSync(dst).size / 1e6).toFixed(2) + 'MB');
