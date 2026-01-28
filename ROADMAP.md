# ATEM ISO EDL Generator — Roadmap

> **Goal:** Frame-accurate EDL generation from vision mixers with professional recorder integration.
> **Vision:** A vendor-agnostic, broadcast-grade equivalent to ATEM Mini ISO for professional environments.
> **Timeline:** Aggressive — MVP in days, not weeks.

---

## Architecture Principles

Based on [docs/ANALYSIS.md](docs/ANALYSIS.md):

1. **Event-driven logging** — Not video analysis
2. **External ISO recording** — Devices do what they do best
3. **Single, coherent timecode domain** — LTC/house sync preferred
4. **Standards-based edit formats** — CMX 3600, FCP7 XML
5. **Minimal complexity, maximum determinism** — Predictable behaviour
6. **Low long-term maintenance cost** — No exotic dependencies

---

## Phase 0: Foundation ✅

**Status:** Complete

| Task | Description | Status |
|------|-------------|--------|
| Repository setup | Git repo, licence, README | ✅ Done |
| Project structure | TypeScript scaffold, folders, configs | ✅ Done |
| Build tooling | ESM, Vitest, Pino | ✅ Done |
| Configuration schema | Zod-validated YAML config | ✅ Done |
| ATEM adapter | Connect via `atem-connection` | ✅ Done |
| Event types | TypeScript types with timestamps | ✅ Done |
| CMX 3600 generator | Basic EDL output | ✅ Done |
| Timecode utilities | SMPTE with drop-frame | ✅ Done |

**Deliverable:** Buildable TypeScript project with core components.

---

## Phase 1: MVP — Working End-to-End

**Goal:** Connect to real ATEM, capture real cuts, generate valid EDL.

| Task | Description | Priority |
|------|-------------|----------|
| Timeline model | Internal representation between events and export | P0 |
| Frame-offset compensation | Per-device latency adjustment | P0 |
| Event store persistence | JSONL append-only log | P0 |
| CLI commands | Start, stop, generate EDL | P0 |
| Integration test | Real ATEM connection test | P0 |

### Success Criteria

- [ ] Connects to ATEM switcher on startup
- [ ] Logs all programme bus changes with frame-accurate timestamps
- [ ] Generates valid CMX 3600 EDL file
- [ ] EDL imports into DaVinci Resolve without errors
- [ ] Frame offsets configurable per device

**Deliverable:** Command-line tool that captures ATEM cuts and outputs EDL.

---

## Phase 2: HyperDeck + FCP7 XML

**Goal:** Query HyperDecks for filenames/timecode. Add FCP7 XML export.

| Task | Description | Priority |
|------|-------------|----------|
| HyperDeck adapter | TCP connection to Ethernet Protocol port 9993 | P0 |
| Clip name query | Fetch active recording filename | P0 |
| Timecode query | Get current deck timecode as master source | P0 |
| Input mapping | Map ATEM inputs to HyperDeck sources | P0 |
| **FCP7 XML export** | DaVinci Resolve / Premiere compatible | P0 |
| Multi-deck support | Handle 4+ HyperDecks simultaneously | P1 |

### Success Criteria

- [ ] Connects to multiple HyperDecks on startup
- [ ] EDL/XML includes correct clip names for each source
- [ ] Source timecode matches HyperDeck recordings
- [ ] FCP7 XML imports into Resolve with all clips linked
- [ ] EDL relinks successfully in Premiere Pro

**Deliverable:** EDLs and XMLs that automatically match ISO recording files.

---

## Phase 3: Web Interface

**Goal:** Browser-based configuration and monitoring.

| Task | Description | Priority |
|------|-------------|----------|
| Express server | Static file serving and API routes | P0 |
| Status dashboard | Connection status, event count, current input | P0 |
| Live event feed | WebSocket-powered scrolling event log | P0 |
| EDL/XML download | Generate and download via browser | P0 |
| Session management | Named sessions with separate logs | P1 |
| Settings page | Runtime configuration | P2 |
| Dark mode | Broadcast-friendly low-light UI | P2 |

### Success Criteria

- [ ] Web UI accessible at `http://localhost:3000`
- [ ] Shows real-time connection status for all devices
- [ ] One-click EDL and FCP7 XML generation
- [ ] Works on tablet in control room
- [ ] Multiple sessions manageable

**Deliverable:** Production-ready web interface for operators.

---

## Phase 4: TSL Universal Mixer Support

**Goal:** Vendor-agnostic cut detection via TSL UMD protocol.

| Task | Description | Priority |
|------|-------------|----------|
| TSL UMD v5 adapter | Listen for tally state changes | P0 |
| TSL UMD v3.1 support | Legacy protocol compatibility | P1 |
| Programme bus detection | Map tally ON AIR to programme change | P0 |
| Source name mapping | TSL display names to reel names | P0 |
| Multi-mixer support | Simultaneous ATEM + TSL sources | P2 |

### Success Criteria

- [ ] Detects programme changes from Ross Carbonite via TSL
- [ ] Detects programme changes from Grass Valley via TSL
- [ ] Works with any TSL-compliant mixer
- [ ] Can run alongside ATEM adapter for redundancy

**Deliverable:** Universal vision mixer support via industry-standard protocol.

---

## Phase 5: LTC Timecode Integration

**Goal:** External LTC as primary timecode source for broadcast environments.

| Task | Description | Priority |
|------|-------------|----------|
| LTC decoder | Software decode from audio input | P1 |
| USB LTC reader support | ESE, Ambient, etc. | P2 |
| HyperDeck as LTC proxy | Use deck timecode when LTC unavailable | P0 |
| Timecode source priority | LTC > HyperDeck > System | P0 |
| Drift monitoring | Alert on timecode discontinuity | P1 |

### Success Criteria

- [ ] Locks to external LTC within 1 frame
- [ ] Falls back gracefully when LTC lost
- [ ] Logs timecode source changes
- [ ] Frame-accurate to house sync

**Deliverable:** Broadcast-grade timecode integration.

---

## Phase 6: Production Hardening

**Goal:** Broadcast-grade reliability and observability.

| Task | Description | Priority |
|------|-------------|----------|
| Auto-reconnect | Exponential backoff for all adapters | P0 |
| Health checks | Liveness and readiness endpoints | P0 |
| Prometheus metrics | Connection uptime, event rate, latency | P1 |
| Graceful shutdown | Complete pending writes before exit | P0 |
| Docker packaging | Multi-stage build, minimal image | P1 |
| Systemd service | Linux service unit file | P2 |

### Success Criteria

- [ ] Survives network blips without data loss
- [ ] Metrics visible in Grafana
- [ ] Zero manual intervention during 8-hour broadcast
- [ ] Clean shutdown preserves all captured events

**Deliverable:** Service that runs unattended in production.

---

## Phase 7: Extended Device Support

**Goal:** Support additional recording devices.

| Task | Description | Priority |
|------|-------------|----------|
| AJA Ki Pro adapter | REST API integration | P2 |
| vMix integration | API for MultiCorder recordings | P2 |
| Atomos support | LTC trigger-based integration | P3 |
| NDI input support | Track NDI source names | P3 |

### Success Criteria

- [ ] Works with AJA Ki Pro recorders
- [ ] Configurable per-project device selection
- [ ] Graceful degradation if device unavailable

**Deliverable:** Multi-vendor recording device support.

---

## Phase 8: Advanced Features

**Goal:** Professional-grade output with full transition support.

| Task | Description | Priority |
|------|-------------|----------|
| Transition capture | Detect dissolves, wipes with duration | P1 |
| Multi-M/E support | Monitor multiple mix/effect buses | P2 |
| Audio follows video | Track AFV switching decisions | P2 |
| AAF export | Avid Media Composer format | P3 |
| FCPXML export | Apple Final Cut Pro X format | P3 |
| Resolve project | Native DaVinci Resolve .drp files | P3 |

### Success Criteria

- [ ] EDL includes dissolve durations
- [ ] Exports to multiple NLE formats
- [ ] Round-trips through Resolve without issues

**Deliverable:** Feature parity with ATEM Mini ISO (and beyond).

---

## Non-Goals (Out of Scope)

| Feature | Reason |
|---------|--------|
| Video recording | Use HyperDecks — we capture metadata only |
| Live switching control | Use ATEM Software Control or Companion |
| SDI capture via DeckLink | High failure impact, high maintenance |
| ffmpeg-based recording | Outside core competency |
| Audio mixing | Outside scope — EDL is video-focused |
| Cloud deployment | Latency-sensitive — must be on-premise |

---

## Version Milestones

| Version | Phase | Description |
|---------|-------|-------------|
| v0.1.0 | 1 | MVP — ATEM capture + CMX 3600 EDL |
| v0.2.0 | 2 | HyperDeck integration + FCP7 XML |
| v0.3.0 | 3 | Web interface |
| v0.4.0 | 4 | TSL universal mixer support |
| v0.5.0 | 5 | LTC timecode integration |
| v1.0.0 | 6 | Production-ready release |
| v1.1.0 | 7 | AJA Ki Pro + vMix support |
| v1.2.0 | 8 | Full transition capture |

---

## Dependencies

### Runtime Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `atem-connection` | ATEM protocol | ^3.x |
| `zod` | Schema validation | ^3.x |
| `pino` | Structured logging | ^8.x |
| `express` | Web server | ^4.x |
| `ws` | WebSocket server | ^8.x |
| `yaml` | Config parsing | ^2.x |

### Planned Dependencies

| Package | Purpose | Phase |
|---------|---------|-------|
| `tsl-umd` or custom | TSL protocol | 4 |
| LTC decoder TBD | Timecode input | 5 |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ATEM protocol changes | Low | High | Pin `atem-connection` version |
| HyperDeck firmware breaks API | Medium | High | Test against multiple firmware versions |
| Network latency causes timing drift | Medium | Medium | LTC sync, frame-offset compensation |
| TSL implementation varies by vendor | Medium | Medium | Test with multiple mixers |
| User misconfigures input mapping | High | Low | Validation warnings in web UI |
| Event log grows unbounded | Low | Low | Daily rotation, compression |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-28 | Use `atem-connection` not raw protocol | Mature library, maintained by NRK/Sofie |
| 2026-01-28 | CMX 3600 as baseline format | Universal NLE support despite limitations |
| 2026-01-28 | JSONL for event storage | Human-readable, appendable, replayable |
| 2026-01-28 | Express over Fastify | Simpler, more middleware available |
| 2026-01-28 | No Companion dependency | Direct device connection for lower latency |
| 2026-01-28 | FCP7 XML as primary rich format | Better than CMX 3600 for multicam, widely supported |
| 2026-01-28 | TSL UMD for vendor-agnostic support | Industry standard, enables Ross/GV/Sony |
| 2026-01-28 | Internal Timeline Model | Decouples events from export format specifics |
| 2026-01-28 | LTC as preferred timecode source | Broadcast standard, frame-accurate |
| 2026-01-28 | Frame-offset compensation required | Real-world devices have measurable latency |

---

## Prior Art & References

| Project | Type | Notes |
|---------|------|-------|
| ATEM Logger (Télio Tortay) | Open source | Similar concept |
| Multicam Logger (Franz Wegner) | Open source | Node.js, hard cuts only |
| ATEM Exporter (Swift) | Open source | FCP-specific |
| Softron Multicam Logger | Commercial | Feature reference |
| Ross Carbonite LiveEDL | Built-in | Ross native solution |
| TSL UMD Protocol v3.1/v5 | Standard | Tally/UMD specification |

---

*Roadmap updated 2026-01-28 based on docs/ANALYSIS.md insights.*
