/**
 * DaVinci Resolve Project (.drp) generator module.
 *
 * Provides functionality for generating ATEM ISO-compatible project files
 * that can be imported directly into DaVinci Resolve for multicam editing.
 *
 * @example
 * ```typescript
 * import { generateDrp } from './generators/drp';
 *
 * const drpContent = generateDrp(timeline, {
 *   videoMode: '1080p25',
 *   sources: [
 *     { inputId: 1, name: 'Cam 1', volume: 'Rec', projectPath: '/ISO', filename: 'Cam1.mov' },
 *     { inputId: 2, name: 'Cam 2', volume: 'Rec', projectPath: '/ISO', filename: 'Cam2.mov' },
 *   ],
 * });
 * ```
 */

export {
  // Main generator function
  generateDrp,

  // Document building
  buildDrpDocument,
  buildHeader,
  buildEvent,

  // Serialisation
  serialiseDrp,
  parseDrp,

  // Utilities
  formatVideoMode,
  generateRecordingId,
  validateDrp,

  // Types
  type DrpSource,
  type DrpMixEffectBlock,
  type DrpHeader,
  type DrpEvent,
  type DrpDocument,
  type DrpOptions,
  type SourceMapping,
} from './resolve.js';
