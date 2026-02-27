import React, { useState, useEffect, useRef } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

const ServiceWidget = ({ widget, isLocked }) => {
    // Value: "Name|Type|URL|Port|IntervalSeconds|IsDisabled"
    const [name = 'Health Check', type = 'http', url = '', port = '', intervalStr = '30', isDisabledStr = 'false'] = (widget.value || '').split('|');
    const intervalMs = Math.max(parseInt(intervalStr, 10) || 30, 30) * 1000;

    const [status, setStatus] = useState('loading'); // 'loading', 'up', 'down'
    const [lastCheck, setLastCheck] = useState(null);
    const [isVibrating, setIsVibrating] = useState(false);
    const timerRef = useRef(null);

    const checkHealth = async () => {
        if (isDisabledStr === 'true') {
            setStatus('disabled');
            return;
        }

        if (!url) {
            setStatus('down');
            return;
        }

        const performCheck = async () => {
            try {
                const res = await fetch(`/api/health-check?type=${type}&url=${encodeURIComponent(url)}&port=${port}&_t=${Date.now()}`);
                const data = await res.json();
                return data.status;
            } catch (e) {
                console.error("[ServiceWidget] Check failed:", e);
                return 'down';
            }
        };

        let currentStatus = await performCheck();

        // If first check fails, retry once after 2 seconds
        if (currentStatus === 'down') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            currentStatus = await performCheck();
        }

        setStatus(currentStatus);
        setLastCheck(new Date().toLocaleTimeString());
    };

    useEffect(() => {
        checkHealth();
        timerRef.current = setInterval(checkHealth, intervalMs);

        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [url, type, port, intervalMs, widget.reloadVersion]);

    // Dedicated 5s Vibration Interval for Failed Checks
    useEffect(() => {
        if (status !== 'down') {
            setIsVibrating(false);
            return;
        }

        const vibrateBurst = () => {
            setIsVibrating(true);
            setTimeout(() => setIsVibrating(false), 1000);
        };

        // Initial burst if it just went down
        vibrateBurst();

        const interval = setInterval(vibrateBurst, 3000); // Every 3 seconds
        return () => clearInterval(interval);
    }, [status]);

    // Dispatch custom event for grid-level alerts
    useEffect(() => {
        const event = new CustomEvent('zulu7-widget-alert', {
            detail: {
                id: widget.id,
                status: status,
                isVibrating: isVibrating
            }
        });
        window.dispatchEvent(event);
    }, [widget.id, status, isVibrating]);

    const isUp = status === 'up';
    const isLoading = status === 'loading';

    const openService = (e) => {
        if (!isLocked) return;
        if (!url) return;
        let targetUrl = url.startsWith('http') ? url : `${type === 'https' ? 'https' : 'http'}://${url}`;
        if (port && !targetUrl.includes(':', targetUrl.indexOf('//') + 2)) {
            targetUrl += `:${port}`;
        }
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
    };

    const handleManualRefresh = (e) => {
        e.stopPropagation();
        setStatus('loading');
        checkHealth();
    };

    return (
        <div
            onClick={openService}
            style={status === 'disabled' ? {
                backgroundColor: 'rgba(0,0,0,0.4)',
                backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 20px, rgba(245, 158, 11, 0.1) 20px, rgba(245, 158, 11, 0.1) 40px)'
            } : {}}
            className={`w-full h-full flex flex-col items-center justify-center transition-colors duration-500 p-4 text-white group relative
            ${isLocked ? 'cursor-pointer' : ''}
            ${status === 'disabled' ? 'bg-amber-950/20' : isLoading ? 'bg-black/40' : isUp ? 'bg-emerald-950/40' : 'bg-rose-950/40'}`}>

            {/* Refresh Button - same style as other widgets */}
            {isLocked && (
                <div className="absolute top-1 right-1 z-30">
                    <button
                        onClick={handleManualRefresh}
                        className="w-7 h-7 flex items-center justify-center bg-white/[0.01] rounded-none border border-white/5 text-white/70 hover:text-orange-500 transition-colors cursor-pointer"
                        title="Force Health Check"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                </div>
            )}

            <div className={`flex flex-col items-center gap-1 transition-transform duration-300 ${isLocked ? 'group-hover:scale-105' : ''}`}>
                <div className="text-center">
                    <h3 className="text-xl font-black uppercase tracking-tighter drop-shadow-md truncate max-w-[180px]">
                        {name}
                    </h3>
                    <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest mt-0.5">
                        {type}://{url}{port ? `:${port}` : ''}
                    </p>
                </div>

                <div className={`mt-2 flex items-center gap-1.5 px-4 py-1.5 bg-black/30 rounded-none border transition-colors ${isLocked ? 'group-hover:bg-black/50' : ''} ${status === 'disabled' ? 'border-amber-500/30' : isUp ? 'border-emerald-500/30' : status === 'down' ? 'border-rose-500/30' : 'border-white/5'}`}>
                    <span className={`text-[11px] font-black uppercase tracking-[0.2em] ${status === 'disabled' ? 'text-amber-400' : isUp ? 'text-emerald-400' : status === 'down' ? 'text-rose-400' : 'text-white/50'}`}>
                        {status === 'disabled' ? 'DISABLED' : status === 'loading' ? 'CHECKING...' : isUp ? 'ONLINE' : 'OFFLINE'}
                    </span>
                </div>
            </div>

            {lastCheck && (
                <div className="absolute bottom-2 right-2 text-[8px] opacity-40 font-mono">
                    LAST: {lastCheck}
                </div>
            )}
        </div>
    );
};

export default ServiceWidget;
