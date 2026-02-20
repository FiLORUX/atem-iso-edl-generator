# ATEM ISO EDL Generator

**Frame-accurate Edit Decision List generation from Blackmagic ATEM switchers**

[![Licence: MIT](https://img.shields.io/badge/Licence-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

---

## Overview

ATEM ISO EDL Generator captures switching events from Blackmagic ATEM switchers in real-time and generates industry-standard EDL files for post-production. Unlike ATEM Mini ISO's proprietary DaVinci Resolve project files, this tool produces **universal CMX 3600 EDLs** compatible with any NLE.

### Key Features

- **Real-time event capture** — Monitors ATEM programme bus changes via network
- **Frame-accurate timestamps** — Sub-frame precision with configurable timecode sources
- **HyperDeck integration** — Reads RP-188 embedded timecode from SDI, queries clip metadata
- **Universal EDL output** — CMX 3600 format with extended comments for file matching
- **Web-based monitoring** — Live dashboard with source configuration and export controls
- **Pluggable timecode** — System clock or HyperDeck SDI timecode with automatic fallback

### Use Cases

- **Live multicam productions** — Generate EDLs for ISO recordings during transmission
- **Broadcast workflows** — Integrate with HyperDeck-based ingest infrastructure
- **Post-production handoff** — Deliver frame-accurate cut lists to offline editors
- **Archive documentation** — Maintain searchable logs of all switching decisions

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────┐     ┌─────────────────┐
│  ATEM Switcher  │────▶│     ATEM ISO EDL Generator       │────▶│  EDL Files      │
│  (UDP 9910)     │     │                                  │     │  (.edl)         │
└─────────────────┘     │  ┌────────────────────────────┐  │     └─────────────────┘
                        │  │ ATEM Adapter               │  │
┌─────────────────┐     │  │ • Programme bus monitoring │  │     ┌─────────────────┐
│  HyperDeck(s)   │────▶│  │ • Transition detection     │  │────▶│  Event Log      │
│  (TCP 9993)     │     │  │ • M/E bank selection       │  │     │  (.jsonl)       │
└─────────────────┘     │  └────────────────────────────┘  │     └─────────────────┘
                        │                                  │
┌─────────────────┐     │  ┌────────────────────────────┐  │
│  Web Browser    │◀───▶│  │ Timecode Provider          │  │
│                 │     │  │ • System clock source      │  │
└─────────────────┘     │  │ • HyperDeck RP-188 source  │  │
                        │  │ • Automatic fallback       │  │
                        │  └────────────────────────────┘  │
                        │                                  │
                        │  ┌────────────────────────────┐  │
                        │  │ Web Interface              │  │
                        │  │ • Real-time dashboard      │  │
                        │  │ • Source configuration     │  │
                        │  │ • EDL export controls      │  │
                        │  └────────────────────────────┘  │
                        └──────────────────────────────────┘
```

### Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| **ATEM Adapter** | Connects to ATEM switcher, captures programme changes | `atem-connection` library |
| **HyperDeck Adapter** | Monitors recording status, reads clip metadata | Blackmagic Ethernet Protocol |
| **Timecode Provider** | Manages timecode acquisition with fallback chain | System clock / RP-188 SDI |
| **Event Store** | Persists all events with timestamps | JSONL append-only log |
| **EDL Generator** | Converts events to CMX 3600 format | Custom TypeScript |
| **Web Server** | Dashboard, configuration UI, WebSocket updates | Express + vanilla JS |

---

## Installation

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **Network access** to ATEM switcher (UDP port 9910)
- **Network access** to HyperDeck(s) (TCP port 9993)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/FiLORUX/atem-iso-edl-generator.git
cd atem-iso-edl-generator

# Install dependencies
npm install

# Copy example configuration
cp config/config.example.yaml config/config.yaml

# Edit configuration with your device IPs
nano config/config.yaml

# Start the service
npm start
```

### Docker Deployment

```bash
# Build the image
docker build -t atem-edl-generator .

# Run with host networking for device discovery
docker run -d \
  --name atem-edl \
  --network host \
  -v $(pwd)/config:/app/config \
  -v $(pwd)/output:/app/output \
  atem-edl-generator
```

---

## Configuration

Configuration is managed via YAML files in the `config/` directory.

### Basic Configuration

```yaml
# config/config.yaml

# ATEM Switcher Connection
atem:
  host: "10.7.77.7"
  mixEffect: 0              # M/E bank to monitor (0 = M/E 1)
  frameOffset: 1            # Compensate for processing latency

# Input Sources
inputs:
  1:
    name: "Cam 1 - Centre Wide"
    reelName: "CAM1"        # 8 chars max for EDL compatibility
    filePrefix: "CAM1_"     # Expected prefix in HyperDeck recordings
  2:
    name: "Cam 2 - Centre MCU"
    reelName: "CAM2"
    filePrefix: "CAM2_"
  3:
    name: "Cam 3 - Centre ECU"
    reelName: "CAM3"
    filePrefix: "CAM3_"
  4:
    name: "Cam 4 - Steadicam"
    reelName: "CAM4"
    filePrefix: "CAM4_"

# HyperDeck ISO Recorders
hyperdecks:
  - name: "ISO-1"
    host: "10.7.77.21"
    inputMapping: 1         # Records ATEM input 1
  - name: "ISO-2"
    host: "10.7.77.22"
    inputMapping: 2
  - name: "ISO-3"
    host: "10.7.77.23"
    inputMapping: 3
  - name: "ISO-4"
    host: "10.7.77.24"
    inputMapping: 4

# EDL Output Settings
edl:
  outputDirectory: "./output"
  format: "cmx3600"
  frameRate: 25             # 23.976, 24, 25, 29.97, 30, 50, 59.94, 60
  dropFrame: false          # true for 29.97/59.94 drop-frame
  includeComments: true     # Add FROM CLIP NAME and SOURCE FILE comments

# Timecode Settings
timecode:
  source: "system"          # "system" or "hyperdeck"
  frameRate: 25
  startTimecode: "01:00:00:00"

  # HyperDeck timecode source (when source: "hyperdeck")
  hyperdeck:
    host: "10.7.77.21"
    port: 9993
    requireSdiSource: true  # Only use RP-188 embedded timecode

  # Fallback to system clock if primary fails
  fallback:
    enabled: true
    delayMs: 3000

# Web Interface
web:
  enabled: true
  port: 3000
  host: "0.0.0.0"
```

---

## Usage

### Starting a Recording Session

1. **Start the service** — `npm start` or via Docker
2. **Open the web UI** — Navigate to `http://localhost:3000`
3. **Verify connections** — Check that ATEM shows "Connected" on the dashboard
4. **Start HyperDeck recording** — Begin ISO recording on all decks
5. **Run your show** — All programme changes are logged automatically
6. **Export** — Click "Download EDL" in the Export tab

### Web Interface

The web interface provides three main views:

| Tab | Purpose |
|-----|---------|
| **Dashboard** | Live programme/preview display, connection status, event log |
| **Export** | EDL format selection, download controls, export history |
| **Settings** | Source configuration, ATEM connection, timecode settings |

### Command Line

```bash
# Start with default config
npm start

# Development mode with hot reload
npm run dev

# Build for production
npm run build
```

---

## EDL Output Format

Generated EDLs follow the CMX 3600 specification with extended comment lines for modern NLE compatibility.

### Sample Output

```edl
TITLE: LIVE_PRODUCTION_2026-01-28

001  CAM1     V     C        01:00:00:00 01:00:12:18 01:00:00:00 01:00:12:18
* FROM CLIP NAME: CAM1_A001_20260128.MOV
* SOURCE FILE: /Volumes/ISO/CAM1_A001_20260128.MOV
* ATEM INPUT: 1 (Cam 1 - Centre Wide)

002  CAM2     V     C        01:00:10:05 01:00:25:12 01:00:12:18 01:00:28:00
* FROM CLIP NAME: CAM2_A001_20260128.MOV
* SOURCE FILE: /Volumes/ISO/CAM2_A001_20260128.MOV
* ATEM INPUT: 2 (Cam 2 - Centre MCU)

003  CAM1     V     D    025 01:00:23:00 01:00:45:10 01:00:28:00 01:00:50:10
* FROM CLIP NAME: CAM1_A001_20260128.MOV
* ATEM INPUT: 1 (Cam 1 - Centre Wide)
* TRANSITION: MIX 25 frames
```

### EDL Field Reference

| Field | Description |
|-------|-------------|
| Event Number | Sequential edit number (001-999) |
| Reel Name | 8-character source identifier from config |
| Track | V (video), A (audio), AA (stereo) |
| Transition | C (cut), D (dissolve/mix), W (wipe) |
| Source In/Out | Timecode in source recording |
| Record In/Out | Timecode on master timeline |

---

## API Reference

### REST Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Connection status and session info |
| `/api/events` | GET | List captured events (paginated) |
| `/api/config` | GET | Current configuration |
| `/api/config` | POST | Update configuration |
| `/api/edl/generate` | POST | Generate EDL from current session |
| `/api/health` | GET | Health check endpoint |

### WebSocket

Connect to `ws://localhost:3000/ws` for real-time updates:

```javascript
// Message types received
{
  "type": "initial_state",    // Full state on connect
  "type": "program_change",   // Programme bus changed
  "type": "connection_status", // Device connected/disconnected
  "type": "event"             // New event captured
}
```

---

## Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| ATEM connection fails | Firewall blocking UDP 9910 | Allow UDP 9910 bidirectional |
| HyperDeck disconnected | Wrong IP or deck powered off | Verify IP and power status |
| Timecode jumping | System clock adjustment | Use HyperDeck RP-188 source |
| Missing events | Input not in mapping | Add input to configuration |
| EDL won't import | Frame rate mismatch | Match EDL frame rate to project |

### Debug Mode

```bash
# Enable verbose logging
npm run dev

# Or set log level in config
logging:
  level: "debug"
```

---

## Development

### Project Structure

```
atem-iso-edl-generator/
├── src/
│   ├── adapters/           # Device communication
│   │   ├── atem/           # ATEM switcher protocol
│   │   └── hyperdeck/      # HyperDeck Ethernet Protocol
│   ├── core/               # Core business logic
│   │   ├── config/         # Configuration schema and loading
│   │   └── events/         # Event types and persistence
│   ├── providers/          # Pluggable subsystems
│   │   └── timecode/       # Timecode acquisition chain
│   ├── generators/         # Output format generators
│   │   └── edl/            # CMX 3600 EDL generation
│   ├── web/                # Web interface
│   │   ├── api/            # REST API routes
│   │   ├── ws/             # WebSocket handlers
│   │   └── static/         # Frontend assets
│   └── app.ts              # Application entry point
├── config/                 # Configuration files
├── output/                 # Generated EDL files
└── logs/                   # Event logs
```

### Running Tests

```bash
npm test                    # Run all tests
npm run test:coverage       # With coverage report
npm run test:watch          # Watch mode
```

---

## Licence

MIT Licence — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

- [atem-connection](https://github.com/nrkno/sofie-atem-connection) — ATEM protocol implementation by NRK/Sofie
- [Blackmagic Design](https://www.blackmagicdesign.com/) — HyperDeck Ethernet Protocol specification

---

*Built for broadcast. Designed for reliability.*

---

David Thåst · [thåst.se](https://xn--thst-roa.se) · [FiLORUX](https://github.com/FiLORUX)
