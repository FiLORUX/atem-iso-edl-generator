# ATEM ISO EDL Generator

**Frame-accurate Edit Decision List generation from Blackmagic ATEM switchers**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)

---

## Overview

ATEM ISO EDL Generator captures switching events from Blackmagic ATEM switchers in real-time and generates industry-standard EDL files for post-production. Unlike ATEM Mini ISO's proprietary DaVinci Resolve project files, this tool produces **universal CMX 3600 EDLs** compatible with any NLE.

### Key Features

- **Real-time event capture** — Monitors ATEM program bus changes via network
- **Frame-accurate timestamps** — High-resolution timing with NTP synchronisation
- **HyperDeck integration** — Queries recording filenames and timecode automatically
- **Universal EDL output** — CMX 3600 format with extended comments for file matching
- **Web-based configuration** — Simple browser UI for settings and monitoring
- **Zero-maintenance design** — Runs as a service, no babysitting required

### Use Cases

- **Live multicam productions** — Generate EDLs for ISO recordings during live events
- **Broadcast workflows** — Integrate with HyperDeck-based recording infrastructure
- **Post-production handoff** — Deliver frame-accurate cut lists to editors
- **Archive documentation** — Maintain searchable logs of all switching decisions

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│  ATEM Switcher  │────▶│  ATEM ISO EDL Generator  │────▶│  EDL Files      │
│  (Network)      │     │                          │     │  (.edl)         │
└─────────────────┘     │  ┌────────────────────┐  │     └─────────────────┘
                        │  │ ATEM Adapter       │  │
┌─────────────────┐     │  │ • Event capture    │  │     ┌─────────────────┐
│  HyperDeck(s)   │────▶│  │ • State tracking   │  │────▶│  Event Log      │
│  (TCP 9993)     │     │  └────────────────────┘  │     │  (.jsonl)       │
└─────────────────┘     │                          │     └─────────────────┘
                        │  ┌────────────────────┐  │
┌─────────────────┐     │  │ HyperDeck Adapter  │  │     ┌─────────────────┐
│  Web Browser    │◀───▶│  │ • Clip queries     │  │     │  Web UI         │
│                 │     │  │ • Timecode sync    │  │     │  (localhost)    │
└─────────────────┘     │  └────────────────────┘  │     └─────────────────┘
                        │                          │
                        │  ┌────────────────────┐  │
                        │  │ EDL Generator      │  │
                        │  │ • CMX 3600 output  │  │
                        │  │ • Comment metadata │  │
                        │  └────────────────────┘  │
                        └──────────────────────────┘
```

### Components

| Component | Purpose | Technology |
|-----------|---------|------------|
| **ATEM Adapter** | Connects to ATEM switcher, captures program changes | `atem-connection` library |
| **HyperDeck Adapter** | Queries recording status, clip names, timecode | TCP Ethernet Protocol |
| **Event Store** | Persists all events with timestamps | JSONL append-only log |
| **EDL Generator** | Converts events to CMX 3600 format | Custom TypeScript |
| **Web Server** | Configuration UI and live monitoring | Express + static HTML |
| **Health Monitor** | Watchdog, metrics, connection status | Prometheus-compatible |

---

## Installation

### Prerequisites

- **Node.js 20+** (LTS recommended)
- **Network access** to ATEM switcher (default port 9910)
- **Network access** to HyperDeck(s) (default port 9993)

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

### Docker Deployment (Recommended for Production)

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
  host: "192.168.1.240"
  # Optional: specify M/E bank to monitor (default: 0)
  mixEffect: 0

# HyperDeck Connections (for filename/timecode queries)
hyperdecks:
  - name: "ISO-1"
    host: "192.168.1.241"
    inputMapping: 1        # Maps to ATEM input 1
  - name: "ISO-2"
    host: "192.168.1.242"
    inputMapping: 2
  - name: "ISO-3"
    host: "192.168.1.243"
    inputMapping: 3
  - name: "ISO-4"
    host: "192.168.1.244"
    inputMapping: 4

# EDL Output Settings
edl:
  outputDirectory: "./output"
  format: "cmx3600"         # Currently only CMX 3600 supported
  frameRate: 25             # 23.976, 24, 25, 29.97, 30, 50, 59.94, 60
  dropFrame: false          # true for 29.97/59.94 drop-frame
  includeComments: true     # Add FROM CLIP NAME and SOURCE FILE comments

# Timecode Settings
timecode:
  source: "system"          # "system", "ntp", or "hyperdeck"
  ntpServer: "pool.ntp.org" # Only used if source is "ntp"

# Web Interface
web:
  enabled: true
  port: 3000
  host: "0.0.0.0"

# Logging
logging:
  level: "info"             # "debug", "info", "warn", "error"
  eventLog: true            # Write all events to JSONL file
```

### Input Name Mapping

Map ATEM input numbers to human-readable names and recording file prefixes:

```yaml
# config/inputs.yaml

inputs:
  1:
    name: "Camera 1 - Wide"
    reelName: "CAM1"        # 8 chars max for EDL compatibility
    filePrefix: "CAM1_"     # Expected prefix in HyperDeck recordings
  2:
    name: "Camera 2 - Close"
    reelName: "CAM2"
    filePrefix: "CAM2_"
  3:
    name: "Camera 3 - Guest"
    reelName: "CAM3"
    filePrefix: "CAM3_"
  4:
    name: "Graphics"
    reelName: "GFX"
    filePrefix: "GFX_"
```

---

## Usage

### Starting a Recording Session

1. **Start the service** — `npm start` or via Docker
2. **Open the web UI** — Navigate to `http://localhost:3000`
3. **Verify connections** — Check that ATEM and HyperDecks show "Connected"
4. **Start HyperDeck recording** — Begin ISO recording on all decks
5. **Run your show** — All program changes are logged automatically
6. **Stop and export** — Click "Generate EDL" in the web UI

### Command Line Interface

```bash
# Start with default config
npm start

# Start with custom config file
npm start -- --config /path/to/config.yaml

# Generate EDL from existing event log
npm run generate-edl -- --input ./logs/events-2026-01-28.jsonl --output ./output/

# Validate configuration
npm run validate-config

# Run in debug mode
DEBUG=atem-edl:* npm start
```

### Web UI Features

| Feature | Description |
|---------|-------------|
| **Dashboard** | Live view of current program input and recent cuts |
| **Connections** | Status of ATEM and HyperDeck connections |
| **Event Log** | Scrolling list of all captured events |
| **EDL Export** | Generate and download EDL files |
| **Settings** | Runtime configuration adjustments |

---

## EDL Output Format

Generated EDLs follow the CMX 3600 specification with extended comment lines for modern NLE compatibility.

### Sample Output

```edl
TITLE: LIVE_PRODUCTION_2026-01-28

001  CAM1     V     C        01:00:00:00 01:00:12:18 01:00:00:00 01:00:12:18
* FROM CLIP NAME: CAM1_A001_20260128_100000.MOV
* SOURCE FILE: /Volumes/ISO/CAM1_A001_20260128_100000.MOV
* ATEM INPUT: 1 (Camera 1 - Wide)

002  CAM2     V     C        01:00:10:05 01:00:25:12 01:00:12:18 01:00:28:00
* FROM CLIP NAME: CAM2_A001_20260128_100000.MOV
* SOURCE FILE: /Volumes/ISO/CAM2_A001_20260128_100000.MOV
* ATEM INPUT: 2 (Camera 2 - Close)

003  CAM1     V     D    025 01:00:23:00 01:00:45:10 01:00:28:00 01:00:50:10
003  CAM1     V     D    025 01:00:23:00 01:00:45:10 01:00:28:00 01:00:50:10
* FROM CLIP NAME: CAM1_A001_20260128_100000.MOV
* SOURCE FILE: /Volumes/ISO/CAM1_A001_20260128_100000.MOV
* ATEM INPUT: 1 (Camera 1 - Wide)
* TRANSITION: DISSOLVE 25 frames
```

### EDL Field Reference

| Field | Description |
|-------|-------------|
| Event Number | Sequential edit number (001-999) |
| Reel Name | 8-character source identifier from config |
| Track | V (video), A1-A4 (audio), VA (both) |
| Transition | C (cut), D (dissolve), W (wipe) |
| Source In/Out | Timecode in source recording |
| Record In/Out | Timecode on output timeline |
| Comments | Extended metadata for NLE import |

---

## API Reference

### REST API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/status` | GET | Current connection status and statistics |
| `GET /api/events` | GET | List recent events (paginated) |
| `GET /api/events/:id` | GET | Single event details |
| `POST /api/edl/generate` | POST | Generate EDL from current session |
| `GET /api/edl/download/:filename` | GET | Download generated EDL file |
| `GET /api/health` | GET | Health check endpoint |
| `GET /metrics` | GET | Prometheus metrics |

### WebSocket Events

Connect to `ws://localhost:3000/ws` for real-time updates:

```javascript
// Event types
{
  "type": "programChange",
  "timestamp": "2026-01-28T10:00:00.123Z",
  "data": {
    "input": 1,
    "inputName": "Camera 1 - Wide",
    "previousInput": 2,
    "transitionType": "cut"
  }
}

{
  "type": "connectionStatus",
  "timestamp": "2026-01-28T10:00:00.000Z",
  "data": {
    "atem": "connected",
    "hyperdecks": {
      "ISO-1": "connected",
      "ISO-2": "connected"
    }
  }
}
```

---

## Troubleshooting

### Common Issues

| Problem | Cause | Solution |
|---------|-------|----------|
| ATEM connection fails | Firewall blocking port 9910 | Allow UDP 9910 in/out |
| HyperDeck shows "disconnected" | Wrong IP or deck powered off | Verify IP and power |
| Timecode drift | System clock not synced | Enable NTP timecode source |
| Missing clips in EDL | Input mapping mismatch | Check `inputs.yaml` configuration |
| EDL won't import | Frame rate mismatch | Match EDL frame rate to project |

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
# Environment variable
DEBUG=atem-edl:* npm start

# Or in config.yaml
logging:
  level: "debug"
```

### Log Files

| File | Location | Content |
|------|----------|---------|
| Application log | `./logs/app.log` | Service activity and errors |
| Event log | `./logs/events-YYYY-MM-DD.jsonl` | All captured events (for replay) |
| EDL output | `./output/*.edl` | Generated EDL files |

---

## Development

### Project Structure

```
atem-iso-edl-generator/
├── src/
│   ├── adapters/           # Device communication
│   │   ├── atem/           # ATEM switcher adapter
│   │   └── hyperdeck/      # HyperDeck adapter
│   ├── core/               # Core business logic
│   │   ├── events/         # Event types and store
│   │   ├── timecode/       # Timecode handling
│   │   └── config/         # Configuration loading
│   ├── generators/         # Output format generators
│   │   └── edl/            # CMX 3600 EDL generator
│   ├── web/                # Web interface
│   │   ├── api/            # REST API routes
│   │   ├── ws/             # WebSocket handlers
│   │   └── static/         # Frontend assets
│   └── index.ts            # Application entry point
├── config/                 # Configuration files
├── docs/                   # Additional documentation
├── output/                 # Generated EDL files
├── logs/                   # Application and event logs
└── tests/                  # Test suites
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Building

```bash
# Development build
npm run build

# Production build
npm run build:prod
```

---

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) before submitting pull requests.

### Development Setup

```bash
# Clone and install
git clone https://github.com/FiLORUX/atem-iso-edl-generator.git
cd atem-iso-edl-generator
npm install

# Run in development mode with hot reload
npm run dev
```

---

## Licence

MIT License — see [LICENSE](LICENSE) for details.

---

## Acknowledgements

- [atem-connection](https://github.com/nrkno/sofie-atem-connection) — ATEM protocol implementation by Sofie TV Automation
- [Blackmagic Design](https://www.blackmagicdesign.com/) — HyperDeck Ethernet Protocol documentation
- Broadcast engineering community for feedback and testing

---

## Support

- **Issues:** [GitHub Issues](https://github.com/FiLORUX/atem-iso-edl-generator/issues)
- **Discussions:** [GitHub Discussions](https://github.com/FiLORUX/atem-iso-edl-generator/discussions)

---

*Built for broadcast. Designed for reliability.*
