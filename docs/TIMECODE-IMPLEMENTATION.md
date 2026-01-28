# Timecode Provider Implementation

> Technical specification for pluggable timecode acquisition system.

## Overview

This system provides accurate SMPTE timecode for EDL generation by supporting multiple timecode sources with automatic failover. The primary use case is reading RP-188 timecode embedded in SDI signals via a HyperDeck proxy.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Application                               │
│                            │                                     │
│                   TimecodeManager                                │
│                   ┌────────┴────────┐                           │
│                   │                 │                            │
│            Primary Provider    Fallback Provider                 │
│                   │                 │                            │
│    ┌──────────────┼──────────────┐  │                           │
│    │              │              │  │                            │
│    ▼              ▼              ▼  ▼                            │
│ HyperDeck    HyperDeck      System Clock                        │
│   SDI        Internal        Provider                            │
│              │                                                   │
│    ┌─────────┴─────────┐                                        │
│    │                   │                                         │
│    ▼                   ▼                                         │
│ TCP Client         Polling                                       │
│ (notify mode)      (fallback)                                    │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
1. HyperDeck receives SDI with RP-188 from ATEM
2. HyperDeck extracts embedded timecode
3. Our TCP client queries transport info
4. Response parsed into TimecodeSnapshot
5. Source validated (SDI vs Internal)
6. Snapshot emitted to consumers
7. EDL generator uses snapshot for event timestamps
```

## Components

### 1. TimecodeSnapshot (Data Model)

The unified output from all providers:

```typescript
interface TimecodeSnapshot {
  readAt: number;              // Date.now() when captured
  timecode: string | null;     // "HH:MM:SS:FF" display TC
  timelineTimecode: string | null;
  source: TimecodeSource;      // 'HYPERDECK_SDI' | 'SYSTEM' | etc.
  status: TimecodeStatus;      // 'OK' | 'DEGRADED' | 'NO_SIGNAL' | 'ERROR'
  frameRate: number;
  dropFrame: boolean;
  transport?: { state, speed, slotId, clipId };
  device?: { name, model, firmwareVersion };
  error?: string;
}
```

### 2. HyperDeckProvider

Primary provider for "real" external timecode.

**Connection Strategy:**
1. Connect via TCP to port 9993
2. Query device info and protocol version
3. Query timecode source configuration
4. If protocol >= 1.11: enable notify for transport
5. Else: start polling at configured rate

**Timecode Source Validation:**
```typescript
// Only report OK status if source matches expectation
if (config.requireSdiSource && timecodeSource !== 'external') {
  snapshot.status = 'DEGRADED';
  snapshot.source = 'HYPERDECK_INTERNAL';
} else if (timecodeSource === 'external') {
  snapshot.status = 'OK';
  snapshot.source = 'HYPERDECK_SDI';
}
```

**Error Handling:**
- Connection timeout: retry with exponential backoff
- Protocol error: log and continue polling
- No signal: report NO_SIGNAL status
- Disconnect: attempt reconnection

**HyperDeck Protocol Commands Used:**
```
device info          → Get model, firmware, protocol version
transport info       → Get timecode, displayTimecode, status, speed
notify: transport: true → Subscribe to transport changes (1.11+)
```

### 3. SystemClockProvider

Fallback provider using computer time.

**Implementation:**
1. Calculate frame number from system time
2. Apply configured start timecode offset
3. Format as SMPTE timecode string
4. Emit at configured rate (default: frame rate)

**Drift Compensation:**
- Use `performance.now()` for sub-millisecond precision
- Track cumulative drift and compensate
- Log warnings if drift exceeds threshold

### 4. TimecodeManager

Orchestrates providers and handles failover.

**Responsibilities:**
1. Instantiate configured providers
2. Connect primary, then fallback
3. Monitor primary health
4. Switch to fallback after timeout
5. Attempt primary reconnection periodically
6. Rate-limit emissions to consumers
7. Provide unified API

**Failover Logic:**
```typescript
if (primaryDisconnectedFor > fallbackDelayMs) {
  activeProvider = fallbackProvider;
  emit('failover', { from: 'primary', to: 'fallback' });
}

// Periodically attempt to restore primary
setInterval(() => {
  if (activeProvider === fallbackProvider) {
    primaryProvider.connect().then(() => {
      activeProvider = primaryProvider;
      emit('restored', { provider: 'primary' });
    }).catch(() => { /* stay on fallback */ });
  }
}, primaryRestoreIntervalMs);
```

## Configuration Schema

```yaml
timecode:
  # Primary source: 'system' | 'hyperdeck'
  source: hyperdeck

  # Frame rate for timecode generation/validation
  frameRate: 25

  # Drop-frame (only for 29.97/59.94)
  dropFrame: false

  # Starting timecode (for system clock mode)
  startTimecode: "01:00:00:00"

  # HyperDeck configuration
  hyperdeck:
    host: "10.7.77.21"
    port: 9993

    # Only accept SDI-embedded timecode as "real"
    requireSdiSource: true

    # Polling rate when notifications unavailable
    pollRateHz: 10

    # Use protocol notifications if available
    useNotifications: true

    # Connection timeout
    connectionTimeoutMs: 5000

    # Reconnection settings
    reconnect:
      enabled: true
      maxAttempts: 0  # 0 = infinite
      initialDelayMs: 1000
      maxDelayMs: 30000

  # Fallback settings
  fallback:
    enabled: true
    delayMs: 3000  # Switch after 3s of primary failure

  # Rate limiting
  maxEmitRateHz: 25
```

## File Structure

```
src/providers/timecode/
├── types.ts              # All interfaces and types
├── hyperdeck.ts          # HyperDeck TCP provider
├── system-clock.ts       # System clock fallback
├── manager.ts            # Provider orchestration
├── utils.ts              # Timecode parsing/formatting
└── index.ts              # Public exports

tools/
└── hyperdeck-tc.ts       # CLI test tool
```

## Implementation Phases

### Phase 1: Types & Utils
- [x] types.ts — All interfaces
- [ ] utils.ts — Timecode parsing, formatting, validation

### Phase 2: HyperDeck Provider
- [ ] TCP connection via hyperdeck-connection
- [ ] Protocol version detection
- [ ] Notify subscription (1.11+)
- [ ] Polling fallback
- [ ] Timecode source validation
- [ ] Reconnection logic

### Phase 3: System Clock Provider
- [ ] Time-of-day to timecode conversion
- [ ] Configurable start offset
- [ ] Frame-accurate update loop
- [ ] Drift monitoring

### Phase 4: Manager & Integration
- [ ] Provider orchestration
- [ ] Failover logic
- [ ] Rate limiting
- [ ] Config schema updates
- [ ] App integration

### Phase 5: CLI Tool & Testing
- [ ] tools/hyperdeck-tc.ts
- [ ] Unit tests for utils
- [ ] Integration tests with mock

## Error States

| Status | Meaning | Action |
|--------|---------|--------|
| OK | Valid TC from expected source | Use timecode |
| DEGRADED | TC available but wrong source | Use with warning |
| NO_SIGNAL | No valid TC signal | Fall back |
| CONNECTING | Establishing connection | Wait |
| DISCONNECTED | Lost connection | Reconnect |
| ERROR | Unrecoverable error | Fall back + alert |

## Testing Strategy

### Unit Tests
- Timecode parsing edge cases
- Frame rate calculations
- Drop-frame handling

### Integration Tests
- Mock HyperDeck responses
- Failover scenarios
- Reconnection behaviour

### Manual Testing
- Real HyperDeck with SDI input
- Verify TC matches device display
- Test disconnect/reconnect
- Verify fallback activation

## Dependencies

```json
{
  "hyperdeck-connection": "^0.5.0"
}
```

## References

- [HyperDeck Ethernet Protocol](https://documents.blackmagicdesign.com/DeveloperManuals/HyperDeckEthernetProtocol.pdf)
- [hyperdeck-connection](https://github.com/nrkno/sofie-hyperdeck-connection)
- [RP-188 SMPTE Standard](https://ieeexplore.ieee.org/document/7291364)
