/**
 * Parses a config string into a structured object.
 * Format: key=value
 * Multiple entries for the same key are supported (e.g. ticker=AAPL, ticker=GOOG)
 * 
 * @param {string} text - The raw config text
 * @returns {Array<{id: string, type: string, value: string}>} Array of widget configs
 */
export const parseConfig = (text) => {
    // 1. Try JSON parsing first
    try {
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
            // V1 Array Format
            return json;
        } else if (typeof json === 'object' && json !== null) {
            // V2 Full Config (Workspaces + Settings)
            return json;
        }
    } catch {
        // Not JSON, continue to legacy parsing
    }

    // 2. Legacy Key=Value Parsing
    const lines = text.split('\n');
    const widgets = [];

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const [key, ...values] = trimmed.split('=');
        if (!key || values.length === 0) return;

        const value = values.join('=').trim();
        const type = key.trim().toLowerCase();

        // Map 'ticker', 'camera', 'iframe' + others we might support in text
        if (['ticker', 'camera', 'iframe', 'rss', 'weather'].includes(type)) {
            widgets.push({
                id: `${type}-${index}`,
                type,
                value,
                // Default layout props, can be overridden by saved layout
                w: type === 'ticker' ? 4 : (type === 'weather' ? 6 : 8),
                h: type === 'ticker' ? 4 : (type === 'rss' ? 8 : 6),
                x: (widgets.length * 4) % 12,
                y: Infinity
            });
        }
    });

    return widgets;
};

/**
 * Fetches and parses the config file.
 */
export const fetchConfig = async () => {
    try {
        const response = await fetch('/config.json');
        const text = await response.text();
        return parseConfig(text);
    } catch (error) {
        console.error("Failed to load config:", error);
        return [];
    }
};
