import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Maximize, Minimize } from 'lucide-react';

const TickerWidget = ({ data, finnhubKey, isLocked }) => {
    const [quote, setQuote] = useState({ price: 0, change: 0, percentChange: 0, lastUpdated: null });
    const [marketStatus, setMarketStatus] = useState('Closed');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [history, setHistory] = useState([]);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const symbol = data.value.toUpperCase();
    const containerRef = useRef(null);

    const checkMarketStatus = () => {
        const now = new Date();
        const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const day = etTime.getDay();
        const hour = etTime.getHours();
        const minute = etTime.getMinutes();
        const decimalTime = hour + (minute / 60);

        // Monday (1) to Friday (5)
        const isWeekday = day >= 1 && day <= 5;
        // 9:30 AM to 4:00 PM ET
        const isMarketHours = decimalTime >= 9.5 && decimalTime < 16;

        return isWeekday && isMarketHours ? 'Open' : 'Closed';
    };

    const CACHE_DURATION = 10 * 60 * 1000; // 10 Minutes

    const getCachedData = () => {
        try {
            const cacheKey = `zulu7_ticker_v2_${symbol}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
                const { quote: cachedQuote, history: cachedHistory, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_DURATION && cachedQuote && cachedQuote.price > 0) {
                    return { quote: { ...cachedQuote, lastUpdated: timestamp }, history: cachedHistory || [] };
                }
            }
        } catch (e) {
            console.warn("Cache read failed", e);
        }
        return null;
    };

    const fetchStockData = async (ignoreCache = false) => {
        try {
            if (!ignoreCache) {
                const cached = getCachedData();
                if (cached) {
                    setQuote(cached.quote);
                    setHistory(cached.history || []);
                    setLoading(false);
                    setError(null);
                    return;
                }
            }

            let response;
            if (['BTC-USD', 'GC=F', 'SI=F', 'CL=F', '^DJI', '^GSPC', '^IXIC'].includes(symbol)) {
                response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&_t=${Date.now()}`);
            } else {
                const encodedSymbol = encodeURIComponent(symbol);
                response = await fetch(`/api/finance/${encodedSymbol}?interval=1d&range=1d&_t=${Date.now()}`);
            }

            if (!response.ok) throw new Error('API failed');

            const json = await response.json();
            if (json.error) throw new Error(json.error);
            if (!json.chart || !json.chart.result || json.chart.error) {
                throw new Error('API Error Payload');
            }

            const result = json.chart.result[0];
            const meta = result.meta;
            const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || 0;
            const previousClose = meta.chartPreviousClose || currentPrice;
            const change = currentPrice - previousClose;
            const percentChange = previousClose ? (change / previousClose) * 100 : 0;

            const DISPLAY_NAMES = {
                'GC=F': 'GOLD',
                'SI=F': 'SILVER',
                'CL=F': 'CRUDE OIL',
                '^DJI': 'DOW JONES',
                '^GSPC': 'S&P 500',
                '^IXIC': 'NASDAQ',
                'BTC-USD': 'BITCOIN'
            };

            let name = DISPLAY_NAMES[symbol] || meta.shortName || meta.longName || symbol;

            // NEW: Use dedicated quote API for better name/metadata if Chart API didn't give a good name
            if (!name || name.toUpperCase() === symbol.toUpperCase()) {
                try {
                    const quoteRes = await fetch(`/api/finance-quote?symbol=${encodeURIComponent(symbol)}`);
                    if (quoteRes.ok) {
                        const quoteJson = await quoteRes.json();
                        const quoteInfo = quoteJson?.quoteResponse?.result?.[0];
                        if (quoteInfo?.longName || quoteInfo?.shortName) {
                            name = quoteInfo.longName || quoteInfo.shortName;
                        }
                    }
                } catch (e) {
                    console.warn('Finance quote fallback failed', e);
                }
            }

            // Fallback to finance-search proxy if name is still missing
            if (!name || name.toUpperCase() === symbol.toUpperCase()) {
                try {
                    const searchRes = await fetch(`/api/finance-search?symbol=${encodeURIComponent(symbol)}`);
                    if (searchRes.ok) {
                        const searchJson = await searchRes.json();
                        const firstQuote = searchJson?.quotes?.[0];
                        if (firstQuote && (firstQuote.shortname || firstQuote.longname)) {
                            name = firstQuote.shortname || firstQuote.longname;
                        }
                    }
                } catch (e) {
                    console.warn('Finance search fallback failed', e);
                }
            }

            // Fallback to Finnhub if still no good name
            if (finnhubKey && (!name || name.toLowerCase() === symbol.toLowerCase())) {
                try {
                    const searchRes = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(symbol)}&token=${finnhubKey}`);
                    if (searchRes.ok) {
                        const searchData = await searchRes.json();
                        const exactMatch = searchData.result?.find(r => r.symbol === symbol || r.displaySymbol === symbol);
                        if (exactMatch && exactMatch.description) {
                            name = exactMatch.description;
                        }
                    }
                } catch (e) {
                    console.warn('Secondary name fetch failed', e);
                }
            }

            // Final fallback to hardcoded list
            if (!name || name.toUpperCase() === symbol.toUpperCase()) {
                if (DISPLAY_NAMES[symbol]) {
                    name = DISPLAY_NAMES[symbol];
                }
            }

            const quoteData = result.indicators.quote[0];
            const sentiment = quoteData ? quoteData.close || [] : [];
            const validHistory = sentiment.filter(p => p !== null && p !== undefined);

            const newQuote = {
                price: Number(currentPrice) || 0,
                change: Number(change) || 0,
                percentChange: Number(percentChange) || 0,
                name: name,
                lastUpdated: Date.now()
            };

            setQuote(newQuote);
            setHistory(validHistory);
            setError(null);
            setLoading(false);

            if (newQuote.price > 0) {
                try {
                    localStorage.setItem(`zulu7_ticker_v2_${symbol}`, JSON.stringify({
                        quote: newQuote,
                        history: validHistory,
                        timestamp: Date.now()
                    }));
                } catch (e) { console.warn("Cache save failed", e); }
            }

        } catch (err) {
            console.warn(`Primary stock API failed for ${symbol}:`, err);

            // Try the quote API directly as a secondary fallback
            try {
                const quoteRes = await fetch(`/api/finance-quote?symbol=${encodeURIComponent(symbol)}`);
                if (quoteRes.ok) {
                    const quoteJson = await quoteRes.json();
                    const data = quoteJson?.quoteResponse?.result?.[0];
                    if (data) {
                        const newQuote = {
                            price: Number(data.regularMarketPrice) || 0,
                            change: Number(data.regularMarketChange) || 0,
                            percentChange: Number(data.regularMarketChangePercent) || 0,
                            name: data.longName || data.shortName || DISPLAY_NAMES[symbol] || symbol,
                            lastUpdated: Date.now()
                        };
                        setQuote(newQuote);
                        setError(null);
                        setLoading(false);
                        return;
                    }
                }
            } catch (e) { console.warn('Quote API fallback failed', e); }

            if (finnhubKey) {
                try {
                    const encodedSymbol = encodeURIComponent(symbol);
                    const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodedSymbol}&token=${finnhubKey}`);
                    if (!res.ok) throw new Error(`Finnhub ${res.status}`);
                    const data = await res.json();
                    if (!data.c && data.c !== 0) throw new Error('No Data');

                    let companyName = quote.name || symbol;

                    // If we only have the symbol, try to get the full name
                    if (companyName.toLowerCase() === symbol.toLowerCase()) {
                        try {
                            const searchRes = await fetch(`https://finnhub.io/api/v1/search?q=${encodedSymbol}&token=${finnhubKey}`);
                            if (searchRes.ok) {
                                const searchData = await searchRes.json();
                                const exactMatch = searchData.result?.find(r => r.symbol === symbol || r.displaySymbol === symbol);
                                if (exactMatch && exactMatch.description) {
                                    companyName = exactMatch.description;
                                }
                            }
                        } catch (e) { console.warn('Finnhub profile fallback failed', e); }
                    }

                    if (!companyName || companyName.toUpperCase() === symbol.toUpperCase()) {
                        companyName = DISPLAY_NAMES[symbol] || symbol;
                    }

                    const newQuote = {
                        price: Number(data.c) || 0,
                        change: Number(data.d) || 0,
                        percentChange: Number(data.dp) || 0,
                        name: companyName,
                        lastUpdated: Date.now()
                    };

                    setQuote(newQuote);
                    setError(null);
                    setLoading(false);

                    try {
                        localStorage.setItem(`zulu7_ticker_v2_${symbol}`, JSON.stringify({
                            quote: newQuote,
                            history: [],
                            timestamp: Date.now()
                        }));
                    } catch (e) { console.warn("Cache save failed", e); }
                } catch (fhErr) {
                    if (quote.price === 0) setError(`FH: ${fhErr.message}`);
                }
            } else {
                if (quote.price === 0) setError("Yahoo Failed & No Key");
            }
            setLoading(false);
        }
    };

    useEffect(() => {
        let timeoutId;
        const cached = getCachedData();
        if (cached) {
            setQuote(cached.quote);
            setHistory(cached.history || []);
            setLoading(false);
            setMarketStatus(checkMarketStatus());
        } else {
            const initialLoad = () => {
                const status = checkMarketStatus();
                setMarketStatus(status);
                if (loading || status === 'Open') {
                    fetchStockData(true);
                }
            };
            const delay = Math.random() * 2000 + 100;
            timeoutId = setTimeout(initialLoad, delay);
        }

        const statusInterval = setInterval(() => {
            setMarketStatus(checkMarketStatus());
        }, 60000);

        const dataInterval = setInterval(() => {
            if (checkMarketStatus() === 'Open') {
                fetchStockData(true);
            }
        }, 600000);

        return () => {
            clearTimeout(timeoutId);
            clearInterval(statusInterval);
            clearInterval(dataInterval);
        };
    }, [symbol]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const toggleFullScreen = () => {
        if (document.fullscreenElement !== containerRef.current) {
            containerRef.current.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    const isPositive = quote.change >= 0;
    const bgColor = isPositive ? `rgba(0, 150, 0, 0.2)` : `rgba(180, 0, 0, 0.2)`;

    const BACKGROUND_IMAGES = {
        'GC=F': '/assets/tickers/gold.png',
        'SI=F': '/assets/tickers/silver.png',
        'CL=F': '/assets/tickers/oil.png',
        '^DJI': '/assets/tickers/dow.png',
        '^GSPC': '/assets/tickers/sp500.png',
        '^IXIC': '/assets/tickers/nasdaq.png',
        'BTC-USD': '/assets/tickers/bitcoin.png'
    };

    const bgImage = BACKGROUND_IMAGES[symbol];

    const getSparklinePath = (points, width, height) => {
        if (!points || points.length < 2) return '';
        const max = Math.max(...points);
        const min = Math.min(...points);
        const range = max - min || 1;
        const stepX = width / (points.length - 1);
        const coords = points.map((p, i) => {
            const x = i * stepX;
            const normalizedY = ((p - min) / range);
            const y = height - (normalizedY * (height * 0.8) + (height * 0.1));
            return `${x},${y}`;
        });
        return `M ${coords.join(' L ')}`;
    };

    const sparklinePath = useMemo(() => getSparklinePath(history, 300, 100), [history]);
    const isTrendUp = history.length > 0 ? history[history.length - 1] >= history[0] : isPositive;

    const DISPLAY_NAMES = {
        'GC=F': 'GOLD',
        'SI=F': 'SILVER',
        'CL=F': 'CRUDE OIL',
        '^DJI': 'DOW JONES',
        '^GSPC': 'S&P 500',
        '^IXIC': 'NASDAQ',
        'BTC-USD': 'BITCOIN'
    };
    const displayName = DISPLAY_NAMES[symbol] || symbol;

    return (
        <div
            ref={containerRef}
            onClick={toggleFullScreen}
            className={`flex flex-col relative overflow-hidden transition-all duration-500 backdrop-blur-sm group cursor-pointer ${isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen' : 'h-full w-full'}`}
            style={{ backgroundColor: bgColor }}
            title={`${displayName} (${symbol})\nPrice: $${quote.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nChange: ${quote.change > 0 ? '+' : ''}${quote.change.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${quote.percentChange.toFixed(2)}%)\nLast Update: ${quote.lastUpdated ? new Date(quote.lastUpdated).toLocaleTimeString() : 'N/A'}\nClick to toggle full screen`}
        >
            {bgImage && (
                <img src={bgImage} alt="" className="absolute inset-0 w-full h-full object-cover z-0 opacity-40 mix-blend-overlay" />
            )}

            {!loading && !error && history.length > 1 && (
                <div className="absolute inset-x-0 bottom-0 h-2/3 z-0 opacity-30 pointer-events-none">
                    <svg viewBox="0 0 300 100" className="w-full h-full" preserveAspectRatio="none">
                        <path d={`${sparklinePath} L 300,150 L 0,150 Z`} fill={isPositive ? "rgba(100, 255, 100, 0.2)" : "rgba(255, 100, 100, 0.2)"} />
                        <path d={sparklinePath} fill="none" stroke={isPositive ? "rgba(100, 255, 100, 0.8)" : "rgba(255, 100, 100, 0.8)"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    </svg>
                </div>
            )}

            {/* Header: Symbol & Refresh (Hidden in Fullscreen) */}
            {!isFullscreen && (
                <div className="flex items-center justify-between h-10 px-3 bg-white/5 border-b border-white/5 z-20 shrink-0">
                    <span className="text-xs font-black tracking-tight text-white uppercase flex items-center">
                        {isPositive ? <TrendingUp size={14} className="mr-2 text-white/70" /> : <TrendingDown size={14} className="mr-2 text-white/70" />}
                        {displayName}
                    </span>
                    {isLocked && (
                        <button
                            onClick={(e) => { e.stopPropagation(); setLoading(true); fetchStockData(true); }}
                            className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer no-focus"
                            title="Refresh Widget"
                        >
                            <RefreshCw size={14} />
                        </button>
                    )}
                </div>
            )}

            {/* Body: Price & Name */}
            <div className="flex-1 flex flex-col items-center justify-center p-4 relative z-10 text-center overflow-hidden">
                {/* Ticker Symbol (Top in Fullscreen) */}
                {isFullscreen && (
                    <div className="text-4xl md:text-6xl font-black text-white/40 mb-10 tracking-[0.2em] uppercase max-w-full px-4 drop-shadow-lg">
                        {symbol}
                    </div>
                )}


                {loading ? (
                    <div className="animate-pulse flex space-x-2">
                        <div className="h-2 w-12 bg-white/20 rounded"></div>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center text-center">
                        <div className="text-white/50 text-xs font-mono">Unavail</div>
                        <div className="text-[8px] text-red-400 mt-1 max-w-[80px] leading-tight">{error}</div>
                    </div>
                ) : (
                    <>
                        {/* Price Display */}
                        <div className={`${isFullscreen ? 'text-[10vw] md:text-[12rem]' : 'text-4xl'} font-bold tracking-tighter text-white drop-shadow-2xl leading-none`}>
                            ${quote.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>

                        {isFullscreen ? (
                            <div className="flex flex-col items-center mt-8 md:mt-12 space-y-4 md:space-y-6">
                                {/* Percentage Change */}
                                <div className={`flex items-center text-5xl md:text-8xl font-black px-6 md:px-10 py-3 md:py-5 rounded-none backdrop-blur-md bg-black/40 shadow-2xl ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                                    {isPositive ? <TrendingUp className="w-10 h-10 md:w-20 md:h-20 mr-4 md:mr-6" /> : <TrendingDown className="w-10 h-10 md:w-20 md:h-20 mr-4 md:mr-6" />}
                                    {quote.percentChange.toFixed(2)}%
                                </div>
                                {/* Dollar Change */}
                                <div className={`text-2xl md:text-5xl font-bold ${isPositive ? 'text-green-500' : 'text-red-500'} opacity-80 tracking-tight`}>
                                    {quote.change > 0 ? '+' : ''}{quote.change.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                                </div>

                                {/* Full Company Name (Below data in Fullscreen) */}
                                {((quote.name || displayName).toUpperCase() !== symbol.toUpperCase()) && (
                                    <div className="text-3xl md:text-5xl font-black text-white mt-10 tracking-tight uppercase max-w-full px-6 drop-shadow-2xl line-clamp-2 leading-tight">
                                        {quote.name || displayName}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className={`flex items-center text-xs font-bold px-2 py-0.5 rounded-none mt-2 backdrop-blur-sm bg-black/20 text-white shadow-sm`}>
                                {quote.change > 0 ? '+' : ''}{quote.change.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({quote.percentChange.toFixed(2)}%)
                            </div>
                        )}
                    </>
                )}

                {/* Full Screen Indicators (Visible on Hover or Fullscreen) */}
            </div>

            {/* Market Status Indicator (Dot) - Hidden in Fullscreen */}
            {!isFullscreen && (
                <div
                    className={`absolute bottom-2 right-2 w-1.5 h-1.5 rounded-none z-0 ${marketStatus === 'Open' ? 'bg-green-400 animate-pulse' : 'bg-white/10'}`}
                    title={`Market ${marketStatus}`}
                />
            )}
        </div>
    );
};

export default React.memo(TickerWidget, (prevProps, nextProps) => {
    return prevProps.data.id === nextProps.data.id &&
        prevProps.data.value === nextProps.data.value &&
        prevProps.data.w === nextProps.data.w &&
        prevProps.data.h === nextProps.data.h &&
        prevProps.finnhubKey === nextProps.finnhubKey &&
        prevProps.isLocked === nextProps.isLocked;
});
