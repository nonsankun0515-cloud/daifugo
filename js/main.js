/* 起動：共通部品と各ゲームを用意して、最後に開いていたタブ（または招待された部屋）を表示する */
(function () {
  'use strict';
  const D = globalThis.DFG;
  const A = D.Art, CM = D.Common, OC = D.OnlineClient, SH = D.Shell, SND = D.Sound;

  function start(data) {
    if (D.Install) D.Install.cleanURL();
    document.body.insertAdjacentHTML('afterbegin', A.SHARED_DEFS);
    if (D.Textures) D.Textures.apply();
    CM.init();
    if (D.BGM) D.BGM.init();
    OC.init();
    SH.init();
    for (const g of ['daifugo', 'sevens', 'speed']) if (D.Games[g]) D.Games[g].init();
    CM.applySettings();
    document.addEventListener('pointerdown', () => SND.unlock(), { once: true });

    // 招待リンク（…#r-ABCDE）から開いたら、その部屋へ
    const hm = location.hash.match(/^#r-([A-Za-z0-9]{5})$/);
    if (hm && D.Net.available()) {
      SH.showHome(CM.store.tab || 'daifugo');
      OC.openOnline(null, hm[1].toUpperCase());
      return;
    }
    // Claude のページを再公開したときは、大富豪の対局を続きから
    if (D.Games.daifugo.restore(data)) return;
    SH.showHome(CM.store.tab || 'daifugo');
  }

  const hot = globalThis.claude && globalThis.claude.hot;
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
