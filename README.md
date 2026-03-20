# Zulu7 Dashboard

**Zulu7** is a professional, open-source dashboard designed for home lab enthusiasts and high-density information displays. It provides a pixel-perfect, highly customizable interface to monitor your servers, cameras, market data, and daily digital life.

## Key Features

- **48-Column Ultra-High Density Grid**: Precision layout control for any screen size.
- **WebRTC Security Monitoring**: Low-latency MJPEG/WebRTC streaming for RTSP cameras via Go2RTC.
- **7+ Virtual Workspaces**: Organize widgets across multiple screens with optional auto-rotation.
- **Real-Time Market Intelligence**: Live tracking for cryptos, stocks, and commodities without rate limits.
- **Privacy First**: 100% local operation with JSON-based snapshots and no cloud tracking.
- **Local System Insights**: Built-in monitoring for CPU load and system health in home lab environments.
- **Advanced Security & Lockdown**: Real-time integration protection via hidden `.locked` file failsafe.

## Security & Lockdown

Zulu7 includes a definitive "Kill-Switch" security mechanism for integrations:

- **Hidden Failsafe**: Create a hidden file named `.locked` in the `integrations/` directory to trigger a global lockdown.
- **Real-Time Protection**: The system polls for the lock status every 5 seconds. If detected, the Integration Editor immediately scrambles all visible code characters into `*`.
- **Content Masking**: The backend automatically obfuscates integration source code before it even leaves the server when locked.
- **UI Interaction Block**: A prominent **"INTEGRATION LOCKED"** overlay prevents all interaction and inspection of sensitive code.
- **Backend Enforcement**: Any attempts to save changes while the system is locked are rejected by the server with a `403 Forbidden` error.
- **Restore Defaults**: Integration editors include a "Restore Defaults" safety mechanism to reset configurations to a known good state.

## Integration Development

When creating or modifying integrations in the `integrations/` directory:

- **Safety Backups**: Always create a `.default` file for new integrations and **update** it during upgrades (e.g., `netdata.default` for `netdata.html`). This enables the "Restore Defaults" feature.
- **Clean Templates**: Default files should contain complete, working source code but with all sensitive information (IPs, API keys, server names) removed or neutralized.
- **Lockdown Support**: Integrations should ideally check for the `.locked` status and provide appropriate visual feedback if they handle their own internal navigation or state.

## Quick Start

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Start Development Server**:
    ```bash
    npm run dev
    ```

3.  **Deploy for Production**:
    ```bash
    npm run build
    npm start
    ```

## Architecture

Zulu7 is built with a modern, high-performance stack:
- **Frontend**: React 19 + Vite + Tailwind CSS 3.
- **Icons**: Lucide React.
- **Grid System**: Custom implementation on top of `react-grid-layout`.
- **Backend API**: Express 5 for proxying and system metrics.

---
*Created by [Zulu7.net](https://zulu7.net)*
