import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertTriangle, Maximize, Minimize } from 'lucide-react';

const MediaWidget = ({ widget, isLocked }) => {
    // Widget Value format: "url|intervalSeconds"
    const [rawUrl = '', intervalStr = '180'] = (widget.value || '').split('|');
    const intervalMs = (parseInt(intervalStr, 10) || 180) * 1000;

    const [mediaList, setMediaList] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [videoDuration, setVideoDuration] = useState(0);

    const videoRef = useRef(null);
    const timerRef = useRef(null);
    const videoLoadTimeoutRef = useRef(null);
    const containerRef = useRef(null);
    const progressBarRef = useRef(null);

    // Fetch Media List
    useEffect(() => {
        let isMounted = true;
        const fetchMedia = async () => {
            if (!rawUrl) {
                console.log("[MediaWidget] fetchMedia: No rawUrl, skipping");
                if (isMounted) {
                    setError("No URL provided");
                    setIsLoading(false);
                }
                return;
            }

            console.log("[MediaWidget] fetchMedia starting for URL:", rawUrl);

            setIsLoading(true);
            setError(null);

            try {
                // Use relative path to hit the Vite proxy in dev, or the express server in prod
                const res = await fetch(`/api/media-folder?url=${encodeURIComponent(rawUrl)}`);
                if (!res.ok) throw new Error("Failed to fetch folder data");

                const data = await res.json();
                console.log("[MediaWidget] fetchMedia data received:", data);
                if (!data.files || data.files.length === 0) {
                    console.warn("[MediaWidget] fetchMedia: No files in response");
                    throw new Error("No media files found in folder");
                }

                if (isMounted) {
                    console.log("[MediaWidget] Setting media list:", data.files.length, "items");
                    // Randomize the initial array
                    const shuffled = [...data.files].sort(() => 0.5 - Math.random());
                    setMediaList(shuffled);
                    setCurrentIndex(0);
                    setIsLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    console.error("[MediaWidget] Error state:", err);
                    setError(err.message);
                    setIsLoading(false);
                }
            }
        };

        fetchMedia();
        return () => { isMounted = false; };
    }, [rawUrl]);

    // Slideshow Timer Logic
    const goToNext = () => {
        console.log("[MediaWidget] goToNext called");
        setCurrentIndex(prev => {
            const nextIdx = (prev + 1) >= mediaList.length ? 0 : prev + 1;
            console.log(`[MediaWidget] Advancing ${prev} -> ${nextIdx} `);
            return nextIdx;
        });
    };

    // Reset loading state when index changes to sync timer with next image load
    useEffect(() => {
        if (mediaList.length > 0) {
            console.log("[MediaWidget] Index changed, resetting loading state");
            setIsLoading(true);
            setVideoDuration(0);

            // Set a safety timeout for loading
            if (videoLoadTimeoutRef.current) clearTimeout(videoLoadTimeoutRef.current);
            videoLoadTimeoutRef.current = setTimeout(() => {
                if (isLoading) {
                    console.warn("[MediaWidget] Loading timeout reached, skipping...");
                    goToNext();
                }
            }, 30000); // 30s timeout for any media item
        }
        return () => {
            if (videoLoadTimeoutRef.current) clearTimeout(videoLoadTimeoutRef.current);
        };
    }, [currentIndex, mediaList]);

    useEffect(() => {
        if (timerRef.current) clearTimeout(timerRef.current);

        if (isLoading || error || mediaList.length === 0) {
            console.log("[MediaWidget] Timer blocked:", { isLoading, error, listSize: mediaList.length });
            return;
        }

        const currentMedia = mediaList[currentIndex];
        const isVideo = currentMedia?.mimeType?.startsWith('video/');
        // Add a 10s safety buffer for videos. Fallback to 5 mins if duration isn't loaded yet.
        const delay = isVideo ? (videoDuration > 0 ? videoDuration + 10000 : 300000) : intervalMs;

        console.log(`[MediaWidget] Setting timer for index ${currentIndex}(${delay}ms)`);
        timerRef.current = setTimeout(() => {
            console.log(`[MediaWidget] Timer fired for index ${currentIndex}`);
            goToNext();
        }, delay);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [currentIndex, mediaList, isLoading, error, intervalMs]);

    // Fullscreen event listener handling
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const toggleFullScreen = (e) => {
        if (e) e.stopPropagation();
        if (document.fullscreenElement !== containerRef.current) {
            containerRef.current?.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };


    // Render logic
    // Initial loading of list
    if (isLoading && mediaList.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black/50 text-white/50">
                <Loader2 size={32} className="animate-spin mb-2" />
                <span className="text-sm font-medium">Loading Media...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-black/50 text-red-500/80 p-4 text-center">
                <AlertTriangle size={32} className="mb-2" />
                <span className="text-sm font-medium uppercase tracking-wider mb-1">Media Error</span>
                <span className="text-xs opacity-70 break-all">{error}</span>
            </div>
        );
    }

    if (mediaList.length === 0) return null;

    const currentMedia = mediaList[currentIndex];
    const isVideo = currentMedia?.mimeType?.startsWith('video/');

    let mediaUrl = '';
    let posterUrl = '';

    if (currentMedia?.source === 'http') {
        mediaUrl = currentMedia.id;
    } else {
        // Fallback to existing Google Drive logic
        mediaUrl = isVideo
            ? `/api/video-proxy?id=${currentMedia.id}`
            : `https://drive.google.com/thumbnail?id=${currentMedia.id}&sz=w1920`;
        posterUrl = `https://drive.google.com/thumbnail?id=${currentMedia.id}&sz=w1920`;
    }

    console.log(`[MediaWidget] Current Media: ID=${currentMedia.id}, Source=${currentMedia?.source}, URL=${mediaUrl}`);

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-black group cursor-pointer overflow-hidden ${isFullscreen ? 'fixed inset-0 z-[9999]' : ''}`}
            onClick={() => goToNext()}
        >
            <div className={`absolute inset-0 z-0 ${(!isVideo || isVideoPlaying) ? 'opacity-100' : 'opacity-0'} transition-opacity duration-1000`}>
                {isVideo ? (
                    <video
                        ref={videoRef}
                        key={currentMedia.id}
                        src={mediaUrl}
                        poster={posterUrl || undefined}
                        className="w-full h-full object-contain pointer-events-none"
                        style={{
                            WebkitMediaControls: 'none',
                        }}
                        autoPlay
                        muted
                        playsInline
                        disablePictureInPicture
                        controlsList="nodownload nofullscreen noremoteplayback"
                        preload="auto"
                        onLoadStart={() => console.log("[MediaWidget] Video load start")}
                        onWaiting={() => console.log("[MediaWidget] Video waiting...")}
                        onLoadedMetadata={(e) => {
                            console.log("[MediaWidget] Video metadata loaded");
                            if (e.target.duration && !isNaN(e.target.duration)) {
                                setVideoDuration(e.target.duration * 1000);
                            }
                            if (videoLoadTimeoutRef.current) clearTimeout(videoLoadTimeoutRef.current);
                            setIsLoading(false);
                            setIsVideoPlaying(true);
                            videoRef.current?.play().catch(e => console.warn("[MediaWidget] Play failed:", e));
                        }}
                        onPlay={() => console.log("[MediaWidget] Video playing")}
                        onTimeUpdate={(e) => {
                            if (progressBarRef.current && e.target.duration) {
                                const pct = (e.target.currentTime / e.target.duration) * 100;
                                progressBarRef.current.style.width = `${pct}%`;
                            }
                        }}
                        onEnded={() => {
                            console.log("[MediaWidget] Video ended, advancing...");
                            goToNext();
                        }}
                        onError={(e) => {
                            console.error("[MediaWidget] Video error:", e.target.error);
                            if (videoLoadTimeoutRef.current) clearTimeout(videoLoadTimeoutRef.current);
                            goToNext();
                        }}
                    />
                ) : (
                    <img
                        key={currentMedia.id}
                        src={mediaUrl}
                        className="absolute inset-0 w-full h-full object-contain transition-opacity duration-1000"
                        alt=""
                        onLoad={() => setIsLoading(false)}
                        onError={(e) => {
                            console.error("[MediaWidget] Image load error:", e);
                            // If thumbnail fails, try the uc download link as fallback
                            if (e.target.src.includes('thumbnail')) {
                                console.log("[MediaWidget] Thumbnail failed, trying download link...");
                                e.target.src = `https://drive.google.com/uc?export=download&id=${currentMedia.id}`;
                            } else {
                                goToNext();
                            }
                        }}
                    />
                )}
            </div>

            {/* Unified UI Overlay Container */}
            <div className="absolute inset-0 z-[2147483647] pointer-events-none flex flex-col justify-between" style={{ transform: 'translateZ(0)' }}>
                {/* Top Section: Controls */}
                <div className="flex justify-end p-2 relative z-50">
                    {isLocked && (
                        <div
                            className="pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-black/60 hover:bg-black/90 rounded-md backdrop-blur-md cursor-pointer no-focus"
                            onClick={toggleFullScreen}
                            title={isFullscreen ? "Exit Fullscreen" : "Maximize Media"}
                        >
                            {isFullscreen ? <Minimize size={isFullscreen ? 28 : 18} className="text-white drop-shadow-md" /> : <Maximize size={18} className="text-white/90" />}
                        </div>
                    )}
                </div>

                {/* Bottom Section: Progress Bar */}
                <div className="relative w-full h-1 z-50">
                    <div
                        ref={progressBarRef}
                        key={`progress-${currentIndex}-${isVideo ? 'video' : 'image'}`}
                        className={`absolute bottom-0 left-0 h-full transition-all pointer-events-none ${(isLoading && isVideo) ? 'bg-orange-600/50 animate-pulse duration-1000' : 'bg-orange-500/80 duration-100 ease-linear'}`}
                        style={{
                            animation: (isLoading || isVideo) ? 'none' : `progress-bar ${intervalMs}ms linear forwards`,
                            width: (isLoading && isVideo) ? '100%' : '0%'
                        }}
                    />
                </div>
            </div>

            {/* Loading Overlay */}
            {isLoading && mediaList.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[4px] z-[2147483647] pointer-events-none" style={{ transform: 'translateZ(0)' }}>
                    <Loader2 size={32} className="animate-spin text-white/50 drop-shadow-md" />
                </div>
            )}

        </div>
    );
};


export default MediaWidget;
