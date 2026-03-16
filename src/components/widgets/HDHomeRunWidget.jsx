import React, { useState, useEffect, useRef } from 'react';
import { Monitor, RefreshCcw, Tv, AlertTriangle, WifiOff, Loader2, Play } from 'lucide-react';

const HDHomeRunWidget = ({ data, isLocked }) => {
    const [channels, setChannels] = useState([]);
    const [status, setStatus] = useState('initializing'); // initializing, loading, active, error
    const [errorMsg, setErrorMsg] = useState('');
    const [selectedChannel, setSelectedChannel] = useState(null);
    const [streamUrl, setStreamUrl] = useState(null);
    const containerRef = useRef(null);

    const deviceIp = data.value; // The IP address saved from the modal

    // 1. Fetch Channel Lineup on Mount or IP Change
    useEffect(() => {
        if (!deviceIp) {
            setStatus('error');
            setErrorMsg('No HDHomeRun IP configured.');
            return;
        }

        const fetchChannels = async () => {
            setStatus('loading');
            try {
                // Fetch the lineup.json from the HDHomeRun device
                // Note: The device must be reachable from the client browser.
                const response = await fetch(`http://${deviceIp}/lineup.json`);

                if (!response.ok) {
                    throw new Error(`Device returned ${response.status}`);
                }

                const lineup = await response.json();

                if (!Array.isArray(lineup) || lineup.length === 0) {
                    throw new Error('No channels found on device.');
                }

                setChannels(lineup);
                setStatus('active');

                // Auto-select first channel if none selected
                if (!selectedChannel) {
                    handleChannelSelect(lineup[0]);
                }

            } catch (err) {
                console.error("HDHomeRun Fetch Error:", err);
                setStatus('error');
                setErrorMsg(`Failed to connect to ${deviceIp}. Ensure it is on the same network.`);
            }
        };

        fetchChannels();
    }, [deviceIp]);

    // 2. Handle Stream Routing via go2rtc
    const handleChannelSelect = async (channel) => {
        setSelectedChannel(channel);
        setStreamUrl(null); // Clear current stream while setting up new one

        try {
            // The raw stream URL from the device
            const rawStreamUrl = channel.URL;

            // Name for the temporary go2rtc stream (clean up spaces/special chars)
            const streamId = `hdhr_${channel.GuideNumber}`;

            // Configure the go2rtc transcode format: 
            // ffmpeg input: HTTP MPEG-TS
            // ffmpeg output commands: copy video, AAC audio (safest for HLS/WebRTC)
            const ffmpegUrl = `ffmpeg:${rawStreamUrl}#video=copy#audio=aac`;

            // Call go2rtc local API to temporarily add this stream
            // /api/streams?name=<stream_name>&src=<ffmpeg_url>
            const addReq = await fetch(`/api/streams?name=${streamId}&src=${encodeURIComponent(ffmpegUrl)}`, {
                method: 'PUT'
            });

            if (!addReq.ok) {
                throw new Error("Failed to register stream with go2rtc proxy.");
            }

            // Once registered, we can play it via the existing StreamPlayer utilizing WebRTC or HLS.
            // We'll construct the local streamplayer URL:
            const playerUrl = `/stream.html?src=${streamId}&mode=webrtc`;
            setStreamUrl(playerUrl);

        } catch (err) {
            console.error("HDHomeRun Stream Routing Error:", err);
            // Show an error in the UI instead of falling back to a raw HTTP-TS link that forces a file download
            setStatus('error');
            setErrorMsg('Failed to configure live stream proxy. Ensure the backend server is running and reachable.');
        }
    };


    return (
        <div
            ref={containerRef}
            className="w-full h-full bg-black relative flex flex-col group overflow-hidden border border-white/10"
        >
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 h-10 bg-gradient-to-b from-black/80 to-transparent z-20 flex items-center px-3 justify-between pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="flex items-center space-x-2 text-white/90">
                    <Tv size={14} className="text-orange-400" />
                    <span className="text-xs font-medium tracking-wide">
                        {selectedChannel ? `CH ${selectedChannel.GuideNumber} - ${selectedChannel.GuideName}` : 'HDHomeRun'}
                    </span>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-row h-full">

                {/* Channel Guide Sidebar */}
                <div className="w-1/3 max-w-[200px] h-full bg-[#111] border-r border-white/5 flex flex-col z-10">
                    <div className="p-2 border-b border-white/5 bg-black/40 text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center">
                        <Monitor size={10} className="mr-1.5" />
                        Channels
                    </div>

                    <div className="flex-1 overflow-y-auto no-scrollbar py-1">
                        {status === 'loading' && (
                            <div className="flex flex-col items-center justify-center p-4 h-full text-gray-500">
                                <Loader2 size={16} className="animate-spin mb-2" />
                                <span className="text-[10px]">Loading Guide...</span>
                            </div>
                        )}

                        {status === 'active' && channels.map((ch) => (
                            <button
                                key={ch.GuideNumber}
                                onClick={() => handleChannelSelect(ch)}
                                className={`w-full text-left px-3 py-2 flex items-center justify-between transition-colors border-l-2 ${selectedChannel?.GuideNumber === ch.GuideNumber
                                    ? 'bg-orange-500/10 border-orange-500 text-white'
                                    : 'border-transparent text-gray-400 hover:bg-white/5 hover:text-white'
                                    }`}
                            >
                                <div className="flex flex-col truncate pr-2">
                                    <span className="text-xs font-semibold truncate">{ch.GuideName}</span>
                                    <span className="text-[10px] opacity-60">Ch {ch.GuideNumber}</span>
                                </div>
                                {selectedChannel?.GuideNumber === ch.GuideNumber && (
                                    <Play size={10} className="text-orange-500 shrink-0" />
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Video Player Area */}
                <div className="flex-1 h-full bg-black relative flex items-center justify-center">
                    {status === 'error' ? (
                        <div className="flex flex-col items-center justify-center text-red-400 p-4 text-center">
                            <WifiOff size={24} className="mb-2 opacity-80" />
                            <div className="text-xs font-bold uppercase tracking-wider mb-1">Connection Error</div>
                            <div className="text-[10px] opacity-70 max-w-[80%]">{errorMsg}</div>
                        </div>
                    ) : !streamUrl ? (
                        <div className="flex flex-col items-center justify-center text-gray-500">
                            <Tv size={32} className="mb-3 opacity-20" />
                            <div className="text-xs uppercase tracking-widest font-medium">Select a Channel</div>
                        </div>
                    ) : (
                        <iframe
                            src={streamUrl}
                            className="w-full h-full border-none pointer-events-auto"
                            allow="autoplay; fullscreen; webrtc"
                            title="HDHomeRun Stream"
                        />
                    )}
                </div>
            </div>

            {/* Lock Overlay */}
            {!isLocked && (
                <div className="absolute inset-0 bg-blue-900/10 pointer-events-auto z-40 border-2 border-blue-500/30">
                    {/* Allow moving widget in unlock mode, but prevent clicks on video */}
                </div>
            )}
        </div>
    );
};

export default React.memo(HDHomeRunWidget);
