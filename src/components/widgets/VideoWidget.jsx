import React, { useState } from 'react';
import { Camera, PlayCircle, RefreshCw, ArrowDownCircle, Globe, Maximize, Minimize, ExternalLink } from 'lucide-react';

const VideoWidget = ({ data, isLocked }) => {
    const [ver, setVer] = useState(0);
    const reload = () => setVer(v => v + 1);

    const getEmbedUrl = (url) => {
        if (!url) return '';
        try {
            // Handle YouTube
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
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
                    return url; // Already an embed URL
                }

                const origin = window.location.origin;
                if (videoId && playlistId) {
                    return `https://www.youtube.com/embed/${videoId}?list=${playlistId}&origin=${origin}&rel=0&modestbranding=1&playsinline=1`;
                } else if (videoId) {
                    return `https://www.youtube.com/embed/${videoId}?origin=${origin}&rel=0&modestbranding=1&playsinline=1`;
                } else if (playlistId) {
                    return `https://www.youtube.com/embed/videoseries?list=${playlistId}&origin=${origin}&rel=0&modestbranding=1&playsinline=1`;
                }
            }
            if (url.includes(':1984')) {
                // Rewrite legacy Go2RTC URLs to use relative proxy path
                // e.g., http://192.168.1.111:1984/stream.html?src=... -> /stream.html?src=...
                const path = url.split(':1984')[1];
                return path;
            }

            // Wrap generic URLs in the proxy for 'proxy' or 'web' type to bypass X-Frame-Options/CSP
            if ((data.type === 'proxy' || data.type === 'web') && (url.startsWith('http') || url.startsWith('www'))) {
                // Skip proxying for YouTube as it has its own embed system
                if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
                    return `/api/proxy?url=${encodeURIComponent(url)}`;
                }
            }

            return url;
        } catch {
            return url;
        }
    };

    // Removed unused scrollRef

    const [isLoading, setIsLoading] = useState(true);

    // Reset loading state when url/id changes
    // reacting to data.value or data.id changes
    React.useEffect(() => {
        setIsLoading(true);
    }, [data.value, data.id]);

    const containerRef = React.useRef(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    React.useEffect(() => {
        const handleFullscreenChange = () => {
            // Only set to true if THIS container is the one in full screen
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const toggleFullScreen = () => {
        // If we are not currently the full screen element (even if something else is), request it
        if (document.fullscreenElement !== containerRef.current) {
            containerRef.current.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            // Already full screen - exit
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    // Render iframe for 'iframe', 'proxy', 'web', and 'camera' types
    if (data.type === 'iframe' || data.type === 'camera' || data.type === 'proxy' || data.type === 'web') {
        const [rawUrl, displayName] = (data.value || '').split('|');
        const embedUrl = getEmbedUrl(rawUrl);

        let title = displayName || "Widget";
        let hostname = "";

        if (!displayName) {
            try {
                // Handle relative URLs by providing a base
                const urlObj = new URL(rawUrl, 'http://base.com');
                hostname = urlObj.hostname;
                // Only set hostname title if it's NOT our dummy base
                if (hostname !== 'base.com') {
                    title = hostname.replace('www.', '');
                }

                if (data.type === 'camera') {
                    const srcParam = urlObj.searchParams.get('src');
                    if (srcParam) {
                        // Capitalize first letter
                        title = srcParam.charAt(0).toUpperCase() + srcParam.slice(1);
                    } else {
                        title = `Camera ${data.id.split('-').pop()}`;
                    }
                }
            } catch {
                title = rawUrl;
            }
        }

        return (
            <div
                ref={containerRef}
                className={`flex flex-col relative group overflow-hidden bg-black ${isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen' : 'h-full w-full'}`}
            >
                {/* Click overlay for full-screen toggle - Only for Camera to allow interaction on iFrames */}
                {data.type === 'camera' && (
                    <div
                        className="absolute inset-0 z-20 cursor-pointer"
                        onClick={toggleFullScreen}
                        title={isFullscreen ? "Tap to exit full screen" : "Tap for full screen"}
                    />
                )}

                {/* Controls Overlay - Refresh for iFrames, Proxy and Cameras (Locked Mode) */}
                {isLocked && (data.type === 'iframe' || data.type === 'camera' || data.type === 'proxy' || data.type === 'web') && (
                    <div className="absolute top-1.5 right-3.5 z-50 flex items-center bg-black/80 backdrop-blur-md rounded-none border border-white/20 no-drag overflow-hidden">
                        {data.type === 'iframe' && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        window.open(rawUrl, '_blank');
                                    }}
                                    className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus"
                                    title="Open in New Tab"
                                >
                                    <ExternalLink size={14} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                                </button>
                                <div className="w-[1px] h-4 bg-white/5"></div>
                            </>
                        )}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                reload();
                            }}
                            className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus"
                            title="Refresh Widget"
                        >
                            <RefreshCw size={14} className="drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]" />
                        </button>
                    </div>
                )}

                <div className="flex-1 relative w-full h-full overflow-hidden bg-[#0d0d12]">
                    {/* Loading Spinner */}
                    {isLoading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center z-0 bg-[#0d0d12]">
                            <div className="relative mb-4 flex items-center justify-center">
                            </div>
                            {(data.type === 'proxy' || data.type === 'web') && (
                                <div className="flex flex-col items-center animate-pulse">
                                    <span className="text-[10px] font-bold text-orange-500 tracking-[0.2em] uppercase">Please wait</span>
                                    <span className="text-[10px] text-white/40 tracking-widest uppercase mt-1">Proxy Loading...</span>
                                </div>
                            )}
                            {data.type !== 'proxy' && data.type !== 'web' && (
                                <RefreshCw size={24} className="animate-spin text-white/10" />
                            )}
                        </div>
                    )}

                    {/* iFrame Container */}
                    <div className="w-full h-full relative z-10">
                        <iframe
                            key={ver}
                            src={embedUrl}
                            title={data.id}
                            style={{ colorScheme: 'dark' }}
                            className={`w-full h-full border-0 pointer-events-auto ${data.type === 'iframe' ? 'bg-white' : ''} transition-opacity duration-500 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            referrerPolicy="strict-origin-when-cross-origin"
                            onLoad={(e) => {
                                setIsLoading(false);
                                try {
                                    const doc = e.target.contentDocument;
                                    if (doc) {
                                        const style = doc.createElement('style');
                                        style.textContent = `
                                            html, body { width: 100% !important; height: 100% !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
                                            /* Hide Scrollbars */
                                            ::-webkit-scrollbar { width: 0px; background: transparent; }
                                            * { -ms-overflow-style: none; scrollbar-width: none; }
                                            video, img, canvas, .fill-screen { width: 100% !important; height: 100% !important; object-fit: fill !important; }
                                            .mode, .status { display: none !important; }
                                        `;
                                        doc.head.appendChild(style);
                                    }
                                } catch (err) { /* Cross-origin ignore */ }
                            }}
                            loading="lazy"
                        />
                    </div>

                    {/* LIVE badge for cameras */}
                    {data.type === 'camera' && (
                        <div className="absolute bottom-2 left-2 flex items-center space-x-1.5 z-10 px-2 py-1 bg-black/40 backdrop-blur-sm rounded-none border border-white/5 pointer-events-none">
                            <div className="w-1.5 h-1.5 rounded-none bg-red-500 animate-pulse"></div>
                            <span className="text-[9px] text-white/90 font-bold tracking-wider">LIVE</span>
                        </div>
                    )}

                    {/* WEB Proxy badge for proxied widgets */}
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
        prevProps.isLocked === nextProps.isLocked;
});
