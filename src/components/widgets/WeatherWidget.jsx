import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, Sun, Wind, Droplets, MapPin, RefreshCw } from 'lucide-react';

const WeatherWidget = ({ data, isLocked }) => {
    const { value, w, h } = data;
    const [searchTerm, unit] = (value || 'London|celsius').split('|');

    const [weather, setWeather] = useState(null);
    const [locationName, setLocationName] = useState('');
    const [loading, setLoading] = useState(true);
    const [localTime, setLocalTime] = useState(null);
    const [isVisible, setIsVisible] = useState(true);

    // Layout Logic (Pixel-based)
    const containerRef = useRef(null);
    // Initialize with a rough estimate to prevent "Vertical Flash" on load
    // Assuming ~40px per col and ~30px per row (with gap)
    const [dimensions, setDimensions] = useState({ width: w * 40, height: h * 30 });

    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });

        // Track visibility for hibernation
        const intersectionObserver = new IntersectionObserver(([entry]) => {
            setIsVisible(entry.isIntersecting);
        }, { threshold: 0.1 });

        resizeObserver.observe(containerRef.current);
        intersectionObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            intersectionObserver.disconnect();
        };
    }, []);

    const CACHE_KEY = `zulu7_weather_v2_${searchTerm}_${unit}`;
    const CACHE_DURATION = 30 * 60 * 1000; // 30 Minutes

    const getCachedData = useCallback(() => {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (cached) {
                const { data, timestamp } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_DURATION) {
                    return data;
                }
            }
        } catch (e) {
            console.warn("Weather cache read failed", e);
        }
        return null;
    }, [CACHE_KEY]);

    const fetchWeather = useCallback(async () => {
        // Check cache first
        const cached = getCachedData();
        if (cached) {
            setWeather(cached.weather);
            setLocationName(cached.locationName);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            // 1. Geocode
            const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(searchTerm)}&count=1&language=en&format=json`);
            const geoData = await geoRes.json();

            if (!geoData.results || geoData.results.length === 0) throw new Error("Location not found");

            const { latitude, longitude, name, admin1, country } = geoData.results[0];

            // Deduplicate location names: [City, Region/Country]
            const nameParts = [name];
            if (admin1 && admin1 !== name) nameParts.push(admin1);
            if (country && !nameParts.includes(country)) nameParts.push(country);

            const newLocationName = nameParts.slice(0, 2).join(', ');
            setLocationName(newLocationName);

            // 2. Fetch Weather (Expanded Data)
            const unitParam = unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,uv_index_max&temperature_unit=${unitParam}&wind_speed_unit=mph&timezone=auto`;

            const weatherRes = await fetch(weatherUrl);
            const weatherData = await weatherRes.json();

            if (weatherData.error) throw new Error("Weather API Error");

            setWeather(weatherData);

            // Save to Cache
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    data: { weather: weatherData, locationName: newLocationName },
                    timestamp: Date.now()
                }));
            } catch (e) {
                console.warn("Weather cache save failed", e);
            }

        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, unit, getCachedData, CACHE_KEY]);

    useEffect(() => {
        fetchWeather();
        const interval = setInterval(fetchWeather, 60 * 60 * 1000); // 1 Hour
        return () => clearInterval(interval);
    }, [fetchWeather]);

    // Local City Clock Logic (1s Updates for World Clock feel)
    useEffect(() => {
        if (!weather?.utc_offset_seconds) return;

        const updateClock = () => {
            // NEW: Pause clock updates if not visible or focused
            if (!isVisible || document.visibilityState !== 'visible') return;

            const now = new Date();
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const cityTime = new Date(utc + (weather.utc_offset_seconds * 1000));

            setLocalTime(cityTime.toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            }));
        };

        updateClock();
        const timer = setInterval(updateClock, 1000); // 1s Updates
        return () => clearInterval(timer);
    }, [weather?.utc_offset_seconds, isVisible]);

    // Helpers
    const getWeatherIcon = (code, size = 24, className = "") => {
        const props = { size, className };
        if (code === 0) return <Sun {...props} className={`${className} text-orange-400`} />;
        if (code >= 1 && code <= 3) return <Cloud {...props} className={`${className} text-orange-400`} />;
        if (code >= 45 && code <= 48) return <CloudFog {...props} className={`${className} text-orange-500`} />;
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return <CloudRain {...props} className={`${className} text-orange-400`} />;
        if (code >= 71 && code <= 77) return <CloudSnow {...props} className={`${className} text-orange-100/80`} />;
        if (code >= 95) return <CloudLightning {...props} className={`${className} text-orange-500`} />;
        return <Sun {...props} className={`${className} text-orange-400`} />;
    };

    const formatTime = (isoString) => {
        if (!isoString) return '--:--';
        return new Date(isoString).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };

    if (loading) return <div className="w-full h-full flex items-center justify-center text-white/50 animate-pulse"><Sun size={32} /></div>;

    if (!weather) return null;

    const current = weather.current;
    const daily = weather.daily;

    // Strict Orientation Rule
    const isHorizontal = dimensions.width > dimensions.height;

    // Density Thresholds (Lowered for "Maximum Data")
    // Removed unused thresholds

    // Unified Smart Scaling
    const getScaleFactor = () => {
        const baseWidth = 160; // 4 columns
        const baseHeight = 120; // 4 rows
        const scaleW = dimensions.width / baseWidth;
        const scaleH = dimensions.height / baseHeight;
        // Use the smaller scale to ensure everything fits, but clamp it
        return Math.min(Math.max(Math.min(scaleW, scaleH), 0.6), 1.5);
    };

    const contentScale = getScaleFactor();

    // Construct tooltip text for locked mode
    const tooltipText = isLocked ?
        `${locationName}: ${Math.round(current.temperature_2m)}° (Feels ${Math.round(current.apparent_temperature)}°), Time: ${localTime || '--:--'}` :
        undefined;

    // Dynamic Weather Backgrounds & Overlays
    const WeatherBackground = () => {
        const code = current.weather_code;
        const isDay = current.is_day === 1;

        // Determine Scenario
        let scenario = 'clear';
        if (code >= 1 && code <= 3) scenario = 'cloudy';
        if (code >= 45 && code <= 48) scenario = 'fog';
        if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) scenario = 'rain';
        if (code >= 71 && code <= 77) scenario = 'snow';
        if (code >= 95) scenario = 'storm';


        const getBackgroundImage = () => {
            if (!isDay) return '/assets/weather/clear-night.png';
            switch (scenario) {
                case 'cloudy':
                case 'fog': return '/assets/weather/cloudy.png';
                case 'rain': return '/assets/weather/rain.png';
                case 'snow': return '/assets/weather/snow.png';
                case 'storm': return '/assets/weather/storm.png';
                default: return '/assets/weather/clear-day.png';
            }
        };

        return (
            <div className={`absolute inset-0 transition-opacity duration-1000 overflow-hidden`}>
                <div
                    className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
                    style={{ backgroundImage: `url(${getBackgroundImage()})` }}
                />
                {/* Subtle Overlay to ensure text readability */}
                <div className="absolute inset-0 bg-black/20" />

                {scenario === 'storm' && (
                    <div className="absolute inset-0 pointer-events-none animate-flash bg-white/10 z-0" />
                )}
            </div>
        );
    };

    return (
        <div ref={containerRef} className="w-full h-full flex p-3 relative group overflow-hidden bg-black shadow-inner" title={tooltipText}>
            <WeatherBackground />

            {/* Header Controls (Always Top Right) */}
            {isLocked && (
                <div className="absolute top-1.5 right-3.5 z-50 flex items-center space-x-2">
                    <button onClick={fetchWeather} className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer" title="Refresh Widget"><RefreshCw size={14} /></button>
                </div>
            )}

            <div
                className="flex flex-col w-full h-full items-center justify-center animate-in fade-in zoom-in duration-700 z-10 pt-4"
                style={{ transform: `scale(${contentScale})` }}
            >

                {/* Main Weather Focus - Inline Layout with Dynamic Scaling */}
                <div className="flex items-center justify-center space-x-3 md:space-x-5 px-2">
                    {/* Icon - Scaled based on contentScale */}
                    <div className="transform transition-transform duration-700 hover:scale-110 drop-shadow-2xl shrink-0">
                        {getWeatherIcon(current.weather_code, 48 + (contentScale * 12))}
                    </div>

                    {/* Metrics - Temperature & Feels Like */}
                    <div className="flex flex-col items-start">
                        <div className="flex items-start">
                            <span className="text-4xl md:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-none drop-shadow-2xl tabular-nums">
                                {Math.round(current.temperature_2m)}
                            </span>
                            <span className="text-base md:text-xl font-bold text-orange-500 mt-0.5 ml-0.5 md:ml-1">°</span>
                        </div>
                        {/* Feels Like - Scaled prominence */}
                        <div className="text-[9px] md:text-xs font-black text-white/40 tracking-[0.15em] uppercase mt-0.5 md:mt-1 whitespace-nowrap">
                            Feels {Math.round(current.apparent_temperature)}°
                        </div>
                    </div>
                </div>

                {/* City Title as Divider Replacement */}
                <div className="mt-2.5 text-[11px] md:text-[14px] font-black tracking-[0.2em] text-orange-500/80 uppercase truncate drop-shadow-md" title={locationName}>
                    {locationName}
                </div>

                {/* Integrated World Clock - Digital Alarm Clock Style */}
                <div className="flex flex-col items-center mt-1 w-full max-w-[140px] md:max-w-[180px]">
                    {localTime && (
                        <div className="flex items-baseline space-x-1.5 font-digital digital-glow">
                            <span className="text-xl md:text-2xl lg:text-3xl font-medium text-white/90 tabular-nums tracking-wider">
                                {localTime.split(' ')[0]}
                            </span>
                            <span className="text-[9px] md:text-[10px] font-bold text-orange-500 uppercase tracking-widest opacity-90">
                                {localTime.split(' ')[1]}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WeatherWidget;
