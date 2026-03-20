import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Camera, PlayCircle, RefreshCw, ArrowDownCircle, Globe, Maximize, Minimize, ExternalLink, AlertCircle } from 'lucide-react';

const VideoWidget = ({ data, isLocked, isActive = true }) => {
    const [ver, setVer] = useState(0);
    const reload = () => setVer(v => v + 1);

    const [isStuck, setIsStuck] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isMissing, setIsMissing] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [reconnectCount, setReconnectCount] = useState(0);

    const containerRef = useRef(null);
    const iframeRef = useRef(null);
    const lastCheckTime = useRef(0);
    const lastTimeRef = useRef(-1);
    const stuckCounter = useRef(0);

    const getEmbedUrl = (url) => {
        if (!url) return '';

        // Handle YouTube
        if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('youtube-nocookie.com')) {
            let videoId = null;
            let playlistId = null;

            if (url.includes('list=')) {
                playlistId = url.split('list=')[1].split('&')[0];
            }

            if (url.includes('v=')) {
                videoId = url.split('v=')[1].split('&')[0];
            } else if (url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1].split('?')[0];
            } else if (url.includes('/shorts/')) {
                videoId = url.split('/shorts/')[1].split('?')[0];
            } else if (url.includes('embed/')) {
                // Extract ID from existing embed URL
                videoId = url.split('embed/')[1].split('?')[0];
            }

            const origin = encodeURIComponent(window.location.origin);
            const flags = `origin=${origin}&rel=0&modestbranding=1&playsinline=1&autoplay=1&mute=1&enablejsapi=1&widgetapi=1&hl=en&iv_load_policy=3&controls=1&widget_referrer=${origin}`;

            if (videoId && playlistId) {
                return `https://www.youtube-nocookie.com/embed/${videoId}?list=${playlistId}&${flags}`;
            } else if (videoId) {
                return `https://www.youtube-nocookie.com/embed/${videoId}?playlist=${videoId}&${flags}`;
            } else if (playlistId) {
                return `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}&${flags}`;
            }
        }
        if (url.includes(':1984')) {
            const path = url.split(':1984')[1];
            return path;
        }

        if ((data.type === 'proxy' || data.type === 'web' || data.type === 'integration') && (url.startsWith('http') || url.startsWith('www') || url.startsWith('/'))) {
            if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                let finalUrl = url;
                if (data.type === 'proxy' || data.type === 'web') {
                    finalUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
                }

                if (data.type === 'integration' && isLocked) {
                    const separator = finalUrl.includes('?') ? '&' : '?';
                    finalUrl += `${separator}locked=true`;
                }

                return finalUrl;
            }
        }

        return url;
    };

    // Reset loading state when url/id changes
    useEffect(() => {
        setIsLoading(true);
        setIsMissing(false);
        setIsStuck(false);
        stuckCounter.current = 0;
        lastTimeRef.current = -1;

        if (data.type === 'integration') {
            const [rawUrl] = (data.value || '').split('|');
            fetch(encodeURI(rawUrl), { method: 'HEAD' })
                .then(res => {
                    if (!res.ok) setIsMissing(true);
                })
                .catch(() => setIsMissing(true));
        }

        // Safety timeout for isLoading
        const timer = setTimeout(() => setIsLoading(false), 15000);
        return () => clearTimeout(timer);
    }, [data.value, data.id, data.type, ver]);

    const [isVisible, setIsVisible] = useState(true);
    const [isVibrating, setIsVibrating] = useState(false);

    // Track visibility for hibernation
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new IntersectionObserver(([entry]) => {
            setIsVisible(entry.isIntersecting);
        }, { threshold: 0.1 });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    // Dedicated Vibration Interval for Stuck Streams (Randomized Stagger)
    const jitter = useMemo(() => Math.random() * 3000, [data.id]);

    useEffect(() => {
        if (!isStuck || data.type !== 'camera') {
            setIsVibrating(false);
            return;
        }

        let interval;
        const startVibration = () => {
            const vibrateBurst = () => {
                if (isVisible && document.visibilityState === 'visible') {
                    setIsVibrating(true);
                    setTimeout(() => setIsVibrating(false), 1000);
                }
            };

            vibrateBurst();
            interval = setInterval(vibrateBurst, 3000);
        };

        const timeout = setTimeout(startVibration, jitter);
        return () => {
            clearTimeout(timeout);
            if (interval) clearInterval(interval);
        };
    }, [isStuck, isVisible, data.type, jitter]);

    // Dispatch custom event for grid-level alerts (Shake)
    useEffect(() => {
        const event = new CustomEvent('zulu7-widget-alert', {
            detail: {
                id: data.id,
                status: isStuck ? 'down' : 'up',
                isVibrating: isVibrating
            }
        });
        window.dispatchEvent(event);
    }, [data.id, isStuck, isVibrating]);

    // Stuck Detection Monitor (Every 3 seconds)
    React.useEffect(() => {
        if (data.type !== 'camera' || isLoading || isMissing) return;

        const checkStream = () => {
            try {
                const iframe = iframeRef.current;
                if (!iframe) return;

                const doc = iframe.contentDocument || iframe.contentWindow?.document;
                if (!doc) return;

                const video = doc.querySelector('video');
                if (!video) return;

                const currentTime = video.currentTime;

                if (video.paused || currentTime === lastTimeRef.current) {
                    stuckCounter.current++;
                } else {
                    stuckCounter.current = 0;
                    if (isStuck) {
                        setIsStuck(false);
                        setReconnectCount(0); // Reset count on successful play
                    }
                }

                lastTimeRef.current = currentTime;

                if (stuckCounter.current >= 3) {
                    if (!isStuck) setIsStuck(true);
                }
            } catch (err) { /* ignore */ }
        };

        const interval = setInterval(checkStream, 3000);
        return () => clearInterval(interval);
    }, [data.type, isLoading, isMissing, isStuck]);

    // Handle Audio Muting Based on Active Workspace
    const updateMuteState = () => {
        if (!iframeRef.current) return;
        try {
            const iframe = iframeRef.current;
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc) {
                const mediaElements = doc.querySelectorAll('video, audio');
                mediaElements.forEach(el => {
                    el.muted = !isActive;
                });
            } else if (data.type === 'iframe') {
                const [rawUrl] = (data.value || '').split('|');
                if (rawUrl && (rawUrl.includes('youtube.com') || rawUrl.includes('youtu.be') || rawUrl.includes('youtube-nocookie.com'))) {
                    iframe.contentWindow?.postMessage(JSON.stringify({
                        event: 'command',
                        func: isActive ? 'unMute' : 'mute',
                        args: []
                    }), '*');
                }
            }
        } catch (err) { /* ignore cross-origin */ }
    };

    useEffect(() => {
        updateMuteState();
    }, [isActive]);

    // Exponential Backoff Auto-Reconnect
    useEffect(() => {
        if (!isStuck || data.type !== 'camera') return;

        // Exponential backoff: 5s, 10s, 20s, 40s, then 60s indefinitely.
        const delay = Math.min(Math.pow(2, reconnectCount) * 5000, 60000);

        const timer = setTimeout(() => {
            console.log(`[VideoWidget] Auto-reconnecting camera "${data.id}" (Attempt ${reconnectCount + 1}) after ${delay / 1000}s`);
            setReconnectCount(prev => prev + 1);
            reload();
        }, delay);

        return () => clearTimeout(timer);
    }, [isStuck, reconnectCount, data.id, data.type]);

    React.useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };

        const handleMessage = (event) => {
            if (iframeRef.current && event.source === iframeRef.current.contentWindow) {
                if (event.data === 'zulu7-request-fullscreen') {
                    toggleFullScreen();
                }
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        window.addEventListener('message', handleMessage);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            window.removeEventListener('message', handleMessage);
        };
    }, [data.id]);

    const toggleFullScreen = () => {
        if (document.fullscreenElement !== containerRef.current) {
            containerRef.current.requestFullscreen().catch(err => {
                console.error(`FullScreen Error: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
        }
    };

    // Authentic TV Static Animation Overlay (Optimized for CPU)
    const StaticOverlay = ({ title }) => (
        <div className="absolute inset-0 z-40 bg-[#0d0d12] overflow-hidden flex flex-col items-center justify-center p-6 select-none pointer-events-auto">
            {/* Optimized CSS Noise - Replaces expensive SVG turbulence filter */}
            <div className="absolute inset-0 opacity-[0.45] pointer-events-none mix-blend-screen scale-[2.5] bg-tv-static animate-tv-snow" />

            {/* Scanning Lines & Flickering Overlays */}
            <div className="absolute inset-0 bg-scan-lines opacity-[0.12] pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/[0.06] to-transparent h-1/2 w-full animate-vhs-scan pointer-events-none" />

            <div className="relative z-10 flex flex-col items-center animate-pulse-flicker">

                <h3 className="text-xl font-black text-white uppercase tracking-[0.1em] mb-4 drop-shadow-2xl text-center max-w-[280px]">
                    {title}
                </h3>

                <p className="text-[10px] font-bold text-white/50 italic tracking-[0.4em] uppercase drop-shadow-lg">
                    No Signal
                </p>
                <p className="text-[9px] text-white/30 tracking-[0.3em] font-medium uppercase mt-2">
                    Searching for input...
                </p>
            </div>

            {/* Background Siren Glow */}
            <div className="absolute top-0 left-0 w-64 h-64 blur-[60px] rounded-full animate-siren-intense pointer-events-none z-0 -translate-x-1/2 -translate-y-1/2 opacity-30 overflow-hidden" />

            {/* VCR Style OSD */}
            <div className="absolute top-6 left-6 flex items-center space-x-2">
                <div className="text-[10px] font-mono font-bold text-white/40 tracking-widest uppercase">Loss</div>
            </div>
            <div className="absolute bottom-6 right-6 text-[10px] font-mono font-bold text-white/30 tracking-[0.3em] uppercase">STBY</div>

            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes vhs-scan {
                    0% { transform: translateY(-100%); }
                    100% { transform: translateY(200%); }
                }
                @keyframes pulse-flicker {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    33% { opacity: 0.95; transform: scale(1.002); }
                    66% { opacity: 0.98; transform: translate(0.5px, 0.5px); }
                }
                @keyframes tv-snow {
                    0% { background-position: 0 0; }
                    20% { background-position: 20% 10%; }
                    40% { background-position: -10% 30%; }
                    60% { background-position: 15% -15%; }
                    80% { background-position: -25% 10%; }
                    100% { background-position: 0 0; }
                }
                @keyframes siren-intense {
                    0%, 25% { background-color: rgba(239, 68, 68, 0.7); filter: blur(60px); transform: translate(-50%, -50%) scale(1); }
                    30%, 75% { background-color: rgba(0, 71, 255, 0.7); filter: blur(80px); transform: translate(-45%, -45%) scale(1.4); }
                    80%, 100% { background-color: rgba(239, 68, 68, 0.7); filter: blur(60px); transform: translate(-50%, -50%) scale(1); }
                }
                .animate-vhs-scan { animation: vhs-scan 4s linear infinite; }
                .animate-pulse-flicker { animation: pulse-flicker 0.1s infinite; }
                .animate-tv-snow { animation: tv-snow 0.1s steps(5) infinite; }
                .animate-siren-intense { animation: siren-intense 0.8s steps(10) infinite; }
                .bg-scan-lines {
                    background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.3) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.05), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.05));
                    background-size: 100% 2px, 3px 100%;
                }
                .bg-tv-static {
                    background-image: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAMAAAApeIjkAAAABlBMVEUAAAD///+l2Z/dAAAAbUlEQVR4XmP4TxcMDAzIgB/C+F8BfggY/0vADwHzfwn4IGB+CDA/BIx/S8AXAfNDwPkpYPwbAn4ImP9LwBcB80OA+SFg/FsCvgCYHwLOTwHj3xDwQ8D8XwK+CJgfAsxPAePflIAfAsZ/CvgBjP8Z4A0An98Wv9jKNoAAAAAASUVORK5CYII=");
                    background-repeat: repeat;
                }
            `}} />
        </div>
    );

    // Render iframe for 'iframe', 'proxy', 'web', 'camera', and 'integration' types
    if (data.type === 'iframe' || data.type === 'camera' || data.type === 'proxy' || data.type === 'web' || data.type === 'integration') {
        const [rawUrl, displayName] = (data.value || '').split('|');
        const embedUrl = getEmbedUrl(rawUrl);

        let title = displayName || "Widget";
        if (!displayName) {
            try {
                const urlObj = new URL(rawUrl, 'http://base.com');
                const hostname = urlObj.hostname;
                if (hostname !== 'base.com') title = hostname.replace('www.', '');

                if (data.type === 'camera') {
                    const srcParam = urlObj.searchParams.get('src');
                    title = srcParam ? srcParam.charAt(0).toUpperCase() + srcParam.slice(1) : `Camera ${data.id.split('-').pop()}`;
                }
            } catch { title = rawUrl; }
        }

        return (
            <div ref={containerRef} className={`flex flex-col relative group overflow-hidden bg-black ${isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen' : 'h-full w-full'}`}>
                {data.type === 'camera' && (
                    <div className="absolute inset-0 z-20 cursor-pointer" onClick={toggleFullScreen} title={isFullscreen ? "Tap to exit full screen" : "Tap for full screen"} />
                )}

                {isLocked && (
                    <div className="absolute top-1.5 right-3.5 z-50 flex items-center bg-black/80 backdrop-blur-md rounded-none border border-white/20 no-drag overflow-hidden">
                        {data.type === 'iframe' && (
                            <>
                                <button onClick={(e) => { e.stopPropagation(); window.open(rawUrl, '_blank'); }} className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus" title="Open in New Tab">
                                    <ExternalLink size={14} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                                </button>
                                <div className="w-[1px] h-4 bg-white/5"></div>
                            </>
                        )}
                        <button onClick={(e) => { e.stopPropagation(); reload(); }} className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus" title="Refresh Widget">
                            <RefreshCw size={14} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                        </button>
                    </div>
                )}

                <div className="flex-1 relative w-full h-full overflow-hidden bg-[#0d0d12]">
                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center z-0 bg-[#0d0d12]">
                            <RefreshCw size={24} className="animate-spin text-white/10" />
                        </div>
                    )}

                    {isStuck && data.type === 'camera' && !isLoading && <StaticOverlay title={title} />}

                    <div className="w-full h-full relative z-10">
                        {isMissing && data.type === 'integration' ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-[#0d0d12] text-center">
                                <AlertCircle size={48} className="text-orange-500 mb-4 opacity-50" />
                                <h3 className="text-sm font-bold text-white uppercase tracking-widest mb-2">Integration Missing</h3>
                                <p className="text-xs text-white/40 max-w-[240px]">Integration file not found in `/integrations` folder.</p>
                            </div>
                        ) : (
                            <iframe
                                ref={iframeRef}
                                key={ver}
                                src={embedUrl}
                                name={data.id}
                                title={data.id}
                                style={{ colorScheme: 'dark', background: 'transparent' }}
                                className={`w-full h-full border-0 pointer-events-auto transition-opacity duration-500 ${isLoading || isMissing ? 'opacity-0' : 'opacity-100'}`}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                allowTransparency={true}
                                referrerPolicy="no-referrer-when-downgrade"
                                onLoad={(e) => {
                                    setIsLoading(false);
                                    updateMuteState();
                                    try {
                                        const doc = e.target.contentDocument;
                                        if (doc) {
                                            const style = doc.createElement('style');
                                            style.textContent = `
                                                html, body { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: black !important; }
                                                ::-webkit-scrollbar { width: 0px; background: transparent; }
                                                * { -ms-overflow-style: none; scrollbar-width: none; }
                                                video, img, canvas, .fill-screen { width: 100% !important; height: 100% !important; object-fit: fill !important; }
                                            `;
                                            doc.head.appendChild(style);
                                        }
                                    } catch (err) { /* Cross-origin ignore */ }
                                }}
                                loading="lazy"
                            />
                        )}
                    </div>

                    {data.type === 'camera' && (
                        <div className="absolute bottom-2 left-2 flex items-center space-x-1.5 z-10 px-2 py-1 bg-black/40 backdrop-blur-sm rounded-none border border-white/5 pointer-events-none">
                            <div className={`w-1.5 h-1.5 rounded-none animate-pulse ${isStuck ? 'bg-orange-500' : 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]'}`}></div>
                            <span className={`text-[9px] font-bold tracking-wider ${isStuck ? 'text-orange-400 animate-pulse' : 'text-white/90'}`}>{isStuck ? 'STUCK' : 'LIVE'}</span>
                        </div>
                    )}

                    {isStuck && (
                        <div className="absolute top-0 left-0 w-64 h-64 blur-[80px] rounded-full animate-siren-intense pointer-events-none z-0 -translate-x-1/2 -translate-y-1/2 opacity-20 overflow-hidden" />
                    )}

                    {(data.type === 'proxy' || data.type === 'web') && (
                        <div className="absolute bottom-2 left-2 flex items-center space-x-1.5 z-10 px-2 py-1 bg-black/40 backdrop-blur-sm rounded-none border border-white/5 pointer-events-none">
                            <div className="w-1.5 h-1.5 rounded-none bg-orange-500 animate-pulse"></div>
                            <span className="text-[9px] text-white/90 font-bold tracking-wider uppercase">WEB</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return null;
};

export default React.memo(VideoWidget, (prevProps, nextProps) => {
    return prevProps.data.id === nextProps.data.id &&
        prevProps.data.value === nextProps.data.value &&
        prevProps.data.type === nextProps.data.type &&
        prevProps.isLocked === nextProps.isLocked &&
        prevProps.isActive === nextProps.isActive;
});
