import express from 'express';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import cors from 'cors';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, createReadStream, appendFileSync } from 'node:fs'; // Keep synchronous versions for startup
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import snmp from 'net-snmp';
import arp from 'node-arp';
import multer from 'multer';

// --- Clipboard Storage configuration ---
const CLIPBOARD_DIR = path.resolve('data', 'clipboards');
if (!existsSync(path.resolve('data'))) mkdirSync(path.resolve('data'));
if (!existsSync(CLIPBOARD_DIR)) mkdirSync(CLIPBOARD_DIR);

// Multer config for Clipboard uploads
const clipboardStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const key = req.params.key;
        if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) {
            return cb(new Error("Invalid clipboard key"));
        }
        const dir = path.join(CLIPBOARD_DIR, key);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        // Sanitize filename to prevent path traversal or weird characters
        const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
        cb(null, safeName);
    }
});
const uploadLocal = multer({ storage: clipboardStorage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit
const uploadDemo = multer({ storage: clipboardStorage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit
// --- SNMP Persistence Manager ---
const SNMP_HISTORY_DIR = path.resolve('snmp_history');
if (!existsSync(SNMP_HISTORY_DIR)) mkdirSync(SNMP_HISTORY_DIR);

// --- Movie Poster Persistent Cache ---
const MOVIE_CACHE_FILE = path.resolve('movies_metadata.json');
const MOVIE_SCRAPE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
let movieCacheData = { updated: 0, scraped: {}, movies: [] };

// Load cache on startup
try {
    if (existsSync(MOVIE_CACHE_FILE)) {
        const loaded = JSON.parse(readFileSync(MOVIE_CACHE_FILE, 'utf-8'));
        movieCacheData = { ...movieCacheData, ...loaded };
        if (!movieCacheData.scraped) movieCacheData.scraped = {};
        console.log(`[Movie Cache] Loaded ${movieCacheData.movies.length} posters from disk.`);
    }
} catch (e) {
    console.error("[Movie Cache] Error loading cache:", e);
}

class SnmpManager {
    constructor() {
        this.targets = new Map(); // signature -> { host, port, community, oid, version, lastActive }
        this.historyCache = new Map(); // signature -> [[ts, val], ...]
        this.pollTimer = setInterval(() => this.pollAll(), 60000); // Global poll every minute
    }

    getSignature(host, port, community, oid, version) {
        return Buffer.from(`${host}:${port}:${community}:${oid}:${version}`).toString('base64').replace(/[/+=]/g, '_');
    }

    register(host, port, community, oid, version) {
        const sig = this.getSignature(host, port, community, oid, version);
        if (!this.targets.has(sig)) {
            this.targets.set(sig, {
                host, port, community, oid, version,
                lastActive: Date.now()
            });

            // Load history from disk into cache once
            const filePath = path.join(SNMP_HISTORY_DIR, `${sig}.json`);
            if (existsSync(filePath)) {
                try {
                    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
                    this.historyCache.set(sig, data);
                } catch (e) {
                    this.historyCache.set(sig, []);
                }
            } else {
                this.historyCache.set(sig, []);
            }

            console.log(`[SnmpManager] Registered new target: ${host} ${oid}`);
            this.pollTarget(sig);
        } else {
            this.targets.get(sig).lastActive = Date.now();
        }
        return sig;
    }

    async pollAll() {
        const now = Date.now();
        for (const [sig, target] of this.targets.entries()) {
            if (now - target.lastActive > 5 * 60 * 1000) {
                console.log(`[SnmpManager] Target expired (inactive): ${target.host} ${target.oid}`);
                this.targets.delete(sig);
                continue;
            }
            this.pollTarget(sig);
        }
    }

    async pollTarget(sig) {
        const target = this.targets.get(sig);
        if (!target) return;

        const { host, port, community, oid, version } = target;
        const cleanOid = oid.startsWith('.') ? oid.slice(1) : oid;
        const session = snmp.createSession(host, community || 'public', {
            port: parseInt(port) || 161,
            retries: 1,
            timeout: 5000,
            version: parseInt(version) || snmp.Version2c
        });

        session.get([cleanOid], (error, varbinds) => {
            if (!error && varbinds && varbinds[0]) {
                let value = varbinds[0].value;
                if (Buffer.isBuffer(value)) {
                    try { value = BigInt('0x' + value.toString('hex')).toString(); }
                    catch (e) { value = value.toString(); }
                }
                this.savePoint(sig, value);
            }
            session.close();
        });
    }

    savePoint(sig, value) {
        const now = Date.now();
        let history = this.historyCache.get(sig) || [];

        history.push([now, value]);

        const SEVEN_DAYS_MS = 604800000;
        const cutoff = now - SEVEN_DAYS_MS;

        // Keep in memory
        history = history.filter(p => p[0] > cutoff).slice(-2000);
        this.historyCache.set(sig, history);

        // Async write to disk
        const filePath = path.join(SNMP_HISTORY_DIR, `${sig}.json`);
        fs.writeFile(filePath, JSON.stringify(history)).catch(err => {
            console.error(`[SnmpManager] Disk write error for ${sig}:`, err.message);
        });
    }

    getHistory(sig) {
        return this.historyCache.get(sig) || [];
    }
}
// --- Docker Persistence Manager ---
const DOCKER_HISTORY_DIR = path.resolve('docker_history');
if (!existsSync(DOCKER_HISTORY_DIR)) mkdirSync(DOCKER_HISTORY_DIR);

class DockerManager {
    constructor() {
        this.targets = new Map(); // signature -> { host, containerId, metric, lastActive }
        this.historyCache = new Map(); // signature -> [[ts, val], ...]
        this.lastStatsMap = new Map(); // signature -> stats
        this.pollTimer = setInterval(() => this.pollAll(), 15000); // Background poll every 15s
    }

    getSignature(host, containerId, metric) {
        return Buffer.from(`${host}:${containerId}:${metric}`).toString('base64').replace(/[/+=]/g, '_');
    }

    register(host, containerId, metric) {
        const sig = this.getSignature(host, containerId, metric);
        if (!this.targets.has(sig)) {
            this.targets.set(sig, { host, containerId, metric, lastActive: Date.now() });

            // Load history from disk into cache once
            const filePath = path.join(DOCKER_HISTORY_DIR, `${sig}.json`);
            if (existsSync(filePath)) {
                try {
                    const data = JSON.parse(readFileSync(filePath, 'utf-8'));
                    this.historyCache.set(sig, data);
                } catch (e) {
                    this.historyCache.set(sig, []);
                }
            } else {
                this.historyCache.set(sig, []);
            }

            console.log(`[DockerManager] Registered: ${host} ${containerId} ${metric}`);
            this.pollTarget(sig);
        } else {
            this.targets.get(sig).lastActive = Date.now();
        }
        return sig;
    }

    async pollAll() {
        const now = Date.now();
        for (const [sig, target] of this.targets.entries()) {
            if (now - target.lastActive > 5 * 60 * 1000) {
                console.log(`[DockerManager] Expired: ${target.host} ${target.containerId}`);
                this.targets.delete(sig);
                continue;
            }
            this.pollTarget(sig);
        }
    }

    async pollTarget(sig) {
        const target = this.targets.get(sig);
        if (!target) return;

        const { host, containerId, metric } = target;
        try {
            const baseUrl = host.startsWith('http') ? host : `http://${host}`;
            const url = new URL(`containers/${containerId}/stats?stream=false`, baseUrl);

            const response = await fetch(url.href, { headers: { 'Accept': 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const stats = await response.json();
            const lastStats = this.lastStatsMap.get(sig);
            this.lastStatsMap.set(sig, stats);

            let value = 0;
            let canSave = false;

            if (metric === 'cpu') {
                const cpu = stats.cpu_stats || {};
                const pre = lastStats?.cpu_stats || stats.precpu_stats || {};
                const curUsage = cpu.cpu_usage?.total_usage || cpu.cpu_usage?.usage || 0;
                const preUsage = pre.cpu_usage?.total_usage || pre.cpu_usage?.usage || 0;
                const curSys = cpu.system_cpu_usage || cpu.system_usage || 0;
                const preSys = pre.system_cpu_usage || pre.system_usage || 0;

                if (curSys > 0 && preSys > 0) {
                    const cpuDelta = curUsage - preUsage;
                    const systemDelta = curSys - preSys;
                    if (systemDelta > 0 && cpuDelta > 0) {
                        value = (cpuDelta / systemDelta) * 100.0;
                        canSave = true;
                    }
                }
            } else if (metric === 'mem') {
                const mem = stats.memory_stats || {};
                const usage = mem.usage || mem.stats?.usage || 0;
                const cache = mem.stats?.cache || mem.stats?.inactive_file || mem.stats?.file || 0;
                value = Math.max(0, usage - cache);
                if (value === 0 && usage > 0) value = mem.stats?.active_anon || usage;
                canSave = true;
            } else if (metric.startsWith('net')) {
                const isRx = metric === 'net_rx';
                let total = 0;
                const nets = stats.networks || stats.network || {};
                for (const iface in nets) {
                    total += isRx ? (nets[iface].rx_bytes || 0) : (nets[iface].tx_bytes || 0);
                }
                if (lastStats) {
                    const prevNets = lastStats.networks || lastStats.network || {};
                    let prevTotal = 0;
                    for (const iface in prevNets) {
                        prevTotal += isRx ? (prevNets[iface].rx_bytes || 0) : (prevNets[iface].tx_bytes || 0);
                    }
                    if (total >= prevTotal) {
                        value = total - prevTotal;
                        canSave = true;
                    }
                }
            } else if (metric.startsWith('io')) {
                const isRead = metric === 'io_r';
                const key = isRead ? 'Read' : 'Write';
                const getIO = (s) => {
                    let t = 0;
                    const blk = s?.blkio_stats || {};
                    const entries = blk.io_service_bytes_recursive || blk.io_service_bytes || blk.io_serviced_recursive || [];
                    entries.forEach(e => {
                        if (e.op === key || e.op?.toLowerCase() === key.toLowerCase()) t += (e.value || 0);
                    });
                    return t;
                };
                const total = getIO(stats);
                if (lastStats) {
                    const prevTotal = getIO(lastStats);
                    if (total >= prevTotal) {
                        value = total - prevTotal;
                        canSave = true;
                    }
                }
            }

            if (canSave) this.savePoint(sig, value);
        } catch (e) {
            console.error(`[DockerManager] Error polling ${host}: ${e.message}`);
        }
    }

    savePoint(sig, value) {
        const now = Date.now();
        const limit = now - 604800000; // 7 days

        let history = this.historyCache.get(sig) || [];
        history.push([now, value]);

        // Keep in memory
        history = history.filter(p => p[0] > limit).slice(-10000); // 10k points limit
        this.historyCache.set(sig, history);

        // Async write to disk
        const filePath = path.join(DOCKER_HISTORY_DIR, `${sig}.json`);
        fs.writeFile(filePath, JSON.stringify(history)).catch(err => {
            console.error(`[DockerManager] Disk write error for ${sig}:`, err.message);
        });
    }

    getHistory(sig) {
        return this.historyCache.get(sig) || [];
    }
}
// --- Speedtest Manager ---
const SPEEDTEST_HISTORY_DIR = path.resolve('speedtest_history');
if (!existsSync(SPEEDTEST_HISTORY_DIR)) mkdirSync(SPEEDTEST_HISTORY_DIR);

class SpeedtestManager {
    constructor() {
        this.historyFile = path.join(SPEEDTEST_HISTORY_DIR, 'results.json');
        this.pollInterval = 60 * 60 * 1000; // 60 mins
        this.pollTimer = setInterval(() => this.runTest(), this.pollInterval);
        this.isTesting = false;
        // Delayed startup test
        setTimeout(() => this.runTest(), 10000);
    }

    async runTest() {
        if (this.isTesting) return;
        this.isTesting = true;
        console.log("[Speedtest] Running scheduled measurement...");

        try {
            const ping = await this.measurePing();
            const download = await this.measureDownload();
            const upload = await this.measureUpload();

            const result = {
                timestamp: Date.now(),
                download,
                upload,
                ping
            };

            this.saveResult(result);
            console.log(`[Speedtest] Success: Dn=${download}Mbps, Up=${upload}Mbps, Ping=${ping}ms`);
        } catch (err) {
            console.error("[Speedtest] Measurement failed:", err);
        } finally {
            this.isTesting = false;
        }
    }

    async measurePing() {
        return new Promise((resolve) => {
            exec('ping -c 4 8.8.8.8', (err, stdout) => {
                if (err) return resolve(0);
                const avgMatch = stdout.match(/rtt min\/avg\/max\/mdev = [\d.]+\/([\d.]+)\//);
                resolve(avgMatch ? parseFloat(avgMatch[1]) : 0);
            });
        });
    }

    async measureDownload() {
        const endpoints = [
            { url: 'https://speed.cloudflare.com/__down?bytes=26214400', bytes: 26214400 },
            { url: 'http://speedtest.tele2.net/10MB.zip', bytes: 10485760 },
            { url: 'https://speed.hetzner.de/100MB.bin', bytes: 104857600 }
        ];

        for (const ep of endpoints) {
            try {
                const cmd = `curl -A "Mozilla/5.0" -k -L -m 20 -s -w "%{http_code}:%{time_total}" -o /dev/null "${ep.url}${ep.url.includes('?') ? '&' : '?'}nocache=${Math.random()}"`;
                const result = await new Promise((resolve, reject) => {
                    exec(cmd, (err, stdout) => {
                        if (err && err.code !== 0) return reject(err);
                        resolve(stdout.trim());
                    });
                });

                const [code, time] = result.split(':');
                if (code !== '200') throw new Error(`HTTP ${code}`);
                
                const durationSec = parseFloat(time);
                if (durationSec < 0.1 || isNaN(durationSec)) throw new Error("Suspicious execution time");

                const mbps = (ep.bytes * 8) / durationSec / 1000000;
                return parseFloat(mbps.toFixed(2));
            } catch (e) {
                console.warn(`[Speedtest] Download failed on ${ep.url} - ${e.message}`);
            }
        }
        
        console.error("[Speedtest] All download endpoints failed");
        return 0;
    }

    async measureUpload() {
        try {
            const tempFile = '/tmp/speedtest_upload.bin';
            const { execSync } = require('child_process');
            
            // Create a 5MB random payload file quickly using dd if it doesn't exist
            try {
                if (!require('fs').existsSync(tempFile)) {
                    execSync(`dd if=/dev/urandom of=${tempFile} bs=1M count=2 2>/dev/null`);
                }
            } catch (e) {
                // Fallback to minimal payload or ignore
            }

            const cmd = `curl -X POST -H "Expect:" -A "Mozilla/5.0" -k -m 20 -s -w "%{http_code}:%{time_total}" -o /dev/null --data-binary "@${tempFile}" "https://speed.cloudflare.com/__up" 2>/dev/null`;
            const result = await new Promise((resolve, reject) => {
                exec(cmd, (err, stdout) => {
                    if (err && err.code !== 0) return reject(err);
                    resolve(stdout.trim());
                });
            });

            const [code, time] = result.split(':');
            if (code !== '200') throw new Error(`HTTP ${code}`);
            
            const durationSec = parseFloat(time);
            if (durationSec < 0.1 || isNaN(durationSec)) throw new Error("Suspicious execution time");

            const mbps = (2 * 8) / durationSec; // 2MB = 16 Megabits
            return parseFloat(mbps.toFixed(2));
        } catch (e) {
            console.warn(`[Speedtest] Upload failed - ${e.message}`);
            return 0;
        }
    }

    saveResult(point) {
        let history = [];
        try {
            if (existsSync(this.historyFile)) {
                history = JSON.parse(readFileSync(this.historyFile, 'utf-8'));
            }
        } catch (e) { }

        history.push(point);

        const CUTOFF = Date.now() - (7 * 24 * 60 * 60 * 1000);
        history = history.filter(p => p.timestamp > CUTOFF);

        writeFileSync(this.historyFile, JSON.stringify(history));
    }

    getHistory() {
        try {
            if (existsSync(this.historyFile)) {
                return JSON.parse(readFileSync(this.historyFile, 'utf-8'));
            }
        } catch (e) { }
        return [];
    }
}

// --- MAC OUI Vendor Lookup System ---
const MAC_VENDORS_OFFLINE_FILE = path.resolve('mac_vendors.json');
const MAC_VENDORS_CACHE_FILE = path.resolve('mac_api_cache.json');

class MacVendorLookup {
    constructor() {
        this.cache = {}; // Persistent API cache
        this.offlineDb = {}; // Massive IEEE index
        this.pendingRequests = new Map();
        
        // 1. Load the massive 4MB IEEE dictionary we downloaded
        try {
            if (existsSync(MAC_VENDORS_OFFLINE_FILE)) {
                this.offlineDb = JSON.parse(readFileSync(MAC_VENDORS_OFFLINE_FILE, 'utf-8'));
                console.log(`[MacVendorLookup] Loaded ${Object.keys(this.offlineDb).length} MAC vendors from offline database.`);
            }
        } catch (e) {
            console.warn(`[MacVendorLookup] Could not parse offline database:`, e.message);
        }

        // 2. Load the dynamic API cache for anything not in the IEEE db (e.g., dynamic lookups)
        try {
            if (existsSync(MAC_VENDORS_CACHE_FILE)) {
                this.cache = JSON.parse(readFileSync(MAC_VENDORS_CACHE_FILE, 'utf-8'));
                console.log(`[MacVendorLookup] Loaded ${Object.keys(this.cache).length} cached API MAC vendors.`);
            }
        } catch (e) {
            console.error("[MacVendorLookup] Error loading cache:", e);
        }
    }

    saveCache() {
        try {
            writeFileSync(MAC_VENDORS_CACHE_FILE, JSON.stringify(this.cache));
        } catch (e) {
            console.error("[MacVendorLookup] Error saving cache:", e);
        }
    }

    async getVendor(mac) {
        if (!mac) return 'Unknown Vendor';
        
        const oui = mac.substring(0, 8).toLowerCase();
        
        // 1. Check offline massive IEEE database first
        if (this.offlineDb[oui]) {
            return this.offlineDb[oui];
        }

        // 2. Check dynamic API cache next
        if (this.cache[oui] !== undefined) {
            return this.cache[oui];
        }

        // If a request for this OUI is already in flight, wait for it
        if (this.pendingRequests.has(oui)) {
            return this.pendingRequests.get(oui);
        }

        const fetchPromise = new Promise(async (resolve) => {
            try {
                // Throttle requests slightly if making multiple at startup
                const res = await fetch(`https://api.macvendors.com/${encodeURIComponent(oui)}`, {
                    headers: {
                        'User-Agent': 'Zulu7 Network Scanner / 1.0; (Node.js)'
                    }
                });
                
                if (res.status === 200) {
                    const vendor = await res.text();
                    this.cache[oui] = vendor.trim();
                    this.saveCache();
                    resolve(this.cache[oui]);
                } else if (res.status === 404) {
                    this.cache[oui] = 'Unknown Vendor'; // Cache the miss so we don't spam the API
                    this.saveCache();
                    resolve(this.cache[oui]);
                } else {
                    console.log(`[MacVendorLookup] API returned status ${res.status} for ${oui}`);
                    resolve('Unknown Vendor'); // Don't cache transient errors like rate limits
                }
            } catch (err) {
                console.error(`[MacVendorLookup] API request failed for ${oui}:`, err.message);
                resolve('Unknown Vendor');
            } finally {
                this.pendingRequests.delete(oui); // Clean up
                // Wait 1s between requests to respect rate limits if we hit this sequentially
                await new Promise(r => setTimeout(r, 1000));
            }
        });

        this.pendingRequests.set(oui, fetchPromise);
        return fetchPromise;
    }
}

const macVendorLookup = new MacVendorLookup();

// --- Network Scanner Manager ---



class NetworkScannerManager {
    constructor() {
        this.cache = new Map(); // ip/mac -> { ip, mac, firstSeen, lastSeen }
        this.pollTimers = new Map(); // segment -> timerId
        this.alertedIds = new Set(); // Globally track devices we've already alerted about
        this.cacheFile = path.resolve('data', 'network_scan_cache.json');
        this.logs = []; // Rolling log buffer
        this.maxLogs = 200; // Keep last 200 logs
        this.loadCache();
    }

    loadCache() {
        try {
            if (existsSync(this.cacheFile)) {
                const data = JSON.parse(readFileSync(this.cacheFile, 'utf-8'));
                // data might be array of [id, devObject] or just objects
                if (Array.isArray(data)) {
                    data.forEach(entry => {
                        // Support both map-like serialization and array of objects
                        if (Array.isArray(entry) && entry.length === 2 && entry[1].mac) {
                            this.cache.set(entry[0], entry[1]);
                        } else if (entry.mac) {
                            this.cache.set(entry.mac, entry);
                        }
                    });
                }
            }
        } catch (e) {
            console.error("[NetworkManager] Failed to load cache:", e.message);
        }
    }

    saveCache() {
        try {
            writeFileSync(this.cacheFile, JSON.stringify(Array.from(this.cache.entries()), null, 2));
        } catch (e) {
            console.error("[NetworkManager] Failed to save cache:", e.message);
        }
    }

    addLog(msg) {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${msg}`;
        console.log(`[NetworkManager] ${msg}`);
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    }

    async scanPorts(ip) {
        const commonPorts = [21, 22, 23, 53, 80, 139, 443, 445, 3389, 5000, 8080, 8443];
        const openPorts = [];
        const promises = commonPorts.map(port => {
            return new Promise(resolve => {
                const socket = new net.Socket();
                socket.setTimeout(2000);
                
                socket.on('connect', () => {
                    openPorts.push(port);
                    socket.destroy();
                    resolve();
                });
                
                socket.on('timeout', () => {
                    socket.destroy();
                    resolve();
                });
                
                socket.on('error', () => {
                    resolve();
                });
                
                socket.connect(port, ip);
            });
        });
        
        await Promise.allSettled(promises);
        return openPorts.sort((a,b) => a - b);
    }

    startScanning(segment, intervalMs = 600000) {
        if (!this.pollTimers.has(segment)) {
            this.addLog(`Starting scan for segment ${segment} every ${intervalMs}ms`);
            
            // Initial scan immediately
            this.scanSegment(segment);
            
            const timer = setInterval(() => this.scanSegment(segment), intervalMs);
            this.pollTimers.set(segment, timer);
        }
        return this.getDevices();
    }

    scanSegment(segment, forceClear = false) {
        return new Promise(async (resolve) => {
            if (!segment) return resolve();

            const now = Date.now();
            let discoveredDevices = [];
            let nmapFailed = false;

            // Attempt Nmap Primary Method
            try {
                const nmapOutput = await new Promise((res, rej) => {
                    // -sn: Ping Scan (disable port scan)
                    // -oG -: Output in greppable format to stdout
                    // Require sudo? No, -sn works without root for basic ping, but MAC might be missing if not root.
                    // We run basic nmap and parse the human-readable output, which includes MAC if on local subnet.
                    // Optimizations: -n (disable DNS resolution), -T4 (aggressive timing for faster local sweeps).
                    exec(`nmap -sn -n -T4 ${segment}`, { timeout: 60000 }, (error, stdout, stderr) => {
                        if (error) {
                            if (error.code === 127 || stderr.includes('not found')) {
                                rej(new Error('nmap not installed'));
                            } else {
                                // Some hosts down might return exit code 1 or similar in nmap? Usually 0 if successful run.
                                res(stdout);
                            }
                        } else {
                            res(stdout);
                        }
                    });
                });

                // Parse nmap output
                // Example lines:
                // Nmap scan report for 192.168.1.100
                // Host is up (0.0012s latency).
                // MAC Address: 00:1A:2B:3C:4D:5E (Vendor Name Inc)

                const lines = nmapOutput.split('\n');
                let currentIP = null;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    const ipMatch = line.match(/Nmap scan report for (.+)/);
                    if (ipMatch) {
                        currentIP = ipMatch[1].trim();
                        // Nmap sometimes puts DNS name along with IP: "router.lan (192.168.1.1)"
                        const parenthesizedIP = currentIP.match(/\(([^)]+)\)/);
                        if (parenthesizedIP) {
                            currentIP = parenthesizedIP[1];
                        }
                    }

                    const macMatch = line.match(/MAC Address: ([0-9A-Fa-f:]+) \((.*)\)/) || line.match(/MAC Address: ([0-9A-Fa-f:]+)/);
                    if (macMatch && currentIP) {
                        const mac = macMatch[1].toLowerCase();
                        discoveredDevices.push({ ip: currentIP, mac });
                        currentIP = null; // reset for next block
                    }
                }

                if (discoveredDevices.length > 0) {
                    this.addLog(`Nmap discovery successful. Found ${discoveredDevices.length} hosts.`);
                } else {
                    // Maybe nmap ran but didn't output MAC addresses (e.g. not run as root, or not local subnet)
                    // Fall back to ARP cache check just in case nmap populated it implicitly
                    this.addLog("Nmap didn't return MACs, falling back to ARP cache read.");
                    nmapFailed = true; 
                }

            } catch (err) {
                this.addLog(`Nmap failed or unavailable, falling back to ping sweep... ${err.message}`);
                nmapFailed = true;
            }

            // Fallback: Concurrent Ping Sweep
            if (nmapFailed) {
                if (segment.includes('/24')) {
                    const parts = segment.split('/')[0].split('.');
                    if (parts.length === 4) {
                        const baseIP = `${parts[0]}.${parts[1]}.${parts[2]}.`;
                        const promises = [];
                        // Ping all 254 possible hosts with a 1-second timeout
                        for (let i = 1; i <= 254; i++) {
                            promises.push(new Promise(res => {
                                exec(`ping -c 1 -W 1 ${baseIP}${i}`, () => res());
                            }));
                        }
                        await Promise.allSettled(promises);
                    }
                }
            }

            // Read populated ARP cache (used unconditionally since Nmap updates it too, 
            // and Nmap might not provide MACs if not run as root)
            exec(`ip neigh show`, (err, stdout) => {
                if (err) {
                    this.addLog(`Failed to read ARP cache: ${err.message}`);
                    return resolve();
                }

                const lines = stdout.split('\n');

                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5 && parts[1] === 'dev' && parts[3] === 'lladdr' && /^[0-9a-fA-F:]+$/.test(parts[4])) {
                        const ip = parts[0];
                        const mac = parts[4].toLowerCase();
                        const state = parts[parts.length - 1];

                        // Strict kernel state dropping - eliminate STALE ghost devices
                        const activeStates = ['REACHABLE', 'DELAY', 'PROBE'];
                        if (!activeStates.includes(state)) continue;

                        // Ensure this segment matches? (We trust the ARP cache generally)
                        discoveredDevices.push({ ip, mac });
                    }
                }

                // Update cache and history tracking
                const discoveredIds = new Set(discoveredDevices.map(d => d.mac));
                
                // 1. Update existing and track misses
                for (const [id, existing] of this.cache.entries()) {
                    existing.history = existing.history || Array(10).fill({ s: 1, t: now - 60000 }); // pre-populate with 1s to not unfairly penalize
                    const wasSeen = discoveredIds.has(id);
                    existing.history.push({ s: wasSeen ? 1 : 0, t: now });
                    if (existing.history.length > 60) existing.history.shift();
                    
                    if (wasSeen) {
                        const dev = discoveredDevices.find(d => d.mac === id);
                        existing.lastSeen = now;
                        existing.ip = dev.ip;
                    } else if (forceClear) {
                        this.cache.delete(id);
                        this.alertedIds.delete(id);
                    }
                }
                
                // 2. Add new devices
                for (const dev of discoveredDevices) {
                    const id = dev.mac;
                    if (!this.cache.has(id)) {
                        this.cache.set(id, {
                            id: id,
                            mac: dev.mac,
                            ip: dev.ip,
                            vendor: 'Resolving...',
                            firstSeen: now,
                            lastSeen: now,
                            openPorts: [],
                            history: [{ s: 1, t: now }]
                        });
                        this.addLog(`Discovered new active device: ${dev.ip} (${dev.mac})`);
                        
                        // Fire off async vendor lookup
                        macVendorLookup.getVendor(dev.mac).then(vendor => {
                            const existing = this.cache.get(id);
                            if (existing) {
                                existing.vendor = vendor;
                                this.cache.set(id, existing);
                                this.addLog(`Vendor assigned to ${dev.ip}: ${vendor}`);
                            }
                        });

                        // Fire off async port scan for new devices
                        this.scanPorts(dev.ip).then(ports => {
                            if (ports.length > 0) {
                                const existing = this.cache.get(id);
                                if (existing) {
                                    existing.openPorts = ports;
                                    this.cache.set(id, existing);
                                    this.addLog(`Ports open on ${dev.ip}: ${ports.join(', ')}`);
                                }
                            }
                        });
                    }
                }

                this.saveCache();
                resolve();
            });
        });
    }
    getDevices() {
        // Trigger vendor lookups for any cached devices that still say Unknown Vendor, but limit retries
        const now = Date.now();
        for (const [id, dev] of this.cache.entries()) {
            if (dev.vendor === 'Unknown Vendor' || dev.vendor === 'Resolving...') {
                // Only retry if we haven't tried in the last hour, to prevent API spam for truly unknown MACs
                if (!dev.lastLookupAttempt || (now - dev.lastLookupAttempt) > 3600000) {
                    dev.lastLookupAttempt = now;
                    this.cache.set(id, dev); // Save the attempt timestamp
                    
                    macVendorLookup.getVendor(dev.mac).then(vendor => {
                        const existing = this.cache.get(id);
                        if (existing && vendor !== 'Unknown Vendor') {
                            existing.vendor = vendor;
                            this.cache.set(id, existing);
                        }
                    }).catch(() => {
                        // Ignore lookup errors, we'll try again in an hour
                    });
                }
            }
        }
        return Array.from(this.cache.values()).sort((a,b) => b.lastSeen - a.lastSeen);
    }
}

class SystemLoadManager {
    constructor() {
        this.historyFile = path.join(path.resolve('published_configs'), 'load_history.json');
        this.pollInterval = 60 * 1000; // 1 min

        if (global.__viteLoadTimer) clearInterval(global.__viteLoadTimer);

        if (!process.argv.includes('build')) {
            this.pollTimer = setInterval(() => this.runTest(), this.pollInterval);
            global.__viteLoadTimer = this.pollTimer;
            setTimeout(() => this.runTest(), 5000);
        }
    }

    runTest() {
        try {
            const loadAvg = os.loadavg();
            const point = {
                timestamp: Date.now(),
                load1: parseFloat(loadAvg[0].toFixed(2)),
                load5: parseFloat(loadAvg[1].toFixed(2)),
                load15: parseFloat(loadAvg[2].toFixed(2))
            };
            this.saveResult(point);
        } catch (e) { console.error("[SystemLoadManager] Error:", e); }
    }

    saveResult(point) {
        let history = [];
        try {
            if (existsSync(this.historyFile)) {
                history = JSON.parse(readFileSync(this.historyFile, 'utf-8'));
            }
        } catch (e) {}

        history.push(point);
        const CUTOFF = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
        history = history.filter(p => p.timestamp > CUTOFF);
        
        try {
            writeFileSync(this.historyFile, JSON.stringify(history));
        } catch (e) {
            console.error("[SystemLoadManager] Save Error:", e);
        }
    }

    getHistory() {
        try {
            if (existsSync(this.historyFile)) {
                return JSON.parse(readFileSync(this.historyFile, 'utf-8'));
            }
        } catch (e) {}
        return [];
    }
}

const snmpManager = new SnmpManager();
const dockerManager = new DockerManager();
const speedtestManager = new SpeedtestManager();
const systemLoadManager = new SystemLoadManager();
const networkManager = new NetworkScannerManager();


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
    logger: console
});

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

// API: SNMP Proxy
app.get('/api/snmp', (req, res) => {
    const { host, port, community, oid, version } = req.query;
    if (!host || !oid) return res.status(400).json({ error: 'Missing parameters' });

    // Register/Heartbeat and return full history
    const sig = snmpManager.register(host, port, community, oid, version);
    const history = snmpManager.getHistory(sig);

    res.json({
        signature: sig,
        history: history
    });
});

// API: Clipboard
app.get('/api/clipboard/:key', async (req, res) => {
    const key = req.params.key;
    if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) return res.status(400).json({ error: 'Invalid key format' });
    
    const dir = path.join(CLIPBOARD_DIR, key);
    try {
        if (!existsSync(dir)) {
            return res.json({ files: [] }); // Clipboard is empty/new
        }
        
        const files = await fs.readdir(dir);
        const fileDetails = await Promise.all(files.map(async (file) => {
            const filePath = path.join(dir, file);
            const stats = await fs.stat(filePath);
            
            let content = null;
            let isSnippet = false;
            
            // If it's a small text file, inline its contents
            if (file.endsWith('.txt') && stats.size < 2048) { // Only read files under 2KB
                try {
                    content = await fs.readFile(filePath, 'utf-8');
                    isSnippet = true;
                } catch (e) {
                    console.error("Failed to read snippet:", file);
                }
            }

            return {
                name: file,
                size: stats.size,
                created: stats.birthtimeMs,
                modified: stats.mtimeMs,
                content: content,
                isSnippet: isSnippet
            };
        }));
        
        // Sort newest first
        fileDetails.sort((a, b) => b.modified - a.modified);
        res.json({ files: fileDetails });
    } catch (e) {
        console.error("Clipboard List Error:", e);
        res.status(500).json({ error: 'Failed to list files' });
    }
});

app.post('/api/clipboard/:key/upload', (req, res, next) => {
    const host = req.hostname || req.headers.host || '';
    const uploader = host.includes('zulu7.net') ? uploadDemo : uploadLocal;
    
    uploader.single('file')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, filename: req.file.filename, size: req.file.size });
});

app.get('/api/clipboard/:key/download/:filename', (req, res) => {
    const { key, filename } = req.params;
    if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) return res.status(400).send('Invalid key');
    
    // Basic path traversal prevention handled by Express and regex, but let's be safe
    const safeFilename = path.basename(filename);
    const filePath = path.join(CLIPBOARD_DIR, key, safeFilename);
    
    if (!existsSync(filePath)) return res.status(404).send('File not found');
    res.download(filePath);
});

app.delete('/api/clipboard/:key/:filename', async (req, res) => {
    const { key, filename } = req.params;
    if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) return res.status(400).json({ error: 'Invalid key' });
    
    const safeFilename = path.basename(filename);
    const filePath = path.join(CLIPBOARD_DIR, key, safeFilename);
    
    try {
        if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
        await fs.unlink(filePath);
        res.json({ success: true, message: 'File deleted' });
    } catch (e) {
        console.error("Clipboard Delete Error:", e);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

app.get('/api/speedtest', (req, res) => {
    res.json(speedtestManager.getHistory());
});

// API: Network Scanner
app.get('/api/network-logs', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(networkManager.logs);
});

app.get('/api/network-scan', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { segment, interval, force } = req.query;
    const pollInterval = interval ? Math.max(10000, parseInt(interval) * 1000) : 30000; // default 30 secs
    
    // Ensure the background loop is running
    networkManager.startScanning(segment || '192.168.1.0/24', pollInterval);
    
    // Explicitly wait for a scan to finish if requested, OR if the cache is currently totally empty (e.g. fresh boot)
    if (force === 'true' || networkManager.cache.size === 0) {
        await networkManager.scanSegment(segment || '192.168.1.0/24', force === 'true');
    }
    
    res.json({
        devices: networkManager.getDevices(),
        alertedIds: Array.from(networkManager.alertedIds)
    });
});

const networkKnownFile = path.resolve('data', 'network_known_devices.json');
if (!existsSync(path.resolve('data'))) {
    mkdirSync(path.resolve('data'));
}

app.get('/api/network-known', (req, res) => {
    try {
        if (existsSync(networkKnownFile)) {
            const data = JSON.parse(readFileSync(networkKnownFile, 'utf-8'));
            res.json(data);
        } else {
            res.json({});
        }
    } catch (e) {
        res.status(500).json({ error: 'Failed to read known devices.' });
    }
});

app.post('/api/network-known', express.json(), (req, res) => {
    try {
        writeFileSync(networkKnownFile, JSON.stringify(req.body, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save known devices.' });
    }
});

app.post('/api/network-alert', express.json(), (req, res) => {
    const { ids } = req.body;
    if (Array.isArray(ids)) {
        ids.forEach(id => networkManager.alertedIds.add(id));
    }
    res.json({ success: true });
});

// API: Verify and purge device if offline
app.post('/api/network-verify-purge', express.json(), async (req, res) => {
    const { ip, mac } = req.body;
    if (!ip || !mac) return res.status(400).json({ error: 'Missing ip or mac' });

    try {
        // Ping the IP explicitly with 1 packet, small timeout
        await new Promise((resolve) => {
            exec(`ping -c 1 -W 1 ${ip}`, (error) => {
                if (error) {
                    // It's offline! Purge it completely from the backend cache!
                    networkManager.cache.delete(mac);
                    networkManager.alertedIds.delete(mac);
                } else {
                    // It's online! Update lastSeen so it's fresh.
                    const existing = networkManager.cache.get(mac);
                    if (existing) {
                        existing.lastSeen = Date.now();
                        if (Array.isArray(existing.history)) {
                            existing.history.push(1);
                        }
                    }
                    // Reset its alerted state so the global background scanner will trigger a brand-new UI alarm!
                    networkManager.alertedIds.delete(mac);
                }
                resolve();
            });
        });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Ping a single device for real-time history monitoring
app.get('/api/network-ping-device', async (req, res) => {
    let { ip, mac } = req.query;
    if (!ip || !mac) return res.status(400).json({ error: 'Missing ip or mac' });

    try {
        const { isOnline, latency } = await new Promise((resolve) => {
            exec(`nmap -sn -n -T5 --max-retries 1 --host-timeout 2000ms ${ip}`, (error, stdout) => {
                if (error || stdout.includes('0 hosts up')) {
                    return resolve({ isOnline: false, latency: null });
                }
                const match = stdout.match(/Host is up \(([\d.]+)s latency\)/);
                const lat = match ? parseFloat(match[1]) * 1000 : 1;
                resolve({ isOnline: true, latency: lat });
            });
        });

        // Track only lastSeen on backend, do NOT pollute the 60-minute background sweep array with 1-second macro payloads
        const existing = networkManager.cache.get(mac);
        if (existing && isOnline) {
            existing.lastSeen = Date.now();
        }
        
        // Return raw telemetry to the frontend for isolated UI real-time processing
        res.json({ mac, s: isOnline ? 1 : 0, l: latency, t: Date.now() });
    } catch (e) {
        res.status(500).json({ error: e.message });
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

            const contentType = response.headers.get('content-type') || '';
            const text = await response.text();

            if (contentType.includes('application/json') || url.endsWith('.json')) {
                try {
                    const data = JSON.parse(text);
                    if (data.files && Array.isArray(data.files)) {
                        cache.titles.set(`http-${url}`, { timestamp: Date.now(), files: data.files });
                        return res.json({ files: data.files });
                    }
                } catch (e) {
                    // Fallback to HTML scraping if JSON parse fails
                }
            }

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

app.get('/api/tmdb-discover', async (req, res) => {
    const { genre, decade, tmdbKey } = req.query;

    // Helper for JoBlo Fallback (Keyless)
    const fetchKeylessFallback = async (genreParam, decadeParam) => {
        const dParam = decadeParam || 'all';
        const now = Date.now();
        const isLatestRequest = (!genreParam || genreParam === 'all') && dParam === 'all';
        const isFutureRequest = dParam === 'future';
        const bucket = isFutureRequest ? 'future' : dParam;
        const lastScraped = movieCacheData.scraped[bucket] || 0;

        const needsUpdate = (movieCacheData.movies.length === 0) ||
            (now - lastScraped > MOVIE_SCRAPE_INTERVAL) ||
            (isLatestRequest && !movieCacheData.scraped['all']) ||
            (isFutureRequest && !movieCacheData.scraped['future']);

        if (needsUpdate) {
            console.log(`[Movie Proxy] ${movieCacheData.movies.length === 0 ? 'Fetching' : 'Refreshing'} JoBlo (Keyless) - Quality: High, Selection: ${isFutureRequest ? 'Future' : 'Last 5 Years'}`);

            const fetchPage = async (pageNumber, yearOverride) => {
                let url = "https://www.joblo.com/movie-posters/";
                if (pageNumber > 1) url += `page/${pageNumber}/`;

                if (yearOverride) {
                    url = `https://www.joblo.com/movie-posters/?movie_poster_year=${yearOverride}`;
                    if (pageNumber > 1) url += `&paged=${pageNumber}`;
                } else if (dParam !== 'all' && !isFutureRequest) {
                    const year = parseInt(dParam, 10) + 4;
                    url = `https://www.joblo.com/movie-posters/?movie_poster_year=${year}`;
                    if (pageNumber > 1) url += `&paged=${pageNumber}`;
                }

                const resp = await fetch(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                });

                if (!resp.ok) return [];
                const html = await resp.text();
                const found = [];

                const posterRegex = /<article[^>]*class="[^"]*poster[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"[\s\S]*?<h2><a[^>]*>([^<]+)<\/a><\/h2>/g;

                let match;
                while ((match = posterRegex.exec(html)) !== null) {
                    let posterUrl = match[1];
                    posterUrl = posterUrl.replace(/-[0-9]+x[0-9]+(\.[a-z0-9]+)$/i, '$1');

                    found.push({
                        id: `joblo-${Math.random().toString(36).substr(2, 5)}`,
                        title: match[2].trim().replace(/&#038;/g, '&'),
                        posterPath: posterUrl,
                        releaseDate: yearOverride ? yearOverride.toString() : (dParam !== 'all' ? dParam : 'Latest'),
                        source: 'joblo'
                    });
                }
                return found;
            };

            try {
                let allMovies = [];
                if (isFutureRequest) {
                    const [y2026, y2027] = await Promise.all([fetchPage(1, 2026), fetchPage(1, 2027)]);
                    allMovies = [...y2026, ...y2027];
                } else if (dParam !== 'all') {
                    // Try mid-decade, then start of decade if empty
                    const midYear = parseInt(dParam, 10) + 4;
                    const startYear = parseInt(dParam, 10);
                    allMovies = await fetchPage(1); // Try the heuristic first
                    if (allMovies.length < 5) {
                        const moreMovies = await fetchPage(1, startYear);
                        allMovies = [...allMovies, ...moreMovies];
                    }
                } else {
                    const [page1, page2] = await Promise.all([fetchPage(1), fetchPage(2)]);
                    allMovies = [...page1, ...page2];
                }

                const existingUrls = new Set(movieCacheData.movies.map(m => m.posterPath));
                const newToCache = [];
                let updatedCount = 0;

                for (const m of allMovies) {
                    if (existingUrls.has(m.posterPath)) {
                        const existing = movieCacheData.movies.find(ex => ex.posterPath === m.posterPath);
                        if (existing && existing.releaseDate === 'Latest' && m.releaseDate !== 'Latest') {
                            existing.releaseDate = m.releaseDate;
                            updatedCount++;
                        }
                    } else {
                        newToCache.push(m);
                    }
                }

                if (newToCache.length > 0 || updatedCount > 0) {
                    if (newToCache.length > 0) {
                        movieCacheData.movies = [...newToCache, ...movieCacheData.movies];
                    }

                    movieCacheData.scraped[bucket] = now;
                    movieCacheData.updated = now;

                    try {
                        writeFileSync(MOVIE_CACHE_FILE, JSON.stringify(movieCacheData, null, 2));
                        console.log(`[Movie Proxy] Evergreen Cache updated: ${newToCache.length} new, ${updatedCount} tags updated for [${bucket}]. Total: ${movieCacheData.movies.length}`);
                    } catch (e) {
                        console.error("[Movie Proxy] Failed to save evergreen cache:", e);
                    }
                } else {
                    movieCacheData.scraped[bucket] = now;
                    movieCacheData.updated = now;
                }
            } catch (err) {
                console.error("[Movie Proxy] JoBlo Scraping failed:", err);
            }
        } else {
            console.log(`[Movie Proxy] Using Evergreen Cache (${movieCacheData.movies.length} posters)`);
        }

        // FILTERING: Ensure we only return movies that match the requested decade or 'Latest'
        let filteredMovies = movieCacheData.movies;
        if (isFutureRequest) {
            filteredMovies = movieCacheData.movies.filter(m => m.releaseDate === '2026' || m.releaseDate === '2027');
        } else if (dParam !== 'all') {
            // Include 'Latest' in the 2020s bucket for better results
            filteredMovies = movieCacheData.movies.filter(m =>
                m.releaseDate === dParam ||
                (dParam === '2020' && m.releaseDate === 'Latest')
            );
        }

        return filteredMovies;
    };


    try {
        const logMsg = `[${new Date().toISOString()}] TMDb Request - Genre: ${genre}, Decade: ${decade}, Key: ${tmdbKey ? 'Yes' : 'No'}\n`;
        appendFileSync('/tmp/zulu7_debug.log', logMsg);
        if (!tmdbKey || tmdbKey.trim() === '') {
            const movies = await fetchKeylessFallback(genre, decade);
            appendFileSync('/tmp/zulu7_debug.log', `[${new Date().toISOString()}] Keyless Done - Found: ${movies.length}\n`);
            console.log(`[TMDb Discover API] Keyless Response - Found ${movies.length} movies.`);
            return res.json({ movies, mode: 'keyless' });
        }

        let url = `https://api.themoviedb.org/3/discover/movie?api_key=${tmdbKey}&sort_by=popularity.desc&include_adult=false&include_video=false&page=1`;

        if (genre && genre !== 'all') {
            url += `&with_genres=${genre}`;
        }

        if (decade) {
            const startYear = parseInt(decade, 10);
            if (!isNaN(startYear)) {
                url += `&primary_release_date.gte=${startYear}-01-01&primary_release_date.lte=${startYear + 9}-12-31`;
            }
        }

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Zulu7/1.0 (TheMovieDatabase Integration)'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[TMDb Proxy] API Error Status: ${response.status}`, errorText);

            // If key is invalid (401), try fallback instead of erroring
            if (response.status === 401) {
                console.warn("[TMDb Proxy] Invalid TMDb Key, attempting JoBlo fallback...");
                const movies = await fetchKeylessFallback(genre, decade);
                return res.json({ movies, mode: 'fallback' });
            }

            throw new Error(`TMDb API error: ${response.status}`);
        }

        const data = await response.json();
        // Return simplified list of posters
        const movies = (data.results || []).map(m => ({
            id: m.id,
            title: m.title,
            posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
            releaseDate: m.release_date,
            source: 'tmdb'
        })).filter(m => m.posterPath);

        console.log(`[TMDb Discover API] TMDb Success - Found ${movies.length} movies.`);
        res.json({ movies, mode: 'tmdb' });
    } catch (e) {
        console.error("[TMDb Proxy] Request Failed:", e.message);
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

// API: System Load History
app.get('/api/load-history', (req, res) => {
    res.json(systemLoadManager.getHistory());
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
// API: Docker Proxy (for Hawser)
app.get('/api/docker-proxy', async (req, res) => {
    const { target, path: apiPath } = req.query;
    if (!target) return res.status(400).json({ error: 'Missing target' });

    try {
        const baseUrl = target.startsWith('http') ? target : `http://${target}`;
        const queryParams = new URLSearchParams(req.query);
        queryParams.delete('target');
        queryParams.delete('path');

        const fullUrl = new URL(apiPath || '', baseUrl);
        queryParams.forEach((value, key) => fullUrl.searchParams.append(key, value));

        const response = await fetch(fullUrl.href, {
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error(`Docker Proxy Failed: ${response.status}`);
        const data = await response.json();
        res.json(data);
    } catch (e) {
        console.error("Docker Proxy Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Docker History
app.get('/api/docker-history', (req, res) => {
    const { host, containerId, metric } = req.query;
    if (!host || !containerId || !metric) return res.status(400).json({ error: 'Missing parameters' });

    const sig = dockerManager.register(host, containerId, metric);
    const history = dockerManager.getHistory(sig);

    res.json({
        signature: sig,
        history: history
    });
});


// API: Check Integration Status (Locked or Unlocked)
app.get('/api/integrations/status', async (req, res) => {
    try {
        const lockedPath = path.join(__dirname, 'integrations', '.locked');
        const isLocked = await fs.access(lockedPath).then(() => true).catch(() => false);
        res.json({ isLocked });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: List Integrations
app.get('/api/integrations', async (req, res) => {
    try {
        const integrationsDir = path.join(__dirname, 'integrations');
        const files = await fs.readdir(integrationsDir);
        const htmlFiles = files.filter(f => f.endsWith('.html'));
        res.json(htmlFiles);
    } catch (e) {
        console.error("[Integrations API] Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// API: Save Integration Content (Local Only)
app.post('/api/integration/save', express.json({ limit: '5mb' }), async (req, res) => {
    const host = req.headers.host || '';
    // Security lockdown for zulu7.net
    if (host.includes('zulu7.net')) {
        return res.status(403).json({ error: 'Editing is restricted on the production server.' });
    }

    const { filename, content } = req.body;
    if (!filename || !content) return res.status(400).json({ error: 'Missing filename or content.' });

    // Extra security: Global lockdown failsafe
    try {
        const lockedPath = path.join(__dirname, 'integrations', '.locked');
        const isLocked = await fs.access(lockedPath).then(() => true).catch(() => false);
        if (isLocked) {
            return res.status(403).json({ error: 'The integration editor is currently locked on this server.' });
        }
    } catch (e) {
        // Log but continue if there's a file access error other than "not found"
        console.warn("[Integration Editor] Lock check error:", e);
    }

    try {
        const safeFilename = path.basename(filename);
        const filePath = path.join(__dirname, 'integrations', safeFilename);

        // Final sanity check - must be within integrations dir
        if (!filePath.startsWith(path.join(__dirname, 'integrations'))) {
            throw new Error('Invalid path attempt detected.');
        }

        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[Integration Editor] Saved: ${safeFilename}`);
        res.json({ success: true });
    } catch (e) {
        console.error("[Integration Editor] Save Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Serve integrations with lock protection
app.use('/integrations', async (req, res, next) => {
    try {
        const lockedPath = path.join(__dirname, 'integrations', '.locked');
        const isLocked = await fs.access(lockedPath).then(() => true).catch(() => false);

        if (isLocked && req.path !== '/.locked' && path.extname(req.path) === '.html') {
            const filePath = path.join(__dirname, 'integrations', decodeURIComponent(req.path));
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                // Obfuscate all alphanumeric characters and some symbols
                const obfuscated = content.replace(/[a-zA-Z0-9]/g, '*');
                res.setHeader('Content-Type', 'text/html');
                return res.send(obfuscated);
            } catch (e) {
                // If file doesn't exist, let static handle it (404)
                return next();
            }
        }
    } catch (e) {
        console.error("[Integration Lock] Middleware Error:", e);
    }

    // Explicitly check if file exists in integrations directory to avoid SPA fallback
    const filePath = path.join(__dirname, 'integrations', decodeURIComponent(req.path));
    try {
        await fs.access(filePath);
        next();
    } catch (e) {
        res.status(404).send('Integration file not found');
    }
}, express.static(path.resolve('integrations')));
// --- INSTAGRAM INTEGRATION ---

// ------------------------------

// Fallback proxy for unmatched /api requests (Go2RTC backend routing)
// Placed at the end so local app.get routes take precedence
app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith('/api/') ||
        p.startsWith('/stream.html') ||
        p.startsWith('/video-stream.js') ||
        p.startsWith('/video-rtc.js') ||
        p.startsWith('/api/ws')) {
        return go2rtcProxy(req, res, next);
    }
    next();
});

// Serve static compiled UI correctly
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for SPA routing
// Using a middleware for reliability in Express 5
app.use((req, res, next) => {
    // Skip if it's an API, integrations, or has a file extension (static asset)
    if (req.path.startsWith('/api') ||
        req.path.startsWith('/integrations') ||
        path.extname(req.path)) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

// Explicitly handle WebSocket Upgrades for go2rtc
server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/api/ws')) {
        go2rtcProxy.upgrade(req, socket, head);
    }
});
