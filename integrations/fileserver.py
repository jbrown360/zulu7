#!/usr/bin/env python3
import http.server
import socketserver
import argparse

parser = argparse.ArgumentParser(description="Serve current directory over HTTP")
parser.add_argument("--port", "-p", type=int, default=8085, help="Port to listen on (default: 8085)")
args = parser.parse_args()

Handler = http.server.SimpleHTTPRequestHandler

with socketserver.TCPServer(("", args.port), Handler) as httpd:
    print(f"Serving current directory at http://localhost:{args.port}")
    print("Press Ctrl+C to stop.")
    httpd.serve_forever()