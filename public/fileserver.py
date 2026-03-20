#!/usr/bin/env python3
import http.server
import socketserver
import argparse
import json
import os
import mimetypes

class Zulu7MediaHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        if self.path == '/files.json':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            
            files = []
            extensions = ('.mp4', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp')
            
            for f in os.listdir('.'):
                if f.lower().endswith(extensions):
                    mime_type, _ = mimetypes.guess_type(f)
                    files.append({
                        "id": f"http://{self.headers.get('Host')}/{f}",
                        "mimeType": mime_type or "application/octet-stream",
                        "source": "http"
                    })
            
            self.wfile.write(json.dumps({"files": files}).encode())
        else:
            super().do_GET()

parser = argparse.ArgumentParser(description="Serve current directory over HTTP for Zulu7 Slideshow")
parser.add_argument("--port", "-p", type=int, default=8085, help="Port to listen on (default: 8085)")
args = parser.parse_args()

with socketserver.TCPServer(("", args.port), Zulu7MediaHandler) as httpd:
    print(f"Zulu7 Fileserver active at http://localhost:{args.port}")
    print(f"Widget URL: http://localhost:{args.port}/files.json")
    print("Press Ctrl+C to stop.")
    httpd.serve_forever()