import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Rss, ExternalLink, RefreshCw, Maximize, Minimize } from 'lucide-react';

// Helper to find image in RSS/Atom nodes
const findImage = (node, content) => {
    // 1. media:thumbnail (Prioritize explicit thumbnails)
    const thumbnails = node.getElementsByTagNameNS('*', 'thumbnail');
    if (thumbnails && thumbnails.length > 0) {
        const url = thumbnails[0].getAttribute('url');
        if (url) return url;
    }

    // 2. media:content (Check for image type or items with url)
    const mediaContents = node.getElementsByTagNameNS('*', 'content');
    for (let i = 0; i < mediaContents.length; i++) {
        const m = mediaContents[i];
        const url = m.getAttribute('url');
        const type = m.getAttribute('type');

        if (url && (!type || type.startsWith('image/'))) {
            return url;
        }
    }

    // 3. enclosure
    const enclosure = node.querySelector('enclosure');
    if (enclosure) {
        const url = enclosure.getAttribute('url');
        const type = enclosure.getAttribute('type');
        if (url && (!type || type.startsWith('image/'))) return url;
    }

    // 4. Simple image tag
    const img = node.querySelector('image');
    if (img && img.textContent) return img.textContent;

    // 5. Regex in description/content
    if (content) {
        const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (match) return match[1];
    }
    return null;
};

const RSSWidget = ({ data, isLocked }) => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [feedTitle, setFeedTitle] = useState('');

    const containerRef = useRef(null);
    const scrollRef = useRef(null);
    const contentRef = useRef(null);
    const preciseScrollYRef = useRef(0);
    const lastTimestampRef = useRef(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [isUserScrolling, setIsUserScrolling] = useState(false);
    const userScrollTimeoutRef = useRef(null);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().catch(e => console.error(e));
        } else {
            document.exitFullscreen().catch(e => console.error(e));
        }
    };

    // Default to a known working feed if data.value is empty (shouldn't happen with valid creation)
    const [rawFeedUrl, displayName] = (data.value || '').split('|');
    // Support both commas and newlines for splitting URLs
    const urls = (rawFeedUrl || 'https://feeds.bbci.co.uk/news/rss.xml').split(/\r?\n|,/).map(u => u.trim()).filter(Boolean);

    const fetchFeed = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Randomize feed order
            const shuffledUrls = [...urls].sort(() => Math.random() - 0.5);

            const fetchPromises = shuffledUrls.map(async (url) => {
                const proxyUrl = `/api/rss?url=${encodeURIComponent(url)}`;
                const response = await fetch(proxyUrl);
                if (!response.ok) throw new Error(`Failed to fetch: ${url}`);

                const text = await response.text();
                const parser = new DOMParser();
                const xml = parser.parseFromString(text, "text/xml");

                let title = "RSS Feed";
                let entries = [];

                // Try Standard RSS (2.0)
                let channel = xml.querySelector("channel");
                if (channel) {
                    title = channel.querySelector("title")?.textContent || "RSS Feed";
                    entries = Array.from(channel.querySelectorAll("item")).map(item => {
                        const description = item.querySelector("description")?.textContent || "";
                        const contentEncoded = item.getElementsByTagNameNS("*", "encoded")[0]?.textContent || "";
                        return {
                            title: item.querySelector("title")?.textContent || "Untitled",
                            link: item.querySelector("link")?.textContent || "#",
                            pubDate: item.querySelector("pubDate")?.textContent || "",
                            image: findImage(item, description + contentEncoded),
                            source: title
                        };
                    });
                } else {
                    // Try Atom
                    const feed = xml.querySelector("feed");
                    if (feed) {
                        title = feed.querySelector("title")?.textContent || "RSS Feed";
                        entries = Array.from(feed.querySelectorAll("entry")).map(entry => {
                            const linkNode = entry.querySelector("link");
                            const link = linkNode?.getAttribute("href") || linkNode?.textContent || "#";
                            const content = entry.querySelector("content")?.textContent || entry.querySelector("summary")?.textContent || "";
                            return {
                                title: entry.querySelector("title")?.textContent || "Untitled",
                                link: link,
                                pubDate: entry.querySelector("updated")?.textContent || entry.querySelector("published")?.textContent || "",
                                image: findImage(entry, content),
                                source: title
                            };
                        });
                    }
                }
                return { title, entries };
            });

            const results = await Promise.allSettled(fetchPromises);

            let allItems = [];
            let titles = [];

            results.forEach(result => {
                if (result.status === 'fulfilled' && result.value.entries.length > 0) {
                    allItems = [...allItems, ...result.value.entries];
                    titles.push(result.value.title);
                }
            });

            if (allItems.length === 0) {
                throw new Error("No headlines found in any provided feed");
            }

            // Shuffle all accumulated items for a truly mixed feed
            const fullyShuffled = allItems.sort(() => Math.random() - 0.5);

            setItems(fullyShuffled);
            // If multiple feeds, show a generic title or first title
            if (urls.length > 1) {
                setFeedTitle("Multi-Feed RSS");
            } else {
                setFeedTitle(titles[0] || "RSS Feed");
            }

        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [urls.join(',')]);

    useEffect(() => {
        fetchFeed();
        // Refresh every 15 minutes
        const interval = setInterval(fetchFeed, 15 * 60 * 1000);
        return () => clearInterval(interval);
    }, [fetchFeed]);

    // IntersectionObserver to detect if widget is visible (for hibernation)
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new IntersectionObserver(([entry]) => {
            setIsVisible(entry.isIntersecting);
        }, { threshold: 0.1 });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const [isHovered, setIsHovered] = useState(false);

    // Auto-scroll logic with GPU acceleration (transform)
    useEffect(() => {
        if (isFullscreen || !items.length) return;

        const content = contentRef.current;
        if (!content) return;

        let requestRef;
        const pixelsPerSecond = 30;

        const scroll = (timestamp) => {
            if (!lastTimestampRef.current) lastTimestampRef.current = timestamp;
            const delta = timestamp - lastTimestampRef.current;
            lastTimestampRef.current = timestamp;

            // Pause if user is manual-scrolling or hovering or widget is not visible or tab is backgrounded
            if (!isUserScrolling && !isHovered && isVisible && document.visibilityState === 'visible') {
                const increment = (pixelsPerSecond * delta) / 1000;
                preciseScrollYRef.current += increment;

                // Seamless loop: if we passed the first half, jump back
                // items are doubled, so we check content height / 2
                const halfHeight = content.scrollHeight / 2;
                if (preciseScrollYRef.current >= halfHeight) {
                    preciseScrollYRef.current -= halfHeight;
                }

                // Apply GPU-accelerated transform
                content.style.transform = `translateY(${-preciseScrollYRef.current}px)`;
            }

            requestRef = requestAnimationFrame(scroll);
        };

        requestRef = requestAnimationFrame(scroll);
        return () => {
            if (requestRef) cancelAnimationFrame(requestRef);
            lastTimestampRef.current = 0;
        };
    }, [isFullscreen, items.length, isUserScrolling, isHovered, isVisible]);

    const handleWheel = (e) => {
        if (isFullscreen) return;

        // Update current scroll coordinate based on wheel movement
        preciseScrollYRef.current += e.deltaY;

        // Loop protection for manual scroll
        const content = contentRef.current;
        if (content) {
            const halfHeight = content.scrollHeight / 2;
            if (preciseScrollYRef.current >= halfHeight) preciseScrollYRef.current -= halfHeight;
            if (preciseScrollYRef.current < 0) preciseScrollYRef.current += halfHeight;

            content.style.transform = `translateY(${-preciseScrollYRef.current}px)`;
        }

        triggerManualScrollPause();
    };

    const triggerManualScrollPause = () => {
        setIsUserScrolling(true);
        if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
        userScrollTimeoutRef.current = setTimeout(() => {
            setIsUserScrolling(false);
        }, 5000); // 5 second pause for manual interaction
    };

    // Format date nicely
    const formatDate = (dateString) => {
        try {
            const date = new Date(dateString);
            return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', month: 'short', day: 'numeric' }).format(date);
        } catch {
            return "";
        }
    };

    if (loading) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center text-white/50 bg-gray-900">
                <Rss className="animate-pulse mb-2" size={32} />
                <span className="text-xs">Loading Feed...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-red-900/20 text-red-300 p-4 text-center">
                <Rss className="mb-2 text-red-400" size={32} />
                <span className="text-xs font-bold mb-1">Feed Error</span>
                <span className="text-[10px] opacity-70 mb-2">{error}</span>
                <button
                    onClick={fetchFeed}
                    className="flex items-center px-3 py-1 bg-white/2 hover:bg-white/20 rounded text-[10px] transition-colors"
                >
                    <RefreshCw size={10} className="mr-1" /> Retry
                </button>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="w-full h-full bg-[#1a1a20] flex flex-col overflow-hidden relative group">
            {/* Header - Hidden when locked */}
            {!isLocked && (
                <div className="flex items-center justify-between p-3 bg-white/5 border-b border-white/5 z-10 shrink-0">
                    <div className="flex items-center space-x-2 overflow-hidden">
                        <Rss size={16} className="text-orange-500 shrink-0" />
                        <span className="text-xs font-bold text-white truncate" title={displayName || feedTitle}>
                            {displayName || feedTitle}
                        </span>
                    </div>
                </div>
            )}

            {/* Locked Mode Refresh Overlay */}
            {isLocked && (
                <div className="absolute top-1.5 right-3.5 z-50 flex items-center space-x-2">
                    <button
                        onClick={fetchFeed}
                        className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus"
                        title="Refresh Widget"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            )}

            {/* Scrolling Content Container */}
            <div
                ref={scrollRef}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onWheel={handleWheel}
                onTouchStart={triggerManualScrollPause}
                className={`flex-1 relative bg-[#1a1a20] overflow-hidden`}
            >
                {/*
                   The actual scrolling layer. we use translate for GPU perf.
                */}
                <div
                    ref={contentRef}
                    className="w-full will-change-transform"
                    style={{ willChange: 'transform' }}
                >
                    <div className={`${(isFullscreen || data.isMaximized) ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4' : ''}`}>
                        {((isFullscreen || data.isMaximized) ? items : [...items, ...items]).map((item, index) => (
                            <div
                                key={`${index}-${item.link}`}
                                className={`
                                    ${(isFullscreen || data.isMaximized)
                                        ? 'bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 transition-colors flex flex-col h-full'
                                        : 'p-4 border-b border-white/5 hover:bg-white/5 transition-colors'}
                                `}
                            >
                                <a
                                    href={item.link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={`Source: ${item.source}`}
                                    className={`block group/item ${(isFullscreen || data.isMaximized) ? 'flex-1 flex flex-col p-4' : ''}`}
                                >
                                    {item.source && (
                                        <div className="flex items-center space-x-2 mb-2">
                                            <span className="text-[10px] font-bold text-orange-500 uppercase tracking-widest">{item.source}</span>
                                        </div>
                                    )}
                                    {item.image && (
                                        <div className={`
                                            ${(isFullscreen || data.isMaximized)
                                                ? 'w-full aspect-video mb-4 rounded-lg overflow-hidden bg-black/20'
                                                : 'w-full h-48 mb-3 overflow-hidden rounded-none bg-white/5 relative'}
                                        `}>
                                            <img
                                                src={item.image}
                                                alt={item.title}
                                                className="w-full h-full object-cover opacity-80 group-hover/item:opacity-100 transition-opacity"
                                                onError={(e) => { e.target.style.display = 'none'; }}
                                            />
                                        </div>
                                    )}
                                    <h4 className={`
                                        font-medium text-white/90 group-hover/item:text-blue-400 leading-tight transition-colors
                                        ${(isFullscreen || data.isMaximized) ? 'text-2xl mb-3 font-bold' : 'text-3xl mb-2'}
                                    `}>
                                        {item.title}
                                    </h4>
                                    {item.pubDate && (
                                        <span className={`
                                            block text-white/40
                                            ${(isFullscreen || data.isMaximized) ? 'text-sm mt-auto' : 'text-base'}
                                        `}>
                                            {formatDate(item.pubDate)}
                                        </span>
                                    )}
                                </a>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Gradient Masks for smooth fade in/out - Hide in Full Screen */}
                {!(isFullscreen || data.isMaximized) && (
                    <>
                        <div className="absolute top-0 left-0 w-full h-4 bg-gradient-to-b from-[#1a1a20] to-transparent pointer-events-none z-10" />
                        <div className="absolute bottom-0 left-0 w-full h-8 bg-gradient-to-t from-[#1a1a20] to-transparent pointer-events-none z-10" />
                    </>
                )}
            </div>
        </div>
    );
};

export default RSSWidget;
