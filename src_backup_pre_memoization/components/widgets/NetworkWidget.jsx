import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Router, Edit2, Check, X, ShieldAlert, ShieldCheck, Download, Upload, Siren, Search, RefreshCw, Terminal, Maximize, Activity } from 'lucide-react';

const NetworkWidget = ({ widget, isEditMode }) => {
    const [devices, setDevices] = useState([]);
    const [knownDevices, setKnownDevices] = useState({});
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [editingId, setEditingId] = useState(null);
    const [editName, setEditName] = useState('');
    const [filter, setFilter] = useState('all');
    const [isFilterSet, setIsFilterSet] = useState(false);
    const [lastScanTime, setLastScanTime] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showLogs, setShowLogs] = useState(false);
    const [logs, setLogs] = useState([]);
    const [hoveredDevice, setHoveredDevice] = useState(null);
    const [hoverMousePos, setHoverMousePos] = useState({ x: 0, y: 0 });
    const [graphDevice, setGraphDevice] = useState(null);

    const segmentStr = widget.value || '192.168.1.0/24';
    const parts = segmentStr.split('|');
    const segment = widget.config?.api_params?.segment || parts[0] || '192.168.1.0/24';
    const interval = widget.config?.api_params?.interval || parseInt(parts[1], 10) || 10;
    const displayName = widget.config?.displayName || parts[2] || 'What is on my Network?';

    const saveKnownDevices = async (newKnownData) => {
        try {
            localStorage.setItem('zulu7-network-scanner-known', JSON.stringify(newKnownData));
        } catch (e) {
            console.error("Failed to save known devices to localStorage:", e);
        }
    };

    useEffect(() => {
        const fetchKnown = async () => {
            try {
                let localData = {};
                const localStr = localStorage.getItem('zulu7-network-scanner-known');
                if (localStr) localData = JSON.parse(localStr);
                
                setKnownDevices(localData);
            } catch (err) {
                console.error("Failed to load known devices array from localStorage:", err);
            }
        };
        fetchKnown();
    }, []);

    const fetchDevices = async (force = false) => {
        try {
            const endpoint = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
                ? `http://${window.location.hostname}:8080/api/network-scan` 
                : '/api/network-scan';
            
            const res = await fetch(`${endpoint}?segment=${encodeURIComponent(segment)}&interval=${interval}${force ? '&force=true' : ''}&t=${Date.now()}`);
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            const data = await res.json();
            
            // The API now returns { devices: [], alertedIds: [] }
            const devArray = Array.isArray(data) ? data : (data.devices || []);
            setDevices(devArray);
            setLastScanTime(Date.now());
            setError('');
        } catch (err) {
            console.error(err);
            setError('Failed to fetch network data.');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDevices();
        const pollTimer = setInterval(() => fetchDevices(), 60000); // UI polls every 1 min
        return () => clearInterval(pollTimer);
    }, [segment, interval]);

    const fetchLogs = async () => {
        try {
            const endpoint = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
                ? `http://${window.location.hostname}:8080/api/network-logs` 
                : '/api/network-logs';
            const res = await fetch(`${endpoint}?t=${Date.now()}`);
            if (res.ok) {
                const data = await res.json();
                setLogs(data);
            }
        } catch (e) {
            console.error("Failed to fetch logs:", e);
        }
    };

    useEffect(() => {
        let logTimer;
        if (showLogs) {
            fetchLogs();
            logTimer = setInterval(fetchLogs, 2000); // Poll logs every 2 seconds when open
        }
        return () => clearInterval(logTimer);
    }, [showLogs]);

    useEffect(() => {
        let pingTimer;
        if (graphDevice) {
            const endpoint = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
                ? `http://${window.location.hostname}:8080/api/network-ping-device` 
                : '/api/network-ping-device';
            let isActive = true;
            
            const pingDevice = async () => {
                if (!isActive) return;
                try {
                    const res = await fetch(`${endpoint}?ip=${graphDevice.ip}&mac=${graphDevice.mac}`);
                    if (res.ok) {
                        const pingData = await res.json();
                        setGraphDevice(prev => {
                            if (!prev || prev.mac !== pingData.mac) return prev;
                            const activeHist = prev.fastHistory || [...(prev.history || [])];
                            const newHist = [...activeHist, pingData];
                            if (newHist.length > 60) newHist.shift();
                            return { ...prev, fastHistory: newHist };
                        });
                    }
                } catch (e) {
                    console.error("Failed to fast-ping device:", e);
                }
                
                if (isActive) {
                    pingTimer = setTimeout(pingDevice, 2000);
                }
            };
            
            pingTimer = setTimeout(pingDevice, 100);
            
            return () => {
                isActive = false;
                clearTimeout(pingTimer);
            };
        }
    }, [graphDevice?.id, graphDevice?.ip, graphDevice?.mac]);

    // Merge backend data with local storage 'known' explicitly whenever either changes
    const activeIds = new Set(devices.map(d => d.id));
    const mergedDevices = devices.map(d => {
        const knownMeta = knownDevices[d.id];
        if (knownMeta) {
            return { ...d, known: true, name: knownMeta.name, isOffline: false };
        }
        const isVendorKnown = d.vendor && d.vendor !== 'Unknown Vendor' && d.vendor !== 'Resolving...';
        const fallbackName = isVendorKnown ? `${d.vendor} Device` : `Unknown Device (${d.ip})`;
        return { ...d, known: false, name: fallbackName, isVendorKnown, isOffline: false };
    });

    Object.keys(knownDevices).forEach(id => {
        if (!activeIds.has(id)) {
            const kd = knownDevices[id];
            mergedDevices.push({
                mac: id,
                ip: 'Unknown IP',
                openPorts: [],
                ...kd,
                known: true,
                isOffline: true,
                history: [] // Offline devices have no current active history
            });
        }
    });

    const handleRemoveKnown = async (device) => {
        try {
            setIsLoading(true);
            const endpoint = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') 
                ? `http://${window.location.hostname}:8080/api/network-verify-purge` 
                : '/api/network-verify-purge';
            
            await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip: device.ip, mac: device.mac })
            }).catch(console.error);

            setKnownDevices(prev => {
                const next = { ...prev };
                delete next[device.id];
                saveKnownDevices(next);
                return next;
            });
            
            await fetchDevices(false);
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-update Known Devices history cache if their IP/ports change while active
    useEffect(() => {
        if (!devices || devices.length === 0) return;
        
        let changed = false;
        const updatedKnown = { ...knownDevices };
        
        devices.forEach(d => {
            if (updatedKnown[d.id]) {
                const kd = updatedKnown[d.id];
                const ipChanged = kd.ip !== d.ip;
                const portsStr1 = JSON.stringify(kd.openPorts || []);
                const portsStr2 = JSON.stringify(d.openPorts || []);
                const portsChanged = portsStr1 !== portsStr2;
                
                if (ipChanged || portsChanged) {
                    updatedKnown[d.id] = {
                        ...kd,
                        ip: d.ip,
                        mac: d.mac,
                        openPorts: d.openPorts,
                        vendor: d.vendor,
                        lastSeen: d.lastSeen
                    };
                    changed = true;
                }
            }
        });
        
        if (changed) {
            setKnownDevices(updatedKnown);
            saveKnownDevices(updatedKnown);
        }
    }, [devices]);

    const handleRename = async (id) => {
        try {
            const currentDevice = mergedDevices.find(d => d.id === id) || {};
            
            if (!editName.trim()) {
                setKnownDevices(prev => {
                    const next = { ...prev };
                    delete next[id];
                    saveKnownDevices(next);
                    return next;
                });
            } else {
                setKnownDevices(prev => {
                    const existing = prev[id] || {};
                    const next = {
                        ...prev,
                        [id]: { 
                            ...existing,
                            id: id,
                            mac: currentDevice.mac || existing.mac || id,
                            ip: currentDevice.ip || existing.ip || 'Unknown IP',
                            vendor: currentDevice.vendor || existing.vendor || 'Unknown Vendor',
                            openPorts: currentDevice.openPorts || existing.openPorts || [],
                            lastSeen: currentDevice.lastSeen || existing.lastSeen || Date.now(),
                            firstSeen: existing.firstSeen || currentDevice.firstSeen || Date.now(),
                            name: editName.trim()
                        }
                    };
                    saveKnownDevices(next);
                    return next;
                });
            }
        } catch (e) {
            console.error("Rename failed:", e);
        } finally {
            setEditingId(null);
        }
    };

    const startEdit = (device) => {
        setEditingId(device.id);
        setEditName(device.name);
    };

    const formatLastSeen = (ts) => {
        if (!ts) return 'Offline';
        const diff = Date.now() - ts;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        return `${Math.floor(diff / 3600000)}h ago`;
    };

    const ipToNum = (ip) => {
        if (!ip) return 0;
        return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
    };

    useEffect(() => {
        const handleFocus = (e) => {
            if (e.detail?.widgetId === widget.id) {
                setShowLogs(false);
                // Instantly re-acquire the latest cache from the backend to match the background monitor!
                fetchDevices(false);
            }
        };
        window.addEventListener('focus-widget', handleFocus);
        return () => window.removeEventListener('focus-widget', handleFocus);
    }, [widget.id, segment, interval]);

    const handleExport = () => {
        const dataStr = JSON.stringify(knownDevices, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `network_devices_${Date.now()}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const handleImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                // Basic validation
                if (typeof importedData === 'object' && importedData !== null) {
                    setKnownDevices(prev => {
                        const next = { ...prev, ...importedData };
                        saveKnownDevices(next);
                        return next;
                    });
                } else {
                    alert("Invalid file format");
                }
            } catch (err) {
                console.error("Failed to parse import file", err);
                alert("Failed to parse imported JSON file");
            }
        };
        reader.readAsText(file);
        
        // Reset the input so the same file can be selected again
        e.target.value = null;
    };

    const sortedDevices = [...mergedDevices].sort((a, b) => {
        // Unknown devices (d.known = false) should come before Known devices (d.known = true)
        if (a.known !== b.known) {
            return a.known ? 1 : -1;
        }
        // If they have the same known status, sort numerically by IP address
        return ipToNum(a.ip) - ipToNum(b.ip);
    });
    
    const activeCount = sortedDevices.filter(d => !d.isOffline).length;
    const knownCount = sortedDevices.filter(d => d.known).length;
    const unknownCount = sortedDevices.filter(d => !d.known && !d.isOffline).length;

    useEffect(() => {
        if (!isLoading && !isFilterSet) {
            // Default to showing all devices on load instead of hiding known devices
            setIsFilterSet(true);
        }
    }, [isLoading, isFilterSet]);

    const displayedDevices = sortedDevices.filter(d => {
        if (filter === 'all' && d.isOffline) return false;
        if (filter === 'known' && !d.known) return false;
        if (filter === 'unknown' && d.known) return false;
        
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const nameMatch = d.name?.toLowerCase().includes(query);
            const ipMatch = d.ip?.toLowerCase().includes(query);
            const macMatch = d.mac?.toLowerCase().includes(query);
            if (!nameMatch && !ipMatch && !macMatch) return false;
        }
        
        return true;
    });

    return (
        <div className={`widget-container h-full p-4 flex flex-col relative overflow-hidden transition-colors duration-500
            ${unknownCount > 0 ? 'bg-rose-950/40 ring-1 ring-red-500/50' : (widget.config?.color || 'bg-slate-800')}
        `}>
            {/* Background Siren Glow */}
            {unknownCount > 0 ? (
                <div className="absolute top-0 left-0 w-64 h-64 blur-[60px] rounded-full animate-siren-intense pointer-events-none z-0 -translate-x-1/2 -translate-y-1/2 opacity-40" />
            ) : null}

            <div className="mb-3 shrink-0 relative z-10">
                <h3 className="widget-title flex items-center justify-between group flex-wrap">
                    <div className="flex items-center gap-3">
                        <span className={`flex items-center gap-2 ${unknownCount > 0 ? 'text-orange-500' : 'text-orange-500/90'}`}>
                            <Router size={18} />
                            <span className="truncate max-w-[120px] 2xl:max-w-max hidden xsm:inline-block" title={displayName}>{displayName}</span>
                        </span>
                        
                        {/* Inline Controls Row */}
                        <div className="flex gap-1.5 text-[10px] items-center text-slate-400">
                            <span className="opacity-30 mx-1 hidden sm:inline-block">|</span>
                            <button 
                                onClick={() => { setFilter('all'); setShowLogs(false); }}
                                className={`px-2 py-1 rounded border font-bold tracking-wider transition-colors cursor-pointer ${filter === 'all' && !showLogs ? 'bg-blue-500/20 text-blue-400 border-blue-500/50' : 'bg-slate-800/50 text-slate-500 border-slate-700 hover:text-slate-300'}`}
                            >
                                {activeCount} ACTIVE
                            </button>
                            <button 
                                onClick={() => { setFilter('unknown'); setShowLogs(false); }}
                                className={`px-2 py-1 rounded border font-bold tracking-wider transition-colors cursor-pointer ${filter === 'unknown' && !showLogs ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'bg-slate-800/50 text-slate-500 border-slate-700 hover:text-slate-300'}`}
                            >
                                {unknownCount} UNKNOWN
                            </button>
                            <button 
                                onClick={() => { setFilter('known'); setShowLogs(false); }}
                                className={`px-2 py-1 rounded border font-bold tracking-wider transition-colors cursor-pointer ${filter === 'known' && !showLogs ? 'bg-green-500/20 text-green-400 border-green-500/50' : 'bg-slate-800/50 text-slate-500 border-slate-700 hover:text-slate-300'}`}
                            >
                                {knownCount} KNOWN
                            </button>
                            <button 
                                onClick={() => setShowLogs(true)}
                                className={`font-mono px-2 py-1 ml-0.5 rounded border transition-colors flex items-center gap-1.5 ${showLogs ? 'bg-black text-white border-slate-600' : 'bg-black/40 text-slate-400 border-white/5 hover:bg-black/60 hover:text-white'}`}
                                title="View Scanner Logs"
                            >
                                {segment}
                            </button>
                            
                            {/* Search Bar */}
                            <div className="relative ml-2 flex items-center group/search">
                                <Search className="absolute left-2 text-slate-500 z-10 pointer-events-none" size={12} />
                                <input 
                                    type="text"
                                    placeholder="Find..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="bg-black/30 border border-slate-700/50 rounded pl-6 pr-6 py-1 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all w-20 focus:w-40 relative z-0"
                                />
                                {searchQuery && (
                                    <button 
                                        type="button"
                                        onMouseDown={(e) => { e.preventDefault(); setSearchQuery(''); }}
                                        onClick={(e) => { e.preventDefault(); setSearchQuery(''); }}
                                        className="absolute right-1 text-slate-500 hover:text-slate-300 transition-colors z-[100] cursor-pointer"
                                        title="Clear Search"
                                    >
                                        <X size={12} className="cursor-pointer" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity ml-auto pl-2">
                        {lastScanTime && (
                            <span className="text-[10px] text-slate-400 font-mono mr-1 hidden sm:inline-block">
                                Last: {new Date(lastScanTime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                        <button 
                            onClick={() => {
                                setIsLoading(true);
                                fetchDevices(true);
                            }}
                            disabled={isLoading}
                            className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors disabled:opacity-50 cursor-pointer"
                            title="Force Refresh Scan"
                        >
                            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <label className="cursor-pointer p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors" title="Import Devices">
                            <Upload size={12} />
                            <input 
                                type="file" 
                                accept=".json" 
                                className="hidden" 
                                onChange={handleImport}
                            />
                        </label>
                        <button 
                            onClick={handleExport}
                            className="p-1 rounded hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors cursor-pointer"
                            title="Export Devices"
                        >
                            <Download size={12} />
                        </button>
                    </div>
                </h3>
            </div>

            {error && <div className="text-red-400 text-sm mb-2 shrink-0 relative z-10">{error}</div>}
            {isLoading && <div className="text-slate-400 text-sm animate-pulse shrink-0 relative z-10">Scanning network...</div>}

            {!showLogs ? (
                <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar min-h-0 relative z-10">
                {displayedDevices.map(device => {
                    const isUnknown = !device.known;
                    return (
                        <div 
                            key={device.id} 
                            onMouseMove={(e) => {
                                setHoverMousePos({ x: e.clientX, y: e.clientY });
                                setHoveredDevice(device);
                            }}
                            onMouseLeave={() => setHoveredDevice(null)}
                            onClick={() => setGraphDevice(device)}
                            className={`flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                                isUnknown 
                                ? 'bg-red-950/40 border-red-500/50 hover:bg-red-900/40' 
                                : 'bg-slate-900/40 border-green-500/30 hover:bg-slate-800/60'
                            }`}
                        >
                            <div className="flex items-center gap-3 overflow-hidden">
                                {isUnknown ? (
                                    <div className="relative flex h-3 w-3">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                                    </div>
                                ) : device.isOffline ? (
                                    <ShieldCheck size={16} className="text-red-500 shrink-0" />
                                ) : (
                                    <ShieldCheck size={16} className="text-green-500 shrink-0" />
                                )}
                                
                                <div className="flex flex-col overflow-hidden">
                                    {editingId === device.id && !isEditMode ? (
                                        <div className="flex flex-col gap-2">
                                            <div className="flex items-center gap-2">
                                                <input 
                                                    autoFocus
                                                    type="text" 
                                                    value={editName}
                                                    onChange={e => setEditName(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleRename(device.id)}
                                                    className="bg-black/50 text-white text-sm rounded px-2 py-1 border border-slate-600 focus:border-blue-500 focus:outline-none w-full"
                                                    placeholder="Device name..."
                                                />
                                                <button onClick={(e) => { e.stopPropagation(); handleRename(device.id); }} className="text-green-400 hover:text-green-300">
                                                    <Check size={16} />
                                                </button>
                                                <button onClick={(e) => { e.stopPropagation(); setEditingId(null); }} className="text-red-400 hover:text-red-300">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <span className={`font-semibold truncate ${isUnknown ? 'text-red-400' : 'text-slate-200'}`}>
                                                {device.name}
                                            </span>
                                            {!isEditMode && (
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); startEdit(device); }} 
                                                    className="text-slate-500 hover:text-white transition-colors"
                                                    title="Rename Device"
                                                >
                                                    <Edit2 size={12} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2 text-xs text-slate-400 font-mono mt-0.5">
                                        <span>{device.ip}</span>
                                        <span className="text-slate-600 text-[10px]">•</span>
                                        <span className="truncate">{device.mac}</span>
                                        {device.vendor && device.vendor !== 'Unknown Vendor' && (
                                            <>
                                                <span className="text-slate-600 text-[10px]">•</span>
                                                <span className="truncate text-slate-300 px-1.5 py-0.5 rounded bg-black/30 border border-white/5">{device.vendor}</span>
                                            </>
                                        )}
                                    </div>
                                    {device.openPorts && device.openPorts.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                                            <span className={`text-[10px] font-semibold mr-1 ${isUnknown ? 'text-red-400' : 'text-slate-500'}`}>OPEN PORTS:</span>
                                            {device.openPorts.map(p => (
                                                <span key={p} className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${isUnknown ? 'bg-red-500/10 text-red-300 border-red-500/20' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                                                    {p}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                </div>
                            </div>

                            <div className="text-right flex flex-col items-end">
                                <div className="flex items-center gap-1">
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${isUnknown ? 'bg-red-500/20 text-red-400' : device.isOffline ? 'bg-slate-800/50 text-slate-500' : 'text-slate-500'}`}>
                                        {isUnknown ? 'NEW' : device.isOffline ? 'OFFLINE' : 'KNOWN'}
                                    </span>
                                    {!isUnknown && !isEditMode && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleRemoveKnown(device); }}
                                            className="text-slate-600 hover:text-red-400 transition-colors p-0.5"
                                            title="Remove from Known Devices"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                                <span className="text-[10px] text-slate-500 mt-1 whitespace-nowrap">
                                    {formatLastSeen(device.lastSeen)}
                                </span>
                            </div>
                        </div>
                    );
                })}
                {displayedDevices.length === 0 && !isLoading && !error && (
                    <div className="text-slate-500 text-sm italic text-center py-4 relative z-10">
                        No {filter !== 'all' ? filter : ''} devices found
                    </div>
                )}
                </div>
            ) : (
                <div className="flex-1 flex flex-col bg-slate-900/80 rounded border border-slate-700/50 relative z-10 min-h-0 overflow-hidden mt-1">
                    <div className="flex-1 overflow-y-auto p-3 custom-scrollbar font-mono text-sm sm:text-base">
                        {logs.length === 0 ? (
                            <div className="text-slate-500 italic">No logs available.</div>
                        ) : (
                            <div className="flex flex-col gap-1">
                                {logs.map((log, i) => (
                                    <div key={i} className={`py-0.5 border-b border-white/5 ${log.toLowerCase().includes('error') || log.toLowerCase().includes('fail') ? 'text-red-400' : 'text-slate-300'}`}>
                                        {log}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {hoveredDevice && createPortal(
                <div 
                    className="fixed z-[999999] bg-slate-900/95 backdrop-blur-md border border-slate-600 rounded-xl p-4 shadow-2xl shadow-black pointer-events-none w-[320px] flex flex-col gap-2 animate-in fade-in zoom-in-95 duration-100"
                    style={{ 
                        left: Math.min(hoverMousePos.x + 15, window.innerWidth - 340), 
                        top: Math.min(hoverMousePos.y + 15, window.innerHeight - 300) 
                    }}
                >
                    <h3 className="font-bold text-white text-sm truncate">{hoveredDevice.name}</h3>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <span className="text-slate-500 text-right font-semibold">IP</span>
                        <span className="text-slate-300 font-mono">{hoveredDevice.ip}</span>
                        <span className="text-slate-500 text-right font-semibold">MAC</span>
                        <span className="text-slate-300 font-mono">{hoveredDevice.mac}</span>
                        <span className="text-slate-500 text-right font-semibold">Vendor</span>
                        <span className="text-slate-300 truncate">{hoveredDevice.vendor || 'Unknown'}</span>
                        <span className="text-slate-500 text-right font-semibold">Status</span>
                        <span>
                            {!hoveredDevice.known ? <span className="text-red-400 font-bold">Unknown</span> : hoveredDevice.isOffline ? <span className="text-slate-400 font-bold">Known (Offline)</span> : <span className="text-green-400 font-bold">Known (Active)</span>}
                        </span>
                        <span className="text-slate-500 text-right font-semibold">First Seen</span>
                        <span className="text-slate-300">{new Date(hoveredDevice.firstSeen).toLocaleString()}</span>
                        <span className="text-slate-500 text-right font-semibold">Last Seen</span>
                        <span className="text-slate-300">{new Date(hoveredDevice.lastSeen).toLocaleString()}</span>
                    </div>
                    {hoveredDevice.openPorts && hoveredDevice.openPorts.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-700/50">
                            <div className="text-[10px] text-slate-500 mb-1.5 font-bold">OPEN PORTS ({hoveredDevice.openPorts.length})</div>
                            <div className="flex flex-wrap gap-1">
                                {hoveredDevice.openPorts.map(p => (
                                    <span key={p} className="text-[10px] bg-slate-800 border border-slate-600 rounded px-1.5 py-0.5 text-slate-300 font-mono">{p}</span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>,
                document.body
            )}

            {graphDevice && createPortal(
                <div className="fixed inset-0 z-[9999999] bg-black/95 backdrop-blur-xl flex flex-col p-4 sm:p-8 animate-in fade-in zoom-in-95 duration-300">
                    <div className="flex items-center justify-between mb-8 shrink-0">
                        <div className="flex flex-col">
                            <h2 className="text-3xl font-light text-white flex items-center gap-4">
                                <Activity size={28} className="text-blue-500" /> {graphDevice.name}
                            </h2>
                            <span className="text-slate-400 text-lg mt-2 font-mono">{graphDevice.ip}</span>
                        </div>
                        <button onClick={() => setGraphDevice(null)} className="absolute top-4 right-4 sm:top-8 sm:right-8 p-1 text-slate-400 hover:text-white transition-colors cursor-pointer">
                            <X size={28} />
                        </button>
                    </div>

                    <div className="flex-1 flex flex-col justify-end relative mt-8 border-b border-white/10 pb-4 min-h-0">
                        <div className="absolute left-0 top-8 bottom-4 flex flex-col text-[10px] text-slate-500 w-16 font-mono pointer-events-none z-0">
                            <span className="absolute top-[10%] -translate-y-1/2">20ms+</span>
                            <span className="absolute top-[45%] -translate-y-1/2">10ms</span>
                            <span className="absolute top-[80%] -translate-y-1/2">0ms</span>
                            <span className="absolute top-[95%] -translate-y-1/2 text-red-500/50 uppercase font-bold tracking-widest text-[9px]">Offline</span>
                            
                            <div className="absolute top-[10%] left-16 w-[calc(100vw-8rem)] h-[1px] bg-slate-700/30" />
                            <div className="absolute top-[45%] left-16 w-[calc(100vw-8rem)] h-[1px] bg-slate-700/30" />
                            <div className="absolute top-[80%] left-16 w-[calc(100vw-8rem)] h-[1px] bg-slate-700/30" />
                            <div className="absolute top-[95%] left-16 w-[calc(100vw-8rem)] h-[1px] bg-red-900/20" />
                        </div>
                        
                        <div className="flex items-end h-full w-full pl-16 overflow-visible relative pt-8">
                            {/* SVG Step Line Chart */}
                            <svg className="absolute inset-0 left-16 w-[calc(100%-4rem)] h-[calc(100%-2rem)] overflow-visible pointer-events-none mt-8" viewBox="0 0 100 100" preserveAspectRatio="none">
                                <path 
                                    d={(() => {
                                        const activeHistory = graphDevice.fastHistory || graphDevice.history || [];
                                        const hist = [...activeHistory];
                                        
                                        const maxN = 60;
                                        const paddingCount = Math.max(0, maxN - hist.length);
                                        if (hist.length === 0) return '';
                                        let path = '';
                                        hist.forEach((item, i) => {
                                            const status = typeof item === 'object' ? item.s : item;
                                            const latency = typeof item === 'object' && item.l != null ? item.l : 1;
                                            const effectiveI = i + paddingCount;
                                            const x = ((effectiveI + 0.5) / maxN) * 100;
                                            let y = 95;
                                            if (status) {
                                                const clamped = Math.min(Math.max(latency, 0), 20);
                                                y = 80 - ((clamped / 20) * 70);  
                                            }
                                            if (i === 0) {
                                                path += `M ${x} ${y} `;
                                            } else {
                                                path += `L ${x} ${y} `;
                                            }
                                        });
                                        return path;
                                    })()}
                                    fill="none"
                                    stroke="#3b82f6"
                                    vectorEffect="non-scaling-stroke"
                                    strokeWidth="3"
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                    className="drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                                />
                            </svg>

                            {/* Hit-zones and Interactive Hover Overlay Points */}
                            {Array.from({ length: Math.max(0, 60 - ((graphDevice.fastHistory || graphDevice.history)?.length || 0)) }).map((_, i) => (
                                <div key={`empty-${i}`} className="flex-1 h-full min-w-[3px]" />
                            ))}
                            {(graphDevice.fastHistory || graphDevice.history) && (graphDevice.fastHistory || graphDevice.history).map((item, i) => {
                                const status = typeof item === 'object' ? item.s : item;
                                const latency = typeof item === 'object' && item.l != null ? item.l : 1;
                                const time = typeof item === 'object' && item.t ? new Date(item.t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) : 'Unknown Time';
                                let yPercent = 95;
                                if (status) {
                                    const clamped = Math.min(Math.max(latency, 0), 20);
                                    yPercent = 80 - ((clamped / 20) * 70);
                                }
                                return (
                                    <div key={i} className="flex-1 flex flex-col justify-end items-center group/tooltip relative h-full min-w-[3px] z-10 cursor-crosshair">
                                        <div className="absolute opacity-0 group-hover/tooltip:opacity-100 transition-opacity inset-0 flex flex-col items-center justify-end pointer-events-none">
                                            {/* Vertical crosshair line */}
                                            <div className="w-[1px] h-full bg-white/20 relative" />
                                            {/* Glowing indicator dot */}
                                            <div className={`absolute w-3 h-3 rounded-full shadow-[0_0_12px_rgba(255,255,255,0.5)] ${status ? 'bg-green-400' : 'bg-red-400'}`} style={{ top: `${yPercent}%`, transform: 'translateY(-50%)' }} />
                                            {/* Floating text tooltip securely centered inside the graph bounds */}
                                            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] whitespace-nowrap bg-slate-900 border border-slate-700 text-white text-sm px-3 py-1.5 rounded-lg shadow-xl mb-4">
                                                <span className={status ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{status ? `${latency < 1 ? latency.toFixed(2) : latency.toFixed(1)}ms` : 'Offline'}</span>
                                                <span className="text-slate-400 ml-2 font-mono">{time}</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className="flex justify-between text-[10px] text-slate-500 mt-4 pl-16 w-full font-mono">
                            <span>{(() => {
                                const hist = graphDevice.fastHistory || graphDevice.history;
                                if (!hist || hist.length === 0) return 'Older';
                                const item = hist[0];
                                const t = typeof item === 'object' ? item.t : null;
                                return t ? new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) : 'Older';
                            })()}</span>
                            <span>{(() => {
                                const hist = graphDevice.fastHistory || graphDevice.history;
                                if (!hist || hist.length === 0) return 'Now';
                                const item = hist[hist.length - 1];
                                const t = typeof item === 'object' ? item.t : null;
                                return t ? new Date(t).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}) : 'Now';
                            })()}</span>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            
            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes siren-intense {
                    0%, 25% { background-color: rgba(239, 68, 68, 0.8); filter: blur(60px); transform: translate(-50%, -50%) scale(1); }
                    30%, 75% { background-color: rgba(0, 71, 255, 0.8); filter: blur(80px); transform: translate(-45%, -45%) scale(1.4); }
                    80%, 100% { background-color: rgba(239, 68, 68, 0.8); filter: blur(60px); transform: translate(-50%, -50%) scale(1); }
                }
                .animate-siren-intense { animation: siren-intense 0.8s steps(10) infinite; }
            `}} />
        </div>
    );
};

export default NetworkWidget;
