import React, { useState, useEffect, useRef } from 'react';
import { Loader2, AlertTriangle, Film, RefreshCw, Maximize, Minimize } from 'lucide-react';

const MoviePosterWidget = ({ widget, isLocked, tmdbKey }) => {
    // Widget Value format: "genreId|decade|intervalSeconds"
    const [genre = 'all', decade = 'all', intervalStr = '30'] = (widget.value || '').split('|');
    const intervalMs = (parseInt(intervalStr, 10) || 30) * 1000;

    const [movies, setMovies] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const timerRef = useRef(null);
    const containerRef = useRef(null);

    // Fetch Movie List
    useEffect(() => {
        let isMounted = true;
        const fetchMovies = async () => {
            try {
                const genreParam = genre !== 'all' ? `&genre=${genre}` : '';
                const decadeParam = decade !== 'all' ? `&decade=${decade}` : '';
                const keyParam = tmdbKey ? `&tmdbKey=${tmdbKey}` : '';

                const res = await fetch(`/api/tmdb-discover?${keyParam}${genreParam}${decadeParam}`);
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Failed to fetch movie data");
                }

                const data = await res.json();
                if (!data.movies || data.movies.length === 0) {
                    throw new Error("No movies found for these filters");
                }

                if (isMounted) {
                    // Randomize the initial array to keep things fresh
                    const shuffled = [...data.movies].sort(() => 0.5 - Math.random());
                    setMovies(shuffled);
                    setCurrentIndex(0);
                    setIsLoading(false);
                }
            } catch (err) {
                if (isMounted) {
                    setError(err.message);
                    setIsLoading(false);
                }
            }
        };

        fetchMovies();
        return () => { isMounted = false; };
    }, [genre, decade, tmdbKey]);

    // Slideshow Timer Logic
    const goToNext = () => {
        if (movies.length <= 1) return;
        setCurrentIndex(prev => (prev + 1) % movies.length);
    };

    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (isLoading || error || movies.length <= 1) return;

        timerRef.current = setInterval(() => {
            goToNext();
        }, intervalMs);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [movies, isLoading, error, intervalMs]);

    // Fullscreen Logic
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullScreen = (e) => {
        if (e) e.stopPropagation();
        if (document.fullscreenElement !== containerRef.current) {
            containerRef.current.requestFullscreen().catch(err => {
                console.error(`Error enabling full-screen: ${err.message}`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    if (isLoading && movies.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1a20] text-blue-400/50">
                <Loader2 size={32} className="animate-spin mb-2" />
                <span className="text-[10px] font-bold uppercase tracking-widest">Loading Movies...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-[#1a1a20] text-red-500/80 p-4 text-center">
                <AlertTriangle size={24} className="mb-2" />
                <span className="text-[10px] font-bold uppercase tracking-widest mb-1">Movie Integration Error</span>
                <span className="text-[9px] opacity-70 leading-relaxed">{error}</span>
            </div>
        );
    }

    if (movies.length === 0) return null;

    const movie = movies[currentIndex];

    return (
        <div
            ref={containerRef}
            className={`relative w-full h-full bg-[#0a0a0f] group cursor-pointer overflow-hidden flex flex-col transition-all duration-500 ${isFullscreen ? 'fixed inset-0 z-[9999] w-screen h-screen' : ''}`}
            onClick={goToNext}
        >
            {/* Poster Image */}
            <div className={`flex-1 relative overflow-hidden flex items-center justify-center ${isFullscreen ? 'bg-black' : ''}`}>
                <img
                    key={movie.id}
                    src={movie.posterPath}
                    alt={movie.title}
                    className={`transition-all duration-1000 w-full h-full object-contain ${isFullscreen ? '' : 'group-hover:scale-105'}`}
                    onError={() => goToNext()}
                />

                {/* Vignette Overlay (Slightly stronger in fullscreen) */}
                <div className={`absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20 ${isFullscreen ? 'opacity-40' : 'opacity-80'}`} />

                {/* Movie Info Overlay */}
                <div className={`absolute bottom-0 left-0 right-0 p-6 transform transition-transform duration-300 ${isFullscreen ? 'bg-gradient-to-t from-black via-black/40 to-transparent' : 'translate-y-2 group-hover:translate-y-0'}`}>
                    <h3 className={`${isFullscreen ? 'text-4xl md:text-6xl mb-2' : 'text-sm'} font-bold drop-shadow-2xl line-clamp-2 leading-tight`} style={{ color: '#999' }}>
                        {movie.title}
                    </h3>
                    <p className={`${isFullscreen ? 'text-lg md:text-2xl text-zulu-orange' : 'text-[10px] text-white/60'} font-medium mt-1`}>
                        {movie.releaseDate ? movie.releaseDate.split('-')[0] : 'N/A'}
                    </p>
                </div>

                {/* Top Actions: Maximize (Matching Slideshow Style) */}
                <div className="absolute top-4 right-4 flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                    <button
                        onClick={toggleFullScreen}
                        className="p-2 bg-black/60 hover:bg-black/90 backdrop-blur-md rounded-md border border-white/10 text-white/70 hover:text-white transition-all shadow-xl no-focus"
                        title={isFullscreen ? "Exit Fullscreen" : "Maximize Poster"}
                    >
                        {isFullscreen ? <Minimize size={isFullscreen ? 28 : 18} className="text-white drop-shadow-md" /> : <Maximize size={18} className="text-white/90" />}
                    </button>
                </div>
            </div>

            {/* Progress Bar (Visible in non-fullscreen only for cleaner look) */}
            {!isFullscreen && (
                <div className="relative w-full h-1 bg-white/5">
                    <div
                        key={`progress-${currentIndex}`}
                        className="absolute bottom-0 left-0 h-full bg-zulu-orange/80 shadow-[0_0_8px_rgba(133,61,26,0.5)]"
                        style={{
                            animation: movies.length > 1 ? `movie-progress ${intervalMs}ms linear forwards` : 'none'
                        }}
                    />
                </div>
            )}

            <style dangerouslySetInnerHTML={{
                __html: `
                @keyframes movie-progress {
                    from { width: 0%; }
                    to { width: 100%; }
                }
                .animate-spin-slow {
                    animation: spin 3s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />
        </div>
    );
};

export default MoviePosterWidget;
