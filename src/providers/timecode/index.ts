/**
 * Timecode Provider System
 *
 * Pluggable timecode acquisition with support for:
 * - HyperDeck (RP-188 embedded in SDI)
 * - System clock (fallback)
 *
 * @example
 * ```typescript
 * import { createHyperDeckWithFallback } from './providers/timecode';
 *
 * const manager = createHyperDeckWithFallback({
 *   host: '192.168.1.50',
 *   frameRate: 25,
 * });
 *
 * manager.on('update', (snapshot) => {
 *   console.log(`TC: ${snapshot.timecode} (${snapshot.source})`);
 * });
 *
 * await manager.start();
 * ```
 */

// ============================================================================
// Types
// ============================================================================

export type {
  // Core types
  TimecodeSource,
  TimecodeStatus,
  TransportState,
  TimecodeSnapshot,

  // Provider interface
  TimecodeProvider,
  TimecodeProviderEvents,

  // Configuration
  SystemClockProviderConfig,
  HyperDeckProviderConfig,
  ProviderConfig,
  TimecodeManagerConfig,

  // Utilities
  TimecodeComponents,
  TimecodeValidation,
} from './types.js';

// ============================================================================
// Manager
// ============================================================================

export {
  TimecodeManager,
  createTimecodeManager,
  createHyperDeckWithFallback,
} from './manager.js';

export type { TimecodeManagerEvents } from './manager.js';

// ============================================================================
// Providers
// ============================================================================

export {
  HyperDeckTimecodeProvider,
  createHyperDeckProvider,
} from './hyperdeck.js';

export {
  SystemClockTimecodeProvider,
  createSystemClockProvider,
} from './system-clock.js';

// ============================================================================
// Utilities
// ============================================================================

export {
  // Parsing
  parseTimecode,
  validateTimecode,

  // Formatting
  formatTimecodeFromComponents,
  formatTimecodeFromFrames,

  // Conversion
  timecodeToFrames,
  millisecondsToTimecode,
  dateToTimecode,

  // Comparison
  compareTimecodes,
  timecodesDifferenceFrames,

  // Arithmetic
  addFramesToTimecode,

  // Validation helpers
  supportsDropFrame,
  isValidTimecodeFormat,
  normaliseTimecode,
} from './utils.js';

// ============================================================================
// Config Bridge
// ============================================================================

export {
  createManagerConfigFromAppConfig,
  createTimecodeManagerFromConfig,
  startTimecodeManagerFromConfig,
} from './config-bridge.js';
