# Zulu7 Dashboard

**Zulu7** is a professional, open-source dashboard designed for home lab enthusiasts and high-density information displays. It provides a pixel-perfect, highly customizable interface to monitor your servers, cameras, market data, and daily digital life.

## Key Features

- **48-Column Ultra-High Density Grid**: Precision layout control for any screen size.
- **WebRTC Security Monitoring**: Low-latency MJPEG/WebRTC streaming for RTSP cameras via Go2RTC.
- **7+ Virtual Workspaces**: Organize widgets across multiple screens with optional auto-rotation.
- **Real-Time Market Intelligence**: Live tracking for cryptos, stocks, and commodities without rate limits.
- **Privacy First**: 100% local operation with JSON-based snapshots and no cloud tracking.
- **Local System Insights**: Built-in monitoring for CPU load and system health in home lab environments.

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
- **Frontend**: React 19 + Vite + Tailwind CSS 4.
- **Icons**: Lucide React.
- **Grid System**: Custom implementation on top of `react-grid-layout`.
- **Backend API**: Express 5 for proxying and system metrics.

---
*Created by [Zulu7.net](https://zulu7.net)*
