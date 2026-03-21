import { STORAGE_KEYS } from './constants';

export const getDashboardConfig = (currentSettings, currentWorkspaces) => {
    const {
        labName = 'Zulu7',
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
        finnhubKey = '',
        streamApiKey = '',
        bgImages = '',
        slideshowInterval = 60,
        isSlideshowEnabled = false,
        workspaceRotationInterval = 300,
        isWorkspaceRotationEnabled = false,
        dashboardRotationSelection = {},
        dashboardNames = {},
        streamerUrl = '',
        activeWorkspace = 0
    } = currentSettings || {};

    const data = {
        version: "1.1",
        timestamp: Date.now(),
        settings: {
            labName,
            timeZone,
            finnhubKey,
            streamApiKey,
            bgImages: typeof bgImages === 'string' ? bgImages.split('\n').filter(url => url.trim() !== '') : bgImages,
            slideshowInterval: parseInt(slideshowInterval, 10),
            isSlideshowEnabled,
            workspaceRotationInterval: parseInt(workspaceRotationInterval || 300, 10),
            isWorkspaceRotationEnabled,
            dashboardRotationSelection,
            dashboardNames, // Store custom names
            streamerUrl,
            activeWorkspace // Persist active workspace
        },
        workspaces: {}
    };

    if (currentWorkspaces) {
        // Use provided state (Source of Truth)
        Object.keys(currentWorkspaces).forEach(key => {
            data.workspaces[key] = currentWorkspaces[key];
        });
    } else {
        // Fallback to LocalStorage (Original Logic)
        const count = parseInt(localStorage.getItem(STORAGE_KEYS.WORKSPACE_COUNT) || '7', 10);
        for (let i = 0; i < count; i++) {
            const wKey = STORAGE_KEYS.getWidgetKey(i);
            const lKey = STORAGE_KEYS.getLayoutKey(i);
            const wVal = localStorage.getItem(wKey);
            const lVal = localStorage.getItem(lKey);

            if (wVal || lVal) {
                data.workspaces[i] = {
                    widgets: wVal ? JSON.parse(wVal) : [],
                    layout: lVal ? JSON.parse(lVal) : []
                };
            }
        }
    }

    return data;
};
