import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'

const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
  rejectUnauthorized: false // Support self-signed certificates for health checks/RSS
});

// Simple In-Memory Cache
const cache = {
  marketData: new Map()
};

const CACHE_TTL = {
  MARKET: 60 * 1000 // 1 minute
};

// Configure Cleanup Logic (Async)
const cleanupConfigs = async () => {
  // console.log("Running cleanupConfigs...");
  const publishedDir = path.resolve('published_configs');
  if (!fs.existsSync(publishedDir)) return;

  try {
    const files = await fs.promises.readdir(publishedDir);
    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    let deletedCount = 0;

    await Promise.all(files.map(async (file) => {
      if (!file.endsWith('.json')) return;
      const filePath = path.join(publishedDir, file);
      try {
        const stats = await fs.promises.stat(filePath);
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const config = JSON.parse(content);

        let lastActivity = config.lastAccessed || config.timestamp;
        if (!lastActivity) {
          lastActivity = stats.mtimeMs;
        }

        if (now - lastActivity > THIRTY_DAYS_MS) {
          // console.log(`Deleting expired config: ${file}`);
          await fs.promises.unlink(filePath);
          deletedCount++;
        }
      } catch (e) {
        console.error(`Error processing ${file} for cleanup:`, e);
      }
    }));

    if (deletedCount > 0) console.log(`Cleanup complete. Deleted ${deletedCount} files.`);
  } catch (err) {
    console.error("Cleanup Error:", err);
  }
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'market-data-proxy',
      configureServer(server) {
        server.middlewares.use('/api/market-data', async (req, res, next) => {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const symbol = url.searchParams.get('symbol');

            if (!symbol) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing symbol' }));
              return;
            }

            let data = {};

            // 1. Commodities / Indices / Crypto (Yahoo Finance Server-Side)
            if (true) {
              // Check Cache
              const cached = cache.marketData.get(symbol);
              if (cached && (Date.now() - cached.timestamp < CACHE_TTL.MARKET)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(cached.data));
                return;
              }

              const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=60m&range=5d`;

              // Reuse global agent

              const yahooRes = await new Promise((resolve, reject) => {
                const request = https.get(yahooUrl, {
                  agent,
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': '*/*'
                  }
                }, (response) => {
                  let body = '';
                  response.on('data', (chunk) => body += chunk);
                  response.on('end', () => resolve({ status: response.statusCode, body }));
                });
                request.on('error', (err) => reject(err));
              });

              if (yahooRes.status !== 200) {
                throw new Error(`Yahoo Proxy Failed: ${yahooRes.status}`);
              }

              data = JSON.parse(yahooRes.body);

              // Update Cache
              cache.marketData.set(symbol, {
                timestamp: Date.now(),
                data: data
              });
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));

          } catch (error) {
            console.error("Market Proxy Error:", error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message }));
          }
        });
      }
    },
    {
      name: 'dashboard-config-server',
      configureServer(server) {
        // Create directory
        const publishedDir = path.resolve('published_configs');
        if (!fs.existsSync(publishedDir)) {
          fs.mkdirSync(publishedDir);
        }

        // Run Initial Cleanup
        cleanupConfigs();

        // Schedule Cleanup (Daily)
        const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
        setInterval(cleanupConfigs, CLEANUP_INTERVAL);

        server.middlewares.use(async (req, res, next) => {
          if (req.method === 'POST' && req.url === '/api/publish') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                const config = JSON.parse(body);
                // Ensure timestamp is set on creation
                config.timestamp = Date.now();
                config.lastAccessed = Date.now(); // Initialize lastAccessed

                const uuid = crypto.randomUUID().replace(/-/g, '');
                const filePath = path.join(publishedDir, `${uuid}.json`);
                fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, key: uuid, url: `/?zulu7=${uuid}` }));
              } catch (e) {
                console.error("Publish Error:", e);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else if (req.method === 'GET' && req.url.startsWith('/api/config')) {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const id = url.searchParams.get('id');
            if (!id || !/^[a-z0-9]+$/i.test(id)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid ID' }));
              return;
            }

            const filePath = path.join(publishedDir, `${id}.json`);
            if (fs.existsSync(filePath)) {
              try {
                let data = fs.readFileSync(filePath, 'utf-8');
                let config = JSON.parse(data);

                // Update lastAccessed
                config.lastAccessed = Date.now();

                // Write back to file (async to not block response too much, but sync is safer for consistency)
                // We'll use sync for simplicity and safety, file I/O is fast enough for this scale
                fs.writeFileSync(filePath, JSON.stringify(config, null, 2));

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(config)); // Send the updated config (with new lastAccessed)
              } catch (e) {
                console.error("Error reading/updating config:", e);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'Internal Server Error' }));
              }
            } else {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: 'Not found' }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/fetch-title')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const targetUrlParam = urlObj.searchParams.get('url');

            if (!targetUrlParam) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing url' }));
              return;
            }

            try {
              const targetUrl = targetUrlParam.startsWith('http') ? targetUrlParam : `https://${targetUrlParam}`;

              // Use native fetch to properly handle HTTP/HTTPS and redirects
              const response = await fetch(targetUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                  'Accept-Language': 'en-US,en;q=0.5'
                }
              });

              if (!response.ok) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ title: '' }));
                return;
              }

              const body = await response.text();
              const match = body.match(/<title>([^<]*)<\/title>/i);
              const title = match ? match[1].trim() : '';

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ title }));
            } catch (err) {
              console.error("Error fetching title:", err);
              res.setHeader('Content-Type', 'application/json');
              // Return empty title on error so UI falls back to domain
              res.end(JSON.stringify({ title: '' }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/media-folder')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const targetUrlParam = urlObj.searchParams.get('url');

            if (!targetUrlParam) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing url' }));
              return;
            }


            // 2. Google Drive Scraper
            if (targetUrlParam.includes('drive.google.com/drive/folders/')) {
              try {
                console.log("[DriveScraper] Proxy fetching fresh data for:", targetUrlParam);
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                const response = await fetch(targetUrlParam, {
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                  },
                  signal: controller.signal
                });
                clearTimeout(timeout);

                if (!response.ok) {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ files: [] }));
                  return;
                }

                const text = await response.text();
                let results = [];
                const idRegex = /(?:\[|\[null,)(?:"|&quot;)([a-zA-Z0-9_-]{28,45})(?:"|&quot;)/g;
                let match;
                const ids = new Set();

                while ((match = idRegex.exec(text)) !== null) { ids.add(match[1]); }

                for (const id of ids) {
                  let startIdx = text.indexOf(id);
                  if (startIdx !== -1) {
                    const windowEnd = Math.min(text.length, startIdx + 1000);
                    const chunk = text.substring(startIdx, windowEnd);

                    const mimeMatch = chunk.match(/video\/[a-zA-Z0-9_.-]+|image\/[a-zA-Z0-9_.-]+/);
                    if (mimeMatch) {
                      results.push({ id, mimeType: mimeMatch[0], source: 'gdrive' });
                    }
                  }
                }

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ files: results }));
                return;
              } catch (err) {
                console.error("Error fetching drive folder:", err);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ files: [] }));
                return;
              }
            }

            // 3. HTTP Public Directory Scraper (Auto-Index)
            if (targetUrlParam.startsWith('http://') || targetUrlParam.startsWith('https://')) {
              try {
                const response = await fetch(targetUrlParam, { headers: { 'User-Agent': 'Mozilla/5.0' } });
                if (!response.ok) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: `HTTP fetch failed: ${response.status}` }));
                  return;
                }

                const text = await response.text();
                const hrefRegex = /href="([^"]+)"/ig;
                let match;
                const results = [];
                const mediaExtensions = ['.mp4', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
                const seen = new Set();

                while ((match = hrefRegex.exec(text)) !== null) {
                  let link = match[1];
                  if (link.startsWith('?C=') || link === '../' || link === '/') continue;

                  try {
                    const fullUrl = new URL(link, targetUrlParam).href;
                    if (seen.has(fullUrl)) continue;
                    seen.add(fullUrl);

                    const extMatch = fullUrl.match(/\.([a-z0-9]+)$/i);
                    if (extMatch) {
                      const ext = `.${extMatch[1].toLowerCase()}`;
                      if (mediaExtensions.includes(ext)) {
                        let mimeType = 'application/octet-stream';
                        if (['.mp4', '.mkv', '.webm'].includes(ext)) mimeType = ext === '.mp4' ? 'video/mp4' : (ext === '.webm' ? 'video/webm' : 'video/x-matroska');
                        else mimeType = `image/${ext.replace('.', '').replace('jpg', 'jpeg')}`;

                        results.push({
                          id: fullUrl,
                          mimeType,
                          source: 'http'
                        });
                      }
                    }
                  } catch (e) { }
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ files: results }));
                return;
              } catch (err) {
                console.error("HTTP Scraper Error:", err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
                return;
              }
            }

            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Unsupported URL format' }));

          } else if (req.method === 'GET' && req.url.startsWith('/api/rss')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const targetUrlParam = urlObj.searchParams.get('url');

            if (!targetUrlParam) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing url' }));
              return;
            }

            try {
              const targetUrl = targetUrlParam.startsWith('http') ? targetUrlParam : `https://${targetUrlParam}`;

              // Use native fetch to handle redirects automatically
              // Also use custom agent to ignore SSL errors if needed (though fetch in Node 18 might need more work for agents)
              // Actually, for fetch in Node, we need to pass an agent if we want to ignore SSL, but let's try just standard fetch first.
              // Wait, "fetch failed" usually means network or SSL.
              // Let's explicitly use an agent.
              const agent = new https.Agent({
                rejectUnauthorized: false,
                keepAlive: true
              });

              const response = await fetch(targetUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Accept': 'application/rss+xml, application/xml, text/xml, */*'
                },
                agent: agent // Pass the custom agent here
              });

              if (!response.ok) {
                throw new Error(`Fetch failed: ${response.status}`);
              }

              const body = await response.text();
              res.setHeader('Content-Type', 'text/xml');
              res.end(body);

            } catch (e) {
              console.error("RSS Proxy Handler Error:", e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/system-load')) {
            try {
              const cpus = os.cpus();
              const loadAvg = os.loadavg();
              const totalMem = os.totalmem();
              const freeMem = os.freemem();
              const usedMem = totalMem - freeMem;
              const memUsage = (usedMem / totalMem) * 100;

              // CPU Usage (Approx from loadavg for simplicity/speed)
              const cpuUsage = (loadAvg[0] / cpus.length) * 100;

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({
                load1: loadAvg[0].toFixed(2),
                load5: loadAvg[1].toFixed(2),
                load15: loadAvg[2].toFixed(2),
                cores: os.cpus().length
              }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/proxy')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            let targetUrlParam = urlObj.searchParams.get('url');

            // Fallback to referer for sub-resources (images, scripts, etc.)
            if (!targetUrlParam && req.headers.referer) {
              try {
                const refUrl = new URL(req.headers.referer);
                const refTarget = refUrl.searchParams.get('url');
                if (refTarget) {
                  const base = refTarget.startsWith('http') ? refTarget : `https://${refTarget}`;
                  const baseUrl = new URL(base);
                  targetUrlParam = new URL(req.url, baseUrl.origin).href;
                }
              } catch (e) { /* ignore */ }
            }

            if (!targetUrlParam) {
              res.statusCode = 400;
              res.end('Missing url parameter');
              return;
            }

            try {
              const fullUrl = targetUrlParam.startsWith('http') ? targetUrlParam : `https://${targetUrlParam}`;
              const parsedUrl = new URL(fullUrl);

              const proxy = createProxyMiddleware({
                target: parsedUrl.origin,
                changeOrigin: true,
                pathRewrite: () => parsedUrl.pathname + parsedUrl.search,
                on: {
                  proxyReq: (proxyReq, req, res) => {
                    proxyReq.setHeader('Referer', parsedUrl.origin);
                    proxyReq.setHeader('Origin', parsedUrl.origin);
                    fixRequestBody(proxyReq, req, res);
                  },
                  proxyRes: (proxyRes, req, res) => {
                    delete proxyRes.headers['x-frame-options'];
                    if (proxyRes.headers['content-security-policy']) {
                      proxyRes.headers['content-security-policy'] = proxyRes.headers['content-security-policy']
                        .replace(/frame-ancestors\s+[^;]+;?/g, '')
                        .replace(/frame-src\s+[^;]+;?/g, '');
                    }
                    delete proxyRes.headers['x-content-security-policy'];
                    delete proxyRes.headers['x-webkit-csp'];
                    proxyRes.headers['access-control-allow-origin'] = '*';
                  },
                  error: (err, req, res) => {
                    console.error("Proxy Error:", err);
                    if (!res.headersSent) {
                      res.statusCode = 500;
                      res.end('Proxy Error: ' + err.message);
                    }
                  }
                }
              });
              return proxy(req, res, next);
            } catch (e) {
              res.statusCode = 400;
              res.end('Invalid URL');
              return;
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/health-check')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const type = urlObj.searchParams.get('type');
            const url = urlObj.searchParams.get('url');
            const port = urlObj.searchParams.get('port');

            if (!type || !url) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing parameters' }));
              return;
            }

            // Prevent visual stale status due to browser/intermediate caching
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');

            try {
              if (type === 'ping') {
                const timeout = 2; // seconds
                const cmd = process.platform === 'win32'
                  ? `ping -n 1 -w ${timeout * 1000} ${url}`
                  : `ping -c 1 -W ${timeout} ${url}`;

                exec(cmd, (error) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ status: error ? 'down' : 'up' }));
                });
              }
              else if (type === 'http' || type === 'https') {
                const targetUrl = url.startsWith('http') ? url : `${type}://${url}`;
                let done = false;
                const sendResponse = (status) => {
                  if (done) return;
                  done = true;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ status }));
                };

                try {
                  const urlObj = new URL(targetUrl);
                  if (port && !urlObj.port) urlObj.port = port;
                  const isHttps = urlObj.protocol === 'https:';
                  const requester = isHttps ? https : http;

                  const options = {
                    method: 'GET',
                    agent: isHttps ? agent : undefined,
                    timeout: 5000,
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Zulu7/1.0',
                      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                      'Cache-Control': 'no-cache'
                    }
                  };

                  const request = requester.get(urlObj, options, (res_check) => {
                    const code = res_check.statusCode;
                    const isOk = (code >= 200 && code < 400) || code === 401 || code === 403;
                    sendResponse(isOk ? 'up' : 'down');
                    res_check.resume();
                  });

                  request.on('error', () => {
                    sendResponse('down');
                  });

                  request.on('timeout', () => {
                    request.destroy();
                    sendResponse('down');
                  });
                } catch (err) {
                  sendResponse('down');
                }
              }
              else if (type === 'tcp') {
                const targetPort = parseInt(port, 10);
                if (isNaN(targetPort)) {
                  res.statusCode = 400;
                  res.end(JSON.stringify({ error: 'Invalid port' }));
                  return;
                }

                const socket = new net.Socket();
                socket.setTimeout(3000);

                socket.on('connect', () => {
                  socket.destroy();
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ status: 'up' }));
                });

                socket.on('timeout', () => {
                  socket.destroy();
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ status: 'down' }));
                });

                socket.on('error', () => {
                  socket.destroy();
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ status: 'down' }));
                });

                socket.connect(targetPort, url);
              } else {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid health check type' }));
              }
            } catch (e) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ status: 'down', error: e.message }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/video-proxy')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const id = urlObj.searchParams.get('id');

            if (!id) {
              res.statusCode = 400;
              res.end('Missing id');
              return;
            }

            const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`;

            const fetchWithRetry = (url, redirectCount = 0) => {
              if (redirectCount > 5) {
                res.statusCode = 500;
                res.end('Too many redirects');
                return;
              }

              const headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              };
              if (req.headers.range) headers['Range'] = req.headers.range;

              // Use native node https module to pipe the response directly
              // (vite dev server runs in node, relying on the import at top)
              https.get(url, { headers }, (proxyRes) => {
                // Handle Redirects (302, 303, etc)
                if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                  let nextUrl = proxyRes.headers.location;
                  if (!nextUrl.startsWith('http')) {
                    nextUrl = new URL(nextUrl, url).href;
                  }
                  return fetchWithRetry(nextUrl, redirectCount + 1);
                }

                // If it's HTML, we hit a virus scan warning or error.
                if (proxyRes.headers['content-type']?.includes('text/html')) {
                  res.statusCode = 500;
                  res.end('Hit GDrive HTML warning page - keyless bypass failed.');
                  return;
                }

                // Success: Pipe the stream
                res.statusCode = proxyRes.statusCode;

                // Forward relevant headers, but sanitize security headers that prevent playback
                Object.entries(proxyRes.headers).forEach(([key, value]) => {
                  const lowerKey = key.toLowerCase();
                  if (['content-security-policy', 'x-frame-options', 'strict-transport-security'].includes(lowerKey)) return;
                  res.setHeader(key, value);
                });

                // Explicitly allow cross-origin
                res.setHeader('Access-Control-Allow-Origin', '*');
                proxyRes.pipe(res);

              }).on('error', (err) => {
                console.error("Video Proxy Error:", err);
                if (!res.headersSent) {
                  res.statusCode = 500;
                  res.end(err.message);
                }
              });
            };

            fetchWithRetry(downloadUrl);
          } else {
            next();
          }
        });
      }
    }
  ],
  server: {
    port: 8080,
    allowedHosts: true,
    proxy: {
      '/api/finance': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        agent: agent,
        rewrite: (path) => path.replace(/^\/api\/finance/, '/v8/finance/chart'),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.removeHeader('Origin');
            proxyReq.removeHeader('Referer');
          });
          proxy.on('proxyRes', (proxyRes, req, res) => {
            // Intercept non-OK responses (like 429 HTML) and return JSON so widget doesn't crash `JSON.parse`
            if (proxyRes.statusCode !== 200) {
              proxyRes.headers['content-type'] = 'application/json';
              let body = [];
              proxyRes.on('data', chunk => body.push(chunk));
              proxyRes.on('end', () => {
                const errorStr = JSON.stringify({ error: `Yahoo API Failed: ${proxyRes.statusCode}` });
                res.end(errorStr);
              });
              // Prevent piping
              proxyRes.pipe = () => { };
            }
          });
        }
      },
      '/api/finance-quote': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        agent: agent,
        rewrite: (path) => path.replace(/^\/api\/finance-quote/, '/v7/finance/quote'),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.removeHeader('Origin');
            proxyReq.removeHeader('Referer');
          });
        }
      },
      '/api/finance-search': {
        target: 'https://query2.finance.yahoo.com',
        changeOrigin: true,
        agent: agent,
        rewrite: (path) => path.replace(/^\/api\/finance-search/, '/v1/finance/search'),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.removeHeader('Origin');
            proxyReq.removeHeader('Referer');
          });
        }
      },

      // Go2RTC Proxy Rules
      '/api/streams': {
        target: 'http://127.0.0.1:1984',
        changeOrigin: true
      },
      '/stream.html': {
        target: 'http://127.0.0.1:1984',
        changeOrigin: true
      },
      '/video-stream.js': {
        target: 'http://127.0.0.1:1984',
        changeOrigin: true
      },
      '/video-rtc.js': {
        target: 'http://127.0.0.1:1984',
        changeOrigin: true
      },
      '/api/ws': {
        target: 'http://127.0.0.1:1984',
        ws: true,
        changeOrigin: true
      },

      '/api': { // Catch-all for other Go2RTC APIs if needed, but be careful not to conflict with finance
        target: 'http://127.0.0.1:1984',
        changeOrigin: true,
        bypass: (req) => {
          if (req.url.startsWith('/api/finance') ||
            req.url.startsWith('/api/market-data') ||
            req.url.startsWith('/api/publish') ||
            req.url.startsWith('/api/config') ||
            req.url.startsWith('/api/drive-folder') ||
            req.url.startsWith('/api/fetch-title') ||
            req.url.startsWith('/api/video-proxy') ||
            req.url.startsWith('/api/rss') ||
            req.url.startsWith('/api/system-load')) {
            return req.url;
          }
        }
      }
    },
    watch: {
      // Ignore published configs to prevent HMR loops when we update lastAccessed
      ignored: ['**/go2rtc.yaml', '**/config.yaml', '**/*.log', '**/published_configs/**']
    }
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'ui-vendor': ['lucide-react', 'react-grid-layout']
        }
      }
    }
  }
})
