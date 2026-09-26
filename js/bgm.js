/* BGM。曲は Kevin MacLeod（incompetech.com）、CC BY 4.0（クレジットはマイページと audio/CREDITS.txt）
 * 画面ごとに曲を変える：ホーム・設定・オンラインの待合室＝Lobby Time、大富豪＝Cool Vibes、七並べ＝Bossa Antigua、スピード＝Hep Cats。
 * iPhone は audio の音量（volume）を変えられないので、Web Audio の GainNode で音量を決める。
 * iPhone は最初のタップの中で再生を始めた audio しか後から鳴らせないので、audio は1つだけにして曲（src）を入れ替える。 */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const CM = D.Common;

  const TRACKS = {
    lobby: { src: 'audio/bgm-lobby.mp3', title: 'Lobby Time' },
    daifugo: { src: 'audio/bgm-daifugo.mp3', title: 'Cool Vibes' },
    sevens: { src: 'audio/bgm-sevens.mp3', title: 'Bossa Antigua' },
    speed: { src: 'audio/bgm-speed.mp3', title: 'Hep Cats' },
  };
  const SCREEN_TRACK = { 'scr-game': 'daifugo', 'scr-sevens': 'sevens', 'scr-speed': 'speed' };
  const VOLUMES = { low: 0.16, mid: 0.3, high: 0.5 }; // 小さめが最初（ユーザーの希望）
  const FADE = 0.6; // 曲を替えるときに音を下げる時間（秒）

  let audio = null, ctx = null, gain = null;
  let want = 'lobby'; // 今の画面の曲
  let playing = null; // 鳴らしている曲
  let unlocked = false; // 画面に一度触れたか（それまではブラウザの決まりで鳴らせない）
  let timer = 0;

  const on = () => !!CM.settings.bgm && document.visibilityState !== 'hidden';
  const level = () => VOLUMES[CM.settings.bgmVol] || VOLUMES.low;

  function setup() {
    if (audio) return true;
    try {
      audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (AC) {
        ctx = new AC();
        gain = ctx.createGain();
        gain.gain.value = 0;
        ctx.createMediaElementSource(audio).connect(gain);
        gain.connect(ctx.destination);
      } else audio.volume = 0;
    } catch (e) { ctx = null; gain = null; }
    return !!audio;
  }

  function fadeTo(v, sec) {
    if (gain) {
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(gain.gain.value, t);
      gain.gain.linearRampToValueAtTime(v, t + sec);
    } else if (audio) audio.volume = v;
  }

  function start(key) {
    playing = key;
    const src = TRACKS[key].src;
    if (!audio.src.endsWith(src)) audio.src = src;
    const p = audio.play();
    if (p && p.catch) p.catch(() => { /* 鳴らせなかったら次に触れたときにもう一度 */ unlocked = false; listen(); });
    fadeTo(level(), 1.2);
  }

  /** 今の画面の曲を、今の設定で鳴らす（止める）。設定を変えたときや画面が変わったときに呼ぶ */
  function sync() {
    if (!unlocked || !setup()) return;
    clearTimeout(timer);
    if (!on()) {
      fadeTo(0, 0.3);
      timer = setTimeout(() => audio.pause(), 320);
      return;
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (playing === want && !audio.paused) { fadeTo(level(), 0.4); return; }
    if (playing && playing !== want && !audio.paused) {
      fadeTo(0, FADE);
      timer = setTimeout(() => start(want), FADE * 1000);
    } else start(want);
  }

  // 最初に画面に触れたとき、そのタップの中で鳴らし始める（iPhone の決まり）
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    for (const ev of ['pointerdown', 'keydown']) document.removeEventListener(ev, unlock, true);
    sync();
  }
  function listen() {
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, unlock, true);
  }

  function init() {
    CM.onShow((id) => { want = SCREEN_TRACK[id] || 'lobby'; sync(); });
    document.addEventListener('visibilitychange', sync); // アプリを離れたら止め、戻ったら続きから
    listen();
  }

  /** 今の様子（動作確認用） */
  function status() {
    return { unlocked, want, playing, paused: audio ? audio.paused : true, src: audio ? audio.src : '', gain: gain ? gain.gain.value : null };
  }

  D.BGM = { init, sync, status, TRACKS, VOLUMES };
})();
