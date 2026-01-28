# ATEM ISO EDL Generator — Roadmap

> **Goal:** Frame-accurate EDL generation from ATEM switchers with HyperDeck integration.
> **Timeline:** Aggressive — MVP in days, not weeks.

---

## Phase 0: Foundation (Current)

**Status:** In Progress

| Task | Description | Status |
|------|-------------|--------|
| Repository setup | Git repo, licence, README | ✅ Done |
| Project structure | TypeScript scaffold, folders, configs | 🔄 In Progress |
| Build tooling | ESM, Vitest, ESLint, Pino | 🔄 In Progress |
| Configuration schema | Zod-validated YAML config | ⏳ Pending |

**Deliverable:** Buildable TypeScript project with no runtime code.

---

## Phase 1: MVP — Core Event Capture

**Goal:** Capture ATEM program changes with timestamps. No HyperDeck, no web UI.

| Task | Description | Priority |
|------|-------------|----------|
| ATEM adapter | Connect via `atem-connection`, subscribe to state changes | P0 |
| Event model | Define TypeScript types for switching events | P0 |
| Event store | JSONL append-only log with timestamps | P0 |
| Basic EDL output | CMX 3600 with hardcoded reel names | P0 |
| CLI interface | Start service, generate EDL from log | P1 |

### Success Criteria

- [ ] Connects to ATEM switcher on startup
- [ ] Logs all program bus changes with sub-second timestamps
- [ ] Generates valid CMX 3600 EDL file
- [ ] EDL imports into DaVinci Resolve without errors

**Deliverable:** Command-line tool that captures ATEM cuts and outputs EDL.

---

## Phase 2: HyperDeck Integration

**Goal:** Query HyperDecks for recording filenames and timecode.

| Task | Description | Priority |
|------|-------------|----------|
| HyperDeck adapter | TCP connection to Ethernet Protocol port 9993 | P0 |
| Clip name query | Fetch active recording filename | P0 |
| Timecode query | Get current deck timecode | P0 |
| Input mapping | Map ATEM inputs to HyperDeck sources | P0 |
| EDL enhancement | Populate `FROM CLIP NAME` and `SOURCE FILE` comments | P0 |
| Multi-deck support | Handle 4+ HyperDecks simultaneously | P1 |

### Success Criteria

- [ ] Connects to multiple HyperDecks on startup
- [ ] EDL includes correct clip names for each source
- [ ] Source timecode matches HyperDeck recordings
- [ ] EDL relinks successfully in Premiere Pro

**Deliverable:** EDLs that automatically match ISO recording files.

---

## Phase 3: Web Interface

**Goal:** Browser-based configuration and monitoring.

| Task | Description | Priority |
|------|-------------|----------|
| Express server | Static file serving and API routes | P0 |
| Status dashboard | Connection status, event count, current input | P0 |
| Live event feed | WebSocket-powered scrolling event log | P1 |
| EDL download | Generate and download EDL via browser | P0 |
| Settings page | Runtime configuration without restart | P2 |
| Dark mode | Broadcast-friendly low-light UI | P2 |

### Success Criteria

- [ ] Web UI accessible at `http://localhost:3000`
- [ ] Shows real-time connection status
- [ ] One-click EDL generation and download
- [ ] Works on tablet in control room

**Deliverable:** Production-ready web interface for operators.

---

## Phase 4: Production Hardening

**Goal:** Broadcast-grade reliability and observability.

| Task | Description | Priority |
|------|-------------|----------|
| Auto-reconnect | Automatic reconnection with exponential backoff | P0 |
| Health checks | Liveness and readiness endpoints | P0 |
| Prometheus metrics | Connection uptime, event rate, latency | P1 |
| Structured logging | Pino with correlation IDs | P0 |
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

## Phase 5: Extended Device Support

**Goal:** Support additional recording devices and switchers.

| Task | Description | Priority |
|------|-------------|----------|
| AJA Ki Pro adapter | REST API integration | P2 |
| vMix integration | API for MultiCorder recordings | P3 |
| Ross Video support | DashBoard protocol for Carbonite/Ultrix | P3 |
| Atomos support | AMP protocol (if documented) | P3 |
| NDI input support | Track NDI source names | P3 |

### Success Criteria

- [ ] Works with AJA Ki Pro recorders
- [ ] Configurable per-project device selection
- [ ] Graceful degradation if device unavailable

**Deliverable:** Multi-vendor recording device support.

---

## Phase 6: Advanced EDL Features

**Goal:** Professional-grade EDL output with transitions.

| Task | Description | Priority |
|------|-------------|----------|
| Transition capture | Detect dissolves, wipes with duration | P1 |
| Multi-M/E support | Monitor multiple mix/effect buses | P2 |
| Audio follows video | Track AFV switching decisions | P2 |
| AAF export | Alternative to CMX 3600 for Avid | P3 |
| FCPXML export | Apple Final Cut Pro format | P3 |
| Resolve project | Native DaVinci Resolve .drp files | P3 |

### Success Criteria

- [ ] EDL includes dissolve durations
- [ ] Exports to multiple NLE formats
- [ ] Round-trips through Resolve without issues

**Deliverable:** Feature parity with ATEM Mini ISO (and beyond).

---

## Phase 7: Enterprise Features

**Goal:** Multi-production, multi-user environments.

| Task | Description | Priority |
|------|-------------|----------|
| Session management | Named sessions with separate logs | P2 |
| Multi-instance | Run multiple generators for different switchers | P2 |
| User authentication | Basic auth for web UI | P3 |
| Audit logging | Who started/stopped sessions | P3 |
| REST API auth | API key authentication | P3 |
| Webhook notifications | Post events to external systems | P3 |

### Success Criteria

- [ ] Manage multiple live productions
- [ ] Access control for shared installations
- [ ] Integration with broadcast automation

**Deliverable:** Enterprise-ready deployment options.

---

## Non-Goals (Out of Scope)

These features are explicitly **not** planned:

| Feature | Reason |
|---------|--------|
| Video recording | Use HyperDecks — we capture metadata only |
| Live switching control | Use ATEM Software Control or Companion |
| Audio mixing | Outside scope — EDL is video-focused |
| Real-time preview | Use ATEM multiview — we're headless |
| Cloud deployment | Latency-sensitive — must be on-premise |

---

## Technical Debt Allowances

For MVP speed, these shortcuts are acceptable:

| Shortcut | Acceptable Until | Remediation |
|----------|------------------|-------------|
| Hardcoded frame rates | Phase 2 | Config-driven frame rate |
| No input validation | Phase 3 | Zod schemas on all inputs |
| Console logging | Phase 4 | Pino structured logging |
| Manual testing only | Phase 4 | Vitest unit and integration tests |
| Single config file | Phase 5 | Environment variable overrides |

---

## Version Milestones

| Version | Phase | Description |
|---------|-------|-------------|
| v0.1.0 | 1 | MVP — ATEM capture + basic EDL |
| v0.2.0 | 2 | HyperDeck integration |
| v0.3.0 | 3 | Web interface |
| v1.0.0 | 4 | Production-ready release |
| v1.1.0 | 5 | AJA Ki Pro support |
| v1.2.0 | 6 | Transition capture |
| v2.0.0 | 7 | Multi-session enterprise |

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

### Development Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `typescript` | Type safety | ^5.3 |
| `vitest` | Testing | ^1.x |
| `eslint` | Linting | ^8.x |
| `tsx` | Dev runner | ^4.x |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| ATEM protocol changes | Low | High | Pin `atem-connection` version |
| HyperDeck firmware breaks API | Medium | High | Test against multiple firmware versions |
| Network latency causes timing drift | Medium | Medium | NTP sync, warn on high latency |
| User misconfigures input mapping | High | Low | Validation warnings in web UI |
| Event log grows unbounded | Low | Low | Daily rotation, compression |

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-28 | Use `atem-connection` not raw protocol | Mature library, maintained by NRK/Sofie |
| 2026-01-28 | CMX 3600 as primary format | Universal NLE support despite limitations |
| 2026-01-28 | JSONL for event storage | Human-readable, appendable, replayable |
| 2026-01-28 | Express over Fastify | Simpler, more middleware available |
| 2026-01-28 | No Companion dependency | Direct ATEM connection for lower latency |

---

*Roadmap is a living document. Priorities may shift based on user feedback.*
