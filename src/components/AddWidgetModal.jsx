import React, { useState, useEffect, useRef } from 'react';
import { X, Plus, Monitor, Video, TrendingUp, Save, Trash2, Rss, CloudSun, Globe, Lock, LayoutGrid, Link, Tag, Layout, PlusCircle, Plug, ShieldAlert, Zap, Image, Activity, RefreshCw, AppWindow, ExternalLink, Download, Film, Code } from 'lucide-react';

const AddWidgetModal = ({ isOpen, onClose, onSave, onDelete, editWidget = null, streamerUrl = 'http://localhost:1984', streamApiKey = '', onOpenSettings, settings, onUpdateSettings, onEditIntegration }) => {
    const [type, setType] = useState('iframe');
    const backdropMouseDownRef = useRef(false);
    const [value, setValue] = useState('');
    const [extraValue, setExtraValue] = useState('fahrenheit'); // Used for Weather Unit or other extras
    const [streams, setStreams] = useState({});
    const [apiKey, setApiKey] = useState(streamApiKey);

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [integrations, setIntegrations] = useState([]);
    const [tmdbApiKey, setTmdbApiKey] = useState('');
    const [isLocked, setIsLocked] = useState(false);
    const isMounted = useRef(false);

    useEffect(() => {
        isMounted.current = true;
        return () => { isMounted.current = false; };
    }, []);

    // Track initial state for dirty check
    const initialStateRef = useRef(null);

    // Sync prop to state if it changes (e.g. settings updated while modal open?)
    useEffect(() => {
        setApiKey(streamApiKey);
    }, [streamApiKey]);

    // 1. Form Initialization (Runs only when modal opens or editWidget changes)
    useEffect(() => {
        if (isOpen) {
            let initialType = 'iframe';
            let initialValue = '';
            let initialExtraValue = '';
            if (editWidget) {
                initialType = editWidget.type;
                setType(initialType);

                if (editWidget.type === 'weather') {
                    const [loc, unit] = editWidget.value.split('|');
                    initialValue = loc;
                    initialExtraValue = unit || 'celsius';
                } else if (editWidget.type === 'media') {
                    const [url, interval] = editWidget.value.split('|');
                    initialValue = url;
                    initialExtraValue = interval || '180';
                } else if (editWidget.type === 'icon' || editWidget.type === 'iframe' || editWidget.type === 'rss' || editWidget.type === 'camera' || editWidget.type === 'proxy' || editWidget.type === 'web' || editWidget.type === 'integration') {
                    const [url, name, icon] = editWidget.value.split('|');
                    initialValue = editWidget.type === 'integration' ? url.replace('/integrations/', '') : url;
                    initialExtraValue = `${name || ''}|${icon || ''}`;
                } else if (editWidget.type === 'service') {
                    const [name, stype, url, port, interval, isDisabled] = editWidget.value.split('|');
                    initialValue = url;
                    initialExtraValue = `${name || ''}|${stype || 'http'}|${port || ''}|${interval || '60'}|${isDisabled || 'false'}`;
                } else if (editWidget.type === 'movie-poster' || editWidget.type === 'movie-posters') {
                    initialType = 'integration';
                    const [genre, decade, interval] = editWidget.value.split('|');
                    initialValue = 'Movie-Posters.html';
                    initialExtraValue = `${decade || ''}|${interval || '30'}`;
                    setType('integration');
                } else if (editWidget.type === 'hdhomerun') {
                    const [ip] = editWidget.value.split('|');
                    initialValue = ip;
                    initialExtraValue = '';
                } else {
                    initialValue = editWidget.value;
                }
                setValue(initialValue);
                setExtraValue(initialExtraValue);
            } else {
                setType('iframe');
                setValue('');
                setExtraValue('');
            }

            // Capture initial state
            initialStateRef.current = {
                type: initialType,
                value: initialValue,
                extraValue: initialExtraValue,
                apiKey: streamApiKey // API Key also tracked
            };
            setTmdbApiKey(settings?.tmdbKey || '');
        }
    }, [isOpen, editWidget, streamApiKey, settings?.tmdbKey]);

    // 2. Fetch Streams (Runs when modal is open and key/url changes)
    useEffect(() => {
        if (isOpen) {
            const fetchUrl = streamerUrl.endsWith('/') ? streamerUrl.slice(0, -1) : streamerUrl;
            const tokenParam = apiKey ? `?token=${apiKey}` : '';

            fetch(`${fetchUrl}/api/streams${tokenParam}`)
                .then(res => res.json())
                .then(data => setStreams(data || {}))
                .catch(err => console.error("Failed to fetch streams for widget modal", err));

            // Fetch Integrations
            fetch('/api/integrations')
                .then(res => res.json())
                .then(data => {
                    const formatted = (data || []).map(file => {
                        const integrationName = file.replace('.html', '').replace(/-/g, ' ');
                        const capitalized = integrationName.split(' ')
                            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                            .join(' ');
                        return { value: file, label: capitalized };
                    });
                    const sorted = formatted.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
                    setIntegrations(sorted);
                })
                .catch(err => console.error("Failed to fetch integrations", err));

            // Fetch Lock Status
            fetch('/api/integrations/status')
                .then(res => res.json())
                .then(data => setIsLocked(data.isLocked))
                .catch(() => setIsLocked(false));
        }
    }, [isOpen, streamerUrl, apiKey]);

    useEffect(() => {
        let pollInterval;
        if (isOpen) {
            pollInterval = setInterval(async () => {
                try {
                    const res = await fetch('/api/integrations/status');
                    const data = await res.json();
                    if (data.isLocked !== isLocked) {
                        setIsLocked(data.isLocked);
                    }
                } catch (err) {
                    console.error("Lock polling error (AddWidgetModal):", err);
                }
            }, 5000);
        }
        return () => {
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [isOpen, isLocked]);

    // Handle Escape Key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    const handleBackdropMouseDown = (e) => {
        if (e.target === e.currentTarget) {
            backdropMouseDownRef.current = true;
        } else {
            backdropMouseDownRef.current = false;
        }
    };

    const handleBackdropClick = (e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) {
            // Check for changes
            if (!initialStateRef.current) {
                onClose();
                return;
            }

            const hasChanges =
                type !== initialStateRef.current.type ||
                value !== initialStateRef.current.value ||
                extraValue !== initialStateRef.current.extraValue ||
                apiKey !== initialStateRef.current.apiKey;

            if (!hasChanges) {
                onClose();
            }
        }
        backdropMouseDownRef.current = false;
    };

    const handleStreamSelect = (streamName) => {
        // Construct the player URL
        // We use stream.html which handles MSE/WebRTC automatically
        const url = `${streamerUrl}/stream.html?src=${streamName}&mode=webrtc`;
        setValue(url);
        // Auto-set Name
        // Strip prefix if present for clean display name
        const cleanName = apiKey && streamName.startsWith(`${apiKey}_`) ? streamName.replace(`${apiKey}_`, '') : streamName;
        const capitalized = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        setExtraValue(`${capitalized}|`);
    };

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!value || isSubmitting) return;

        setIsSubmitting(true);
        let urlToSave = value;

        // Auto-convert YouTube links for iFrames
        if (type === 'iframe') {
            const ytRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
            const match = value.match(ytRegex);
            if (match && match[1]) {
                urlToSave = `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&mute=1`;
            }
        }

        let finalValue = urlToSave;
        if (type === 'service') {
            const parts = extraValue.split('|');
            const sName = parts[0] || 'Health Check';
            const sType = parts[1] || 'http';
            const sPort = parts[2] || '';
            const sInterval = Math.max(parseInt(parts[3], 10) || 60, 60);
            const sDisabled = parts[4] || 'false';

            finalValue = `${sName}|${sType}|${value}|${sPort}|${sInterval}|${sDisabled}`;
        } else if (type === 'media') {
            finalValue = `${urlToSave}|${extraValue || '180'}`;
        } else if (type === 'weather') {
            finalValue = `${urlToSave}|${extraValue || 'fahrenheit'}`;
        } else if (type === 'hdhomerun') {
            // value contains the IP address. Trim whitespace and http prefix if provided accidentally.
            let cleanIp = urlToSave.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
            finalValue = `${cleanIp}`;
        } else if (type === 'icon' || type === 'iframe' || type === 'rss' || type === 'camera' || type === 'proxy' || type === 'web' || type === 'integration') {
            // extraValue acts as "Name|Icon" or just "Name"
            let [name, icon] = extraValue.split('|');

            // Handle Integration URL
            if (type === 'integration') {
                urlToSave = `/integrations/${value}`;
            }

            // Logic to determine if we should auto-fetch the title
            const isEditingUrl = editWidget && initialStateRef.current && value !== initialStateRef.current.value;
            const isNameUnchanged = editWidget && initialStateRef.current && name === (initialStateRef.current.extraValue || '').split('|')[0];
            // Skip auto-fetch for RSS to allow empty name (defaults to feed title)
            const shouldAutoFetch = type !== 'rss' && (!name || !name.trim() || (isEditingUrl && isNameUnchanged));

            // Auto-generate name from URL if needed
            if (shouldAutoFetch) {
                // Try server-side fetch first
                try {
                    // Use relative path for API (proxied by Vite or direct if compiled)
                    const res = await fetch(`/api/fetch-title?url=${encodeURIComponent(urlToSave)}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.title) {
                            name = data.title;
                        }
                    }
                } catch (err) {
                    console.warn("Failed to auto-fetch title", err);
                }

                // Fallback to domain parsing if still empty
                if (!name || !name.trim()) {
                    try {
                        const urlStr = urlToSave.startsWith('http') ? urlToSave : `https://${urlToSave}`;
                        const urlObj = new URL(urlStr);

                        if (type === 'camera' && urlObj.searchParams.get('src')) {
                            const src = urlObj.searchParams.get('src');
                            name = src.charAt(0).toUpperCase() + src.slice(1);
                        } else {
                            let host = urlObj.hostname;
                            if (host.startsWith('www.')) host = host.slice(4);
                            // Extract main domain name (e.g. "google" from "google.com")
                            const mainName = host.split('.')[0];
                            // Capitalize
                            name = mainName.charAt(0).toUpperCase() + mainName.slice(1);
                        }
                    } catch { // ignore
                        name = type === 'camera' ? 'Camera' : 'Link';
                    }
                }
            }

            finalValue = `${urlToSave}|${name}|${icon || ''}`;
        }

        if (type === 'movie-posters' || type === 'movie-poster' || (type === 'integration' && (value === 'Movie-Posters' || value === 'Movie-Posters.html' || value === 'movie-poster' || value === 'movie-poster.html'))) {
            const interval = extraValue.split('|')[1] || '30';
            const genreToSave = 'all';
            const decade = extraValue.split('|')[0] || 'all';
            finalValue = `${genreToSave}|${decade}|${interval}`;

            console.log(`[AddWidgetModal] Saving Movie Poster Widget - Type: movie-posters, Value: ${finalValue}`);

            // Update TMDb Key if changed
            if (tmdbApiKey !== (settings?.tmdbKey || '') && onUpdateSettings) {
                onUpdateSettings({ ...settings, tmdbKey: tmdbApiKey });
            }

            onSave('movie-posters', finalValue, editWidget ? editWidget.id : null);
            setIsSubmitting(false);
            onClose();
            return;
        }

        if (isMounted.current) {
            onSave(type, finalValue, editWidget ? editWidget.id : null);
            setIsSubmitting(false);
            onClose();
        }
    };

    const handleCancel = () => {
        onClose();
    };

    return (
        <div
            onMouseDown={handleBackdropMouseDown}
            onClick={handleBackdropClick}
            className="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-16 bg-black/60 backdrop-blur-sm animate-in fade-in zoom-in duration-200"
        >
            <div className="w-full max-w-md bg-[#1a1a20] border border-white/10 rounded-none shadow-2xl overflow-y-auto max-h-[95vh] no-scrollbar">
                <div className="flex items-center justify-between p-4 border-b border-white/5 bg-orange-500/90 backdrop-blur-md">
                    <h2 className="text-lg font-semibold text-white flex items-center">
                        <img src="/icon.svg" alt="Widget" className="w-8 h-8 mr-3 brightness-0 invert" />
                        {editWidget ? 'Widget Settings' : 'Add Widget'}
                    </h2>
                    <button onClick={onClose} title="Close Modal" className="p-1 rounded-full hover:bg-white/10 text-white hover:text-white/80 transition-colors cursor-pointer">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 pb-12 space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                            <LayoutGrid size={12} className="mr-1.5" />
                            Widget Type
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { id: 'iframe', label: 'iFrame', icon: Globe },
                                { id: 'rss', label: 'RSS', icon: Rss },
                                { id: 'icon', label: 'Link', icon: Link },
                                { id: 'ticker', label: 'Ticker', icon: TrendingUp },
                                { id: 'weather', label: 'Weather', icon: CloudSun },
                                { id: 'media', label: 'Slide Show', icon: Image },
                                { id: 'service', label: 'Health Check', icon: Activity },
                                { id: 'integration', label: 'Integration', icon: Plug },
                            ].map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        if (type !== item.id) {
                                            setType(item.id);
                                            setExtraValue(item.id === 'weather' ? 'fahrenheit' : item.id === 'media' ? '10' : '');
                                            if (item.id === 'media' && !value) {
                                                setValue('');
                                            }
                                        }
                                    }}
                                    title={`Select ${item.label} Widget`}
                                    className={`flex flex-col items-center justify-center p-3 rounded-none border transition-all cursor-pointer ${type === item.id
                                        ? 'bg-orange-500 border-orange-500 text-white shadow-md'
                                        : 'bg-white/5 border-transparent text-gray-400 hover:bg-white/10'
                                        }`}
                                >
                                    <item.icon size={24} className="mb-2" />
                                    <span className="text-sm">{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                            <Link size={12} className="mr-1.5" />
                            {type === 'ticker' ? 'Symbol (e.g., AAPL)' :
                                type === 'rss' ? 'RSS Feed URLs (One per line)' :
                                    type === 'weather' ? 'City or Zip Code' :
                                        type === 'icon' ? 'Target URL' :
                                            type === 'media' ? 'Slide Show Folder (Google Drive or HTTP/HTTPS)' :
                                                type === 'service' ? 'Health Check URL / Hostname' :
                                                    type === 'integration' && value === 'hdhomerun' ? 'HDHomeRun Local IP Address' :
                                                        type === 'integration' ? 'Selected Integration' :
                                                            (type === 'proxy') ? 'Target Website URL' : 'Source URL'}
                        </label>

                        {type === 'integration' ? (
                            <div className="space-y-4">
                                <select
                                    value={value === 'hdhomerun' ? 'hdhomerun' : (value.includes('|') ? value : integrations.find(i => i.value.startsWith(value))?.value || value)}
                                    onChange={(e) => {
                                        const selectedValue = e.target.value;
                                        if (selectedValue === 'hdhomerun') {
                                            setValue('hdhomerun');
                                            setExtraValue('');
                                        } else {
                                            setValue(selectedValue);
                                            if (!extraValue.split('|')[0] || selectedValue.includes('Movie-Posters')) {
                                                const cleanName = selectedValue.replace('.html', '').replace(/-/g, ' ');
                                                const capitalized = cleanName.split(' ')
                                                    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                                                    .join(' ');

                                                if (selectedValue.includes('Movie-Posters')) {
                                                    setExtraValue(`all|30`);
                                                } else {
                                                    setExtraValue(`${capitalized}|`);
                                                }
                                            }
                                        }
                                    }}
                                    className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-zulu-orange/50 appearance-none cursor-pointer"
                                >
                                    <option value="" disabled className="bg-[#1a1a20]">Choose an Integration...</option>
                                    <option value="hdhomerun" className="bg-[#1a1a20] text-orange-400 font-bold">📡 HDHomeRun Local TV</option>
                                    {integrations.map(item => (
                                        <option key={item.value} value={item.value} className="bg-[#1a1a20]">{item.label}</option>
                                    ))}
                                </select>
                                {value === 'hdhomerun' && (
                                    <input
                                        type="text"
                                        value={extraValue}
                                        onChange={(e) => setExtraValue(e.target.value)}
                                        placeholder="192.168.1.50"
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                                        autoFocus
                                    />
                                )}
                            </div>
                        ) : (type === 'rss' || type === 'media') ? (
                            <textarea
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder={type === 'rss' ? 'https://feeds.bbci.co.uk/news/rss.xml\nhttps://...' : 'https://image-url-1.jpg\nhttps://image-url-2.jpg'}
                                className={`w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 min-h-[100px] resize-none ${type === 'rss' ? 'focus:border-zulu-orange/50' : 'focus:border-blue-500/50'}`}
                                autoFocus
                            />
                        ) : (
                            <input
                                type="text"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder={type === 'ticker' ? 'AAPL' : type === 'weather' ? 'New York, London, 90210...' : type === 'service' ? 'www.google.com' : (type === 'proxy') ? 'https://www.google.com' : 'https://...'}
                                className={`w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 ${type === 'rss' ? 'focus:border-zulu-orange/50' : type === 'weather' ? 'focus:border-cyan-500/50' : (type === 'proxy') ? 'focus:border-zulu-orange/50' : 'focus:border-blue-500/50'}`}
                                autoFocus
                            />
                        )}
                        {type === 'integration' && integrations.length === 0 && (
                            <p className="text-[10px] text-orange-400 italic mt-1">
                                No integrations found in /integrations folder. Add .html files there.
                            </p>
                        )}

                        {/* Service Fields */}
                        {type === 'service' && (
                            <div className="grid grid-cols-2 gap-4 mt-4 animate-in slide-in-from-top-2 duration-300">
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase text-gray-500 font-bold">Health Check Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. My Website"
                                        className="w-full bg-black/20 border border-white/5 px-3 py-2 text-sm text-white focus:border-zulu-orange/50 outline-none"
                                        value={extraValue.split('|')[0] || ''}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            parts[0] = e.target.value;
                                            setExtraValue(parts.join('|'));
                                        }}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase text-gray-500 font-bold">Monitor Type</label>
                                    <select
                                        className="w-full bg-black/20 border border-white/5 px-3 py-2 text-sm text-white focus:border-zulu-orange/50 outline-none appearance-none cursor-pointer"
                                        value={extraValue.split('|')[1] || 'http'}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            parts[1] = e.target.value;
                                            setExtraValue(parts.join('|'));
                                        }}
                                    >
                                        <option value="http" className="bg-[#1a1a20]">HTTP</option>
                                        <option value="https" className="bg-[#1a1a20]">HTTPS</option>
                                        <option value="ping" className="bg-[#1a1a20]">PING</option>
                                        <option value="tcp" className="bg-[#1a1a20]">TCP Port</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase text-gray-500 font-bold">Port (if TCP/HTTP)</label>
                                    <input
                                        type="number"
                                        placeholder="80, 443..."
                                        className="w-full bg-black/20 border border-white/5 px-3 py-2 text-sm text-white focus:border-zulu-orange/50 outline-none"
                                        value={extraValue.split('|')[2] || ''}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            parts[2] = e.target.value;
                                            setExtraValue(parts.join('|'));
                                        }}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] uppercase text-gray-500 font-bold">Interval (Sec)</label>
                                    <input
                                        type="number"
                                        placeholder="30"
                                        className="w-full bg-black/20 border border-white/5 px-3 py-2 text-sm text-white focus:border-zulu-orange/50 outline-none"
                                        value={extraValue.split('|')[3] || '30'}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            parts[3] = e.target.value;
                                            setExtraValue(parts.join('|'));
                                        }}
                                    />
                                </div>
                                <div className="col-span-2 space-y-1 pt-2">
                                    <label className="flex items-center space-x-3 cursor-pointer group">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only"
                                                checked={extraValue.split('|')[4] === 'true'}
                                                onChange={(e) => {
                                                    const parts = extraValue.split('|');
                                                    parts[4] = e.target.checked ? 'true' : 'false';
                                                    setExtraValue(parts.join('|'));
                                                }}
                                            />
                                            <div className={`w-10 h-5 transition-colors rounded-full shadow-inner ${extraValue.split('|')[4] === 'true' ? 'bg-orange-600' : 'bg-white/10'}`}></div>
                                            <div className={`absolute top-0 w-5 h-5 transition-transform bg-white rounded-full shadow-md ${extraValue.split('|')[4] === 'true' ? 'translate-x-5' : 'translate-x-0'}`}></div>
                                        </div>
                                        <div className="text-xs font-medium text-gray-300 uppercase tracking-widest group-hover:text-white transition-colors">
                                            Temporarily Disable Health Check
                                        </div>
                                    </label>
                                </div>
                            </div>
                        )}

                        {/* Market Presets for Ticker */}
                        {type === 'ticker' && (
                            <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/5 animate-in slide-in-from-top-2">
                                <label className="w-full text-xs font-medium text-green-400 uppercase tracking-wider mb-1">
                                    Market Presets
                                </label>
                                {[
                                    { label: 'DOW', symbol: '^DJI' },
                                    { label: 'S&P 500', symbol: '^GSPC' },
                                    { label: 'Nasdaq', symbol: '^IXIC' },
                                    { label: 'Gold', symbol: 'GC=F' },
                                    { label: 'Silver', symbol: 'SI=F' },
                                    { label: 'Oil', symbol: 'CL=F' },
                                    { label: 'Bitcoin', symbol: 'BTC-USD' }
                                ].map((preset) => (
                                    <button
                                        key={preset.symbol}
                                        type="button"
                                        onClick={() => setValue(preset.symbol)}
                                        title={`Select ${preset.label}`}
                                        className="px-2 py-1 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-none text-xs text-green-300 transition-colors cursor-pointer"
                                    >
                                        + {preset.label}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Icon/Iframe/RSS/Camera/RBI Widget Extra Fields */}
                        {(type === 'icon' || type === 'iframe' || type === 'rss' || type === 'camera' || type === 'proxy' || (type === 'integration' && !value?.includes('Movie-Posters'))) && (
                            <div className="space-y-2 mt-2 pt-2 border-t border-white/5 animate-in slide-in-from-top-2">
                                <div>
                                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                                        Display Name (Optional)
                                    </label>
                                    <input
                                        type="text"
                                        value={extraValue.split('|')[0] || ''}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            setExtraValue(`${e.target.value}|${parts[1] || ''}`);
                                        }}
                                        placeholder="Auto-fetch if left blank"
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 mt-1"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Slide Show Widget Details */}
                        {type === 'media' && (
                            <div className="space-y-2 mt-2 pt-2 border-t border-white/5 animate-in slide-in-from-top-2">
                                <div>
                                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                                        Slide Interval (Seconds)
                                    </label>
                                    <input
                                        type="number"
                                        min="5"
                                        value={extraValue}
                                        onChange={(e) => setExtraValue(e.target.value)}
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 mt-1"
                                    />
                                    <p className="text-[10px] text-gray-500 italic mt-1 pb-1 border-b border-white/5">
                                        Note: Videos will play fully before advancing, regardless of this interval.
                                    </p>
                                </div>

                                {/* Fileserver Utility Section */}
                                <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/20 rounded-none">
                                    <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center mb-2">
                                        <Download size={12} className="mr-1" />
                                        Local Fileserver Utility
                                    </h4>
                                    <p className="text-[10px] text-gray-400 mb-3 leading-relaxed">
                                        Need to serve images or videos from a local folder? Download our python utility and run it in your media directory.
                                    </p>
                                    <div className="space-y-2">
                                        <a
                                            href="/fileserver.py"
                                            download
                                            className="flex items-center justify-center w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-400 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none"
                                        >
                                            <Download size={14} className="mr-2" />
                                            Download fileserver.py
                                        </a>
                                        <div className="bg-black/40 p-2 border border-white/5 font-mono text-[9px] text-gray-400 uppercase tracking-tighter">
                                            <p className="text-blue-500/70 mb-1"># Usage:</p>
                                            <p>python3 fileserver.py --port 8085</p>
                                            <p className="mt-2 text-blue-500/70 mb-1"># widget url:</p>
                                            <p>http://localhost:8085/files.json</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}


                        {/* Integration Editor Button (Only for Integration Widgets, and only if not globally locked) */}
                        {type === 'integration' && value && !isLocked && (
                            <div className="mt-4 animate-in slide-in-from-top-2">
                                <button
                                    type="button"
                                    onClick={() => onEditIntegration(value)}
                                    className="w-full flex items-center justify-center space-x-2 py-3 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/50 text-blue-400 text-xs font-bold uppercase tracking-[2px] transition-all group shadow-[0_0_15px_rgba(37,99,235,0.1)]"
                                >
                                    <Code size={16} className="group-hover:scale-110 transition-transform" />
                                    <span>Edit Integration</span>
                                </button>
                                <p className="text-[9px] text-gray-600 italic mt-2 text-center uppercase tracking-tighter">
                                    Unlock full-screen editor to modify this integration file
                                </p>
                            </div>
                        )}
                    </div>
                    {
                        type === 'rss' && (
                            <div className="flex flex-wrap gap-2 mt-2">
                                <button type="button" onClick={() => setValue('https://feeds.bbci.co.uk/news/rss.xml')} title="Use BBC News Feed" className="px-2 py-1 text-[10px] bg-white/5 hover:bg-white/10 rounded-none text-gray-400 hover:text-white border border-white/5 transition-colors cursor-pointer">BBC News</button>
                                <button type="button" onClick={() => setValue('https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml')} title="Use NY Times Feed" className="px-2 py-1 text-[10px] bg-white/5 hover:bg-white/10 rounded-none text-gray-400 hover:text-white border border-white/5 transition-colors cursor-pointer">NY Times</button>
                                <button type="button" onClick={() => setValue('https://www.theverge.com/rss/index.xml')} title="Use The Verge Feed" className="px-2 py-1 text-[10px] bg-white/5 hover:bg-white/10 rounded-none text-gray-400 hover:text-white border border-white/5 transition-colors cursor-pointer">The Verge</button>
                            </div>
                        )
                    }
                    {
                        type === 'weather' && (
                            <div className="flex bg-black/30 border border-white/10 rounded-none p-1 mt-2 w-max">
                                <button
                                    type="button"
                                    onClick={() => setExtraValue('fahrenheit')}
                                    title="Switch to Fahrenheit"
                                    className={`px-3 py-1.5 rounded-none text-xs font-medium transition-all cursor-pointer ${extraValue === 'fahrenheit' ? 'bg-orange-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Fahrenheit (°F)
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setExtraValue('celsius')}
                                    title="Switch to Celsius"
                                    className={`px-3 py-1.5 rounded-none text-xs font-medium transition-all cursor-pointer ${extraValue === 'celsius' ? 'bg-orange-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                                >
                                    Celsius (°C)
                                </button>
                            </div>
                        )
                    }

                    {/* Stream API Key Display (Editable) */}
                    {
                        type === 'camera' && (
                            <div className="space-y-2 mt-2 pt-2 border-t border-white/5 animate-in slide-in-from-top-2">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                                    <Lock size={12} className="mr-1" />
                                    Stream API Key
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={apiKey || ''}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        placeholder="Enter API Key to load streams"
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500/50"
                                    />
                                    {apiKey !== streamApiKey && (
                                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-orange-400 italic">
                                            Custom Key
                                        </div>
                                    )}
                                </div>
                                <p className="text-[10px] text-gray-500">
                                    This key is used to fetch the available stream list.
                                </p>
                            </div>
                        )
                    }

                    {/* Quick Add Streams */}
                    {
                        (type === 'camera') && Object.keys(streams).length > 0 && (
                            <div className="space-y-2 animate-in slide-in-from-top-2 pt-2 border-t border-white/5">
                                <div className="flex justify-between items-center mb-1">
                                    <label className="text-xs font-medium text-green-400 uppercase tracking-wider flex items-center">
                                        <Video size={12} className="mr-1" />
                                        Available Streams
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onClose();
                                            if (onOpenSettings) onOpenSettings('streams');
                                        }}
                                        className="text-xs font-medium text-green-500/60 hover:text-green-400 hover:underline transition-colors flex items-center bg-transparent border-none cursor-pointer uppercase tracking-wider"
                                    >
                                        Manage Streams
                                        <ExternalLink size={12} className="ml-1" />
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {Object.keys(streams)
                                        .filter(name => apiKey && name.startsWith(`${apiKey}_`))
                                        .map(name => {
                                            const displayName = apiKey && name.startsWith(`${apiKey}_`) ? name.replace(`${apiKey}_`, '') : name;
                                            return (
                                                <button
                                                    key={name}
                                                    type="button"
                                                    onClick={() => handleStreamSelect(name)} // Pass full name (with prefix) as URL src
                                                    title={`Select stream: ${displayName}`}
                                                    className="px-2 py-1 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 rounded-none text-xs text-green-300 transition-colors cursor-pointer"
                                                >
                                                    + {displayName}
                                                </button>
                                            );
                                        })}
                                </div>
                            </div>
                        )
                    }

                    {/* Movie Poster Widget Details */}
                    {(type === 'movie-posters' || type === 'movie-poster' || (type === 'integration' && (value === 'Movie-Posters' || value === 'Movie-Posters.html' || value === 'movie-poster' || value === 'movie-poster.html'))) && (
                        <div className="space-y-4 mt-2 pt-2 border-t border-white/5 animate-in slide-in-from-top-2">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                                        <Globe size={12} className="mr-1.5" />
                                        Decade
                                    </label>
                                    <select
                                        value={extraValue.split('|')[0] || 'all'}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            setExtraValue(`${e.target.value}|${parts[1] || '30'}`);
                                        }}
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 mt-1 cursor-pointer appearance-none"
                                    >
                                        <option value="all" className="bg-[#1a1a20]">Any Decade</option>
                                        <option value="future" className="bg-[#1a1a20]">2026+ (Future)</option>
                                        <option value="2020" className="bg-[#1a1a20]">2020s</option>
                                        <option value="2010" className="bg-[#1a1a20]">2010s</option>
                                        <option value="2000" className="bg-[#1a1a20]">2000s</option>
                                        <option value="1990" className="bg-[#1a1a20]">1990s</option>
                                        <option value="1980" className="bg-[#1a1a20]">1980s</option>
                                        <option value="1970" className="bg-[#1a1a20]">1970s</option>
                                        <option value="1960" className="bg-[#1a1a20]">1960s</option>
                                        <option value="1950" className="bg-[#1a1a20]">1950s</option>
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                                        <RefreshCw size={12} className="mr-1.5" />
                                        Rotation (Sec)
                                    </label>
                                    <input
                                        type="number"
                                        min="5"
                                        value={extraValue.split('|')[1] || '30'}
                                        onChange={(e) => {
                                            const parts = extraValue.split('|');
                                            setExtraValue(`${parts[0] || 'all'}|${e.target.value}`);
                                        }}
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500/50 mt-1"
                                        placeholder="30"
                                    />
                                </div>
                            </div>

                            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-none text-[10px] text-blue-200/70 leading-relaxed shadow-inner">
                                <p className="flex items-start">
                                    <ShieldAlert size={12} className="mr-2 mt-0.5 text-blue-400 shrink-0" />
                                    <span>
                                        This widget uses <strong>JoBlo</strong> for high-quality mainstream posters by default! Add a <strong>TMDb API Key</strong> below for the full TMDb library.
                                    </span>
                                </p>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-white/5">
                                <label className="text-xs font-medium text-gray-400 uppercase tracking-wider flex items-center">
                                    <Lock size={12} className="mr-1.5" />
                                    TMDb API Key (Optional)
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={tmdbApiKey}
                                        onChange={(e) => setTmdbApiKey(e.target.value)}
                                        placeholder="Optional: Enter TMDb Key"
                                        className="w-full bg-black/30 border border-white/10 rounded-none px-4 py-3 text-white font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500/50 mt-1"
                                    />
                                    {tmdbApiKey !== (settings?.tmdbKey || '') && tmdbApiKey !== '' && (
                                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-orange-400 italic">
                                            Changed
                                        </div>
                                    )}
                                </div>
                                {tmdbApiKey !== (settings?.tmdbKey || '') && tmdbApiKey !== '' && (
                                    <p className="text-[9px] text-orange-400/70 italic px-1">
                                        Note: Saving this widget will also update your global API key.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}


                    <div className="pt-2 flex space-x-3">
                        {editWidget && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (confirm('Delete this widget?')) {
                                        onDelete(editWidget.id);
                                        onClose();
                                    }
                                }}
                                className="flex-1 bg-white/5 hover:bg-red-600 text-gray-500 hover:text-white border border-white/10 hover:border-red-600 font-medium py-3 rounded-none transition-colors flex items-center justify-center space-x-2 cursor-pointer"
                                title="Delete this widget permanently"
                            >
                                <Trash2 size={18} />
                                <span>Delete</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleCancel}
                            className="flex-1 bg-white/5 hover:bg-white/10 text-gray-400 font-medium py-3 rounded-none transition-colors flex items-center justify-center space-x-2 cursor-pointer"
                            title="Cancel and close modal"
                        >
                            <span>Cancel</span>
                        </button>
                        <button
                            type="submit"
                            disabled={!value || isSubmitting}
                            className="flex-[2] bg-orange-600 hover:bg-orange-500 text-white font-medium py-3 rounded-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 cursor-pointer"
                            title={editWidget ? 'Save changes to widget' : 'Add new widget to dashboard'}
                        >
                            {isSubmitting ? <RefreshCw size={18} className="animate-spin" /> : (editWidget ? <Save size={18} /> : <Plus size={18} />)}
                            <span>{isSubmitting ? 'Processing...' : (editWidget ? 'Save Changes' : 'Add Widget')}</span>
                        </button>
                    </div>


                </form>
            </div >
        </div >
    );
};

export default AddWidgetModal;
