import React from 'react';
import TickerWidget from './widgets/TickerWidget';
import VideoWidget from './widgets/VideoWidget';
import RSSWidget from './widgets/RSSWidget';
import IconWidget from './widgets/IconWidget';
import WeatherWidget from './widgets/WeatherWidget';
import MediaWidget from './widgets/MediaWidget';
import ServiceWidget from './widgets/ServiceWidget';

const WidgetRenderer = ({ widget, isLocked, finnhubKey }) => {
    // Use reloadVersion as part of the key to force re-mounting when reloaded
    // Note: The key is usually set by the parent map, but we can pass it down if needed for internal resets, 
    // though React handles the component remount if the parent key changes.
    // Here we just render the content.

    switch (widget.type) {
        case 'ticker':
            return <TickerWidget data={widget} finnhubKey={finnhubKey} isLocked={isLocked} />;
        case 'camera':
        case 'iframe':
        case 'proxy':
        case 'web':
        case 'integration':
            return <VideoWidget data={widget} isLocked={isLocked} />;
        case 'rss':
            return <RSSWidget data={widget} isLocked={isLocked} />;
        case 'icon':
            return <IconWidget data={widget} isLocked={isLocked} />;
        case 'weather':
            return <WeatherWidget data={widget} isLocked={isLocked} />;
        case 'media':
            return <MediaWidget widget={widget} isLocked={isLocked} />;
        case 'service':
            return <ServiceWidget widget={widget} isLocked={isLocked} />;
        default:
            return <div>Unknown</div>;
    }
};

export default React.memo(WidgetRenderer);
