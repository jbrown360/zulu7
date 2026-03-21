import React from 'react';
import { ExternalLink, MousePointerClick } from 'lucide-react';

const IconWidget = ({ data }) => {
    // Value format: TargetURL|Name|IconURL
    // IconURL is optional
    const [targetUrl, name, iconUrl] = (data.value || '').split('|');

    const displayUrl = targetUrl || '#';
    const displayName = name || 'Link';

    // Determine Icon Source
    // 1. Custom Icon URL (if provided)
    // 2. Google Favicon Service (fallback)
    let finalIconUrl = iconUrl;
    if (!finalIconUrl && targetUrl) {
        try {
            const hostname = new URL(targetUrl).hostname;
            finalIconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
        } catch {
            // Invalid URL, will fallback to generic icon
        }
    }

    return (
        <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={`${displayName} - ${displayUrl}`}
            className="w-full h-full bg-transparent flex flex-col items-center justify-center relative group transition-colors text-decoration-none overflow-visible"
        >
            <div className="flex flex-col items-center justify-center w-full h-full space-y-2">
                {/* Icon Container - Adjusted Size (~54%) to allow more gap */}
                <div className="flex-none h-[50%] flex items-center justify-center w-full">
                    {finalIconUrl ? (
                        <img
                            src={finalIconUrl}
                            alt={displayName}
                            className="h-full w-auto object-contain drop-shadow-sm group-hover:scale-110 transition-transform duration-300"
                            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                        />
                    ) : null}

                    {/* Fallback Icon */}
                    <div
                        className="hidden text-white/20 group-hover:text-blue-400 transition-colors"
                        style={{ display: finalIconUrl ? 'none' : 'block' }}
                    >
                        <MousePointerClick size={16} />
                    </div>
                </div>

                {/* Label - Larger Text (18px) */}
                <div className="w-full flex items-center justify-center px-0.5 transform transition-all duration-300 group-hover:translate-y-1.5 group-hover:scale-110">
                    <span className="text-[18px] font-bold text-white/90 truncate max-w-full leading-none group-hover:text-blue-400 transition-colors">
                        {displayName}
                    </span>
                </div>
            </div>


        </a>
    );
};

export default IconWidget;
