import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Save, Trash2, Download, Upload, Monitor, Play, Pause, Layout, Video, Copy, Check, RefreshCw, Server, Clock, Image, Lock, Activity, PlusCircle, SlidersHorizontal, Database, Home, Globe, Key, Share2, Loader2, FileDown, FileUp, GripVertical, Timer, Zap } from 'lucide-react';
import { STORAGE_KEYS, DEFAULTS } from '../utils/constants';

const SettingsModal = ({ isOpen, onClose, onSave, initialSettings, activeTab, setActiveTab, activeWorkspace }) => {
    // Debug wrapper for onClose
    const handleClose = useCallback(() => {
        console.trace("SettingsModal onClose called");
        onClose();
    }, [onClose]);
    const [labName, setLabName] = useState('Zulu7');
    const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
    const [finnhubKey, setFinnhubKey] = useState('');
    const [googleApiKey, setGoogleApiKey] = useState('');
    const [streamApiKey, setStreamApiKey] = useState('');

    // activeTab state lifted to parent

    // Legacy / Extra Settings
    const [bgImages, setBgImages] = useState('');
    const [slideshowInterval, setSlideshowInterval] = useState(60);
    const [isSlideshowEnabled, setIsSlideshowEnabled] = useState(false);

    // Rotation Settings
    const [workspaceRotationInterval, setWorkspaceRotationInterval] = useState(300);
    const [isWorkspaceRotationEnabled, setIsWorkspaceRotationEnabled] = useState(false);
    const [dashboardRotationSelection, setDashboardRotationSelection] = useState({}); // { 0: true, 1: false }
    const [dashboardNames, setDashboardNames] = useState({}); // { 0: "Custom Name", ... }
    const [editingNameIndex, setEditingNameIndex] = useState(null);
    const [dashboardOrder, setDashboardOrder] = useState([]); // [0, 1, 2, ... ]
    const [draggedItem, setDraggedItem] = useState(null);

    // Stream Management State
    const [streams, setStreams] = useState({});
    const [newStreamName, setNewStreamName] = useState('');
    const [newStreamUrl, setNewStreamUrl] = useState('');
    const [streamerUrl, setStreamerUrl] = useState(''); // Default to empty (proxy)
    const [streamLoading, setStreamLoading] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [publishedUrl, setPublishedUrl] = useState(null);
    const [publishScope, setPublishScope] = useState('full'); // 'full' or 'workspace'
    const [systemLoad, setSystemLoad] = useState(null);
    const isLocal = useMemo(() => {
        return window.location.hostname !== 'zulu7.net' && !window.location.hostname.endsWith('.zulu7.net');
    }, []);

    const fetchStreams = useCallback(async () => {
        setStreamLoading(true);
        try {
            const res = await fetch(`${streamerUrl}/api/streams`);
            if (res.ok) {
                const data = await res.json();
                setStreams(data || {});
            }
        } catch (err) {
            console.error("fetchStreams error:", err);
        } finally {
            setStreamLoading(false);
        }
    }, [streamerUrl]);

    useEffect(() => {
        if (isOpen && initialSettings) {
            setLabName(initialSettings.labName || 'Zulu7');
            setTimeZone(initialSettings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
            if (initialSettings.finnhubKey) setFinnhubKey(initialSettings.finnhubKey);
            if (initialSettings.googleApiKey) setGoogleApiKey(initialSettings.googleApiKey);
            if (initialSettings.streamApiKey) setStreamApiKey(initialSettings.streamApiKey);

            // Legacy settings load
            if (initialSettings.bgImages) setBgImages(initialSettings.bgImages.join('\n'));
            if (initialSettings.isSlideshowEnabled) setIsSlideshowEnabled(initialSettings.isSlideshowEnabled);
            setSlideshowInterval(initialSettings.slideshowInterval || 60);

            // Workspace Rotation Load
            if (initialSettings.isWorkspaceRotationEnabled) setIsWorkspaceRotationEnabled(initialSettings.isWorkspaceRotationEnabled);
            setWorkspaceRotationInterval(Math.max(10, initialSettings.workspaceRotationInterval || 300));
            setDashboardRotationSelection(initialSettings.dashboardRotationSelection || {});
            setDashboardNames(initialSettings.dashboardNames || {});

            // Initialize order based on current count
            const count = parseInt(localStorage.getItem(STORAGE_KEYS.WORKSPACE_COUNT) || '7', 10);
            setDashboardOrder(Array.from({ length: count }, (_, i) => i));


            // Load streamer URL from settings
            // If it exists (even empty string), use it. If undefined, default to ''
            if (initialSettings.streamerUrl !== undefined) {
                setStreamerUrl(initialSettings.streamerUrl);
            }
        }
        fetchStreams();
    }, [isOpen, initialSettings, fetchStreams]);

    // Handle Escape Key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                console.log("Escape key closed modal");
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // System Load Polling
    useEffect(() => {
        if (!isOpen || !isLocal) return;

        const fetchLoad = async () => {
            try {
                const res = await fetch('/api/system-load');
                if (res.ok) {
                    const data = await res.json();
                    setSystemLoad(data);
                }
            } catch (e) { console.error("Load fetch failed:", e); }
        };

        fetchLoad();
        const interval = setInterval(fetchLoad, 5000);
        return () => clearInterval(interval);
    }, [isOpen, isLocal]);

    // Track Changes to prevent accidental close
    const hasChanges = useMemo(() => {
        if (!initialSettings) return false;

        const currentBgImages = bgImages.split('\n').filter(url => url.trim() !== '');
        const initialBgImages = initialSettings.bgImages || [];

        // Simple comparison for arrays/objects
        const isBgDiff = JSON.stringify(currentBgImages) !== JSON.stringify(initialBgImages);
        const isRotationSelDiff = JSON.stringify(dashboardRotationSelection) !== JSON.stringify(initialSettings.dashboardRotationSelection || {});
        const isNamesDiff = JSON.stringify(dashboardNames) !== JSON.stringify(initialSettings.dashboardNames || {});

        // Check Order Change
        const isOrderDiff = dashboardOrder.some((val, idx) => val !== idx);

        return (
            labName !== (initialSettings.labName || 'Zulu7') ||
            timeZone !== (initialSettings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone) ||
            finnhubKey !== (initialSettings.finnhubKey || '') ||
            googleApiKey !== (initialSettings.googleApiKey || '') ||
            streamApiKey !== (initialSettings.streamApiKey || '') ||
            (streamerUrl || '') !== (initialSettings.streamerUrl || '') ||
            slideshowInterval != (initialSettings.slideshowInterval || 60) ||
            isSlideshowEnabled !== (initialSettings.isSlideshowEnabled || false) ||
            workspaceRotationInterval != (initialSettings.workspaceRotationInterval || 300) ||
            isWorkspaceRotationEnabled !== (initialSettings.isWorkspaceRotationEnabled || false) ||
            isBgDiff ||
            isRotationSelDiff ||
            isNamesDiff ||
            isOrderDiff
        );
    }, [
        initialSettings, labName, timeZone, finnhubKey, googleApiKey, streamApiKey, streamerUrl,
        slideshowInterval, isSlideshowEnabled, workspaceRotationInterval, isWorkspaceRotationEnabled,
        bgImages, dashboardRotationSelection, dashboardNames, dashboardOrder
    ]);

    // Handle Backdrop Click
    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget && !hasChanges) {
            handleClose();
        }
    };



    const copyToClipboard = (text, id) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                setCopiedId(id);
                setTimeout(() => setCopiedId(null), 2000);
            }).catch(err => {
                console.error('Async: Could not copy text: ', err);
                fallbackCopyTextToClipboard(text, id);
            });
        } else {
            fallbackCopyTextToClipboard(text, id);
        }
    };

    const fallbackCopyTextToClipboard = (text, id) => {
        var textArea = document.createElement("textarea");
        textArea.value = text;

        // Avoid scrolling to bottom
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            var successful = document.execCommand('copy');
            if (successful) {
                setCopiedId(id);
                setTimeout(() => setCopiedId(null), 2000);
            } else {
                console.error('Fallback: Unable to copy');
            }
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }

        document.body.removeChild(textArea);
    };

    const handleSelectAll = () => {
        const newSelection = { ...dashboardRotationSelection };
        dashboardOrder.forEach(idx => {
            newSelection[idx] = true;
        });
        setDashboardRotationSelection(newSelection);
    };

    const handleUnselectAll = () => {
        const newSelection = { ...dashboardRotationSelection };
        dashboardOrder.forEach(idx => {
            newSelection[idx] = false;
        });
        setDashboardRotationSelection(newSelection);
    };

    const handleSave = () => {
        const images = bgImages.split('\n').filter(url => url.trim() !== '');

        // Create mapped selection and names based on current order
        const mappedSelection = {};
        const mappedNames = {};
        dashboardOrder.forEach((originalIndex, newIndex) => {
            // New position 'newIndex' inherits the selection status and name of 'originalIndex'
            if (dashboardRotationSelection[originalIndex] !== undefined) {
                mappedSelection[newIndex] = dashboardRotationSelection[originalIndex];
            }
            if (dashboardNames[originalIndex]) {
                mappedNames[newIndex] = dashboardNames[originalIndex];
            }
        });

        onSave({
            labName,
            timeZone,
            finnhubKey,
            googleApiKey,
            streamApiKey,
            bgImages: images,
            slideshowInterval: Math.max(10, parseInt(slideshowInterval || 60, 10)),
            isSlideshowEnabled,
            workspaceRotationInterval: Math.max(10, parseInt(workspaceRotationInterval || 300, 10)),
            isWorkspaceRotationEnabled,
            dashboardRotationSelection: mappedSelection,
            dashboardNames: mappedNames,
            streamerUrl
        });

        // HANDLE REORDERING IF CHANGED
        const currentOrder = dashboardOrder;
        const isReordered = currentOrder.some((val, idx) => val !== idx);

        if (isReordered) {
            // We need to swap data in localStorage
            // 1. Load all data
            const allData = {};
            currentOrder.forEach((originalIndex) => {
                allData[originalIndex] = {
                    widgets: localStorage.getItem(STORAGE_KEYS.getWidgetKey(originalIndex)),
                    layout: localStorage.getItem(STORAGE_KEYS.getLayoutKey(originalIndex))
                };
            });

            // 2. Write back in new order
            currentOrder.forEach((originalIndex, newPosition) => {
                // The data for 'newPosition' should come from 'originalIndex'
                // Wait. currentOrder[newPosition] = originalIndex.
                // So at newPosition 0, we have originalIndex 3.
                // We want workspace 0 to NOW have the data of workspace 3.
                const data = allData[originalIndex];
                if (data) {
                    if (data.widgets) localStorage.setItem(STORAGE_KEYS.getWidgetKey(newPosition), data.widgets);
                    else localStorage.removeItem(STORAGE_KEYS.getWidgetKey(newPosition));

                    if (data.layout) localStorage.setItem(STORAGE_KEYS.getLayoutKey(newPosition), data.layout);
                    else localStorage.removeItem(STORAGE_KEYS.getLayoutKey(newPosition));
                }
            });

            // Force reload by dispatching event or relying on App re-render?
            // Since we save settings, App re-renders. But Zulu7Grid only loads on mount.
            // We need to force Zulu7Grid to reload. We can do this by updating a version key in settings?
            // Or just window.location.reload() (aggressive).
            // Better: update a 'layoutVersion' in settings to trigger effect in Zulu7Grid.
            // But I can't easily add a new setting field without updating App.jsx defaults.
            // I'll emit a custom event.
            window.dispatchEvent(new Event('zulu7-workspaces-reordered'));
        }
        handleClose();
    };

    const handleAddStream = async (e) => {
        if (e && e.preventDefault) {
            e.preventDefault();
            e.stopPropagation();
        }

        if (!newStreamName || !newStreamUrl) return;

        // Sanitize name (simple chars only)
        const safeName = newStreamName.replace(/[^a-zA-Z0-9_-]/g, '');
        // Prefix with API Key if available
        const finalName = streamApiKey ? `${streamApiKey}_${safeName}` : safeName;

        console.log("Attempting to add stream:", {
            rawName: newStreamName,
            safeName,
            apiKey: streamApiKey,
            finalName,
            url: newStreamUrl
        });

        try {
            // Go2RTC API: PUT /api/streams?src={url}&name={name}
            const res = await fetch(`${streamerUrl}/api/streams?src=${encodeURIComponent(newStreamUrl)}&name=${encodeURIComponent(finalName)}`, {
                method: 'PUT',
                redirect: 'manual' // Prevent following redirects which might cause reload
            });

            if (res.ok || res.status === 302 || res.status === 301 || res.status === 0) {
                console.log("Add Stream Success (Status: " + res.status + ")");
                setNewStreamName('');
                setNewStreamUrl('');
                fetchStreams();
                // Ensure modal stays open
            } else {
                const errText = await res.text();
                console.error("Add Stream Failed:", res.status, errText);
                alert(`Failed to add stream.Status: ${res.status}.Error: ${errText} `);
            }
        } catch (e) {
            console.error("Add Stream Error:", e);
            alert("Error connecting to streamer: " + e.message);
        }
    };

    const handleDeleteStream = async (name) => {
        if (!confirm(`Delete stream "${name}" ? `)) return;

        try {
            const res = await fetch(`${streamerUrl}/api/streams?src=${encodeURIComponent(name)}`, {
                method: 'DELETE',
                redirect: 'manual'
            });
            if (res.ok || res.status === 302 || res.status === 301 || res.status === 0) {
                console.log("Delete Stream Success (Status: " + res.status + ")");
                fetchStreams();
            }
        } catch (e) {
            console.error(e);
        }
    };


    const getDashboardConfig = useCallback((scopeOverride = null) => {
        const count = parseInt(localStorage.getItem(STORAGE_KEYS.WORKSPACE_COUNT) || '20', 10);

        const data = {
            version: "1.2", // Bumped version for isRestricted support
            timestamp: Date.now(),
            settings: {
                labName,
                timeZone,
                finnhubKey,
                googleApiKey,
                streamApiKey,
                bgImages: typeof bgImages === 'string' ? bgImages.split('\n').filter(url => url.trim() !== '') : bgImages,
                slideshowInterval: parseInt(slideshowInterval, 10),
                isSlideshowEnabled,
                workspaceRotationInterval: parseInt(workspaceRotationInterval, 10),
                isWorkspaceRotationEnabled,
                dashboardRotationSelection,
                dashboardNames, // Store custom names
                streamerUrl,
                activeWorkspace: activeWorkspace // Include current workspace in JSON
            },
            history: (() => {
                try {
                    const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_HISTORY);
                    return raw ? JSON.parse(raw) : [];
                } catch (e) { return []; }
            })(),
            targetWorkspace: activeWorkspace, // Embed the starting workspace ID directly
            workspaces: {}
        };

        const currentScope = scopeOverride || publishScope;
        const isRestricted = currentScope === 'workspace';
        if (isRestricted) {
            data.isRestricted = true;
            // Only include the active workspace, but NORMALIZE it to index 0
            const wKey = STORAGE_KEYS.getWidgetKey(activeWorkspace);
            const lKey = STORAGE_KEYS.getLayoutKey(activeWorkspace);
            const wVal = localStorage.getItem(wKey);
            const lVal = localStorage.getItem(lKey);

            data.workspaces = {
                [0]: {
                    widgets: wVal ? JSON.parse(wVal) : [],
                    layout: lVal ? JSON.parse(lVal) : []
                }
            };
            // Also restrict rotation/selection settings to just this one (at index 0)
            const currentName = dashboardNames[activeWorkspace] || `Dashboard #${activeWorkspace + 1}`;
            data.settings.dashboardNames = { [0]: currentName };
            data.settings.dashboardRotationSelection = { [0]: true };
            data.settings.activeWorkspace = 0;
        } else {
            // Gather all workspaces (dynamic count)
            for (let i = 0; i < count; i++) {
                const wKey = STORAGE_KEYS.getWidgetKey(i);
                const lKey = STORAGE_KEYS.getLayoutKey(i);
                const wVal = localStorage.getItem(wKey);
                const lVal = localStorage.getItem(lKey);

                if (wVal || lVal) {
                    data.workspaces[i] = {
                        widgets: wVal ? JSON.parse(wVal) : [],
                        layout: lVal ? JSON.parse(lVal) : []
                    };
                }
            }
        }
        return data;
    }, [labName, timeZone, finnhubKey, googleApiKey, streamApiKey, bgImages, slideshowInterval, isSlideshowEnabled, workspaceRotationInterval, isWorkspaceRotationEnabled, dashboardRotationSelection, dashboardNames, streamerUrl, activeWorkspace, publishScope]);

    const handleExport = () => {
        const data = getDashboardConfig();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `zulu7-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handlePublish = useCallback(async (scopeOverride = null) => {
        setIsPublishing(true);
        setPublishedUrl(null);
        try {
            const currentScope = scopeOverride || publishScope;
            const config = getDashboardConfig(currentScope);

            const res = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });

            if (!res.ok) throw new Error(`Server returned ${res.status}`);

            const data = await res.json();
            if (data.success && data.url) {
                const fullUrl = `${window.location.protocol}//${window.location.host}${data.url}`;
                setPublishedUrl(fullUrl);
            } else {
                throw new Error(data.error || "Unknown error");
            }
        } catch (e) {
            console.error("Publish failed:", e);
            alert("Failed to publish dashboard: " + e.message);
        } finally {
            setIsPublishing(false);
        }
    }, [publishScope, activeWorkspace, getDashboardConfig]);

    useEffect(() => {
        if (isOpen && activeTab === 'data' && !publishedUrl && !isPublishing) {
            handlePublish();
        }
    }, [isOpen, activeTab, publishedUrl, isPublishing, handlePublish]);

    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);

                // Basic Validation
                if (!data.workspaces || !data.settings) {
                    alert("Invalid backup file format.");
                    return;
                }

                if (!confirm("This will overwrite your current layout and settings. Are you sure?")) return;

                // Restore Settings
                localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(data.settings));

                // Restore History
                if (data.history) {
                    localStorage.setItem(STORAGE_KEYS.DASHBOARD_HISTORY, JSON.stringify(data.history));
                }

                // 2. Determine limits
                const currentCount = parseInt(localStorage.getItem(STORAGE_KEYS.WORKSPACE_COUNT) || '7', 10);
                const workspaceKeys = Object.keys(data.workspaces || {});

                // Find highest ID in backup
                const backupMaxIndex = workspaceKeys.reduce((max, key) => Math.max(max, parseInt(key, 10)), -1);

                // We need to loop far enough to:
                // a) Restore all backup items
                // b) Clear all existing items (up to current count or safe legacy limit 20)
                const loopLimit = Math.max(currentCount, backupMaxIndex + 1, 20);

                // 3. Restore & Clean Loop
                for (let i = 0; i < loopLimit; i++) {
                    const ws = data.workspaces[i];
                    if (ws) {
                        localStorage.setItem(STORAGE_KEYS.getWidgetKey(i), JSON.stringify(ws.widgets));
                        localStorage.setItem(STORAGE_KEYS.getLayoutKey(i), JSON.stringify(ws.layout));
                    } else {
                        // Clean up any existing data in this slot if not in backup
                        localStorage.removeItem(STORAGE_KEYS.getWidgetKey(i));
                        localStorage.removeItem(STORAGE_KEYS.getLayoutKey(i));
                    }
                }

                // 4. Update Workspace Count to match Backup
                // If backup was empty/invalid, default to 1, otherwise ID+1
                const newCount = Math.max(1, backupMaxIndex + 1);
                localStorage.setItem(STORAGE_KEYS.WORKSPACE_COUNT, newCount.toString());

                alert("Import successful! Reloading...");
                window.location.reload();

            } catch (err) {
                console.error(err);
                alert("Failed to parse file.");
            }
        };
        reader.readAsText(file);
    };

    const handlePurge = () => {
        if (!confirm("DANGER: This will delete ALL widgets and layouts from EVERY workspace.\n\nThis action cannot be undone.\n\nAre you sure you want to wipe everything?")) {
            return;
        }

        // Double check confirmation for destructive action
        if (!confirm("Are you absolutely sure? Last chance to cancel.")) {
            return;
        }

        try {
            // Loop through all possible workspaces and remove keys
            for (let i = 0; i < 20; i++) { // Check up to 20 to be safe for legacy
                // V2 Keys
                localStorage.removeItem(STORAGE_KEYS.getWidgetKey(i));
                localStorage.removeItem(STORAGE_KEYS.getLayoutKey(i));
            }

            // App Settings (Force reload from config.json)
            localStorage.removeItem(STORAGE_KEYS.SETTINGS);

            alert("All configuration (including legacy data) purged. The dashboard will now reload.");
            window.location.reload();
        } catch (e) {
            console.error("Purge failed:", e);
            alert("Failed to purge data.");
        }
    };

    if (!isOpen) return null;

    return (
        <div
            onClick={handleBackdropClick}
            className="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-16 bg-black/60 backdrop-blur-sm animate-in fade-in zoom-in duration-200"
        >
            <div className="w-full max-w-2xl bg-[#1a1a20] border border-white/10 rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-orange-500/90 backdrop-blur-md">
                    <h2 className="text-lg font-semibold text-white flex items-center">
                        <img src="/icon.svg" alt="Settings" className="w-8 h-8 mr-3 brightness-0 invert" />
                        {labName || 'Zulu7'} Dashboard Settings
                    </h2>
                    <button onClick={handleClose} title="Close Settings" className="text-white hover:text-white/80 transition-colors cursor-pointer">
                        <X size={20} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-white/5">
                    <button
                        onClick={() => setActiveTab('general')}
                        title="General Settings"
                        className={`flex-1 py-3 text-sm font-medium transition-colors cursor-pointer flex items-center justify-center ${activeTab === 'general' ? 'bg-blue-500/10 text-blue-400 border-b border-blue-500/50' : 'text-white/50 hover:text-white hover:bg-white/5 border-b border-transparent'}`}
                    >
                        <SlidersHorizontal size={16} className="mr-2" />
                        General
                    </button>
                    <button
                        onClick={() => setActiveTab('streams')}
                        title="Manage Camera Streams"
                        className={`flex-1 py-3 text-sm font-medium transition-colors cursor-pointer flex items-center justify-center ${activeTab === 'streams' ? 'bg-blue-500/10 text-blue-400 border-b border-blue-500/50' : 'text-white/50 hover:text-white hover:bg-white/5 border-b border-transparent'}`}
                    >
                        <Video size={16} className="mr-2" />
                        Camera Streams
                    </button>
                    <button
                        onClick={() => setActiveTab('data')}
                        title="Backup & Restore Data"
                        className={`flex-1 py-3 text-sm font-medium transition-colors cursor-pointer flex items-center justify-center ${activeTab === 'data' ? 'bg-blue-500/10 text-blue-400 border-b border-blue-500/50' : 'text-white/50 hover:text-white hover:bg-white/5 border-b border-transparent'}`}
                    >
                        <Database size={16} className="mr-2" />
                        Data Management
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto custom-scrollbar flex-1">

                    {/* General Tab */}
                    {activeTab === 'general' && (
                        <div className="space-y-6">
                            {/* Zulu7 Section */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="space-y-1">
                                    <h3 className="text-[10px] uppercase font-bold tracking-widest text-blue-100 flex items-center">
                                        <Monitor size={14} className="mr-2 text-yellow-500" />
                                        Zulu7
                                    </h3>
                                    <p className="text-[10px] text-blue-200/50">
                                        Identify and localize your dashboard instance.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {/* Dashboard Name */}
                                    <div className="space-y-2">
                                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Dashboard Name</span>
                                        <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={labName}
                                                onChange={(e) => setLabName(e.target.value)}
                                                className="bg-transparent border-none focus:ring-0 text-[11px] text-white/90 w-full focus:outline-none placeholder-white/20"
                                                placeholder="Enter dashboard name..."
                                            />
                                        </div>
                                    </div>

                                    {/* Time Zone */}
                                    <div className="space-y-2">
                                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Global Time Zone</span>
                                        <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                            <select
                                                value={timeZone}
                                                onChange={(e) => setTimeZone(e.target.value)}
                                                className="bg-transparent border-none focus:ring-0 text-[11px] text-white/90 w-full focus:outline-none cursor-pointer appearance-none"
                                            >
                                                <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>Local System Time</option>
                                                <option value="UTC">UTC</option>
                                                <option value="America/New_York">Eastern Time (US)</option>
                                                <option value="America/Chicago">Central Time (US)</option>
                                                <option value="America/Denver">Mountain Time (US)</option>
                                                <option value="America/Los_Angeles">Pacific Time (US)</option>
                                                <option value="Europe/London">London (UK)</option>
                                            </select>
                                            <Globe size={14} className="text-white/20 shrink-0" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* External API Keys Section */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="space-y-1">
                                    <h3 className="text-[10px] uppercase font-bold tracking-widest text-blue-100 flex items-center">
                                        <Key size={14} className="mr-2 text-yellow-500" />
                                        External API Keys
                                    </h3>
                                    <p className="text-[10px] text-blue-200/50">
                                        Configure third-party services for stock data and media integration.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {/* Finnhub */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Finnhub (Stocks)</span>
                                            <a
                                                href="https://finnhub.io/register"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-[9px] uppercase font-bold tracking-wider text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                                            >
                                                Get Free Key
                                            </a>
                                        </div>
                                        <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2 group/key">
                                            <input
                                                type="text"
                                                value={finnhubKey}
                                                onChange={(e) => setFinnhubKey(e.target.value)}
                                                className="bg-transparent border-none focus:ring-0 text-[11px] text-white/90 font-mono w-full select-all focus:outline-none placeholder-white/20"
                                                placeholder="Enter Finnhub Key"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => copyToClipboard(finnhubKey, 'finnhub')}
                                                className="p-1 transition-all flex-shrink-0 cursor-pointer text-white/20 hover:text-orange-500"
                                                title="Copy Key"
                                            >
                                                {copiedId === 'finnhub' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Google */}
                                    <div className="space-y-2">
                                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Google Cloud (Media)</span>
                                        <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2 group/key">
                                            <input
                                                type="text"
                                                value={googleApiKey}
                                                onChange={(e) => setGoogleApiKey(e.target.value)}
                                                className="bg-transparent border-none focus:ring-0 text-[11px] text-white/90 font-mono w-full select-all focus:outline-none placeholder-white/20"
                                                placeholder="Enter Google API Key"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => copyToClipboard(googleApiKey, 'google')}
                                                className="p-1 transition-all flex-shrink-0 cursor-pointer text-white/20 hover:text-orange-500"
                                                title="Copy Key"
                                            >
                                                {copiedId === 'google' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>



                            {/* Dashboard Management Section */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="space-y-1">
                                    <h3 className="text-[10px] uppercase font-bold tracking-widest text-blue-100 flex items-center justify-between">
                                        <div className="flex items-center">
                                            <Layout size={14} className="mr-2 text-yellow-500" />
                                            Dashboard Selection
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <button
                                                onClick={handleSelectAll}
                                                className="text-[9px] uppercase font-bold tracking-wider text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                                            >
                                                Select All
                                            </button>
                                            <span className="text-white/10 text-[9px]">|</span>
                                            <button
                                                onClick={handleUnselectAll}
                                                className="text-[9px] uppercase font-bold tracking-wider text-white/40 hover:text-white transition-colors cursor-pointer"
                                            >
                                                Unselect All
                                            </button>
                                        </div>
                                    </h3>
                                    <p className="text-[10px] text-blue-200/50">
                                        Toggle and reorder workspaces shared in this dashboard.
                                    </p>
                                </div>

                                <div className="space-y-2 pr-2">
                                    {dashboardOrder.map((originalIndex, displayIndex) => {
                                        const isChecked = dashboardRotationSelection[originalIndex] !== false;
                                        const displayName = dashboardNames[originalIndex] || `Dashboard ${originalIndex + 1} `;

                                        return (
                                            <div key={originalIndex} className="flex items-center space-x-3 group">
                                                <span className="text-[10px] font-bold text-white/20 w-4 text-center shrink-0">
                                                    {displayIndex + 1}
                                                </span>

                                                <div
                                                    draggable
                                                    onDragStart={() => setDraggedItem(displayIndex)}
                                                    onDragOver={(e) => e.preventDefault()}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        if (draggedItem === null || draggedItem === displayIndex) return;
                                                        const newOrder = [...dashboardOrder];
                                                        const item = newOrder[draggedItem];
                                                        newOrder.splice(draggedItem, 1);
                                                        newOrder.splice(displayIndex, 0, item);
                                                        setDashboardOrder(newOrder);
                                                        setDraggedItem(null);
                                                    }}
                                                    className={`flex-1 flex items-center justify-between p-2.5 rounded bg-white/5 border border-white/10 ${draggedItem === displayIndex ? 'opacity-50 border-blue-500 border-dashed' : 'hover:bg-white/10 hover:border-white/20'} cursor-grab active:cursor-grabbing transition-all`}
                                                >
                                                    <div className="flex items-center space-x-3 flex-1">
                                                        <GripVertical size={14} className="text-white/10 group-hover:text-white/30" />
                                                        {editingNameIndex === originalIndex ? (
                                                            <input
                                                                autoFocus
                                                                type="text"
                                                                value={dashboardNames[originalIndex] !== undefined ? dashboardNames[originalIndex] : `Dashboard ${originalIndex + 1}`}
                                                                onChange={(e) => setDashboardNames(prev => ({ ...prev, [originalIndex]: e.target.value }))}
                                                                onBlur={() => setEditingNameIndex(null)}
                                                                onKeyDown={(e) => e.key === 'Enter' && setEditingNameIndex(null)}
                                                                className="bg-transparent border-none p-0 text-[11px] font-medium text-white focus:outline-none w-full outline-none"
                                                                style={{ borderBottom: '1px solid #f97316' }}
                                                            />
                                                        ) : (
                                                            <span
                                                                className="text-[11px] font-medium text-white/90 cursor-text select-none"
                                                                onDoubleClick={() => setEditingNameIndex(originalIndex)}
                                                            >
                                                                {displayName}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={(e) => setDashboardRotationSelection({ ...dashboardRotationSelection, [originalIndex]: e.target.checked })}
                                                        className="w-3.5 h-3.5 rounded-none border-white/10 bg-black/20 text-orange-500 focus:ring-orange-500/50 cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Dashboard Rotation Section */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <h3 className="text-[10px] uppercase font-bold tracking-widest text-blue-100 flex items-center">
                                            <RefreshCw size={14} className="mr-2 text-yellow-500" />
                                            Auto-Rotation
                                        </h3>
                                        <p className="text-[10px] text-blue-200/50">
                                            Automatically cycle through active dashboards.
                                        </p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isWorkspaceRotationEnabled}
                                            onChange={(e) => setIsWorkspaceRotationEnabled(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <div className={`w-8 h-4 transition-colors rounded-full shadow-inner ${isWorkspaceRotationEnabled ? 'bg-orange-600' : 'bg-white/10'}`}></div>
                                        <div className={`absolute top-0 w-4 h-4 transition-transform bg-white rounded-full shadow-md ${isWorkspaceRotationEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                    </label>
                                </div>

                                <div className="space-y-2">
                                    <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Rotation Interval (Seconds)</span>
                                    <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                        <input
                                            type="number"
                                            min="10"
                                            value={workspaceRotationInterval}
                                            onChange={(e) => setWorkspaceRotationInterval(e.target.value)}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value, 10);
                                                if (isNaN(val) || val < 10) setWorkspaceRotationInterval(10);
                                            }}
                                            className="bg-transparent border-none focus:ring-0 text-[11px] text-white/90 w-full focus:outline-none"
                                        />
                                        <Clock size={14} className="text-white/20 shrink-0" />
                                    </div>
                                </div>
                            </div>


                            {/* Background System Section */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-1">
                                        <h3 className="text-[10px] uppercase font-bold tracking-widest text-blue-100 flex items-center">
                                            <Image size={14} className="mr-2 text-yellow-500" />
                                            Visual System
                                        </h3>
                                        <p className="text-[10px] text-blue-200/50">
                                            Configure dynamic background imagery.
                                        </p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={isSlideshowEnabled}
                                            onChange={(e) => setIsSlideshowEnabled(e.target.checked)}
                                            className="sr-only"
                                        />
                                        <div className={`w-8 h-4 transition-colors rounded-full shadow-inner ${isSlideshowEnabled ? 'bg-orange-600' : 'bg-white/10'}`}></div>
                                        <div className={`absolute top-0 w-4 h-4 transition-transform bg-white rounded-full shadow-md ${isSlideshowEnabled ? 'translate-x-4' : 'translate-x-0'}`}></div>
                                    </label>
                                </div>

                                <div className="space-y-3">
                                    <div className="space-y-2">
                                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Image URLs (One per line)</span>
                                        <div className="p-2 bg-white/5 border border-white/10 rounded">
                                            <textarea
                                                value={bgImages}
                                                onChange={(e) => setBgImages(e.target.value)}
                                                placeholder="https://example.com/image1.jpg"
                                                className="w-full h-20 bg-transparent border-none focus:ring-0 text-[11px] text-white/90 font-mono focus:outline-none resize-none px-1"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Slideshow Interval (Seconds)</span>
                                        <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                            <input
                                                type="number"
                                                min="10"
                                                value={slideshowInterval}
                                                onChange={(e) => setSlideshowInterval(e.target.value)}
                                                onBlur={(e) => {
                                                    const val = parseInt(e.target.value, 10);
                                                    if (isNaN(val) || val < 10) setSlideshowInterval(10);
                                                }}
                                                className="bg-transparent border-none focus:ring-0 text-[11px] text-white/90 w-full focus:outline-none"
                                            />
                                            <Timer size={14} className="text-white/20 shrink-0" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Streams Tab */}
                    {activeTab === 'streams' && (
                        <div className="space-y-6">
                            {/* Stream Privacy / API Key Section */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="space-y-2">
                                    <h3 className="text-sm font-semibold text-blue-100 flex items-center">
                                        <Lock size={16} className="mr-2" />
                                        Stream API Key
                                    </h3>
                                    <p className="text-xs text-blue-200/70">
                                        This unique API Key is auto-generated for your dashboard. It is required to list available streams securely.
                                    </p>
                                </div>
                                <div className="p-3 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={streamApiKey}
                                        className="bg-transparent border-none focus:ring-0 text-xs text-white/90 font-mono w-full select-all focus:outline-none"
                                        onClick={(e) => {
                                            e.target.select();
                                            copyToClipboard(streamApiKey, 'streamKey');
                                        }}
                                        title="API Key is persistent and unique to this dashboard"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => copyToClipboard(streamApiKey, 'streamKey')}
                                        className="p-1.5 transition-all flex-shrink-0 cursor-pointer text-white/40 hover:text-orange-500"
                                        title="Copy API Key"
                                    >
                                        {copiedId === 'streamKey' ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                                    </button>
                                </div>
                            </div>

                            {/* Streamer Config */}
                            <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <div className="space-y-1">
                                    <h3 className="text-[10px] uppercase font-bold tracking-widest text-blue-100 flex items-center">
                                        <Server size={14} className="mr-2 text-yellow-500" />
                                        Streamer Endpoint
                                    </h3>
                                    <p className="text-[10px] text-blue-200/50">
                                        The URL of your camera stream server (e.g. go2rtc). <strong>Empty = Use Local Proxy.</strong>
                                    </p>
                                </div>

                                <div className="p-2.5 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                    <input
                                        className="bg-transparent border-none text-[11px] text-white/90 w-full focus:outline-none placeholder-white/20"
                                        value={streamerUrl}
                                        onChange={(e) => setStreamerUrl(e.target.value)}
                                        placeholder="Enter Streamer URL"
                                    />
                                    <button
                                        onClick={fetchStreams}
                                        title="Refresh Stream List"
                                        className="p-1 transition-all flex-shrink-0 cursor-pointer text-white/20 hover:text-orange-500"
                                    >
                                        <RefreshCw size={14} className={streamLoading ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                            </div>

                            {/* Add New Stream */}
                            <div className="space-y-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none">
                                <h3 className="text-sm font-medium text-white flex items-center">
                                    <PlusCircle size={16} className="text-green-400 mr-2" />
                                    Add New Camera Stream
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <input
                                        placeholder="Name (e.g. driveway)"
                                        value={newStreamName}
                                        onChange={(e) => setNewStreamName(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleAddStream();
                                            }
                                        }}
                                        className="bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50"
                                    />
                                    <input
                                        placeholder="RTSP URL (rtsp://...)"
                                        value={newStreamUrl}
                                        onChange={(e) => setNewStreamUrl(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                handleAddStream();
                                            }
                                        }}
                                        className="col-span-2 bg-black/30 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500/50"
                                    />
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleAddStream(e);
                                        }}
                                        disabled={!newStreamName || !newStreamUrl}
                                        className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-500 rounded text-xs font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                    >
                                        <Video size={14} className="mr-2" />
                                        ADD STREAM
                                    </button>
                                </div>
                            </div>

                            {/* Existing Streams List */}
                            <div className="space-y-2">
                                <div className="flex items-center space-x-2 mb-2">
                                    <Activity size={14} className="text-yellow-500" />
                                    <h3 className="text-xs font-medium text-white/50 uppercase tracking-wider">Active Streams</h3>
                                </div>
                                {Object.keys(streams).filter(name => streamApiKey && name.startsWith(`${streamApiKey}_`)).length === 0 ? (
                                    <div className="text-center py-8 text-white/20 italic text-sm">No streams configured for this key</div>
                                ) : (
                                    <div className="space-y-2">
                                        {Object.entries(streams)
                                            .filter(([name]) => !streamApiKey || name.startsWith(`${streamApiKey}_`))
                                            .map(([name]) => {
                                                const displayName = streamApiKey && name.startsWith(`${streamApiKey}_`) ? name.replace(`${streamApiKey}_`, '') : name;
                                                return (
                                                    <div key={name} className="flex items-center justify-between p-3 bg-white/5 rounded-none border border-white/5 hover:border-white/10 transition-colors">
                                                        <div className="flex items-center space-x-3">
                                                            <div className="w-2 h-2 rounded-none bg-green-500 animate-pulse" />
                                                            <span className="font-mono text-sm text-white">{displayName}</span>
                                                        </div>
                                                        <div className="flex items-center space-x-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => copyToClipboard(`${streamerUrl}/stream.html?src=${name}`, name)}
                                                                className="flex items-center px-2 py-1.5 bg-white/10 hover:bg-white/20 rounded text-[10px] text-white transition-colors cursor-pointer"
                                                                title="Copy Widget URL"
                                                            >
                                                                {copiedId === name ? <Check size={12} className="mr-1.5 text-green-400" /> : <Copy size={12} className="mr-1.5" />}
                                                                {copiedId === name ? 'COPIED' : 'COPY URL'}
                                                            </button >
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    handleDeleteStream(name);
                                                                }}
                                                                className="p-1.5 text-white/30 hover:text-red-400 transition-colors cursor-pointer"
                                                                title="Delete Stream"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div >
                                                    </div >
                                                );
                                            })}
                                    </div >
                                )}
                            </div >
                        </div >
                    )}



                    {/* Data Tab */}
                    {
                        activeTab === 'data' && (
                            <div className="space-y-6">
                                {/* Publish Dashboard */}
                                <div className="space-y-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-none relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-4 opacity-10">
                                        <Share2 size={100} />
                                    </div>
                                    <div className="relative z-10 space-y-4">
                                        <div className="flex items-center space-x-2 text-blue-100">
                                            <Globe size={18} />
                                            <h3 className="font-semibold">Create Shared Link</h3>
                                        </div>
                                        <div className="p-4 bg-white/5 border border-white/10 rounded-none space-y-4">
                                            <div className="flex items-center space-x-2">
                                                <button
                                                    onClick={() => {
                                                        setPublishScope('full');
                                                        handlePublish('full');
                                                    }}
                                                    className={`px-3 py-1.5 border transition-all cursor-pointer flex items-center space-x-2 text-[10px] uppercase font-bold tracking-widest active:scale-95 ${publishScope === 'full' ? 'bg-orange-600 border-orange-500 text-white shadow-lg' : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:bg-white/10'}`}
                                                    title="Publish your entire dashboard with all workspaces"
                                                >
                                                    <Monitor size={12} />
                                                    <span>Full Dashboard</span>
                                                </button>

                                                <button
                                                    onClick={() => {
                                                        setPublishScope('workspace');
                                                        handlePublish('workspace');
                                                    }}
                                                    className={`px-3 py-1.5 border transition-all cursor-pointer flex items-center space-x-2 text-[10px] uppercase font-bold tracking-widest active:scale-95 ${publishScope === 'workspace' ? 'bg-orange-600 border-orange-500 text-white shadow-lg' : 'bg-white/5 border-white/10 text-white/40 hover:text-white/60 hover:bg-white/10'}`}
                                                    title="Publish only the current active workspace"
                                                >
                                                    <Layout size={12} />
                                                    <span>Workspace Only</span>
                                                </button>
                                            </div>


                                            {isPublishing && (
                                                <div className="w-full py-4 bg-orange-600/20 text-orange-400 font-bold rounded-none transition-all flex items-center justify-center animate-pulse">
                                                    <Loader2 size={20} className="animate-spin mr-2" />
                                                    GENERATING LINK...
                                                </div>
                                            )}

                                            {publishedUrl && !isPublishing && (
                                                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                                                    <div className="p-3 bg-white/5 border border-white/10 rounded flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            readOnly
                                                            value={publishedUrl}
                                                            className="bg-transparent border-none focus:ring-0 text-xs text-white/90 font-mono w-full select-all"
                                                            onClick={(e) => e.target.select()}
                                                        />
                                                        <button
                                                            onClick={() => copyToClipboard(publishedUrl, 'url')}
                                                            className="p-1.5 transition-all flex-shrink-0 cursor-pointer text-white/40 hover:text-orange-500"
                                                            title="Copy URL"
                                                        >
                                                            {copiedId === 'url' ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-none space-y-4">
                                    <div>
                                        <h3 className="text-sm font-semibold text-blue-100 flex items-center">
                                            <Server size={16} className="mr-2" />
                                            Backup & Restore
                                        </h3>
                                        <p className="text-xs text-blue-200/70 mt-1">
                                            Export your entire dashboard configuration to a JSON file, restore from a previous backup, or reset everything.
                                        </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Export */}
                                        <button
                                            onClick={handleExport}
                                            title="Download JSON Backup"
                                            className="flex items-center justify-center p-3 bg-white/5 border border-white/10 rounded-none hover:bg-white/10 transition-all group cursor-pointer"
                                        >
                                            <FileDown size={20} className="text-white/40 group-hover:text-orange-500 transition-colors mr-3" />
                                            <span className="text-sm font-medium text-white">Export Backup</span>
                                        </button>

                                        {/* Import */}
                                        <label className="flex items-center justify-center p-3 bg-white/5 border border-white/10 rounded-none hover:bg-white/10 transition-all group cursor-pointer" title="Upload JSON Backup">
                                            <FileUp size={20} className="text-white/40 group-hover:text-orange-500 transition-colors mr-3" />
                                            <span className="text-sm font-medium text-white">Import Backup</span>
                                            <input
                                                type="file"
                                                accept=".json"
                                                onChange={handleImport}
                                                className="hidden"
                                            />
                                        </label>

                                    </div>
                                </div>

                                {/* Purge */}
                                <button
                                    onClick={handlePurge}
                                    title="Permanently Delete ALL Data"
                                    className="w-full flex items-center justify-center p-3 bg-red-500/10 border border-red-500/20 rounded-none hover:bg-red-500/20 transition-all group mt-0 cursor-pointer"
                                >
                                    <Trash2 size={20} className="text-red-400 transition-colors mr-3" />
                                    <span className="text-sm font-medium text-red-400">Purge All Data</span>
                                </button>

                            </div>
                        )
                    }

                </div >

                {/* Footer */}
                < div className="p-4 border-t border-white/5 bg-white/5 flex items-center justify-between" >
                    <div className="flex items-center space-x-4">
                        <a
                            href="https://zulu7.net"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-bold text-orange-500 tracking-[0.2em] uppercase hover:text-orange-400 transition-colors opacity-80 hover:opacity-100"
                        >
                            Zulu7
                        </a>
                        {isLocal && systemLoad && (
                            <div className="flex items-center space-x-3 text-xs font-bold text-white/40 tracking-[0.2em] uppercase border-l border-white/10 pl-4">
                                <div className="flex items-center">
                                    <span title="1-Minute Load Average" className="cursor-pointer">{systemLoad.load1}</span>
                                    <span className="mx-1 text-white/10">,</span>
                                    <span title="5-Minute Load Average" className="cursor-pointer">{systemLoad.load5}</span>
                                    <span className="mx-1 text-white/10">,</span>
                                    <span title="15-Minute Load Average" className="cursor-pointer">{systemLoad.load15}</span>
                                    <span className="text-white/10 mx-2">|</span>
                                    <span title="CPU Core Count" className="text-orange-500/80 cursor-pointer">{systemLoad.cores}</span>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={handleClose}
                            title="Discard Changes"
                            className="px-4 py-2 text-sm font-medium text-white/70 hover:text-white transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            title="Apply and Save Settings"
                            className="flex-1 bg-orange-600 hover:bg-orange-500 text-white py-3 px-6 text-sm font-bold uppercase tracking-widest transition-all cursor-pointer shadow-lg shadow-orange-500/20 active:scale-95 flex items-center justify-center gap-2 group"
                        >
                            <Save size={18} className="group-hover:scale-110 transition-transform" />
                            Save Changes
                        </button>
                    </div>
                </div >
            </div >
        </div >
    );
};

export default SettingsModal;
