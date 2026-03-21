import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import ClipboardWidget from './widgets/ClipboardWidget';

const StandaloneClipboard = () => {
    const { key } = useParams();

    // Mock an update function since the standalone doesn't need to save to a dashboard layout
    const handleUpdateWidget = () => {};

    // Create a mock widget object to pass to the widget component
    const widget = {
        id: `standalone-clipboard-${key}`,
        type: 'clipboard',
        value: `${key}|Shared Clipboard`
    };

    useEffect(() => {
        document.title = 'Clipboard';
    }, []);

    return (
        <div className="w-screen h-screen bg-gray-950 text-white flex flex-col m-0 p-0 overflow-hidden">
            <ClipboardWidget
                widget={widget}
                isLocked={true}
                updateWidget={handleUpdateWidget}
                isStandalone={true}
            />
        </div>
    );
};

export default StandaloneClipboard;
