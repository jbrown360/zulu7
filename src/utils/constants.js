export const STORAGE_KEYS = {
    SETTINGS: 'zulu7_settings',
    WORKSPACE_COUNT: 'zulu7_workspace_count',
    ACTIVE_WORKSPACE: 'zulu7_active_workspace',
    DASHBOARD_HISTORY: 'zulu7_dashboard_history',
    // Dynamic Key Generators
    getWidgetKey: (id) => `zulu7_v2_ws_${id}_widgets`,
    getLayoutKey: (id) => `zulu7_v2_ws_${id}_layout`,
    getTickerCacheKey: (symbol) => `zulu7_ticker_${symbol}`
};

export const DEFAULTS = {
    WORKSPACE_COUNT: 7,
    ROTATION_INTERVAL: 300,
    SLIDESHOW_INTERVAL: 60
};
