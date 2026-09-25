"""1ファイルにまとめる。

  py tools/build.py

  dist/index.html     … そのままブラウザで開ける完全版
  dist/artifact.html  … Claude のアーティファクト公開用（<html>/<head>/<body> なし）
  docs/               … iPhone のホーム画面に置けるアプリ版（GitHub Pages がこのフォルダを公開する）
"""
import hashlib
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def inline(html):
    def css(m):
        return "<style>\n" + read(m.group(1)) + "\n</style>"

    def js(m):
        code = read(m.group(1))
        if "</script" in code:
            raise SystemExit("</script が含まれています: " + m.group(1))
        return "<script>\n" + code + "\n</script>"

    html = re.sub(r'<link rel="stylesheet" href="(css/[^"]+)">', css, html)
    html = re.sub(r'<script src="(js/[^"]+)"></script>', js, html)
    return html


def artifact(full):
    head = re.search(r"<head>(.*?)</head>", full, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", full, re.S).group(1)
    # 文字コードと viewport は公開時の骨組みが付けるので外す
    head = re.sub(r'<meta charset="utf-8">\s*', "", head)
    head = re.sub(r'<meta name="viewport"[^>]*>\s*', "", head)
    title = re.search(r"<title>.*?</title>", head).group(0)
    head = head.replace(title, "")
    return title + "\n" + head.strip() + "\n" + body.strip() + "\n"


MANIFEST = {
    "name": "大富豪",
    "short_name": "大富豪",
    "description": "ローカルルールを自由に選べる大富豪。AIロボットと対戦。",
    "lang": "ja",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "any",
    "background_color": "#062d1e",
    "theme_color": "#062d1e",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}

SW = """// 大富豪 — オフラインでも遊べるようにするキャッシュ
const CACHE = 'daifugo-%s';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const put = (res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; };
  if (url.origin === location.origin) {
    // 自分のファイル：つながっていれば最新、つながらなければ保存済み
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))));
  } else if (/fonts\\.(googleapis|gstatic)\\.com$/.test(url.hostname)) {
    // フォント：保存済みを優先
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then(put)));
  }
});
"""

PWA_HEAD = """<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="icon" type="image/png" href="icons/icon-192.png">
"""

PWA_SW = """<script>
if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
</script>
"""


def main():
    full = inline(read("index.html"))
    write("dist/index.html", full)
    write("dist/artifact.html", artifact(full))

    pwa = full.replace("</title>", "</title>\n" + PWA_HEAD, 1).replace("</body>", PWA_SW + "</body>", 1)
    version = hashlib.sha1(pwa.encode("utf-8")).hexdigest()[:10]
    write("docs/index.html", pwa)
    write("docs/manifest.webmanifest", json.dumps(MANIFEST, ensure_ascii=False, indent=2) + "\n")
    write("docs/sw.js", SW % version)
    write("docs/.nojekyll", "")
    icons_src = os.path.join(ROOT, "icons")
    icons_dst = os.path.join(ROOT, "docs", "icons")
    if os.path.isdir(icons_src):
        shutil.rmtree(icons_dst, ignore_errors=True)
        shutil.copytree(icons_src, icons_dst)
    # 以前の出力先（dist/pwa）は使わない
    shutil.rmtree(os.path.join(ROOT, "dist", "pwa"), ignore_errors=True)

    for name in ("dist/index.html", "dist/artifact.html", "docs/index.html"):
        size = os.path.getsize(os.path.join(ROOT, name))
        print(f"{name}: {size / 1024:.1f} KB")
    print("pwa version:", version)


if __name__ == "__main__":
    main()
