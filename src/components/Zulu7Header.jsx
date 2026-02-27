import React, { useState, useEffect, useRef } from 'react';
import { Plus, SlidersHorizontal, Lock, Unlock, CalendarDays, Play, Pause, Minus, ChevronDown, Square, Share2, X, History, Monitor, Tv, Calendar, DollarSign, Cake, Copy, Check, Pencil, GripVertical } from 'lucide-react';
import { STORAGE_KEYS } from '../utils/constants';

const Zulu7Header = ({ settings, isLocked, setIsLocked, onOpenSettings, openAddModal, activeWorkspace, setActiveWorkspace, onOpenCalendar, onUpdateSettings, totalWorkspaces = 7, onAddWorkspace, onDeleteWorkspace, onSwapWorkspaces, disablePersistence, isRestricted = false }) => {
    const [currentTime, setCurrentTime] = useState(new Date());
    const [draggedIndex, setDraggedIndex] = useState(null);
    const [dragOverIndex, setDragOverIndex] = useState(null);
    const [todayEventTypes, setTodayEventTypes] = useState([]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const dropdownRef = useRef(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');

    // History Dropdown State
    const [history, setHistory] = useState([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const historyRef = useRef(null);
    const [copiedId, setCopiedId] = useState(null);
    const [draggedHistoryIdx, setDraggedHistoryIdx] = useState(null);
    const [historyDragOverIdx, setHistoryDragOverIdx] = useState(null);

    // Dynamic Space Management
    const headerRef = useRef(null);
    const leftSideRef = useRef(null);
    const rightSideRef = useRef(null);
    const [isHeaderTight, setIsHeaderTight] = useState(false);
    const ghostRightSideRef = useRef(null);

    useEffect(() => {
        if (!headerRef.current || !leftSideRef.current || !ghostRightSideRef.current) return;

        const checkSpace = () => {
            const headerWidth = headerRef.current.offsetWidth;
            const leftWidth = leftSideRef.current.offsetWidth;
            const ghostRightWidth = ghostRightSideRef.current.offsetWidth;
            const padding = 48; // px-6 on both sides
            const minGap = 40;

            // Use the stable ghost width to decide if the header should be tight
            const combinedWidth = leftWidth + ghostRightWidth + padding + minGap;

            if (combinedWidth > headerWidth) {
                if (!isHeaderTight) setIsHeaderTight(true);
            } else if (combinedWidth < headerWidth - 40) {
                // Add hysteresis (40px buffer) to prevent flickering at the threshold
                if (isHeaderTight) setIsHeaderTight(false);
            }
        };

        const observer = new ResizeObserver(checkSpace);
        observer.observe(headerRef.current);
        observer.observe(leftSideRef.current);
        // Observe ghost instead of active right side
        observer.observe(ghostRightSideRef.current);

        checkSpace();
        return () => observer.disconnect();
    }, [isHeaderTight]);

    // Initial Load of History
    useEffect(() => {
        const loadHistory = () => {
            try {
                const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_HISTORY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    setHistory(parsed);
                }
            } catch (e) { console.error(e); }
        };
        loadHistory();

        // Listen for storage events (in case updated in another tab, though unlikely to matter much here)
        window.addEventListener('storage', loadHistory);
        return () => window.removeEventListener('storage', loadHistory);
    }, []);

    const deleteHistoryItem = (e, id) => {
        e.stopPropagation();
        if (window.confirm("Are you sure you want to forget this shared dashboard?")) {
            const newHistory = history.filter(h => h.id !== id);
            setHistory(newHistory);
            localStorage.setItem(STORAGE_KEYS.DASHBOARD_HISTORY, JSON.stringify(newHistory));
        }
    };

    const renameHistoryItem = (e, item) => {
        e.stopPropagation();
        const newName = window.prompt("Enter new name for this dashboard:", item.name);
        if (newName && newName.trim() !== "" && newName !== item.name) {
            const newHistory = history.map(h => h.id === item.id ? { ...h, name: newName.trim() } : h);
            setHistory(newHistory);
            localStorage.setItem(STORAGE_KEYS.DASHBOARD_HISTORY, JSON.stringify(newHistory));
        }
    };

    const handleCopy = (e, item) => {
        e.stopPropagation();
        const urlToCopy = item.url.startsWith('http') ? item.url : `${window.location.origin}${item.url}`;

        const copyFallback = (text) => {
            const textArea = document.createElement("textarea");
            textArea.value = text;
            textArea.style.top = "0";
            textArea.style.left = "0";
            textArea.style.position = "fixed";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    setCopiedId(item.id);
                    setTimeout(() => setCopiedId(null), 2000);
                }
            } catch (err) {
                console.error('Fallback: Oops, unable to copy', err);
            }
            document.body.removeChild(textArea);
        };

        if (!navigator.clipboard) {
            copyFallback(urlToCopy);
            return;
        }

        navigator.clipboard.writeText(urlToCopy).then(() => {
            setCopiedId(item.id);
            setTimeout(() => setCopiedId(null), 2000);
        }).catch((err) => {
            console.error('Async: Could not copy text: ', err);
            copyFallback(urlToCopy);
        });
    };

    const renameWorkspace = (e, index, currentName) => {
        e.stopPropagation();
        const newName = window.prompt("Enter new name for this dashboard:", currentName);
        if (newName && newName.trim() !== "" && newName !== currentName) {
            const newNames = { ...(settings?.dashboardNames || {}) };
            newNames[index] = newName.trim();
            if (onUpdateSettings) onUpdateSettings({ ...settings, dashboardNames: newNames });
        }
    };

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
            if (historyRef.current && !historyRef.current.contains(event.target)) {
                setIsHistoryOpen(false);
            }
        };

        if (isDropdownOpen || isHistoryOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen, isHistoryOpen]);

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Helper for icons
    const EVENT_ICONS = {
        appointment: <Calendar size={18} className="text-orange-500" />,
        bill: <DollarSign size={18} className="text-orange-500" />,
        birthday: <Cake size={18} className="text-orange-500" />
    };

    // Check for events
    const checkEvents = () => {
        const saved = localStorage.getItem('zulu7_calendar_events');
        if (!saved) {
            setTodayEventTypes([]);
            return;
        }

        try {
            const events = JSON.parse(saved);
            if (!Array.isArray(events)) return;

            const now = new Date();
            const targetDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

            // Re-implement check logic
            const [tY, tM, tD] = targetDateStr.split('-').map(Number);

            const typesFound = new Set();

            events.forEach(e => {
                const [sY, sM, sD] = e.date.split('-').map(Number);

                // Safety check
                if (sY > tY || (sY === tY && sM > tM) || (sY === tY && sM === tM && sD > tD)) return;

                let isToday = false;

                if (e.recurrence === 'none') isToday = e.date === targetDateStr;
                else if (e.recurrence === 'daily') isToday = true;
                else if (e.recurrence === 'weekly') {
                    const start = new Date(e.date);
                    const current = new Date(targetDateStr);
                    const diffTime = Math.abs(current - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    isToday = diffDays % 7 === 0;
                }
                else if (e.recurrence === 'monthly') isToday = sD === tD;
                else if (e.recurrence === 'yearly') isToday = sD === tD && sM === tM;

                if (isToday) {
                    typesFound.add(e.type || 'appointment');
                }
            });

            setTodayEventTypes(Array.from(typesFound));

        } catch {
            // ignore
        }
    };

    useEffect(() => {
        checkEvents(); // eslint-disable-line react-hooks/set-state-in-effect

        // Poll every minute (for midnight rollover)
        const interval = setInterval(checkEvents, 60000);

        // Listen for updates from CalendarOverlay
        const handleUpdate = () => checkEvents();
        window.addEventListener('calendar-updated', handleUpdate);

        return () => {
            clearInterval(interval);
            window.removeEventListener('calendar-updated', handleUpdate);
        };
    }, []);

    const formatTime = (date) => {
        const timeZone = settings?.timeZone === 'local' ? undefined : settings?.timeZone;
        try {
            return new Intl.DateTimeFormat('en-US', {
                hour: 'numeric', minute: '2-digit',
                hour12: true, timeZone
            }).format(date);
        } catch { return date.toLocaleTimeString(); }
    };

    const formatDate = (date) => {
        const timeZone = settings?.timeZone === 'local' ? undefined : settings?.timeZone;
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                timeZone
            }).formatToParts(date);

            const weekday = parts.find(p => p.type === 'weekday').value;
            const month = parts.find(p => p.type === 'month').value;
            const day = parts.find(p => p.type === 'day').value;

            const getOrdinal = (n) => {
                const s = ["th", "st", "nd", "rd"];
                const v = n % 100;
                return n + (s[(v - 20) % 10] || s[v] || s[0]);
            };

            return `${weekday}, ${month} ${getOrdinal(parseInt(day))}`;
        } catch {
            return date.toLocaleDateString();
        }
    };

    return (
        <>
            <div ref={headerRef} className="fixed top-0 left-0 right-0 h-14 z-[100] flex items-center justify-between px-6 bg-black/60 backdrop-blur-md border-b border-white/5 shadow-2xl">
                {/* Left Side: Workspaces Only */}
                <div ref={leftSideRef} className="flex items-center">
                    {/* Rotation Toggle (Floating Left) */}
                    {!isRestricted && (
                        <button
                            onClick={() => {
                                if (onUpdateSettings) {
                                    const newStatus = !settings.isWorkspaceRotationEnabled;
                                    // If starting rotation, auto-lock
                                    if (newStatus && !isLocked) {
                                        setIsLocked(true);
                                    }
                                    onUpdateSettings({
                                        ...settings,
                                        isWorkspaceRotationEnabled: newStatus
                                    });
                                }
                            }}
                            className={`
                                h-7 w-7 flex items-center justify-center transition-all duration-300 mr-3 cursor-pointer
                                text-orange-500 hover:text-orange-400 hover:scale-125 active:scale-95
                            `}
                            title={settings?.isWorkspaceRotationEnabled ? "Stop Dashboard Rotation" : "Start Dashboard Rotation"}
                        >
                            {settings?.isWorkspaceRotationEnabled ? <Square size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                        </button>
                    )}

                    {/* Workspace Tabs */}
                    {!isRestricted && (
                        <div className="flex items-center bg-white/5 rounded-none p-1 border border-white/5">
                            {/* Scrollable List */}
                            <div
                                className="flex items-center space-x-1 overflow-x-auto max-w-[140px] md:max-w-[220px] no-scrollbar scroll-smooth"
                                ref={(el) => {
                                    if (el && activeWorkspace >= 0) {
                                        // Simple auto-scroll to keep active in view
                                        const activeBtn = el.children[activeWorkspace];
                                        if (activeBtn) {
                                            activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                                        }
                                    }
                                }}
                            >
                                {Array.from({ length: totalWorkspaces }).map((_, i) => {
                                    const isEnabled = settings?.dashboardRotationSelection?.[i] !== false;
                                    const name = settings?.dashboardNames?.[i] ?? `Dashboard #${i + 1}`;
                                    const isBeingDragged = draggedIndex === i;
                                    const isTargeted = dragOverIndex === i;
                                    return (
                                        <a
                                            key={i}
                                            href={new URL(`?w=${i}${window.location.search.replace(/[?&]w=\d+/, '').replace(/^\?/, '&')}`, window.location.origin).href}
                                            data-number={i + 1}
                                            draggable={isEnabled}
                                            onDragStart={(e) => {
                                                // If unlocked, we handle internal reordering
                                                if (!isLocked) {
                                                    setDraggedIndex(i);
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    e.dataTransfer.setData('text/plain', i.toString());
                                                }
                                                // If locked, we don't call e.preventDefault() or anything,
                                                // letting the browser handle the standard anchor drag for bookmarking.
                                            }}
                                            onDragOver={(e) => {
                                                if (isLocked) return;
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = 'move';
                                                if (dragOverIndex !== i) setDragOverIndex(i);
                                            }}
                                            onDragLeave={() => {
                                                setDragOverIndex(null);
                                            }}
                                            onDragEnd={() => {
                                                setDraggedIndex(null);
                                                setDragOverIndex(null);
                                            }}
                                            onDrop={(e) => {
                                                if (isLocked) return;
                                                e.preventDefault();
                                                const sourceIdx = draggedIndex;
                                                const targetIdx = i;
                                                setDraggedIndex(null);
                                                setDragOverIndex(null);
                                                if (sourceIdx !== null && sourceIdx !== targetIdx && onSwapWorkspaces) {
                                                    if (window.confirm(`Swap Dashboard ${sourceIdx + 1} and ${targetIdx + 1}?`)) {
                                                        onSwapWorkspaces(sourceIdx, targetIdx);
                                                    }
                                                }
                                            }}
                                            onClick={(e) => {
                                                if (!isEnabled) {
                                                    e.preventDefault();
                                                    return;
                                                }
                                                e.preventDefault();
                                                setActiveWorkspace(i);
                                                if (settings?.isWorkspaceRotationEnabled && onUpdateSettings) {
                                                    onUpdateSettings({ ...settings, isWorkspaceRotationEnabled: false });
                                                }
                                            }}
                                            title={isEnabled ? (isLocked ? name : `Hold to drag | ${name}`) : `${name} (Disabled)`}
                                            className={`
                                                workspace-bubble no-underline h-7 w-7 min-w-[1.75rem] rounded-none flex items-center justify-center transition-all duration-300 transform
                                                ${isEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-30 bg-white/5 text-white/20'}
                                                ${activeWorkspace === i
                                                    ? 'active-workspace-bubble bg-orange-500 text-white shadow-lg shadow-orange-500/30 scale-110 z-10'
                                                    : (isEnabled ? 'text-white/40 hover:text-orange-400 hover:bg-white/2 hover:scale-125 hover:z-20 hover:shadow-lg hover:shadow-orange-500/20' : '')}
                                                ${isBeingDragged ? 'opacity-20 scale-90 text-white/0' : ''}
                                                ${isTargeted && !isBeingDragged ? 'ring-2 ring-orange-500 bg-orange-500/20 scale-125 z-30' : ''}
                                            `}
                                        >
                                            {name}
                                        </a>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Workspace Management Controls (Add/Delete) - Free Floating, Edit Mode Only */}
                    {!disablePersistence && !isLocked && (
                        <div className="flex items-center ml-1">
                            <button
                                onClick={() => {
                                    const isReset = totalWorkspaces <= 7;
                                    const msg = isReset
                                        ? "Are you sure you want to RESET this dashboard? All widgets will be removed."
                                        : "Are you sure you want to DELETE this dashboard? This cannot be undone.";

                                    if (window.confirm(msg)) {
                                        if (onDeleteWorkspace) onDeleteWorkspace(activeWorkspace);
                                    }
                                }}
                                className="h-9 w-8 flex items-center justify-center transition-all duration-300 transform cursor-pointer text-white/40 hover:text-orange-400 hover:scale-125 active:scale-95"
                                title={totalWorkspaces <= 7 ? "Delete & Reset This Dashboard" : "Delete Current Dashboard"}
                            >
                                <Minus size={16} />
                            </button>
                            <button
                                onClick={() => onAddWorkspace && onAddWorkspace()}
                                className="h-9 w-8 flex items-center justify-center transition-all duration-300 transform cursor-pointer text-white/40 hover:text-orange-400 hover:scale-125 active:scale-95"
                                title="Add New Dashboard"
                            >
                                <Plus size={16} />
                            </button>
                        </div>
                    )}

                    {/* More Workspaces Dropdown (Always available for management) */}
                    {totalWorkspaces >= 7 && !isRestricted && (
                        <div className="relative ml-1" ref={dropdownRef}>
                            <button
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                                className="h-9 w-8 flex items-center justify-center text-white/40 hover:text-orange-400 hover:scale-125 active:scale-95 transition-all duration-300 cursor-pointer"
                                title="Show All Workspaces"
                            >
                                <ChevronDown size={14} className={`transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {/* Dropdown Menu */}
                            {isDropdownOpen && (
                                <div className="absolute top-full left-0 mt-2 w-48 max-h-64 overflow-y-auto bg-[#1a1a20]/90 backdrop-blur-xl rounded shadow-2xl z-[150] custom-scrollbar flex flex-col">
                                    {Array.from({ length: totalWorkspaces }).map((_, i) => {
                                        const isEnabled = settings?.dashboardRotationSelection?.[i] !== false;
                                        const name = settings?.dashboardNames?.[i] ?? `Dashboard ${i + 1}`;
                                        return (
                                            <div
                                                key={i}
                                                className={`
                                            group w-full flex items-center justify-between px-4 py-2 text-sm transition-colors cursor-pointer border-l-2
                                            ${!isEnabled ? 'opacity-30 cursor-not-allowed bg-black/20 text-white/20 border-transparent' : ''}
                                            ${activeWorkspace === i
                                                        ? 'text-orange-400 font-bold border-orange-500'
                                                        : (isEnabled ? 'text-white/70 hover:bg-white/5 hover:text-orange-400 border-transparent' : 'border-transparent')}
                                        `}
                                                onClick={() => {
                                                    if (!isEnabled) return;
                                                    setActiveWorkspace(i);
                                                    setIsDropdownOpen(false);
                                                    if (settings?.isWorkspaceRotationEnabled && onUpdateSettings) {
                                                        onUpdateSettings({ ...settings, isWorkspaceRotationEnabled: false });
                                                    }
                                                }}
                                            >
                                                <span className="truncate flex-1">{name}</span>

                                                {/* Management Icons - Only in Unlock Mode */}
                                                {!isLocked && isEnabled && (
                                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-2">
                                                        <button
                                                            onClick={(e) => renameWorkspace(e, i, name)}
                                                            className="p-1 text-white/20 hover:text-orange-400 transition-all duration-200 transform hover:scale-125 cursor-pointer mr-1"
                                                            title="Rename Dashboard"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const isReset = totalWorkspaces <= 7;
                                                                const msg = isReset
                                                                    ? "Are you sure you want to RESET this dashboard? All widgets will be removed."
                                                                    : "Are you sure you want to DELETE this dashboard? This cannot be undone.";

                                                                if (window.confirm(msg)) {
                                                                    if (onDeleteWorkspace) onDeleteWorkspace(i);
                                                                }
                                                            }}
                                                            className="p-1 text-white/20 hover:text-red-400 transition-all duration-200 transform hover:scale-125 cursor-pointer"
                                                            title={totalWorkspaces <= 7 ? "Reset Dashboard" : "Delete Dashboard"}
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Workspace Name Display & Rename */}
                    {(() => {
                        const workspaceName = settings?.dashboardNames?.[activeWorkspace] || `Dashboard #${activeWorkspace + 1}`;

                        if (isEditing && !isLocked && !isRestricted) {
                            return (
                                <div className={`hidden lg:flex items-center ${((!isLocked && !disablePersistence && !isRestricted) || (totalWorkspaces >= 7 && !isRestricted)) ? 'ml-1' : 'ml-4'}`}>
                                    <input
                                        autoFocus
                                        type="text"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        onBlur={() => {
                                            if (editValue.trim() !== "" && editValue !== workspaceName) {
                                                const newNames = { ...(settings?.dashboardNames || {}) };
                                                newNames[activeWorkspace] = editValue.trim();
                                                if (onUpdateSettings) onUpdateSettings({ ...settings, dashboardNames: newNames });
                                            }
                                            setIsEditing(false);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                if (editValue.trim() !== "" && editValue !== workspaceName) {
                                                    const newNames = { ...(settings?.dashboardNames || {}) };
                                                    newNames[activeWorkspace] = editValue.trim();
                                                    if (onUpdateSettings) onUpdateSettings({ ...settings, dashboardNames: newNames });
                                                }
                                                setIsEditing(false);
                                            } else if (e.key === 'Escape') {
                                                setIsEditing(false);
                                            }
                                        }}
                                        className="bg-transparent border-none p-0 m-0 text-sm font-semibold tracking-wider text-orange-400 focus:outline-none focus:ring-0 w-auto min-w-[50px]"
                                        style={{ width: `${Math.max(editValue.length + 1, 10)}ch` }}
                                    />
                                </div>
                            );
                        }

                        return (
                            <div
                                className={`hidden lg:flex items-center ${((!isLocked && !disablePersistence && !isRestricted) || (totalWorkspaces >= 7 && !isRestricted)) ? 'ml-1' : 'ml-4'} transition-all duration-300 pointer-events-auto`}
                                title={isLocked || isRestricted ? workspaceName : "Double-click to rename workspace"}
                            >
                                <a
                                    href={new URL(`?w=${activeWorkspace}${window.location.search.replace(/[?&]w=\d+/, '').replace(/^\?/, '&')}`, window.location.origin).href}
                                    onDoubleClick={() => {
                                        if (isLocked || isRestricted) return;
                                        setEditValue(workspaceName);
                                        setIsEditing(true);
                                    }}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        setIsDropdownOpen(!isDropdownOpen);
                                    }}
                                    className={`no-underline text-sm font-semibold tracking-wider ${isRestricted ? 'text-white' : 'text-orange-500'} transition-all duration-300 cursor-pointer hover:text-orange-400 flex items-center`}
                                >
                                    {isRestricted && (
                                        <div className="mr-2 w-5 h-3.5 border border-orange-500 rounded-[2px] flex items-center justify-center bg-orange-500/10 shrink-0 shadow-sm" title="Z7 | Shared Dashboard">
                                            <span className="text-[9px] font-black leading-none text-orange-500 select-none pb-[1px]" style={{ fontFamily: 'Orbitron, sans-serif' }}>Z</span>
                                        </div>
                                    )}
                                    {workspaceName}
                                </a>
                            </div>
                        );
                    })()}
                </div>

                {/* Right Side: Consolidated Management Group (High Density) */}
                <div ref={rightSideRef} className="flex items-center gap-2">
                    {(!isHeaderTight || isLocked) && (
                        <>
                            <div className="hidden md:flex items-center gap-2 text-white/90 font-mono tracking-wider text-sm">
                                {/* Dynamic Event Icons (Left of Date) - Click to Direct Edit */}
                                {todayEventTypes.length > 0 && (
                                    <div
                                        className={`flex items-center space-x-1.5 mr-1 cursor-pointer p-0.5 rounded transition-colors`}
                                        onClick={() => {
                                            const y = currentTime.getFullYear();
                                            const m = String(currentTime.getMonth() + 1).padStart(2, '0');
                                            const d = String(currentTime.getDate()).padStart(2, '0');
                                            onOpenCalendar(`${y}-${m}-${d}`);
                                        }}
                                        title="View Today's Events"
                                    >
                                        {todayEventTypes.map(type => (
                                            <span key={type} className="leading-none flex items-center" title={type}>
                                                {EVENT_ICONS[type] || <Calendar size={18} className="text-orange-500" />}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                <span
                                    onClick={() => onOpenCalendar(null)}
                                    className={`cursor-pointer hover:text-orange-400 transition-colors`}
                                    title="Open Calendar"
                                >
                                    {formatDate(currentTime)}
                                </span>
                            </div>

                            <span className="hidden md:block text-white/20 mx-1">|</span>

                            <div
                                onClick={() => !disablePersistence && onOpenSettings('general', activeWorkspace)}
                                className={`flex items-center space-x-2 ${disablePersistence ? '' : 'cursor-pointer hover:text-white'} group transition-colors text-sm font-mono tracking-wider`}
                                title={disablePersistence ? undefined : "Change Time Zone"}
                            >
                                <span className={`text-white ${disablePersistence ? '' : 'group-hover:text-orange-400'} transition-colors`}>{formatTime(currentTime)}</span>
                            </div>

                            <span className="hidden md:block text-white/20 mx-1">|</span>
                        </>
                    )}

                    {/* Lab Name (Priority Position next to History Dropdown) */}
                    <h1 className="contents">
                        <a
                            href={new URL(window.location.search || '/', window.location.origin).href}
                            onClick={(e) => {
                                e.preventDefault();
                                if (disablePersistence || isLocked) {
                                    setIsHistoryOpen(!isHistoryOpen);
                                } else {
                                    onOpenSettings('general', activeWorkspace);
                                }
                            }}
                            className={`no-underline hidden md:flex text-sm font-mono tracking-wider text-orange-500 cursor-pointer hover:text-orange-400 transition-colors max-w-[150px] overflow-hidden whitespace-nowrap`}
                            title={`${settings?.labName || "Zulu7"} ${disablePersistence ? '(Viewing Shared)' : '(Local)'}`}
                        >
                            <div className={(settings?.labName || "Zulu7").length > 15 ? "animate-marquee-infinite" : ""}>
                                <span className={(settings?.labName || "Zulu7").length > 15 ? "pr-4" : ""}>{settings?.labName || "Zulu7"}</span>
                                {(settings?.labName || "Zulu7").length > 15 && (
                                    <span className="pr-4">{settings?.labName || "Zulu7"}</span>
                                )}
                            </div>
                        </a>
                    </h1>



                    {/* Controls (Add & Settings) */}
                    {!isLocked && (
                        <div className="flex items-center bg-white/2 rounded-none p-1 border border-white/5 space-x-1 pointer-events-auto opacity-90 hover:opacity-100 transition-opacity">
                            <button
                                onClick={openAddModal}
                                className="h-7 w-7 flex items-center justify-center rounded-none text-white/70 hover:text-orange-400 hover:bg-white/2 transition-all active:scale-95 cursor-pointer"
                                title="Add Widget"
                            >
                                <Plus size={16} />
                            </button>
                            <div className="w-[1px] h-4 bg-white/5"></div>
                            <button
                                onClick={() => onOpenSettings('general', activeWorkspace)}
                                className="h-7 w-7 flex items-center justify-center rounded-none text-white/70 hover:text-orange-400 hover:bg-white/2 transition-all active:scale-95 cursor-pointer"
                                title="Dashboard Settings"
                            >
                                <SlidersHorizontal size={16} />
                            </button>
                        </div>
                    )}

                    {/* 5. Shared Dashboard History Dropdown */}
                    {(isLocked || disablePersistence) && (
                        <div className="relative pointer-events-auto opacity-90 hover:opacity-100 transition-opacity" ref={historyRef}>
                            <button
                                onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                                className="h-9 w-6 flex items-center justify-center text-white/40 hover:text-orange-400 hover:scale-125 active:scale-95 transition-all duration-300 cursor-pointer"
                                title="Shared Dashboard History"
                            >
                                <ChevronDown size={14} className={`transition-transform duration-200 ${isHistoryOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isHistoryOpen && (
                                <div className="absolute top-full right-0 mt-2 w-64 bg-[#1a1a20]/90 backdrop-blur-xl rounded shadow-2xl z-[150] overflow-hidden flex flex-col">
                                    {(() => {
                                        let localLabName = 'Zulu7';
                                        try {
                                            const saved = localStorage.getItem(STORAGE_KEYS.SETTINGS);
                                            if (saved) {
                                                const parsed = JSON.parse(saved);
                                                if (parsed.labName) localLabName = parsed.labName;
                                            }
                                        } catch (e) { /* ignore */ }

                                        const isActive = !disablePersistence;
                                        return (
                                            <div
                                                className={`
                                                    group flex items-center justify-between px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer text-xs font-bold border-l-2
                                                    ${isActive
                                                        ? 'text-orange-400 border-l-orange-500'
                                                        : 'text-white border-l-transparent hover:text-orange-400'}
                                                `}
                                                onClick={() => window.location.href = '/'}
                                                title={`Local: ${localLabName}`}
                                            >
                                                <span className="truncate">{localLabName}</span>
                                                <span className={`text-[14px] font-black transition-colors ${isActive ? 'text-orange-500' : 'text-white/20 group-hover:text-orange-500'}`}>Z</span>
                                            </div>
                                        );
                                    })()}
                                    <div className="px-3 py-2 border-b border-white/5 bg-white/5 text-xs font-bold text-white/60 flex items-center">
                                        Linked Dashboards
                                    </div>
                                    <div className="max-h-64 overflow-y-auto custom-scrollbar">
                                        {history.length === 0 ? (
                                            <div className="p-4 text-center text-white/30 text-xs italic">
                                                No recent dashboards
                                            </div>
                                        ) : (
                                            history.map((item, idx) => {
                                                const currentPath = window.location.pathname + window.location.search;
                                                const isActive = disablePersistence && (item.url === currentPath || item.url === window.location.href);

                                                return (
                                                    <div
                                                        key={item.id}
                                                        draggable
                                                        onDragStart={() => setDraggedHistoryIdx(idx)}
                                                        onDragOver={(e) => {
                                                            e.preventDefault();
                                                            setHistoryDragOverIdx(idx);
                                                        }}
                                                        onDrop={() => {
                                                            if (draggedHistoryIdx !== null && historyDragOverIdx !== null && draggedHistoryIdx !== historyDragOverIdx) {
                                                                const newHistory = [...history];
                                                                const [movedItem] = newHistory.splice(draggedHistoryIdx, 1);
                                                                newHistory.splice(historyDragOverIdx, 0, movedItem);
                                                                setHistory(newHistory);
                                                                localStorage.setItem(STORAGE_KEYS.DASHBOARD_HISTORY, JSON.stringify(newHistory));
                                                            }
                                                            setDraggedHistoryIdx(null);
                                                            setHistoryDragOverIdx(null);
                                                        }}
                                                        onDragEnd={() => {
                                                            setDraggedHistoryIdx(null);
                                                            setHistoryDragOverIdx(null);
                                                        }}
                                                        className={`
                                                            group flex items-center justify-between px-3 py-2 transition-all cursor-pointer border-l-2
                                                            ${isActive ? 'border-l-orange-500' : 'border-transparent'}
                                                            ${draggedHistoryIdx === idx ? 'opacity-20 scale-90 bg-white/5' : 'hover:bg-white/5'}
                                                            ${historyDragOverIdx === idx ? 'border-l-orange-500 bg-white/10 scale-105' : ''}
                                                            ${historyDragOverIdx === idx && draggedHistoryIdx !== idx ? 'ring-1 ring-orange-500 ring-inset' : ''}
                                                        `}
                                                        onClick={() => {
                                                            window.location.href = item.url;
                                                        }}
                                                        title={`Shared: ${item.name}`}
                                                    >
                                                        <div className="flex items-center min-w-0 flex-1">
                                                            <span className={`text-sm ${isActive ? 'text-orange-400 font-bold' : 'text-white/90 font-medium'} truncate group-hover:text-orange-400 transition-colors`}>{item.name}</span>
                                                        </div>
                                                        <div className="flex items-center">
                                                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <button
                                                                    onClick={(e) => renameHistoryItem(e, item)}
                                                                    className="p-1 text-white/20 hover:text-orange-400 transition-all duration-200 transform hover:scale-125 cursor-pointer mr-1"
                                                                    title="Rename Dashboard"
                                                                >
                                                                    <Pencil size={12} />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => handleCopy(e, item)}
                                                                    className="p-1 text-white/20 hover:text-orange-400 transition-all duration-200 transform hover:scale-125 cursor-pointer mr-1"
                                                                    title="Copy Link"
                                                                >
                                                                    {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                                                                </button>
                                                                <button
                                                                    onClick={(e) => deleteHistoryItem(e, item.id)}
                                                                    className="p-1 text-white/20 hover:text-red-400 transition-all duration-200 transform hover:scale-125 cursor-pointer"
                                                                    title="Forget"
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                            <GripVertical size={12} className="ml-2 text-white/20 cursor-grab active:cursor-grabbing shrink-0" />
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Lock/Unlock - Solid Orange Icon Only */}
                    <button
                        onClick={() => {
                            if (disablePersistence) {
                                window.location.href = '/'; // Return to local dashboard
                                return;
                            }
                            const newLocked = !isLocked;
                            setIsLocked(newLocked);
                            if (!newLocked && settings?.isWorkspaceRotationEnabled && onUpdateSettings) {
                                onUpdateSettings({ ...settings, isWorkspaceRotationEnabled: false });
                            }
                        }}
                        className={`
                            h-9 w-7 flex items-center justify-center transition-all duration-300 pointer-events-auto opacity-90 hover:opacity-100
                            ${disablePersistence ? 'cursor-pointer hover:scale-125 active:scale-95 text-orange-500 hover:text-orange-400' : 'cursor-pointer hover:scale-125 active:scale-95 text-orange-500 hover:text-orange-400'}
                        `}
                        title={disablePersistence ? "Leave Shared Dashboard View" : (isLocked ? "Unlock to Edit Layout" : "Lock Layout")}
                    >
                        {disablePersistence ? (
                            <Share2 size={20} className="text-orange-500" fill="currentColor" />
                        ) : isLocked ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-orange-500" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor" stroke="none" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                        ) : <Unlock size={20} />}
                    </button>
                </div>

            </div>
            {/* Ghost Measurement Container (Always Full Width, Hidden) */}
            <div
                ref={ghostRightSideRef}
                className="absolute opacity-0 pointer-events-none flex items-center gap-3 invisible"
                style={{ top: '-9999px', right: '0' }}
            >
                {/* 1. Date */}
                <div className="flex items-center gap-2 text-sm font-mono tracking-wider">
                    {todayEventTypes.length > 0 && (
                        <div className="flex items-center space-x-2 p-0.5">
                            {todayEventTypes.map(type => (
                                <span key={type} className="leading-none flex items-center">
                                    {EVENT_ICONS[type] || <Calendar size={18} className="text-orange-500" />}
                                </span>
                            ))}
                        </div>
                    )}
                    <span>{formatDate(currentTime)}</span>
                </div>

                {/* 2. Time */}
                <div className="text-sm font-mono tracking-wider font-bold">
                    {formatTime(currentTime)}
                </div>

                {/* 3. Lab Name */}
                <div className="text-sm font-mono tracking-wider font-semibold max-w-[150px] truncate">
                    {settings?.labName || "Zulu7"}
                </div>

                {/* 4. Controls */}
                {!isLocked && (
                    <div className="flex items-center bg-white/2 p-1 border border-white/5 space-x-1">
                        <div className="h-7 w-7"></div>
                        <div className="w-[1px] h-4"></div>
                        <div className="h-7 w-7"></div>
                    </div>
                )}

                {/* 5. History Dropdown */}
                {(isLocked || disablePersistence) && <div className="h-9 w-6"></div>}

                {/* 6. Padlock */}
                <div className="h-9 w-7"></div>
            </div>
        </>
    );
};


export default React.memo(Zulu7Header);
