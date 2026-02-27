import React, { useState, useEffect, useRef } from 'react';
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { fetchConfig } from '../utils/configParser';
import { getDashboardConfig } from '../utils/configManager';
import { STORAGE_KEYS } from '../utils/constants';
import WidgetRenderer from './WidgetRenderer';
import AddWidgetModal from './AddWidgetModal';
import Zulu7Header from './Zulu7Header';
import { X, GripHorizontal, RefreshCw, CloudSun, Video, Rss, TrendingUp, Minimize, Maximize, Cast, SlidersHorizontal, Image, Activity } from 'lucide-react';

import CalendarOverlay from './CalendarOverlay';

const Zulu7Grid = ({ onOpenSettings, settings, onUpdateSettings, disablePersistence = false, initialWorkspaces = null, initialActiveWorkspace, isRestricted = false }) => {
    // State now holds ALL workspaces
    // State now holds ALL workspaces
    const [activeWorkspace, setActiveWorkspace] = useState(() => {
        if (initialActiveWorkspace !== undefined) return initialActiveWorkspace;
        const saved = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORKSPACE);
        const parsed = parseInt(saved, 10);
        return !isNaN(parsed) ? parsed : 0;
    });

    // Save active workspace on change
    useEffect(() => {
        if (!disablePersistence) {
            localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKSPACE, activeWorkspace.toString());
        }
    }, [activeWorkspace, disablePersistence]);
    const [workspaceCount, setWorkspaceCount] = useState(7);
    const [workspaces, setWorkspaces] = useState({}); // { 0: { widgets: [], layout: [] }, 1: ... }
    const [areAllLoaded, setAreAllLoaded] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCalendarOpen, setIsCalendarOpen] = useState(false);
    const [calendarInitialDate, setCalendarInitialDate] = useState(null);
    const [editingWidget, setEditingWidget] = useState(null);
    const [isLocked, setIsLocked] = useState(true); // Default to locked
    const [width, setWidth] = useState(window.innerWidth);
    const containerRef = useRef(null);
    const [mounted, setMounted] = useState(false);
    const [isManualFullScreen, setIsManualFullScreen] = useState(false);
    const [alertStates, setAlertStates] = useState({}); // { widgetId: { status, isVibrating } }

    // Undo History
    const [history, setHistory] = useState([]); // Stack of workspace states

    const addToHistory = () => {
        setHistory(prev => {
            const newHistory = [...prev, JSON.parse(JSON.stringify(workspaces))];
            if (newHistory.length > 50) newHistory.shift(); // Limit to 50
            return newHistory;
        });
    };

    const handleUndo = () => {
        resetAutoLock(); // Reset timer on undo
        setHistory(prev => {
            if (prev.length === 0) return prev;
            const newHistory = [...prev];
            const previousState = newHistory.pop();

            setWorkspaces(previousState);

            // Persist the restored state to localStorage
            if (!disablePersistence) {
                Object.keys(previousState).forEach(key => {
                    const ws = previousState[key];
                    localStorage.setItem(STORAGE_KEYS.getWidgetKey(key), JSON.stringify(ws.widgets));
                    localStorage.setItem(STORAGE_KEYS.getLayoutKey(key), JSON.stringify(ws.layout));
                });
            }

            return newHistory;
        });
    };

    // Keyboard Listeners (Undo & Navigation)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Check if user is typing in an input, textarea, or contentEditable
            if (
                e.target.tagName === 'INPUT' ||
                e.target.tagName === 'TEXTAREA' ||
                e.target.isContentEditable
            ) {
                return;
            }

            // Priority 1: Navigation (Arrows) - Works even when locked
            if (e.key === 'ArrowRight') {
                setActiveWorkspace(prev => calculateNextWorkspace(prev, workspaces, workspaceCount));
                resetAutoLock();
            } else if (e.key === 'ArrowLeft') {
                setActiveWorkspace(prev => calculatePrevWorkspace(prev, workspaces, workspaceCount));
                resetAutoLock();
            }

            // Priority 2: Undo (Ctrl+Z) - Only when unlocked
            if (!isLocked && (e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                handleUndo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLocked, workspaces, workspaceCount, settings]);

    // Cast Support
    const [isCastAvailable, setIsCastAvailable] = useState(false);
    const [isCasting, setIsCasting] = useState(false);

    // Initialize Cast Support (Presentation API + Google Cast SDK check)
    useEffect(() => {
        // Method 1: Check for Presentation API (Modern)
        if (navigator.presentation) {
            setIsCastAvailable(true);
        }

        // Method 2: Google Cast SDK (Fallback/Detection)
        window['__onGCastApiAvailable'] = (isAvailable) => {
            if (isAvailable) {
                setIsCastAvailable(true);
                try {
                    // Initialize purely for detection/state monitoring
                    const cast = window.cast;
                    const chrome = window.chrome;
                    cast.framework.CastContext.getInstance().setOptions({
                        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
                        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
                    });
                    // Listen for Session State Changes
                    const context = cast.framework.CastContext.getInstance();
                    context.addEventListener(
                        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
                        (event) => {
                            if (event.sessionState === cast.framework.SessionState.SESSION_STARTED ||
                                event.sessionState === cast.framework.SessionState.SESSION_RESUMED) {
                                setIsCasting(true);
                            } else if (event.sessionState === cast.framework.SessionState.SESSION_ENDED) {
                                setIsCasting(false);
                            }
                        }
                    );
                } catch (e) { console.error("Cast Init Error", e); }
            }
        };
    }, []);

    // Listen for Widget Alerts (Health Checks)
    useEffect(() => {
        const handleAlert = (e) => {
            const { id, status, isVibrating } = e.detail;
            setAlertStates(prev => ({
                ...prev,
                [id]: { status, isVibrating }
            }));
        };
        window.addEventListener('zulu7-widget-alert', handleAlert);
        return () => window.removeEventListener('zulu7-widget-alert', handleAlert);
    }, []);

    const handleCast = async () => {
        let castUrl = window.location.href;

        // Check if we are in Local Mode (no query params for config)
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has('zulu7') && !urlParams.has('dash')) {
            // Local Mode: We must publish to make it visible to Chromecast
            console.log("Local Mode detected. Publishing config for Cast...");

            try {
                // Ensure we have current settings and workspaces (source of truth)
                const configData = getDashboardConfig(settings, workspaces);
                console.log("Publishing Config for Cast (from State):", configData);

                const response = await fetch('/api/publish', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(configData)
                });

                if (response.ok) {
                    const result = await response.json();
                    if (result.id) {
                        castUrl = `${window.location.origin}/?zulu=${result.id}`;
                        console.log("Published for Cast. URL:", castUrl);
                    }
                } else {
                    console.error("Failed to publish for Cast:", response.statusText);
                    alert("Failed to prepare dashboard for casting. Please try again.");
                    return;
                }
            } catch (error) {
                console.error("Error publishing for Cast:", error);
                alert("Error preparing dashboard for casting.");
                return;
            }
        }

        // Priority 1: Presentation API (Best for "Cast this Tab/URL")
        if (navigator.presentation) {
            try {
                const request = new PresentationRequest(castUrl);
                // Start presentation - this triggers browser Cast dialog
                const connection = await request.start();
                console.log("Presentation started:", connection);
                setIsCasting(true);

                connection.onclose = () => setIsCasting(false);
                connection.onterminate = () => setIsCasting(false);
            } catch (error) {
                console.error("Presentation Request failed:", error);
                // Fallback to Cast SDK if user cancelled or failed?
                // Usually error name is 'NotFoundError' or 'NotAllowedError'
            }
        }
        // Priority 2: Cast SDK (Media Receiver - Not ideal for Dashboard but triggers dialog)
        else if (window.cast) {
            window.cast.framework.CastContext.getInstance().requestSession()
                .catch((e) => console.error('Cast Session fail', e));
        } else {
            alert("Casting is not supported in this browser.");
        }
    };

    useEffect(() => {
        setMounted(true); // eslint-disable-line react-hooks/set-state-in-effect

        const updateWidth = () => {
            if (containerRef.current) {
                setWidth(containerRef.current.offsetWidth);
            } else {
                setWidth(window.innerWidth);
            }
        };

        // Initial check
        updateWidth();

        // Robust Resize Observer
        const observer = new ResizeObserver((entries) => {
            // Use contentRect or fallback to offsetWidth
            for (const entry of entries) {
                setWidth(entry.contentRect.width || entry.target.offsetWidth);
            }
        });

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        // Window resize fallback (covers cases where observer might miss global layout shifts)
        window.addEventListener('resize', updateWidth);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', updateWidth);
        };
    }, []);

    // Ensure we don't land on a disabled workspace
    useEffect(() => {
        if (!settings) return;

        // Check if current active is disabled (default true if undefined)
        const isCurrentEnabled = settings.dashboardRotationSelection?.[activeWorkspace] !== false;

        if (!isCurrentEnabled) {
            // Find first enabled workspace
            let firstEnabled = -1;
            // Iterate up to workspaceCount (or defaulting to 7/max if undefined)
            const total = workspaceCount || 7;
            for (let i = 0; i < total; i++) {
                if (settings.dashboardRotationSelection?.[i] !== false) {
                    firstEnabled = i;
                    break;
                }
            }

            if (firstEnabled !== -1 && firstEnabled !== activeWorkspace) {
                console.log(`Redirecting from disabled workspace ${activeWorkspace} to ${firstEnabled}`);
                setActiveWorkspace(firstEnabled);
            }
        }
    }, [activeWorkspace, settings, workspaceCount]);

    // Swapping Workspaces
    const handleSwapWorkspaces = (sourceIdx, targetIdx) => {
        if (sourceIdx === targetIdx || disablePersistence) return;
        resetAutoLock();
        addToHistory();

        // Swap Content (Widgets & Layout)
        const newWorkspaces = { ...workspaces };
        const tempWS = newWorkspaces[sourceIdx];
        newWorkspaces[sourceIdx] = newWorkspaces[targetIdx] || { widgets: [], layout: [] };
        newWorkspaces[targetIdx] = tempWS || { widgets: [], layout: [] };

        // Swap Settings (Names & Selection)
        const newSettings = { ...settings };
        const dashboardNames = { ...(newSettings.dashboardNames || {}) };
        const dashboardRotationSelection = { ...(newSettings.dashboardRotationSelection || {}) };

        const tempName = dashboardNames[sourceIdx];
        dashboardNames[sourceIdx] = dashboardNames[targetIdx];
        dashboardNames[targetIdx] = tempName;

        const tempSelection = dashboardRotationSelection[sourceIdx];
        dashboardRotationSelection[sourceIdx] = dashboardRotationSelection[targetIdx];
        dashboardRotationSelection[targetIdx] = tempSelection;

        newSettings.dashboardNames = dashboardNames;
        newSettings.dashboardRotationSelection = dashboardRotationSelection;

        // Update States
        setWorkspaces(newWorkspaces);
        onUpdateSettings(newSettings);
        setActiveWorkspace(targetIdx);

        // Persist
        localStorage.setItem(STORAGE_KEYS.getWidgetKey(sourceIdx), JSON.stringify(newWorkspaces[sourceIdx].widgets));
        localStorage.setItem(STORAGE_KEYS.getLayoutKey(sourceIdx), JSON.stringify(newWorkspaces[sourceIdx].layout));
        localStorage.setItem(STORAGE_KEYS.getWidgetKey(targetIdx), JSON.stringify(newWorkspaces[targetIdx].widgets));
        localStorage.setItem(STORAGE_KEYS.getLayoutKey(targetIdx), JSON.stringify(newWorkspaces[targetIdx].layout));

        // Trigger Global Refresh (App.jsx)
        window.dispatchEvent(new CustomEvent('zulu7-workspaces-reordered'));
    };

    // Update Page Title
    useEffect(() => {
        const labName = settings?.labName || 'Zulu7';
        const workspaceName = settings?.dashboardNames?.[activeWorkspace] || `Dashboard #${activeWorkspace + 1}`;
        document.title = `${labName} | ${workspaceName}`;
    }, [settings?.labName, settings?.dashboardNames, activeWorkspace]);

    // Helper: Fetch data for a single workspace ID (migrating if necessary)
    const getWorkspaceData = async (workspaceId) => {
        // V2 Keys
        const wsWidgetKeyV2 = STORAGE_KEYS.getWidgetKey(workspaceId);
        const wsLayoutKeyV2 = STORAGE_KEYS.getLayoutKey(workspaceId);

        const savedWidgetsV2 = localStorage.getItem(wsWidgetKeyV2);
        const savedLayoutV2 = localStorage.getItem(wsLayoutKeyV2);

        if (savedWidgetsV2 && savedLayoutV2) {
            try {

                const loadedWidgets = JSON.parse(savedWidgetsV2);
                const loadedLayout = JSON.parse(savedLayoutV2);

                const fixedWidgets = loadedWidgets;
                const fixedLayout = loadedLayout;

                return {
                    widgets: fixedWidgets,
                    layout: fixedLayout
                };
            } catch (e) {
                console.error(`V2 Load Failed for WS ${workspaceId}`, e);
            }
        }

        // Default for new empty workspaces (1-3) or fallback
        if (workspaceId === 0) {
            try {
                // Absolute fallback (Config file) for fresh start
                const parsedWidgets = await fetchConfig();
                // Even config widgets might be V1 sized?
                // Assuming config.txt is still the source of truth for defaults, 
                // we'll treat them as needing to be V2 compliant. 
                // If the user's config.txt generates V1 sized widgets, we might need to keep doubling them
                // OR we accept that 'get rid of V1' means we expect V2 sized inputs.
                // However, fetchConfig parses typical text lines. The 'parsing' logic in configParser 
                // likely defaults to small sizes. I will keep the *doubling* here just for the config-file 
                // fallback to ensure they look good, but remove the localStorage V1 keys.

                const v2Widgets = parsedWidgets.map(w => ({ ...w, x: w.x * 2, y: w.y * 2, w: w.w * 2, h: w.h * 2 }));
                // Force Icon widgets to 1x1 if they exist in legacy config
                const migratedWidgets = v2Widgets;

                const initialLayout = migratedWidgets.map(w => ({
                    i: w.id, x: w.x, y: w.y, w: w.w, h: w.h
                }));
                return { widgets: migratedWidgets, layout: initialLayout };
            } catch { /* ignore */ }
        }

        // Default empty
        return { widgets: [], layout: [] };
    };

    // Initial Load of ALL Workspaces
    useEffect(() => {
        const loadAll = async () => {
            if (initialWorkspaces) {
                // Load from props (Ephemeral Mode)
                console.log("Loading Ephemeral Workspaces:", initialWorkspaces);
                setWorkspaces(initialWorkspaces);

                // Fix: Calculate count based on MAX index, not number of keys
                const keys = Object.keys(initialWorkspaces).map(k => parseInt(k, 10));
                const maxKey = keys.length > 0 ? Math.max(...keys) : 6; // Default to 7 (index 6) if empty
                const newCount = Math.max(maxKey + 1, 7); // Ensure at least 7

                console.log(`Ephemeral Count: keys=${keys.length}, maxKey=${maxKey}, settingCount=${newCount}`);
                setWorkspaceCount(newCount);
                setAreAllLoaded(true);
                return;
            }

            // Load from LocalStorage
            const savedCount = localStorage.getItem(STORAGE_KEYS.WORKSPACE_COUNT);
            const count = savedCount ? parseInt(savedCount, 10) : 7;
            setWorkspaceCount(count);

            const newWorkspaces = {};
            for (let i = 0; i < count; i++) {
                newWorkspaces[i] = await getWorkspaceData(i);
            }
            setWorkspaces(newWorkspaces);
            setAreAllLoaded(true);
        };
        loadAll();
    }, [initialWorkspaces]);

    const handleAddWorkspace = async () => {
        const newIndex = workspaceCount;
        const newCount = workspaceCount + 1;

        // Update Count
        setWorkspaceCount(newCount);
        if (!disablePersistence) {
            localStorage.setItem(STORAGE_KEYS.WORKSPACE_COUNT, newCount.toString());
        }

        // Init Data
        const newData = { widgets: [], layout: [] };

        // Update State
        setWorkspaces(prev => ({ ...prev, [newIndex]: newData }));

        // Switch to it
        setActiveWorkspace(newIndex);

        // Auto-unlock for immediate editing
        setIsLocked(false);

        // Auto-open Add Modal
        setEditingWidget(null);
        setIsModalOpen(true);
    };

    const handleDeleteWorkspace = async (indexToDelete) => {
        // If > 7, we reduce count.
        // If <= 7, we delete (shift) but keep count 7 by adding a fresh one at the end.
        let newCount = workspaceCount;
        const newWorkspaces = { ...workspaces };

        if (workspaceCount > 7) {
            newCount = workspaceCount - 1;
        }

        // Shift data down from indexToDelete
        // Example: Count 7. Delete 2. 
        // 3->2, 4->3, 5->4, 6->5, New->6.
        // Loop runs from indexToDelete up to newCount-1?
        // If count > 7 (e.g. 8). New count 7.
        // i=2. 3->2, 4->3, 5->4, 6->5, 7->6. 
        // 7th (index 7) is dropped.

        // If count <= 7 (e.g. 7). New count 7.
        // i=2. 3->2, 4->3, 5->4, 6->5.
        // Loop limit:
        // We need to fill indices 0 to newCount-1.
        // If we shift, we fill up to newCount-2 from existing data.

        // Let's use a simpler approach: create a new array of objects, filter, then re-assign
        const wsList = [];
        for (let i = 0; i < workspaceCount; i++) {
            wsList.push(workspaces[i]);
        }

        // Remove the one
        wsList.splice(indexToDelete, 1);

        // Handle names and rotation shifting
        if (settings && onUpdateSettings) {
            const namesArray = Array.from({ length: workspaceCount }).map((_, i) => settings.dashboardNames?.[i]);
            namesArray.splice(indexToDelete, 1);
            const nextNames = {};
            namesArray.forEach((name, i) => { if (name !== undefined) nextNames[i] = name; });

            const rotationArray = Array.from({ length: workspaceCount }).map((_, i) => settings.dashboardRotationSelection?.[i]);
            rotationArray.splice(indexToDelete, 1);
            const nextRotation = {};
            rotationArray.forEach((val, i) => { if (val !== undefined) nextRotation[i] = val; });

            onUpdateSettings({
                ...settings,
                dashboardNames: nextNames,
                dashboardRotationSelection: nextRotation
            });
        }

        // If we dropped below 7, add empty
        while (wsList.length < 7) {
            wsList.push({ widgets: [], layout: [] });
        }

        const finalCount = wsList.length;

        // Re-assign to state object and localStorage
        const nextWorkspaces = {};
        for (let i = 0; i < finalCount; i++) {
            nextWorkspaces[i] = wsList[i];
            if (!disablePersistence) {
                localStorage.setItem(STORAGE_KEYS.getWidgetKey(i), JSON.stringify(wsList[i].widgets));
                localStorage.setItem(STORAGE_KEYS.getLayoutKey(i), JSON.stringify(wsList[i].layout));
            }
        }

        // Clean up any extra keys in localStorage if we reduced count
        // (e.g. went from 8 to 7, key 7 should be gone)
        for (let i = finalCount; i < workspaceCount; i++) {
            localStorage.removeItem(STORAGE_KEYS.getWidgetKey(i));
            localStorage.removeItem(STORAGE_KEYS.getLayoutKey(i));
        }

        setWorkspaceCount(finalCount);
        setWorkspaces(nextWorkspaces);
        if (!disablePersistence) {
            localStorage.setItem(STORAGE_KEYS.WORKSPACE_COUNT, finalCount.toString());
        }

        // Adjust Active Workspace
        // If we deleted the last valid one (and didn't replenish? well we always have >=7)
        // If we deleted index X, we stay at logical index X unless it's out of bounds.
        // If we had 8, deleted 7 (last), now 7. Active should be 6.
        if (activeWorkspace >= finalCount) {
            setActiveWorkspace(finalCount - 1);
        }
        // If active was the one deleted, we are now showing the "next" one which slid into this slot.
        // Except if it was the very last one, then we show previous.
        // Logic: If active > indexToDelete, active-- logic applies?
        // Actually:
        // List: [A, B, C]. Active B (1). Delete B.
        // List: [A, C]. C is at index 1.
        // Active still 1. So we see C. This is standard tab behavior.
        // But if Active was 2 (C). Delete B.
        // List [A, C]. C is at 1. Active 2 is out of bounds. -> 1.

        // Special case: If we deleted the one we are looking at:
        // User expects to see *something*.
        // If we shift, we see the next one.
        // If we delete the last one, we see the previous one.

        // Refined Active Logic:
        if (activeWorkspace === indexToDelete) {
            if (activeWorkspace >= finalCount - 1 && finalCount > 0) {
                // Last one was deleted/reset?
                // If we have 7, delete #7. It is replaced by empty #7.
                // We stay on #7 (empty).
                // If we have 8, delete #8. It is gone. We go to #7.
                if (indexToDelete === workspaceCount - 1 && workspaceCount > 7) {
                    setActiveWorkspace(indexToDelete - 1);
                }
                // Else stay put (shows next data or empty data)
            }
        } else if (activeWorkspace > indexToDelete) {
            setActiveWorkspace(activeWorkspace - 1);
        }
    };

    // Workspace Auto-Rotation
    useEffect(() => {
        if (!settings?.isWorkspaceRotationEnabled || !isLocked || isModalOpen) return;

        const intervalSeconds = settings.workspaceRotationInterval || 300;
        const intervalMs = intervalSeconds * 1000;

        const timer = setInterval(() => {
            // Pause rotation if any element is in full screen, UNLESS it is the root element (Kiosk Mode)
            const fsEl = document.fullscreenElement;
            if (fsEl && fsEl !== document.documentElement && fsEl !== document.body) return;

            setActiveWorkspace(prev => {
                return calculateNextWorkspace(prev, workspaces, workspaceCount);
            });
        }, intervalMs);

        return () => clearInterval(timer);
    }, [settings?.isWorkspaceRotationEnabled, settings?.workspaceRotationInterval, settings?.dashboardRotationSelection, isLocked, isModalOpen, workspaces, workspaceCount]);

    // Auto-Lock Timer (5 Minutes - Edits Only)
    const autoLockTimeoutRef = useRef(null);

    const resetAutoLock = () => {
        if (autoLockTimeoutRef.current) clearTimeout(autoLockTimeoutRef.current);
        if (!isLocked) {
            autoLockTimeoutRef.current = setTimeout(() => setIsLocked(true), 3 * 60 * 1000);
        }
    };

    // Start/Stop timer based on lock state
    useEffect(() => {
        resetAutoLock();
        return () => clearTimeout(autoLockTimeoutRef.current);
    }, [isLocked]);

    const calculateNextWorkspace = (current, allWorkspaces, count) => {
        let next = (current + 1) % count;
        let attempts = 0;
        const selection = settings?.dashboardRotationSelection || {};

        // Skip disabled workspaces
        // We only skip empty if in rotation mode, but for manual arrow keys, 
        // maybe the user wants to see an empty one they just created?
        // User said "switch visible workspace", usually implying enabled ones.
        while (attempts < count) {
            const isEmpty = !allWorkspaces[next]?.widgets || allWorkspaces[next].widgets.length === 0;
            if (selection[next] !== false && !isEmpty) break;

            next = (next + 1) % count;
            attempts++;
        }
        return next;
    };

    const calculatePrevWorkspace = (current, allWorkspaces, count) => {
        let prev = (current - 1 + count) % count;
        let attempts = 0;
        const selection = settings?.dashboardRotationSelection || {};

        while (attempts < count) {
            const isEmpty = !allWorkspaces[prev]?.widgets || allWorkspaces[prev].widgets.length === 0;
            if (selection[prev] !== false && !isEmpty) break;

            prev = (prev - 1 + count) % count;
            attempts++;
        }
        return prev;
    };

    const saveTimeoutRef = useRef(null);

    // Handlers
    // Handlers
    const handleLayoutFinalize = (layout) => {
        if (!areAllLoaded) return;

        resetAutoLock(); // Reset timer on layout change

        // Update state and persist only when drag/resize stops
        setWorkspaces(prev => ({
            ...prev,
            [activeWorkspace]: { ...prev[activeWorkspace], layout }
        }));

        if (!disablePersistence) {
            localStorage.setItem(STORAGE_KEYS.getLayoutKey(activeWorkspace), JSON.stringify(layout));
        }
    };

    const onLayoutChange = (wsId, newLayout) => {
        if (!areAllLoaded) return;

        // Skip state update during active drag/resize to prevent render trashing
        if (isDragging) return;

        setWorkspaces(prev => ({
            ...prev,
            [wsId]: { ...prev[wsId], layout: newLayout }
        }));
    };

    // ... (rest of file until GridLayout render) ...
    // Note: I can't span that far. I will do this in two chunks if needed or just target the props.
    // The previous edit was adding logs and the prop was added before that.
    // I can remove the logs first.


    const handleSaveWidget = (type, value, id = null, targetWorkspaceId = null) => {
        if (!areAllLoaded) return;
        resetAutoLock(); // Reset timer on add/edit
        addToHistory(); // Capture state before add/edit
        const currentWS = workspaces[activeWorkspace];

        if (id) {
            // Edit Existing
            // Check for Move
            if (targetWorkspaceId !== null && targetWorkspaceId !== undefined && targetWorkspaceId !== activeWorkspace) {
                // MOVE + UPDATE
                const oldWidget = currentWS.widgets.find(w => w.id === id);
                if (!oldWidget) return;

                // Create Updated Widget
                const updatedWidget = { ...oldWidget, type, value, reloadVersion: (oldWidget.reloadVersion || 0) + 1 };

                // Remove from Current
                const newCurrentWidgets = currentWS.widgets.filter(w => w.id !== id);
                const newCurrentLayout = (currentWS.layout || []).filter(l => l.i !== id);

                // Add to Target
                let targetData = workspaces[targetWorkspaceId];
                if (!targetData) {
                    try {
                        const w = localStorage.getItem(STORAGE_KEYS.getWidgetKey(targetWorkspaceId));
                        const l = localStorage.getItem(STORAGE_KEYS.getLayoutKey(targetWorkspaceId));
                        targetData = { widgets: w ? JSON.parse(w) : [], layout: l ? JSON.parse(l) : [] };
                    } catch (e) { targetData = { widgets: [], layout: [] }; }
                }

                // Get Size from Layout
                const existingLayoutItem = (currentWS.layout || []).find(l => l.i === id);
                const w = existingLayoutItem?.w || updatedWidget.w || 4;
                const h = existingLayoutItem?.h || updatedWidget.h || 4;

                const newTargetWidgets = [...targetData.widgets, updatedWidget];
                const newLayoutItem = { i: updatedWidget.id, x: 0, y: Infinity, w, h };
                const newTargetLayout = [...(targetData.layout || []), newLayoutItem];

                // Update State
                setWorkspaces(prev => ({
                    ...prev,
                    [activeWorkspace]: { widgets: newCurrentWidgets, layout: newCurrentLayout },
                    [targetWorkspaceId]: { widgets: newTargetWidgets, layout: newTargetLayout }
                }));

                // Persist
                if (!disablePersistence) {
                    localStorage.setItem(STORAGE_KEYS.getWidgetKey(activeWorkspace), JSON.stringify(newCurrentWidgets));
                    localStorage.setItem(STORAGE_KEYS.getLayoutKey(activeWorkspace), JSON.stringify(newCurrentLayout));
                    localStorage.setItem(STORAGE_KEYS.getWidgetKey(targetWorkspaceId), JSON.stringify(newTargetWidgets));
                    localStorage.setItem(STORAGE_KEYS.getLayoutKey(targetWorkspaceId), JSON.stringify(newTargetLayout));
                }
            } else {
                // UPDATE IN PLACE
                // Ensure we update layout if needed? No, layout shouldn't change on edit unless we change size which we don't here.
                // But we persist value changes.
                const newWidgets = currentWS.widgets.map(w => w.id === id ? { ...w, type, value, reloadVersion: (w.reloadVersion || 0) + 1 } : w);

                setWorkspaces(prev => ({ ...prev, [activeWorkspace]: { ...prev[activeWorkspace], widgets: newWidgets } }));
                if (!disablePersistence) {
                    localStorage.setItem(STORAGE_KEYS.getWidgetKey(activeWorkspace), JSON.stringify(newWidgets));
                }
            }
        } else {
            // Add new
            const newId = `${type}-${Date.now()}`;
            const targetWSId = (targetWorkspaceId !== null && targetWorkspaceId !== undefined) ? targetWorkspaceId : activeWorkspace;
            const targetWS = workspaces[targetWSId];
            const layout = targetWS?.layout || [];

            const maxY = layout.length > 0 ? Math.max(...layout.map(l => l.y + l.h)) : 0;
            // Ticker/Service: 2x1, Icon: 1x1, Iframe-like/RSS: 6x4, Weather: 4x4, Media: 3x5, Camera: 3x2, Others: 12x8
            const isIframeLike = ['iframe', 'proxy', 'web', 'rss'].includes(type);
            const is2x1 = ['ticker', 'service'].includes(type);
            const defaultW = is2x1 ? 2 : type === 'icon' ? 1 : type === 'weather' ? 4 : (type === 'media' || type === 'camera') ? 3 : isIframeLike ? 6 : 12;
            const defaultH = is2x1 ? 1 : type === 'icon' ? 1 : type === 'weather' ? 4 : type === 'media' ? 5 : type === 'camera' ? 2 : isIframeLike ? 4 : 8;

            const newWidget = {
                id: newId,
                type,
                value,
                w: defaultW,
                h: defaultH,
                x: 0,
                y: maxY,
                isMaximized: false,
                preMaximizedW: defaultW,
                preMaximizedH: defaultH,
                reloadVersion: 1
            };

            const newWidgets = [...(targetWS?.widgets || []), newWidget];
            const newLayout = [...layout, { i: newId, x: 0, y: maxY, w: newWidget.w, h: newWidget.h }];

            setWorkspaces(prev => ({
                ...prev,
                [targetWSId]: { widgets: newWidgets, layout: newLayout }
            }));

            if (!disablePersistence) {
                localStorage.setItem(STORAGE_KEYS.getWidgetKey(targetWSId), JSON.stringify(newWidgets));
                localStorage.setItem(STORAGE_KEYS.getLayoutKey(targetWSId), JSON.stringify(newLayout));
            }
        }

        setIsModalOpen(false);
    };

    const handleReloadWidget = (id) => {
        if (!areAllLoaded) return;
        const currentWS = workspaces[activeWorkspace];
        const newWidgets = currentWS.widgets.map(w => {
            if (w.id === id) {
                return { ...w, reloadVersion: (w.reloadVersion || 0) + 1 };
            }
            return w;
        });

        setWorkspaces(prev => ({
            ...prev,
            [activeWorkspace]: { ...prev[activeWorkspace], widgets: newWidgets }
        }));
    };

    const handleDeleteWidget = (id) => {
        if (!areAllLoaded) return;
        resetAutoLock(); // Reset timer on delete
        addToHistory(); // Capture state before delete

        const currentWS = workspaces[activeWorkspace];
        const newWidgets = currentWS.widgets.filter(w => w.id !== id);
        const newLayout = currentWS.layout.filter(l => l.i !== id);

        setWorkspaces(prev => ({
            ...prev,
            [activeWorkspace]: { widgets: newWidgets, layout: newLayout }
        }));

        if (!disablePersistence) {
            localStorage.setItem(STORAGE_KEYS.getWidgetKey(activeWorkspace), JSON.stringify(newWidgets));
            // Layout updates automatically via onLayoutChange usually, but explicit delete might need explicit save if grid doesn't trigger it immediately
            // Actually react-grid-layout triggers onLayoutChange when items are removed? usage suggests we should save it.
            localStorage.setItem(STORAGE_KEYS.getLayoutKey(activeWorkspace), JSON.stringify(newLayout));
        }
    };

    const handleToggleWidgetSize = (id) => {
        if (!areAllLoaded) return;
        addToHistory();

        const currentWS = workspaces[activeWorkspace];
        const widget = currentWS.widgets.find(w => w.id === id);
        if (!widget) return;

        const nextMaximized = !widget.isMaximized;

        const currentLayoutItem = currentWS.layout.find(l => l.i === id);

        const newWidgets = currentWS.widgets.map(w => {
            if (w.id === id) {
                const nextState = { ...w, isMaximized: nextMaximized };
                // If we are MAXIMIZING, store the current size so we can shrink back to it
                if (nextMaximized && currentLayoutItem) {
                    nextState.preMaximizedW = currentLayoutItem.w;
                    nextState.preMaximizedH = currentLayoutItem.h;
                }
                return nextState;
            }
            return w;
        });

        const newLayout = currentWS.layout.map(l => {
            if (l.i === id) {
                if (!nextMaximized) {
                    // Shrink to pre-maximized size or default V2 sizes
                    const isIframeLike = ['iframe', 'proxy', 'web', 'rss'].includes(widget.type);
                    const is2x1 = ['ticker', 'service'].includes(widget.type);
                    const defaultW = is2x1 ? 2 : widget.type === 'icon' ? 1 : widget.type === 'weather' ? 4 : (widget.type === 'media' || widget.type === 'camera') ? 3 : isIframeLike ? 6 : 12;
                    const defaultH = is2x1 ? 1 : widget.type === 'icon' ? 1 : widget.type === 'weather' ? 4 : widget.type === 'media' ? 5 : widget.type === 'camera' ? 2 : isIframeLike ? 4 : 8;

                    const restoredW = widget.preMaximizedW || defaultW;
                    const restoredH = widget.preMaximizedH || defaultH;

                    return { ...l, w: restoredW, h: restoredH };
                } else {
                    // Maximize: Target ~85% of screen height
                    // If h=8 is filling the screen, we'll use h=7 as a safe maximum
                    const calculatedH = 7;

                    // Maximize to full width and safe height
                    return { ...l, x: 0, y: 0, w: 48, h: calculatedH };
                }
            }
            return l;
        });

        setWorkspaces(prev => ({
            ...prev,
            [activeWorkspace]: { widgets: newWidgets, layout: newLayout }
        }));

        if (!disablePersistence) {
            localStorage.setItem(STORAGE_KEYS.getWidgetKey(activeWorkspace), JSON.stringify(newWidgets));
            localStorage.setItem(STORAGE_KEYS.getLayoutKey(activeWorkspace), JSON.stringify(newLayout));
        }
    };

    const openAddModal = () => { setEditingWidget(null); setIsModalOpen(true); };
    const openEditModal = (widget) => { setEditingWidget(widget); setIsModalOpen(true); };

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (isLocked) return;
            if (isRestricted) return; // No workspace switching in restricted mode

            if (e.ctrlKey && e.altKey) {
                // Ctrl+Alt+Left/Right Arrow for workspace switching
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setActiveWorkspace(prev => calculatePrevWorkspace(prev, workspaces, workspaceCount));
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    setActiveWorkspace(prev => calculateNextWorkspace(prev, workspaces, workspaceCount));
                }
            } else if (e.key === 'Escape') {
                // Escape to close modals
                if (isModalOpen) {
                    setIsModalOpen(false);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isLocked, isRestricted, isModalOpen, workspaces, workspaceCount, setActiveWorkspace]);


    // Swipe Handlers
    const touchStartRef = useRef(null);
    const touchEndRef = useRef(null);

    const onTouchStart = (e) => {
        touchEndRef.current = null;
        touchStartRef.current = e.targetTouches[0].clientX;
    };

    const onTouchMove = (e) => {
        touchEndRef.current = e.targetTouches[0].clientX;
    };

    const onTouchEnd = () => {
        if (!touchStartRef.current || !touchEndRef.current) return;

        // Prevent swipe if unlocked (dragging widgets)
        if (!isLocked) return;
        if (isRestricted) return; // No workspace switching in restricted mode

        const distance = touchStartRef.current - touchEndRef.current;
        const isLeftSwipe = distance > 50;
        const isRightSwipe = distance < -50;

        if (isLeftSwipe) {
            // Next Workspace
            setActiveWorkspace(prev => calculateNextWorkspace(prev, workspaces, workspaceCount));
        }
        if (isRightSwipe) {
            // Prev Workspace
            setActiveWorkspace(prev => calculatePrevWorkspace(prev, workspaces, workspaceCount));
        }
    };

    const [isDragging, setIsDragging] = useState(false);

    if (!areAllLoaded) return <div className="min-h-screen bg-black/20 text-white flex items-center justify-center">Loading Dashboard...</div>;

    const renderWorkspace = (wsIndex, isPreload = false) => {
        const wsData = workspaces[wsIndex];
        if (!wsData) return null;

        return (
            <div
                key={wsIndex}
                className={`
                    w-full h-full col-start-1 row-start-1 
                    ${isPreload ? 'invisible z-0 pointer-events-none' : 'z-10 animate-workspace-enter'}
                `}
                aria-hidden={isPreload}
            >
                <GridLayout
                    className={`layout ${isLocked ? 'layout-locked' : ''}`}
                    layout={wsData.layout.map(l => ({
                        ...l,
                        static: isLocked,
                        isDraggable: !isLocked,
                        isResizable: !isLocked
                    }))}
                    cols={48}
                    rowHeight={30}
                    width={width}
                    onLayoutChange={(l) => !isPreload && onLayoutChange(wsIndex, l)}
                    onDragStart={() => { setIsDragging(true); addToHistory(); }}
                    onDragStop={(layout) => { setIsDragging(false); handleLayoutFinalize(layout); }}
                    onResizeStart={() => { setIsDragging(true); addToHistory(); }}
                    onResizeStop={(layout) => { setIsDragging(false); handleLayoutFinalize(layout); }}
                    draggableCancel=".no-drag"
                    isDraggable={!isLocked && !isPreload}
                    isResizable={!isLocked && !isPreload}
                    compactType={null}
                    preventCollision={false}
                    draggableHandle=".zulu-drag-handle"
                    margin={[0, 0]}
                    resizeHandles={isLocked || isPreload ? [] : ['se']}
                >
                    {wsData.widgets.map(widget => (
                        <div key={widget.id} className={`widget-item relative ${widget.isMaximized ? 'widget-maximized' : ''} ${(!isLocked && !isPreload) ? 'ring-1 ring-orange-500/50 z-50' : ''}`}>
                            <div
                                className={`
                                    widget-content h-full w-full group 
                                    ${widget.type === 'icon' ? 'overflow-visible' : 'overflow-hidden'}
                                    ${widget.type !== 'icon' ? 'border border-white/5' : ''}
                                    transition-all duration-300 transform 
                                    ${widget.type !== 'ticker' && widget.type !== 'icon' ? 'glass-panel' : ''}
                                    ${(!isLocked && !isPreload) ? 'cursor-move' : 'hover:z-10'}
                                    ${isDragging ? 'pointer-events-none' : ''}
                                    ${alertStates[widget.id]?.status === 'down' ? 'widget-broken' : ''}
                                    ${alertStates[widget.id]?.isVibrating ? 'animate-shake' : ''}
                                `}
                            >
                                {/* Drag Handle - Constrained width to avoid covering buttons */}
                                {!isLocked && !isPreload && (
                                    <div className={`zulu-drag-handle absolute top-0 left-0 w-full h-10 px-3 z-40 cursor-grab active:cursor-grabbing flex items-center justify-start bg-black/40 backdrop-blur-sm text-white/50 hover:text-white transition-colors ${isDragging ? 'pointer-events-auto' : ''}`}>
                                        {widget.type === 'iframe' ? (() => {
                                            const [rawUrl, displayName] = (widget.value || '').split('|');
                                            let title = displayName || "Widget";
                                            let hostname = "";
                                            try {
                                                const urlObj = new URL(rawUrl, 'http://base.com');
                                                hostname = urlObj.hostname;
                                                if (hostname !== 'base.com' && !displayName) {
                                                    title = hostname.replace('www.', '');
                                                }
                                            } catch { /* ignore */ }

                                            return (
                                                <>
                                                    <img
                                                        src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                                                        alt="icon"
                                                        className="w-3.5 h-3.5 mr-2 opacity-80"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                    <span className="text-xs font-bold truncate opacity-80">{title}</span>
                                                </>
                                            );
                                        })() : widget.type === 'weather' ? (() => {
                                            const [location] = (widget.value || '').split('|');
                                            const city = location?.split(',')[0] || "Weather";
                                            return (
                                                <>
                                                    <CloudSun size={14} className="mr-2 opacity-80" />
                                                    <span className="text-xs font-bold truncate opacity-80">{city}</span>
                                                </>
                                            );
                                        })() : widget.type === 'camera' ? (() => {
                                            const [rawUrl, displayName] = (widget.value || '').split('|');
                                            let title = displayName || "Camera";
                                            if (!displayName) {
                                                try {
                                                    const urlObj = new URL(rawUrl, 'http://base.com');
                                                    const srcParam = urlObj.searchParams.get('src');
                                                    if (srcParam) {
                                                        title = srcParam.charAt(0).toUpperCase() + srcParam.slice(1);
                                                    } else {
                                                        title = `Camera ${widget.id.split('-').pop()}`;
                                                    }
                                                } catch { /* ignore */ }
                                            }
                                            return (
                                                <>
                                                    <Video size={14} className="mr-2 opacity-80" />
                                                    <span className="text-xs font-bold truncate opacity-80">{title}</span>
                                                </>
                                            );
                                        })() : widget.type === 'rss' ? (() => {
                                            const [url, displayName] = (widget.value || '').split('|');
                                            let title = displayName || "RSS Feed";
                                            if (!displayName) {
                                                try {
                                                    const urlObj = new URL(url);
                                                    title = urlObj.hostname.replace('www.', '');
                                                } catch { /* ignore */ }
                                            }
                                            return (
                                                <>
                                                    <Rss size={14} className="mr-2 opacity-80" />
                                                    <span className="text-xs font-bold truncate opacity-80">{title}</span>
                                                </>
                                            );
                                        })() : widget.type === 'ticker' ? null : widget.type === 'media' ? (
                                            <>
                                                <Image size={14} className="mr-2 opacity-80" />
                                                <span className="text-xs font-bold uppercase tracking-wider opacity-50">Slide Show</span>
                                            </>
                                        ) : widget.type === 'service' ? (
                                            <>
                                                <Activity size={14} className="mr-2 opacity-80" />
                                                <span className="text-xs font-bold uppercase tracking-wider opacity-50">Health Check</span>
                                            </>
                                        ) : (
                                            <>
                                                <GripHorizontal size={16} className="mr-2" />
                                                <span className="text-xs font-bold uppercase tracking-wider opacity-50">Move</span>
                                            </>
                                        )}
                                    </div>
                                )}

                                <WidgetRenderer
                                    key={widget.reloadVersion || 0}
                                    widget={widget}
                                    isLocked={isLocked}
                                    finnhubKey={settings?.finnhubKey}
                                />
                            </div>

                            {/* Widget Controls - Moved to bottom of child to ensure it's higher in the stacking order */}
                            {!isLocked && !isPreload && (
                                <div
                                    className="absolute top-1 right-1 flex items-center bg-black/90 backdrop-blur-xl rounded-none border border-white/20 z-[200] no-drag overflow-hidden pointer-events-auto shadow-2xl"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onTouchStart={(e) => e.stopPropagation()}
                                    onMouseDown={(e) => e.stopPropagation()}
                                >
                                    {['iframe', 'proxy', 'web', 'camera', 'rss'].includes(widget.type) && (
                                        <>
                                            <button
                                                className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus"
                                                onPointerDown={(e) => { e.stopPropagation(); handleToggleWidgetSize(widget.id); }}
                                                title={widget.isMaximized ? "Shrink to Default" : "Expand to Grid"}
                                            >
                                                {widget.isMaximized ? <Minimize size={14} /> : <Maximize size={14} />}
                                            </button>
                                            <div className="w-[1px] h-4 bg-white/10"></div>
                                        </>
                                    )}
                                    <button
                                        className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-orange-500 transition-colors cursor-pointer"
                                        onPointerDown={(e) => { e.stopPropagation(); openEditModal(widget); }}
                                        title="Widget Settings"
                                    >
                                        <SlidersHorizontal size={14} />
                                    </button>

                                    <div className="w-[1px] h-4 bg-white/10"></div>

                                    <button
                                        className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-orange-500 transition-colors cursor-pointer"
                                        onPointerDown={(e) => { e.stopPropagation(); handleDeleteWidget(widget.id); }}
                                        title="Delete Widget"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))
                    }
                </GridLayout >
            </div >
        );
    };

    const isFullScreenMode = isManualFullScreen;

    return (
        <div
            className="zulu7-container relative min-h-screen transition-colors duration-500"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
        >

            {/* Top Title Bar / Controls - Hidden in Full Screen Mode */}
            {!isFullScreenMode && (
                <Zulu7Header
                    settings={settings}
                    isLocked={isLocked}
                    setIsLocked={setIsLocked}
                    onOpenSettings={onOpenSettings}
                    openAddModal={openAddModal}
                    activeWorkspace={activeWorkspace}
                    setActiveWorkspace={setActiveWorkspace}
                    onUpdateSettings={onUpdateSettings}
                    onOpenCalendar={(date = null) => {
                        setCalendarInitialDate(date);
                        setIsCalendarOpen(true);
                    }}
                    totalWorkspaces={workspaceCount}
                    onAddWorkspace={handleAddWorkspace}
                    onDeleteWorkspace={handleDeleteWorkspace}
                    onSwapWorkspaces={handleSwapWorkspaces}
                    disablePersistence={disablePersistence}
                    isRestricted={isRestricted}
                />
            )}

            {/* Full Screen Toggle Button (Bottom Left - Always Visible) */}
            <button
                className="fixed bottom-2 left-6 z-[100] h-9 w-9 flex items-center justify-center rounded-full text-orange-500 hover:text-orange-400 hover:scale-125 active:scale-95 group cursor-pointer transition-transform duration-300 ease-out border-none outline-none ring-0 bg-transparent shadow-none"
                onClick={(e) => {
                    e.stopPropagation();
                    // Toggle Manual Full Screen - WITHOUT affecting rotation
                    if (!isManualFullScreen) {
                        try {
                            if (document.documentElement.requestFullscreen) {
                                document.documentElement.requestFullscreen();
                            } else if (document.documentElement.webkitRequestFullscreen) { /* Safari */
                                document.documentElement.webkitRequestFullscreen();
                            } else if (document.documentElement.msRequestFullscreen) { /* IE11 */
                                document.documentElement.msRequestFullscreen();
                            }
                        } catch (err) { console.error("Error attempting to enable full-screen mode:", err); }
                    } else {
                        try {
                            if (document.exitFullscreen) {
                                document.exitFullscreen();
                            } else if (document.webkitExitFullscreen) { /* Safari */
                                document.webkitExitFullscreen();
                            } else if (document.msExitFullscreen) { /* IE11 */
                                document.msExitFullscreen();
                            }
                        } catch (err) { console.error("Error attempting to exit full-screen mode:", err); }
                    }
                    setIsManualFullScreen(!isManualFullScreen);
                }}
                onTouchStart={(e) => e.stopPropagation()}
                title={isFullScreenMode ? "Exit Full Screen" : "Enter Full Screen"}
                aria-label={isFullScreenMode ? "Exit Full Screen" : "Enter Full Screen"}
            >
                {isFullScreenMode ? (
                    <Minimize size={20} className="" aria-hidden="true" />
                ) : (
                    <Maximize size={20} className="" aria-hidden="true" />
                )}
                <span className="sr-only">{isFullScreenMode ? "Exit Full Screen" : "Enter Full Screen"}</span>
            </button>

            {/* Main Grid Area - Remove padding in Full Screen Mode */}
            <div ref={containerRef} className={`w-full min-h-screen bg-black/20 grid grid-cols-1 grid-rows-1 overflow-y-auto overflow-x-hidden custom-scrollbar ${isFullScreenMode ? '' : 'pt-16'}`}>
                {mounted && (() => {
                    const nextWS = settings?.isWorkspaceRotationEnabled ? calculateNextWorkspace(activeWorkspace, workspaces, workspaceCount) : -1;

                    return Array.from({ length: workspaceCount }).map((_, i) => {
                        const isActive = i === activeWorkspace;
                        const isNext = i === nextWS;

                        if (isActive || isNext) {
                            // Pass true for isPreload if it is the 'next' one and NOT the active one (though usually distinct)
                            return renderWorkspace(i, isNext && !isActive);
                        }
                        return null;
                    });
                })()}
            </div>

            <AddWidgetModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleSaveWidget}
                onDelete={handleDeleteWidget}
                editWidget={editingWidget}
                streamerUrl={settings?.streamerUrl}
                streamApiKey={settings?.streamApiKey}
                onOpenSettings={onOpenSettings}
                settings={settings}
                totalWorkspaces={workspaceCount}
                activeWorkspace={activeWorkspace}
            />

            <CalendarOverlay
                isOpen={isCalendarOpen}
                onClose={() => setIsCalendarOpen(false)}
                initialDate={calendarInitialDate}
            />
        </div>
    );
};

export default Zulu7Grid;
