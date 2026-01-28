/**
 * ATEM ISO EDL Generator
 *
 * Frame-accurate Edit Decision List generation from Blackmagic ATEM switchers.
 *
 * This file provides backward compatibility. For programmatic usage, import
 * from './app.js' directly. For CLI usage, run './cli.js'.
 *
 * @module atem-iso-edl-generator
 */

// Re-export app functions for programmatic usage
export {
  startApp,
  createLogger,
  createAppState,
  generateSessionId,
  loadConfig,
  ensureDirectories,
  setupEventHandlers,
  logEvent,
  generateAndSaveEdl,
  type AppState,
  type StartOptions,
} from './app.js';

// Re-export core types
export type { Config } from './core/config/schema.js';
export type {
  SwitchingEvent,
  ProgramChangeEvent,
  PreviewChangeEvent,
  TransitionStartEvent,
  TransitionCompleteEvent,
  ConnectionEvent,
  SessionEvent,
  Timestamp,
  InputSource,
  TransitionType,
} from './core/events/types.js';

// Re-export EDL generator
export {
  generateEdl,
  generateEdlFromEvents,
  buildEdlEvents,
  validateEdl,
  type EdlDocument,
  type EdlEvent,
  type EdlComment,
  type GeneratorOptions,
} from './generators/edl/cmx3600.js';

// Re-export FCP7 XML generator
export {
  generateFcp7Xml,
  generateFcp7XmlFromEvents,
  buildSequenceXml,
  buildClipitemXml,
  buildTransitionXml,
  buildRateXml,
  encodePathUrl,
  framesToTimecodeString,
  isNtscFrameRate,
  getTimebase,
  validateFcp7Options,
  type Fcp7Options,
  type Fcp7Clip,
  type Fcp7Transition,
} from './generators/xml/fcp7.js';

// Re-export web server
export {
  createWebServer,
  type WebServer,
  type WebServerOptions,
} from './web/server.js';

// Default export: start application (for backward compatibility)
import { startApp } from './app.js';

const main = async (): Promise<void> => {
  const { shutdown } = await startApp();

  const handleSignal = async (signal: string) => {
    console.log(`\n${signal} received`);
    await shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
};

// Only run if this is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
