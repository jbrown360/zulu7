import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import cors from 'cors';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream } from 'node:fs'; // Keep synchronous versions for startup
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';


// Global HTTPS Agent for reuse
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 100,
    maxFreeSockets: 10,
    timeout: 60000,
    rejectUnauthorized: false // Support self-signed certificates for health checks/RSS
});

// Simple In-Memory Cache
const cache = {
    marketData: new Map(),
    titles: new Map()
};

const CACHE_TTL = {
    MARKET: 60 * 1000, // 1 minute
    TITLE: 24 * 60 * 60 * 1000 // 24 hours
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const app = express();
const PORT = process.env.PORT || 8080;

// Middleware (Proxy FIRST to avoid any path stripping/modifications)
const STREAMER_URL = process.env.STREAMER_URL || 'http://127.0.0.1:1984';
const go2rtcProxy = createProxyMiddleware({
    target: STREAMER_URL,
    changeOrigin: true,
    ws: true,
    logger: console,
    on: {
        proxyReq: (proxyReq, req, res) => {
            // console.log(`[Go2RTC-Proxy] FORWARDING: ${req.url} -> ${proxyReq.path}`);
        }
    },
    pathFilter: ['/api/streams', '/stream.html', '/video-stream.js', '/video-rtc.js', '/api/ws']
});
app.use(go2rtcProxy);

app.use(cors());

// Ensure published_configs directory exists
const publishedDir = path.resolve('published_configs');
if (!existsSync(publishedDir)) {
    mkdirSync(publishedDir);
}

// Cleanup Function (Async)
const cleanupConfigs = async () => {
    if (!existsSync(publishedDir)) return;

    try {
        const files = await fs.readdir(publishedDir);
        const now = Date.now();
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        let deletedCount = 0;

        await Promise.all(files.map(async (file) => {
            if (!file.endsWith('.json')) return;
            const filePath = path.join(publishedDir, file);
            try {
                const stats = await fs.stat(filePath);
                const content = await fs.readFile(filePath, 'utf-8');
                const config = JSON.parse(content);

                const isUsed = config.isUsed || false;
                const lastActivity = config.lastAccessed || config.timestamp || stats.mtimeMs;
                const createdTime = config.timestamp || stats.mtimeMs;

                if (now - lastActivity > THIRTY_DAYS_MS) {
                    console.log(`Deleting expired config: ${file}`);
                    await fs.unlink(filePath);
                    deletedCount++;
                }
            } catch (e) {
                console.error(`Error processing ${file}:`, e);
            }
        }));

        if (deletedCount > 0) console.log(`Cleanup complete. Deleted ${deletedCount} files.`);
    } catch (err) {
        console.error("Cleanup Error:", err);
    }
};

// Start Cleanup Loop (Every hour)
cleanupConfigs();
setInterval(cleanupConfigs, 60 * 60 * 1000);

// API: Video Content Proxy (Hardened for GDrive, Keyless)
app.get('/api/video-proxy', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send('Missing id');

    const downloadUrl = `https://drive.google.com/uc?export=download&id=${id}`;

    const fetchWithRetry = (url, redirectCount = 0) => {
        if (redirectCount > 5) {
            return res.status(500).send('Too many redirects');
        }

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (req.headers.range) headers['Range'] = req.headers.range;

        https.get(url, { headers }, (proxyRes) => {
            // Handle Redirects (302, 303, etc)
            if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
                let nextUrl = proxyRes.headers.location;
                if (!nextUrl.startsWith('http')) {
                    nextUrl = new URL(nextUrl, url).href;
                }
                return fetchWithRetry(nextUrl, redirectCount + 1);
            }

            // If it's HTML, we hit a virus scan warning or error. This keyless approach 
            // relies on the file being small enough, or finding a way to bypass it.
            // For now, just fail gracefully if it hits HTML instead of video.
            if (proxyRes.headers['content-type']?.includes('text/html')) {
                res.status(500).send('Hit GDrive HTML warning page - keyless bypass failed.');
                return;
            }

            // Success: Pipe the stream
            res.status(proxyRes.statusCode);

            // Forward relevant headers, but sanitize security headers that prevent playback
            Object.entries(proxyRes.headers).forEach(([key, value]) => {
                const lowerKey = key.toLowerCase();
                if (['content-security-policy', 'x-frame-options', 'strict-transport-security'].includes(lowerKey)) return;
                res.setHeader(key, value);
            });

            // Explicitly allow cross-origin for the video player
            res.setHeader('Access-Control-Allow-Origin', '*');
            proxyRes.pipe(res);

        }).on('error', (err) => {
            console.error("Video Proxy Error:", err);
            if (!res.headersSent) res.status(500).send(err.message);
        });
    };

    fetchWithRetry(downloadUrl);
});


// API: Publish Config
app.post('/api/publish', express.json(), (req, res) => {
    try {
        const config = req.body;
        config.timestamp = Date.now();
        config.lastAccessed = Date.now();
        config.isUsed = false; // Initialize as unused

        const uuid = crypto.randomUUID().replace(/-/g, '');
        const filePath = path.join(publishedDir, `${uuid}.json`);
        writeFileSync(filePath, JSON.stringify(config, null, 2));

        res.json({ success: true, key: uuid, url: `/?zulu7=${uuid}` });
    } catch (e) {
        console.error("Publish Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Get Config
app.get('/api/config', (req, res) => {
    const id = req.query.id;
    if (!id || !/^[a-z0-9]+$/i.test(id)) {
        return res.status(400).json({ error: 'Invalid ID' });
    }

    const filePath = path.join(publishedDir, `${id}.json`);
    if (existsSync(filePath)) {
        try {
            const data = readFileSync(filePath, 'utf-8');
            const config = JSON.parse(data);
            config.lastAccessed = Date.now();
            config.isUsed = true; // Mark as used upon first retrieval
            writeFileSync(filePath, JSON.stringify(config, null, 2));
            res.json(config);
        } catch (e) {
            console.error("Error reading config:", e);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// API: Market Data Proxy
app.get('/api/market-data', async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    // Check Cache
    const cached = cache.marketData.get(symbol);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL.MARKET)) {
        return res.json(cached.data);
    }

    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=60m&range=5d`;

        const yahooRes = await new Promise((resolve, reject) => {
            const request = https.get(yahooUrl, {
                agent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': '*/*'
                }
            }, (response) => {
                let body = '';
                response.on('data', chunk => body += chunk);
                response.on('end', () => resolve({ status: response.statusCode, body }));
            });
            request.on('error', err => reject(err));
        });

        if (yahooRes.status !== 200) {
            throw new Error(`Yahoo Proxy Failed: ${yahooRes.status}`);
        }

        const data = JSON.parse(yahooRes.body);

        // Update Cache
        cache.marketData.set(symbol, {
            timestamp: Date.now(),
            data: data
        });

        res.json(data);
    } catch (error) {
        console.error("Market Proxy Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// API: Finance Quote Proxy (for better metadata/names)
app.get('/api/finance-quote', async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    try {
        const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}`;
        const yahooRes = await new Promise((resolve, reject) => {
            const request = https.get(yahooUrl, {
                agent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }, (response) => {
                let body = '';
                response.on('data', chunk => body += chunk);
                response.on('end', () => resolve({ status: response.statusCode, body }));
            });
            request.on('error', err => reject(err));
        });

        if (yahooRes.status !== 200) {
            return res.status(yahooRes.status).json({ error: `Yahoo Quote Failed: ${yahooRes.status}`, body: yahooRes.body });
        }
        res.json(JSON.parse(yahooRes.body));
    } catch (error) {
        console.error("Quote Proxy Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// API: Finance Search Proxy (for better metadata/names)
app.get('/api/finance-search', async (req, res) => {
    const symbol = req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'Missing symbol' });

    try {
        const yahooUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}`;
        const yahooRes = await new Promise((resolve, reject) => {
            const request = https.get(yahooUrl, {
                agent,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }, (response) => {
                let body = '';
                response.on('data', chunk => body += chunk);
                response.on('end', () => resolve({ status: response.statusCode, body }));
            });
            request.on('error', err => reject(err));
        });

        if (yahooRes.status !== 200) {
            return res.status(yahooRes.status).json({ error: `Yahoo Search Failed: ${yahooRes.status}`, body: yahooRes.body });
        }
        res.json(JSON.parse(yahooRes.body));
    } catch (error) {
        console.error("Search Proxy Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// API: Fetch Page Title
app.get('/api/fetch-title', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    // Check Cache
    const cached = cache.titles.get(url);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL.TITLE)) {
        return res.json({ title: cached.title });
    }

    try {
        const targetUrl = url.startsWith('http') ? url : `https://${url}`;

        // Use built-in fetch (Node 18+)
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Zulu7Bot/1.0)'
            }
        });

        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

        const text = await response.text();
        const match = text.match(/<title>([^<]*)<\/title>/i);
        const title = match ? match[1].trim() : '';

        // Update Cache
        cache.titles.set(url, {
            timestamp: Date.now(),
            title: title
        });

        res.json({ title });
    } catch (e) {
        console.error("Fetch Title Error:", e);
        res.json({ title: '' });
    }
});

// API: Universal Media Folder Scraper (Local, GDrive, HTTP)
app.get('/api/media-folder', async (req, res) => {
    let { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });


    // 2. Google Drive Scraper
    if (url.includes('drive.google.com/drive/folders/')) {
        const cached = cache.titles.get(`gdrive-${url}`);
        if (cached && (Date.now() - cached.timestamp < 300000)) {
            return res.json({ files: cached.files });
        }

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });

            if (!response.ok) throw new Error(`Drive fetch failed: ${response.status}`);
            const text = await response.text();
            let results = [];
            const idRegex = /(?:\[|\[null,)(?:"|&quot;)([a-zA-Z0-9_-]{28,45})(?:"|&quot;)/g;
            let match;
            const ids = new Set();

            while ((match = idRegex.exec(text)) !== null) { ids.add(match[1]); }

            for (const id of ids) {
                let startIdx = text.indexOf(id);
                if (startIdx !== -1) {
                    const windowStart = Math.max(0, startIdx - 500);
                    const windowEnd = Math.min(text.length, startIdx + 1000);
                    const chunk = text.substring(windowStart, windowEnd);

                    const mimeMatch = chunk.match(/video\/[a-zA-Z0-9_.-]+|image\/[a-zA-Z0-9_.-]+/);
                    if (mimeMatch) {
                        results.push({ id, mimeType: mimeMatch[0], source: 'gdrive' });
                    }
                }
            }

            cache.titles.set(`gdrive-${url}`, { timestamp: Date.now(), files: results });
            return res.json({ files: results });
        } catch (error) {
            console.error("Drive Proxy Error:", error);
            return res.status(500).json({ error: error.message });
        }
    }

    // 3. HTTP Public Directory Scraper (Auto-Index)
    if (url.startsWith('http://') || url.startsWith('https://')) {
        // Simple cache for HTTP scraped content
        const cached = cache.titles.get(`http-${url}`);
        if (cached && (Date.now() - cached.timestamp < 300000)) {
            return res.json({ files: cached.files });
        }

        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (!response.ok) throw new Error(`HTTP fetch failed: ${response.status}`);

            const text = await response.text();
            // Parse common hrefs from auto-index pages like Nginx/Apache
            const hrefRegex = /href="([^"]+)"/ig;
            let match;
            const results = [];
            const mediaExtensions = ['.mp4', '.mkv', '.webm', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
            const seen = new Set();

            while ((match = hrefRegex.exec(text)) !== null) {
                let link = match[1];
                // Ignore query sorts, relative up-dirs, or simple slashes
                if (link.startsWith('?C=') || link === '../' || link === '/') continue;

                try {
                    const fullUrl = new URL(link, url).href;
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
                                id: fullUrl, // Treat the URL itself as the ID
                                mimeType,
                                source: 'http'
                            });
                        }
                    }
                } catch (e) { } // Ignore malformed URL parts
            }

            cache.titles.set(`http-${url}`, { timestamp: Date.now(), files: results });
            return res.json({ files: results });
        } catch (err) {
            console.error("HTTP Scraper Error:", err);
            return res.status(500).json({ error: err.message });
        }
    }
});


// API: Fetch RSS Feed (Proxy)
app.get('/api/rss', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        const targetUrl = url.startsWith('http') ? url : `https://${url}`;
        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; Zulu7Bot/1.0; +http://zulu7.local)',
                'Accept': 'application/rss+xml, application/xml, text/xml, */*'
            },
            agent
        });

        if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

        const xml = await response.text();
        res.setHeader('Content-Type', 'text/xml');
        res.send(xml);
    } catch (e) {
        console.error("RSS Fetch Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Health Check (Ping, HTTP, TCP)
app.get('/api/health-check', async (req, res) => {
    const { type, url, port } = req.query;
    if (!type || !url) return res.status(400).json({ error: 'Missing parameters' });

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
                res.json({ status: error ? 'down' : 'up' });
            });
        }
        else if (type === 'http' || type === 'https') {
            const targetUrl = url.startsWith('http') ? url : `${type}://${url}`;
            let done = false;
            const sendResponse = (status) => {
                if (done) return;
                done = true;
                res.json({ status });
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
                    res_check.resume(); // consume response data to free up memory
                });

                request.on('error', (e) => {
                    console.warn(`Health check error for ${url}:`, e.message);
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
            if (isNaN(targetPort)) return res.status(400).json({ error: 'Invalid port' });

            const socket = new net.Socket();
            socket.setTimeout(3000);

            socket.on('connect', () => {
                socket.destroy();
                if (!res.headersSent) res.json({ status: 'up' });
            });

            socket.on('timeout', () => {
                socket.destroy();
                if (!res.headersSent) res.json({ status: 'down' });
            });

            socket.on('error', () => {
                socket.destroy();
                if (!res.headersSent) res.json({ status: 'down' });
            });

            socket.connect(targetPort, url);
        } else {
            res.status(400).json({ error: 'Invalid health check type' });
        }
    } catch (e) {
        res.json({ status: 'down', error: e.message });
    }
});

// API: System Load (Local Only)
app.get('/api/system-load', (req, res) => {
    try {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsage = (usedMem / totalMem) * 100;

        res.json({
            load1: loadAvg[0].toFixed(2),
            load5: loadAvg[1].toFixed(2),
            load15: loadAvg[2].toFixed(2),
            cores: os.cpus().length
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// API: Header-Stripping Proxy for Web Widgets
app.use('/api/proxy', (req, res, next) => {
    let targetUrlParam = req.query.url;

    // Fallback to referer for sub-resources (images, scripts, etc.)
    if (!targetUrlParam && req.headers.referer) {
        try {
            const refUrl = new URL(req.headers.referer);
            const refTarget = refUrl.searchParams.get('url');
            if (refTarget) {
                // Resolve the current request path relative to the referer's target URL
                const base = refTarget.startsWith('http') ? refTarget : `https://${refTarget}`;
                const baseUrl = new URL(base);
                // Reconstruct the full target URL by taking the base and attaching current request's path/search
                // But we must be careful: req.url inside app.use('/api/proxy') might be just the subpath
                // Typically in Express, req.path is the part after the mount point
                targetUrlParam = new URL(req.url, baseUrl.origin).href;
            }
        } catch (e) { /* ignore */ }
    }

    if (!targetUrlParam) return res.status(400).send('Missing url parameter');

    try {
        const fullUrl = targetUrlParam.startsWith('http') ? targetUrlParam : `https://${targetUrlParam}`;
        const parsedUrl = new URL(fullUrl);

        const proxy = createProxyMiddleware({
            target: parsedUrl.origin,
            changeOrigin: true,
            pathRewrite: () => parsedUrl.pathname + parsedUrl.search,
            on: {
                proxyReq: (proxyReq, req, res) => {
                    // Fix headers that might block the proxy
                    proxyReq.setHeader('Referer', parsedUrl.origin);
                    proxyReq.setHeader('Origin', parsedUrl.origin);
                    fixRequestBody(proxyReq, req, res);
                },
                proxyRes: (proxyRes, req, res) => {
                    // Strip headers that prevent embedding
                    delete proxyRes.headers['x-frame-options'];
                    res.removeHeader('X-Frame-Options');

                    // Sanitize CSP
                    if (proxyRes.headers['content-security-policy']) {
                        proxyRes.headers['content-security-policy'] = proxyRes.headers['content-security-policy']
                            .replace(/frame-ancestors\s+[^;]+;?/g, '')
                            .replace(/frame-src\s+[^;]+;?/g, '');
                    }

                    delete proxyRes.headers['x-content-security-policy'];
                    delete proxyRes.headers['x-webkit-csp'];

                    // Allow all origins for this proxy
                    proxyRes.headers['access-control-allow-origin'] = '*';
                },
                error: (err, req, res) => {
                    console.error("Proxy Error:", err);
                    if (!res.headersSent) {
                        res.status(500).send('Proxy Error: ' + err.message);
                    }
                }
            }
        });
        return proxy(req, res, next);
    } catch (e) {
        return res.status(400).send('Invalid URL');
    }
});
// --- INSTAGRAM INTEGRATION ---

// ------------------------------

// Serve static compiled UI correctly
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for SPA routing
app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
