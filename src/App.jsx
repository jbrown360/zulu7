import React, { useState, useEffect } from 'react';
import Zulu7Grid from './components/Zulu7Grid';
import SettingsModal from './components/SettingsModal';
import { Settings } from 'lucide-react';
import { STORAGE_KEYS } from './utils/constants';

function App() {
  const [settings, setSettings] = useState({
    bgImages: [],
    slideshowInterval: 60,
    isSlideshowEnabled: false,
    labName: 'Zulu7',
    timeZone: 'local',
    streamerUrl: '', // Empty string implies relative path (use proxy)
    finnhubKey: '',
    googleApiKey: '',
    streamApiKey: '', // Unique key for privacy
    isWorkspaceRotationEnabled: false,
    workspaceRotationInterval: 300,
    instagramClientId: '',
    instagramClientSecret: '',
    instagramAccessToken: ''
  });
  const [currentBgIndex, setCurrentBgIndex] = useState(0);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('general');

  // Load settings from local storage or config.json
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [isEphemeralMode, setIsEphemeralMode] = useState(false);
  const [ephemeralWorkspaces, setEphemeralWorkspaces] = useState(null);
  const [currentActiveWorkspace, setCurrentActiveWorkspace] = useState(0);

  useEffect(() => {
    const loadSettings = async () => {
      // Check for Kiosk Mode (?dash=URL)
      const params = new URLSearchParams(window.location.search);
      const dashUrl = params.get('dash');
      const configId = params.get('zulu7');
      const workspaceParam = params.get('w');
      let targetWorkspace = workspaceParam ? parseInt(workspaceParam, 10) : 0;

      if (dashUrl || configId) {
        try {
          let fetchUrl = dashUrl;
          if (configId) {
            fetchUrl = `/api/config?id=${configId}`;
            console.log(`Loading Published Configuration: ${configId}`);
          } else {
            console.log(`Loading Kiosk Configuration from: ${dashUrl}`);
          }

          const response = await fetch(fetchUrl);
          if (!response.ok) {
            if (response.status === 404 || response.status === 400) {
              throw new Error("Invalid Dashboard Key");
            }
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const config = await response.json();

          // Use embedded target workspace if provided in the configuration
          if (config.targetWorkspace !== undefined) {
            targetWorkspace = config.targetWorkspace;
          }

          if (config.isRestricted) {
            targetWorkspace = 0;
          }

          let initialSettings = {
            bgImages: [],
            slideshowInterval: 60,
            isSlideshowEnabled: false,
            labName: 'Zulu7 Kiosk',
            timeZone: 'local',
            streamerUrl: '',
            finnhubKey: '',
            googleApiKey: '',
            streamApiKey: '', // Will be generated if missing
            isWorkspaceRotationEnabled: false,
            workspaceRotationInterval: 300
          };

          // Apply Settings
          if (config.settings) {
            initialSettings = { ...initialSettings, ...config.settings };
          }

          // Ensure API Key
          if (!initialSettings.streamApiKey) {
            initialSettings.streamApiKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map(b => b.toString(16).padStart(2, '0')).join('');
          }

          // Save to History (for Dropdown)
          try {
            const historyKey = STORAGE_KEYS.DASHBOARD_HISTORY;
            const rawHistory = localStorage.getItem(historyKey);
            let history = rawHistory ? JSON.parse(rawHistory) : [];

            const entryId = configId || dashUrl;
            const existingEntry = history.find(h => h.id === entryId);

            // If we have a manual rename in history, prioritize it for the header display
            if (existingEntry && existingEntry.name) {
              initialSettings.labName = existingEntry.name;
            }

            const newEntry = {
              id: entryId,
              type: configId ? 'id' : 'url',
              name: initialSettings.labName || 'Shared Dashboard',
              url: configId ? `/?zulu7=${configId}` : `/?dash=${encodeURIComponent(dashUrl)}&w=${targetWorkspace}`,
              originalParam: configId || dashUrl, // What we put in the URL param
              lastVisited: Date.now()
            };

            // Remove existing entry with same ID if exists to update it
            history = history.filter(h => h.id !== entryId);
            // Add to top
            history.unshift(newEntry);
            // Limit to 10
            if (history.length > 10) history = history.slice(0, 10);

            localStorage.setItem(historyKey, JSON.stringify(history));
          } catch (err) {
            console.error("Failed to save dashboard history:", err);
          }


          // Apply Workspaces
          let maxId = 6; // Default to at least 7 workspaces (0-6)
          let loadedWorkspaces = null;

          if (config.workspaces) {
            loadedWorkspaces = config.workspaces;
            // Validate max ID
            Object.keys(config.workspaces).forEach(id => {
              const numId = parseInt(id, 10);
              if (!isNaN(numId) && numId > maxId) maxId = numId;
            });
          }

          setIsEphemeralMode(true);
          setEphemeralWorkspaces(loadedWorkspaces || {});

          if (config.isRestricted) {
            initialSettings.isRestricted = true;
          }

          // Only overwrite from URL if parameter was actually specified
          if (workspaceParam !== null && !isNaN(targetWorkspace)) {
            initialSettings.activeWorkspace = targetWorkspace;
            setCurrentActiveWorkspace(targetWorkspace);
          } else if (initialSettings.activeWorkspace !== undefined) {
            setCurrentActiveWorkspace(initialSettings.activeWorkspace);
          }

          setSettings(initialSettings); // Set state but don't save to LS
          setConfigLoaded(true);
          return; // Exit early
        } catch (e) {
          console.error("Failed to load Kiosk config:", e);

          // Auto-cleanup: If it's an invalid key, remove it from history
          if (e.message === "Invalid Dashboard Key") {
            try {
              const historyKey = STORAGE_KEYS.DASHBOARD_HISTORY;
              const rawHistory = localStorage.getItem(historyKey);
              if (rawHistory) {
                const entryId = configId || dashUrl;
                let history = JSON.parse(rawHistory);
                const filtered = history.filter(h => h.id !== entryId);
                if (filtered.length !== history.length) {
                  localStorage.setItem(historyKey, JSON.stringify(filtered));
                  console.log(`Auto-cleaned invalid dashboard from history: ${entryId}`);
                }
              }
            } catch (err) {
              console.error("Failed to cleanup invalid history:", err);
            }
          }

          // If we were trying to load a specific config ID/URL and failed, 
          // we should stop here and show an error, rather than fallback to local.
          setLoadError(e.message || "Failed to load configuration");
          return;
        }
      }

      // Normal Load Logic (LocalStorage -> config.json -> Defaults)
      const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);

      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        // Ensure streamApiKey exists
        if (!parsed.streamApiKey) {
          parsed.streamApiKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(parsed));
        }
        setSettings(parsed);
      } else {
        // No local settings found, try loading from config.json
        try {
          const { fetchConfig } = await import('./utils/configParser');
          const config = await fetchConfig();

          let initialSettings = {
            bgImages: [],
            slideshowInterval: 60,
            isSlideshowEnabled: false,
            labName: 'Zulu7',
            timeZone: 'local',
            streamerUrl: '',
            finnhubKey: '',
            googleApiKey: '',
            streamApiKey: Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map(b => b.toString(16).padStart(2, '0')).join(''),
            isWorkspaceRotationEnabled: false,
            workspaceRotationInterval: 300
          };

          // Handle V2 Config (Object with settings & workspaces)
          if (config && !Array.isArray(config) && config.settings) {
            // Merge loaded settings with defaults
            initialSettings = { ...initialSettings, ...config.settings };

            // Ensure API key if missing from config
            if (!initialSettings.streamApiKey) {
              initialSettings.streamApiKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
                .map(b => b.toString(16).padStart(2, '0')).join('');
            }

            // Pre-populate workspaces in localStorage if provided
            if (config.workspaces) {
              Object.entries(config.workspaces).forEach(([id, ws]) => {
                localStorage.setItem(STORAGE_KEYS.getWidgetKey(id), JSON.stringify(ws.widgets));
                localStorage.setItem(STORAGE_KEYS.getLayoutKey(id), JSON.stringify(ws.layout));
              });
            }
          }
          // Handle V1 Config (Array of widgets) - treat as Workspace 0?
          else if (Array.isArray(config) && config.length > 0) {
            // Legacy fallback logic could go here, but Zulu7Grid handles legacy fallback too.
            // For now, if it's just widgets, we let Zulu7Grid handle it or we could save to ws_0_widgets
          }

          setSettings(initialSettings);
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(initialSettings));
        } catch (e) {
          console.error("Config load failed, using defaults", e);
          // Fallback to defaults already in initialSettings
          const newKey = Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0')).join('');
          const defaults = {
            bgImages: [],
            slideshowInterval: 60,
            isSlideshowEnabled: false,
            labName: 'Zulu7',
            timeZone: 'local',
            streamerUrl: '',
            finnhubKey: '',
            googleApiKey: '',
            streamApiKey: newKey,
            isWorkspaceRotationEnabled: false,
            workspaceRotationInterval: 300
          };
          setSettings(defaults);
          localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(defaults));
        }
      }
      setConfigLoaded(true);
    };
    loadSettings();
  }, []);

  // Save settings
  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings);
    if (!isEphemeralMode) {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));
    }
    setCurrentBgIndex(0); // Reset slideshow
  };

  // Slideshow logic
  useEffect(() => {
    if (!settings.isSlideshowEnabled || settings.bgImages.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentBgIndex((prev) => (prev + 1) % settings.bgImages.length);
    }, settings.slideshowInterval * 1000);

    return () => clearInterval(interval);
  }, [settings]);

  const currentBg = settings.bgImages.length > 0 ? settings.bgImages[currentBgIndex] : null;

  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handleReorder = () => {
      setRefreshKey(prev => prev + 1);
    };
    window.addEventListener('zulu7-workspaces-reordered', handleReorder);
    return () => window.removeEventListener('zulu7-workspaces-reordered', handleReorder);
  }, []);



  // Instagram OAuth Callback Handler
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code && settings.instagramClientId && settings.instagramClientSecret && !settings.instagramAccessToken) {
      const exchangeToken = async () => {
        try {
          console.log("Instagram OAuth code detected. Exchanging for token...");
          const redirectUri = `${window.location.protocol}//${window.location.host}/api/auth/callback`;
          const res = await fetch(`/api/auth/callback?code=${code}&client_id=${settings.instagramClientId}&client_secret=${settings.instagramClientSecret}&redirect_uri=${encodeURIComponent(redirectUri)}`);
          const data = await res.json();

          if (data.access_token) {
            console.log("Instagram Token obtained successfully.");
            const newSettings = { ...settings, instagramAccessToken: data.access_token };
            setSettings(newSettings);
            localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(newSettings));

            // Clean up URL
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('code');
            window.history.replaceState({}, '', newUrl.href);

            // Re-open settings modal and switch to integrations tab for feedback
            setIsSettingsOpen(true);
            setSettingsTab('integrations');
          } else {
            throw new Error(data.error || "Token exchange failed");
          }
        } catch (e) {
          console.error("Instagram Token Exchange Error:", e);
          alert("Failed to connect Instagram: " + e.message);
        }
      };
      exchangeToken();
    }
  }, [settings.instagramClientId, settings.instagramClientSecret, settings.instagramAccessToken]);

  console.log("App Rendering...");
  return (
    <div className="App bg-gray-950 min-h-screen text-white overflow-x-hidden relative transition-all duration-1000 ease-in-out">
      {/* Dynamic Background */}
      {currentBg && (
        <div
          className="fixed inset-0 z-0 bg-cover bg-center transition-all duration-1000 ease-in-out opacity-40"
          style={{ backgroundImage: `url(${currentBg})` }}
        />
      )}

      {/* Default Gradient Fallback (visible if no image or underneath) */}
      <div className={`fixed inset-0 z-0 pointer-events-none ${currentBg ? 'opacity-30' : 'opacity-100'}`} />

      <div className="relative z-10">
        {configLoaded ? (
          <Zulu7Grid
            key={refreshKey}
            onOpenSettings={(tab = 'general', wsIndex = 0) => {
              setCurrentActiveWorkspace(wsIndex);
              setSettingsTab(tab);
              setIsSettingsOpen(true);
            }}
            settings={settings}
            onUpdateSettings={handleSaveSettings}
            disablePersistence={isEphemeralMode}
            initialWorkspaces={ephemeralWorkspaces}
            initialActiveWorkspace={isEphemeralMode ? (settings.activeWorkspace || 0) : undefined}
            isRestricted={settings.isRestricted}
          />
        ) : loadError ? (
          <div className="min-h-screen flex flex-col items-center justify-center text-white p-8 text-center">
            <div className="mb-6">
              <img src="/favicon.svg" alt="Zulu7 Logo" className="w-16 h-16" />
            </div>
            <h1 className="text-2xl font-bold mb-6">Invalid Dashboard Key</h1>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="px-6 py-2 bg-white/10 hover:bg-white/20 rounded text-sm font-medium transition-colors cursor-pointer"
              title="Return to your local configuration"
            >
              Return to Local Dashboard
            </button>
          </div>
        ) : (
          <div className="min-h-screen flex items-center justify-center text-white/50">
            Loading...
          </div>
        )}
      </div>


      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
          initialSettings={settings}
          activeTab={settingsTab}
          setActiveTab={setSettingsTab}
          activeWorkspace={currentActiveWorkspace}
        />
      )}


      {/* Z Logo (Bottom Right) */}
      <div
        className="fixed bottom-2 right-6 z-50 opacity-80 hover:opacity-100 transition-all duration-300 hover:scale-125 cursor-pointer"
        onClick={() => {
          window.location.href = '/default.html';
        }}
        title="Zulu7"
      >
        <img
          src="/icon.svg"
          alt="Zulu7"
          className="w-[34px] h-[34px] drop-shadow-lg"
        />
      </div>
    </div>
  );
}

export default App;
