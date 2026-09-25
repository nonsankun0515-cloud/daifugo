"""開発用のローカルサーバー（キャッシュさせない）。 py tools/devserver.py 8793"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    http.server.ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()


if __name__ == "__main__":
    main()
