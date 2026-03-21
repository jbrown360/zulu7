import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { exec } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import snmp from 'net-snmp'
import arp from 'node-arp'
import multer from 'multer'

// --- Clipboard Storage configuration ---
const CLIPBOARD_DIR = path.resolve('data', 'clipboards');
if (!fs.existsSync(path.resolve('data'))) fs.mkdirSync(path.resolve('data'));
if (!fs.existsSync(CLIPBOARD_DIR)) fs.mkdirSync(CLIPBOARD_DIR);

const clipboardStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const urlStr = req.url;
        const match = urlStr.match(/^\/([^\/]+)\/upload/);
        const key = match ? match[1] : null;
        if (!key || !/^[a-zA-Z0-9_-]+$/.test(key)) {
            return cb(new Error("Invalid clipboard key"));
        }
        const dir = path.join(CLIPBOARD_DIR, key);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
        cb(null, safeName);
    }
});
const uploadLocal = multer({ storage: clipboardStorage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit
const uploadDemo = multer({ storage: clipboardStorage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// --- SNMP Persistence Manager ---
const SNMP_HISTORY_DIR = path.resolve('snmp_history');
if (!fs.existsSync(SNMP_HISTORY_DIR)) fs.mkdirSync(SNMP_HISTORY_DIR);

// --- Movie Poster Persistent Cache ---
const MOVIE_CACHE_FILE = path.resolve('movies_metadata.json');
const MOVIE_SCRAPE_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
let movieCacheData = { updated: 0, scraped: {}, movies: [] };

// Load cache on startup
try {
  if (fs.existsSync(MOVIE_CACHE_FILE)) {
    const loaded = JSON.parse(fs.readFileSync(MOVIE_CACHE_FILE, 'utf-8'));
    movieCacheData = { ...movieCacheData, ...loaded };
    if (!movieCacheData.scraped) movieCacheData.scraped = {};
    console.log(`[Vite Movie Cache] Loaded ${movieCacheData.movies.length} posters from disk.`);
  }
} catch (e) {
  console.error("[Vite Movie Cache] Error loading cache:", e);
}

class SnmpManager {
  constructor() {
    this.targets = new Map(); // signature -> { host, port, community, oid, version, lastActive, pollInterval }
    if (!process.argv.includes('build')) {
        this.pollTimer = setInterval(() => this.pollAll(), 60000); // Global poll every minute
    }
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
      console.log(`[SnmpManager] Registered new target: ${host} ${oid}`);
      // Immediate poll on first registration
      this.pollTarget(sig);
    } else {
      this.targets.get(sig).lastActive = Date.now();
    }
    return sig;
  }

  async pollAll() {
    const now = Date.now();
    for (const [sig, target] of this.targets.entries()) {
      // Auto-cleanup: stop polling if inactive for > 5 minutes
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
    const filePath = path.join(SNMP_HISTORY_DIR, `${sig}.json`);
    let history = [];
    try {
      if (fs.existsSync(filePath)) {
        history = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) { }

    const now = Date.now();
    history.push([now, value]);

    // 7-day retention (60 * 60 * 24 * 7 * 1000)
    const SEVEN_DAYS_MS = 604800000;
    const cutoff = now - SEVEN_DAYS_MS;
    history = history.filter(p => p[0] > cutoff);

    fs.writeFileSync(filePath, JSON.stringify(history));
  }

  getHistory(sig) {
    const filePath = path.join(SNMP_HISTORY_DIR, `${sig}.json`);
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      } catch (e) { return []; }
    }
    return [];
  }
}

// --- Docker Persistence Manager ---
const DOCKER_HISTORY_DIR = path.resolve('docker_history');
if (!fs.existsSync(DOCKER_HISTORY_DIR)) fs.mkdirSync(DOCKER_HISTORY_DIR);

class DockerManager {
  constructor() {
    this.targets = new Map(); // signature -> { host, containerId, metric, lastActive }
    this.lastStatsMap = new Map(); // signature -> stats
    if (!process.argv.includes('build')) {
        this.pollTimer = setInterval(() => this.pollAll(), 15000); // Background poll every 15s
    }
  }

  getSignature(host, containerId, metric) {
    return Buffer.from(`${host}:${containerId}:${metric}`).toString('base64').replace(/[/+=]/g, '_');
  }

  register(host, containerId, metric) {
    const sig = this.getSignature(host, containerId, metric);
    if (!this.targets.has(sig)) {
      this.targets.set(sig, { host, containerId, metric, lastActive: Date.now() });
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
        for (const iface in nets) total += isRx ? (nets[iface].rx_bytes || 0) : (nets[iface].tx_bytes || 0);
        if (lastStats) {
          const prevNets = lastStats.networks || lastStats.network || {};
          let prevTotal = 0;
          for (const iface in prevNets) prevTotal += isRx ? (prevNets[iface].rx_bytes || 0) : (prevNets[iface].tx_bytes || 0);
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
          entries.forEach(e => { if (e.op === key || e.op?.toLowerCase() === key.toLowerCase()) t += (e.value || 0); });
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
      console.error(`[DockerManager] Error: ${e.message}`);
    }
  }

  savePoint(sig, value) {
    const filePath = path.join(DOCKER_HISTORY_DIR, `${sig}.json`);
    let history = [];
    try {
      if (fs.existsSync(filePath)) history = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) { }
    const now = Date.now();
    history.push([now, value]);
    const limit = now - 604800000;
    history = history.filter(p => p[0] > limit).slice(-10000);
    fs.writeFileSync(filePath, JSON.stringify(history));
  }

  getHistory(sig) {
    const filePath = path.join(DOCKER_HISTORY_DIR, `${sig}.json`);
    if (fs.existsSync(filePath)) {
      try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
      catch (e) { return []; }
    }
    return [];
  }
}

// --- Speedtest Manager ---
const SPEEDTEST_HISTORY_DIR = path.resolve('speedtest_history');
if (!fs.existsSync(SPEEDTEST_HISTORY_DIR)) fs.mkdirSync(SPEEDTEST_HISTORY_DIR);

class SpeedtestManager {
  constructor() {
    this.historyFile = path.join(SPEEDTEST_HISTORY_DIR, 'results.json');
    this.pollInterval = 5 * 60 * 1000; // 5 mins default
    this.isTesting = false;
    
    // Clear any ghost timers from previous Vite HMR reloads to prevent Cloudflare rate-limiting/spam!
    if (global.__viteSpeedtestTimer) clearInterval(global.__viteSpeedtestTimer);
    
    if (!process.argv.includes('build')) {
        this.pollTimer = setInterval(() => this.runTest(), this.pollInterval);
        global.__viteSpeedtestTimer = this.pollTimer;
        // Delayed startup test
        setTimeout(() => this.runTest(), 10000);
    }
  }

  updateInterval(ms) {
    if (!ms || ms < 60000) ms = 60000; // Min 1 min
    console.log(`[Vite Speedtest] Updating interval to ${ms}ms`);
    this.pollInterval = ms;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (global.__viteSpeedtestTimer) clearInterval(global.__viteSpeedtestTimer);
    this.pollTimer = setInterval(() => this.runTest(), this.pollInterval);
    global.__viteSpeedtestTimer = this.pollTimer;
  }

  async runTest() {
    if (this.isTesting) return;
    this.isTesting = true;

    try {
      console.log("[Vite Speedtest] Running Python Speedtest-CLI measurement...");
      const resultStr = await new Promise((resolve, reject) => {
        exec('python3 utils/speedtest.py --json', { timeout: 90000 }, (err, stdout) => {
          if (err && !stdout) return reject(err);
          resolve(stdout);
        });
      });

      const parsed = JSON.parse(resultStr);
      const download = (parsed.download / 1000000) || 0;
      const upload = (parsed.upload / 1000000) || 0;
      const ping = parsed.ping || 0;

      console.log(`[Vite Speedtest] Success: Dn=${download.toFixed(2)}Mbps, Up=${upload.toFixed(2)}Mbps, Ping=${ping.toFixed(2)}ms`);

      let history = [];
      try {
        if (fs.existsSync(this.historyFile)) {
          history = JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
        }
      } catch (e) {}

      history.push({ timestamp: Date.now(), download, upload, ping });
      const CUTOFF = Date.now() - (24 * 60 * 60 * 1000);
      history = history.filter(p => p.timestamp > CUTOFF);
      
      try {
        fs.writeFileSync(this.historyFile, JSON.stringify(history));
      } catch (e) {
        console.error("[Vite Speedtest] Save Error:", e);
      }
    } catch (err) {
      console.error("[Vite Speedtest] Measurement failed:", err.message);
    } finally {
      this.isTesting = false;
    }
  }


  getHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        return JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
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
            if (fs.existsSync(MAC_VENDORS_OFFLINE_FILE)) {
                this.offlineDb = JSON.parse(fs.readFileSync(MAC_VENDORS_OFFLINE_FILE, 'utf-8'));
                console.log(`[MacVendorLookup] Loaded ${Object.keys(this.offlineDb).length} MAC vendors from offline database.`);
            }
        } catch (e) {
            console.warn(`[MacVendorLookup] Could not parse offline database:`, e.message);
        }

        // 2. Load the dynamic API cache for anything not in the IEEE db (e.g., dynamic lookups)
        try {
            if (fs.existsSync(MAC_VENDORS_CACHE_FILE)) {
                this.cache = JSON.parse(fs.readFileSync(MAC_VENDORS_CACHE_FILE, 'utf-8'));
                console.log(`[MacVendorLookup] Loaded ${Object.keys(this.cache).length} cached API MAC vendors.`);
            }
        } catch (e) {
            console.error("[MacVendorLookup] Error loading cache:", e);
        }
    }

    saveCache() {
        try {
            fs.writeFileSync(MAC_VENDORS_CACHE_FILE, JSON.stringify(this.cache));
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
            if (fs.existsSync(this.cacheFile)) {
                const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
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
            fs.writeFileSync(this.cacheFile, JSON.stringify(Array.from(this.cache.entries()), null, 2));
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
                    exec(`nmap -sn -n -T4 ${segment}`, { timeout: 60000 }, (error, stdout, stderr) => {
                        if (error) {
                            if (error.code === 127 || stderr.includes('not found')) {
                                rej(new Error('nmap not installed'));
                            } else {
                                res(stdout);
                            }
                        } else {
                            res(stdout);
                        }
                    });
                });

                const lines = nmapOutput.split('\n');
                let currentIP = null;

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];

                    const ipMatch = line.match(/Nmap scan report for (.+)/);
                    if (ipMatch) {
                        currentIP = ipMatch[1].trim();
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
                        for (let i = 1; i <= 254; i++) {
                            promises.push(new Promise(res => {
                                exec(`ping -c 1 -W 1 ${baseIP}${i}`, () => res());
                            }));
                        }
                        await Promise.allSettled(promises);
                    }
                }
            }

            // Read populated ARP cache
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

                        const activeStates = ['REACHABLE', 'DELAY', 'PROBE'];
                        if (!activeStates.includes(state)) continue;

                        discoveredDevices.push({ ip, mac });
                    }
                }

                const discoveredIds = new Set(discoveredDevices.map(d => d.mac));
                
                for (const [id, existing] of this.cache.entries()) {
                    existing.history = existing.history || Array(10).fill({ s: 1, t: now - 60000 });
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
                        
                        macVendorLookup.getVendor(dev.mac).then(vendor => {
                            const existing = this.cache.get(id);
                            if (existing) {
                                existing.vendor = vendor;
                                this.cache.set(id, existing);
                                this.addLog(`Vendor assigned to ${dev.ip}: ${vendor}`);
                            }
                        });

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
        const now = Date.now();
        for (const [id, dev] of this.cache.entries()) {
            if (dev.vendor === 'Unknown Vendor' || dev.vendor === 'Resolving...') {
                if (!dev.lastLookupAttempt || (now - dev.lastLookupAttempt) > 3600000) {
                    dev.lastLookupAttempt = now;
                    this.cache.set(id, dev);
                    
                    macVendorLookup.getVendor(dev.mac).then(vendor => {
                        const existing = this.cache.get(id);
                        if (existing && vendor !== 'Unknown Vendor') {
                            existing.vendor = vendor;
                            this.cache.set(id, existing);
                        }
                    }).catch(() => {});
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
            if (fs.existsSync(this.historyFile)) {
                history = JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
            }
        } catch (e) {}

        history.push(point);
        const CUTOFF = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
        history = history.filter(p => p.timestamp > CUTOFF);
        fs.writeFileSync(this.historyFile, JSON.stringify(history));
    }

    getHistory() {
        try {
            if (fs.existsSync(this.historyFile)) {
                return JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
            }
        } catch (e) {}
        return [];
    }
}

const dockerManager = new DockerManager();
const speedtestManager = new SpeedtestManager();
const systemLoadManager = new SystemLoadManager();
const snmpManager = new SnmpManager();
const networkManager = new NetworkScannerManager();

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
    {
      name: 'clipboard-proxy',
      configureServer(server) {
        server.middlewares.use('/api/clipboard', async (req, res, next) => {
            try {
                const urlStr = req.url; // e.g. "/mykey", "/mykey/upload", "/mykey/download/file.txt", "/mykey/file.txt"
                const urlObj = new URL(urlStr, `http://${req.headers.host || 'localhost'}`);
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                
                if (pathParts.length === 0) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: 'Missing key' }));
                }

                const key = pathParts[0];
                if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: 'Invalid key format' }));
                }

                const dir = path.join(CLIPBOARD_DIR, key);

                // POST /api/clipboard/:key/upload
                if (req.method === 'POST' && pathParts[1] === 'upload') {
                    const host = req.headers.host || '';
                    const uploader = host.includes('zulu7.net') ? uploadDemo : uploadLocal;
                    
                    return uploader.single('file')(req, res, (err) => {
                        if (err) {
                            res.statusCode = 400;
                            return res.end(JSON.stringify({ error: err.message }));
                        }
                        if (!req.file) {
                            res.statusCode = 400;
                            return res.end(JSON.stringify({ error: 'No file uploaded' }));
                        }
                        
                        res.setHeader('Content-Type', 'application/json');
                        res.end(JSON.stringify({ success: true, filename: req.file.filename, size: req.file.size }));
                    });
                }

                // GET /api/clipboard/:key/download/:filename
                if (req.method === 'GET' && pathParts[1] === 'download' && pathParts[2]) {
                    const filename = decodeURIComponent(pathParts[2]);
                    const safeFilename = path.basename(filename);
                    const filePath = path.join(dir, safeFilename);
                    if (!fs.existsSync(filePath)) {
                        res.statusCode = 404;
                        return res.end('File not found');
                    }
                    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
                    res.setHeader('Content-Type', 'application/octet-stream');
                    return fs.createReadStream(filePath).pipe(res);
                }

                // DELETE /api/clipboard/:key/:filename
                if (req.method === 'DELETE' && pathParts.length === 2 && pathParts[1] !== 'upload') {
                    const filename = decodeURIComponent(pathParts[1]);
                    const safeFilename = path.basename(filename);
                    const filePath = path.join(dir, safeFilename);
                    
                    if (!fs.existsSync(filePath)) {
                        res.statusCode = 404;
                        return res.end(JSON.stringify({ error: 'File not found' }));
                    }
                    await fs.promises.unlink(filePath);
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify({ success: true, message: 'File deleted' }));
                }

                // GET /api/clipboard/:key
                if (req.method === 'GET' && pathParts.length === 1) {
                    if (!fs.existsSync(dir)) {
                        res.setHeader('Content-Type', 'application/json');
                        return res.end(JSON.stringify({ files: [] }));
                    }
                    
                    const files = await fs.promises.readdir(dir);
                    const fileDetails = await Promise.all(files.map(async (file) => {
                        const filePath = path.join(dir, file);
                        const stats = await fs.promises.stat(filePath);
                        
                        let content = null;
                        let isSnippet = false;
                        
                        if (file.endsWith('.txt') && stats.size < 2048) {
                            try {
                                content = await fs.promises.readFile(filePath, 'utf-8');
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
                    
                    fileDetails.sort((a, b) => b.modified - a.modified);
                    res.setHeader('Content-Type', 'application/json');
                    return res.end(JSON.stringify({ files: fileDetails }));
                }

                // Fallback
                next();
            } catch (err) {
                console.error("Clipboard Proxy Error:", err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
        });
      }
    },
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
      name: 'docker-proxy',
      configureServer(server) {
        server.middlewares.use('/api/network-scan', async (req, res, next) => {
            try {
                const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                const segment = url.searchParams.get('segment') || '192.168.1.0/24';
                const interval = url.searchParams.get('interval');
                const force = url.searchParams.get('force');
                const pollInterval = interval ? parseInt(interval) * 60000 : 600000;
                
                const isFirstBoot = !networkManager.pollTimers.has(segment);
                networkManager.startScanning(segment, pollInterval);
                
                // Await if the user implicitly forced it OR if it's the very first cold boot and cache is empty, 
                // so the initial UI load doesn't hang at 0 devices for 60 seconds waiting for the next UI poll cycle.
                if (force === 'true' || (isFirstBoot && networkManager.cache.size === 0)) {
                    console.log(`[Vite NetworkManager] Awaiting ping sweep for segment ${segment}`);
                    await networkManager.scanSegment(segment, force === 'true');
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    devices: networkManager.getDevices(),
                    alertedIds: Array.from(networkManager.alertedIds)
                }));
            } catch (err) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
            }
        });

        server.middlewares.use('/api/network-alert', async (req, res, next) => {
            // Very basic body parser for the proxy middleware
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (Array.isArray(parsed.ids)) {
                        parsed.ids.forEach(id => networkManager.alertedIds.add(id));
                    }
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ error: "Invalid JSON" }));
                }
            });
        });

        server.middlewares.use('/api/network-verify-purge', async (req, res, next) => {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', async () => {
                try {
                    const parsed = JSON.parse(body);
                    const { ip, mac } = parsed;
                    if (!ip || !mac) {
                        res.statusCode = 400;
                        return res.end(JSON.stringify({ error: 'Missing ip or mac' }));
                    }
                    await new Promise((resolve) => {
                        exec(`ping -c 1 -W 1 ${ip}`, (error) => {
                            if (error) {
                                networkManager.cache.delete(mac);
                                networkManager.alertedIds.delete(mac);
                            } else {
                                const existing = networkManager.cache.get(mac);
                                if (existing) {
                                    existing.lastSeen = Date.now();
                                    if (Array.isArray(existing.history)) {
                                        existing.history.push(1);
                                    }
                                }
                                networkManager.alertedIds.delete(mac);
                            }
                            resolve();
                        });
                    });
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ success: true }));
                } catch (e) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
        });

        server.middlewares.use('/api/network-ping-device', async (req, res, next) => {
            try {
                const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
                let ip = url.searchParams.get('ip');
                let mac = url.searchParams.get('mac');
                if (!ip || !mac) {
                    res.statusCode = 400;
                    return res.end(JSON.stringify({ error: 'Missing ip or mac' }));
                }

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

                const existing = networkManager.cache.get(mac);
                if (existing && isOnline) {
                    existing.lastSeen = Date.now();
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ mac, s: isOnline ? 1 : 0, l: latency, t: Date.now() }));
            } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
            }
        });

        server.middlewares.use('/api/docker-proxy', async (req, res, next) => {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const target = url.searchParams.get('target');
            const apiPath = url.searchParams.get('path');

            if (!target) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing target' }));
              return;
            }

            const baseUrl = target.startsWith('http') ? target : `http://${target}`;
            const fullUrl = new URL(apiPath || '', baseUrl);

            url.searchParams.forEach((value, key) => {
              if (key !== 'target' && key !== 'path') {
                fullUrl.searchParams.append(key, value);
              }
            });

            const response = await fetch(fullUrl.href, {
              headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) throw new Error(`Docker Proxy Failed: ${response.status}`);
            const data = await response.json();
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
          } catch (error) {
            console.error("Docker Proxy Error:", error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        server.middlewares.use('/api/docker-history', async (req, res, next) => {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const host = url.searchParams.get('host');
            const containerId = url.searchParams.get('containerId');
            const metric = url.searchParams.get('metric');

            if (!host || !containerId || !metric) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing parameters' }));
              return;
            }

            const sig = dockerManager.register(host, containerId, metric);
            const history = dockerManager.getHistory(sig);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ signature: sig, history }));
          } catch (error) {
            console.error("Docker History Error:", error);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: error.message }));
          }
        });
        server.middlewares.use('/api/speedtest', async (req, res, next) => {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);

            // Set Interval
            if (url.pathname.includes('/setInterval')) {
              const ms = parseInt(url.searchParams.get('ms'));
              if (ms) speedtestManager.updateInterval(ms);
              res.end(JSON.stringify({ success: true, interval: speedtestManager.pollInterval }));
              return;
            }

            // Get Interval
            if (url.pathname.includes('/getInterval')) {
              res.end(JSON.stringify({ interval: speedtestManager.pollInterval }));
              return;
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(speedtestManager.getHistory()));
          } catch (error) {
            console.error("Speedtest API Error:", error);
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

                const contentType = response.headers.get('content-type') || '';
                const text = await response.text();

                if (contentType.includes('application/json') || targetUrlParam.endsWith('.json')) {
                  try {
                    const data = JSON.parse(text);
                    if (data.files && Array.isArray(data.files)) {
                      res.setHeader('Content-Type', 'application/json');
                      res.end(JSON.stringify({ files: data.files }));
                      return;
                    }
                  } catch (e) { }
                }
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
          } else if (req.method === 'GET' && req.url.startsWith('/api/tmdb-discover')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const genre = urlObj.searchParams.get('genre');
            const decade = urlObj.searchParams.get('decade');
            const tmdbKey = urlObj.searchParams.get('tmdbKey');

            try {
              async function fetchKeyless(genreParam, decadeParam) {
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
                  console.log(`[Vite Proxy] ${movieCacheData.movies.length === 0 ? 'Fetching' : 'Refreshing'} JoBlo (Keyless) - Quality: High, Selection: ${isFutureRequest ? 'Future' : 'Last 5 Years'} for bucket: ${bucket}`);

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
                    } else if (dParam && dParam !== 'all') {
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
                        fs.writeFileSync(MOVIE_CACHE_FILE, JSON.stringify(movieCacheData, null, 2));
                        console.log(`[Vite Proxy] Evergreen Cache updated: ${newToCache.length} new, ${updatedCount} tags updated for [${bucket}]. Total: ${movieCacheData.movies.length}`);
                      } catch (e) {
                        console.error("[Vite Proxy] Failed to save evergreen cache:", e);
                      }
                    } else {
                      movieCacheData.scraped[bucket] = now;
                      movieCacheData.updated = now;
                    }
                  } catch (err) {
                    console.error("[Vite Proxy] JoBlo Scraping failed:", err);
                  }
                } else {
                  console.log(`[Vite Proxy] Using Evergreen Cache (${movieCacheData.movies.length} posters)`);
                }

                // FILTERING
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
              }
              const logMsg = `[${new Date().toISOString()}] Vite TMDb Request - Genre: ${genre}, Decade: ${decade}, Key: ${tmdbKey ? 'Yes' : 'No'}\n`;
              fs.appendFileSync('/tmp/zulu7_debug.log', logMsg);
              if (!tmdbKey || tmdbKey.trim() === '') {
                const movies = await fetchKeyless(genre, decade);
                console.log(`[Vite TMDb Discover API] Keyless Response - Found ${movies.length} movies.`);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ movies, mode: 'keyless' }));
                return;
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
                  'User-Agent': 'Zulu7/1.0 (TheMovieDatabase Developer Proxy)'
                }
              });

              if (!response.ok) {
                const errorBody = await response.text();
                console.error(`[Vite TMDb Proxy] API Error: ${response.status}`, errorBody);

                if (response.status === 401) {
                  console.warn("[Vite Movie Proxy] Invalid Key, attempting JoBlo fallback...");
                  const movies = await fetchKeyless(genre, decade);
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ movies, mode: 'fallback' }));
                  return;
                }

                throw new Error(`TMDb API error: ${response.status}`);
              }

              const data = await response.json();
              const movies = (data.results || []).map(m => ({
                id: m.id,
                title: m.title,
                posterPath: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null,
                releaseDate: m.release_date,
                source: 'tmdb'
              })).filter(m => m.posterPath);

              console.log(`[Vite TMDb Proxy] Success: ${movies.length} movies for key ${tmdbKey.substring(0, 4)}...`);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ movies, mode: 'tmdb' }));
            } catch (err) {
              console.error("TMDb Proxy Error:", err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/load-history')) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(systemLoadManager.getHistory()));
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
          } else if (req.method === 'GET' && req.url.startsWith('/integrations/') && req.url.endsWith('.html') && !req.url.includes('.locked')) {
            try {
              const lockedPath = path.join(path.resolve('integrations'), '.locked');
              if (fs.existsSync(lockedPath)) {
                const fileName = path.basename(req.url.split('?')[0]);
                const filePath = path.join(path.resolve('integrations'), fileName);
                if (fs.existsSync(filePath)) {
                  const content = fs.readFileSync(filePath, 'utf-8');
                  // Obfuscate all alphanumeric characters
                  const obfuscated = content.replace(/[a-zA-Z0-9]/g, '*');
                  res.setHeader('Content-Type', 'text/html');
                  res.end(obfuscated);
                  return;
                }
              }
            } catch (e) {
              console.error("[Integration Lock] Dev Middleware Error:", e);
            }
            next();
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
          } else if (req.url.startsWith('/api/integration/save') && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
              try {
                const host = req.headers.host || '';
                if (host.includes('zulu7.net')) {
                  res.statusCode = 403;
                  res.end(JSON.stringify({ error: 'Editing restricted on production.' }));
                  return;
                }
                const { filename, content } = JSON.parse(body);

                // Extra security: Global lockdown failsafe
                const lockedPath = path.join(path.resolve('integrations'), '.locked');
                if (fs.existsSync(lockedPath)) {
                  res.statusCode = 403;
                  res.end(JSON.stringify({ error: 'The integration editor is currently locked on this server.' }));
                  return;
                }
                const safeFilename = path.basename(filename);
                const filePath = path.join(path.resolve('integrations'), safeFilename);
                fs.writeFileSync(filePath, content, 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (e) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else if (req.method === 'GET' && req.url.startsWith('/api/integrations/status')) {
            try {
              const lockedPath = path.join(path.resolve('integrations'), '.locked');
              const isLocked = fs.existsSync(lockedPath);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ isLocked }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/integrations')) {
            try {
              const integrationsDir = path.resolve('integrations');
              if (!fs.existsSync(integrationsDir)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify([]));
                return;
              }
              const files = fs.readdirSync(integrationsDir);
              const htmlFiles = files.filter(file => file.endsWith('.html'));
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(htmlFiles));
            } catch (e) {
              console.error("Integrations List Error:", e);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: e.message }));
            }
          } else if (req.method === 'GET' && req.url.startsWith('/api/snmp')) {
            const urlObj = new URL(req.url, `http://${req.headers.host}`);
            const host = urlObj.searchParams.get('host');
            const port = urlObj.searchParams.get('port');
            const community = urlObj.searchParams.get('community');
            const oid = urlObj.searchParams.get('oid');
            const version = urlObj.searchParams.get('version');

            if (!host || !oid) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Missing parameters' }));
              return;
            }

            // Register/Heartbeat and return full history
            const sig = snmpManager.register(host, port, community, oid, version);
            const history = snmpManager.getHistory(sig);

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              signature: sig,
              history: history
            }));
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

        // Explicit 404 for missing /integrations files to avoid SPA fallback
        server.middlewares.use('/integrations', async (req, res, next) => {
          const decodedUrl = decodeURIComponent(req.url.split('?')[0]);
          const filePath = path.join(process.cwd(), 'integrations', decodedUrl);
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end('Integration file not found');
            return;
          }
          next();
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
      '/api/fileshare': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true
      },
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
            req.url.startsWith('/api/docker-proxy') ||
            req.url.startsWith('/api/docker-history') ||
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
