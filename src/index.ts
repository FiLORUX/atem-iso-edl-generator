/**
 * ATEM ISO EDL Generator
 *
 * Frame-accurate Edit Decision List generation from Blackmagic ATEM switchers.
 *
 * @module atem-iso-edl-generator
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import pino from 'pino';
import { parseConfig, type Config } from './core/config/schema.js';
import { AtemAdapter } from './adapters/atem/adapter.js';
import {
  type ProgramChangeEvent,
  type SwitchingEvent,
  serialiseEvent,
} from './core/events/types.js';
import { generateEdlFromEvents } from './generators/edl/cmx3600.js';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ============================================================================
// Logger Setup
// ============================================================================

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  },
});

// ============================================================================
// Application State
// ============================================================================

interface AppState {
  config: Config;
  atem: AtemAdapter | null;
  events: ProgramChangeEvent[];
  sessionId: string;
  startTime: Date;
}

const state: AppState = {
  config: null as unknown as Config,
  atem: null,
  events: [],
  sessionId: generateSessionId(),
  startTime: new Date(),
};

// ============================================================================
// Main Application
// ============================================================================

async function main(): Promise<void> {
  logger.info('ATEM ISO EDL Generator starting...');

  // Load configuration
  const configPath = process.env['CONFIG_PATH'] ?? './config/config.yaml';
  state.config = await loadConfig(configPath);
  logger.info({ host: state.config.atem.host }, 'Configuration loaded');

  // Ensure output directories exist
  await ensureDirectories(state.config);

  // Create ATEM adapter
  state.atem = new AtemAdapter({
    config: state.config.atem,
    inputs: state.config.inputs,
  });

  // Set up event handlers
  setupEventHandlers(state.atem);

  // Connect to ATEM
  logger.info({ host: state.config.atem.host }, 'Connecting to ATEM switcher...');
  try {
    await state.atem.connect();
  } catch (error) {
    logger.error({ error }, 'Failed to connect to ATEM');
    // Don't exit — adapter will attempt reconnection
  }

  // Handle shutdown signals
  setupShutdownHandlers();

  logger.info('ATEM ISO EDL Generator running. Press Ctrl+C to stop.');
}

// ============================================================================
// Configuration
// ============================================================================

async function loadConfig(configPath: string): Promise<Config> {
  const absolutePath = resolve(configPath);

  if (!existsSync(absolutePath)) {
    logger.error({ path: absolutePath }, 'Configuration file not found');
    logger.info('Copy config/config.example.yaml to config/config.yaml and edit with your settings');
    process.exit(1);
  }

  const content = await readFile(absolutePath, 'utf-8');
  const raw = parseYaml(content);

  const result = parseConfig(raw);
  return result;
}

async function ensureDirectories(config: Config): Promise<void> {
  const dirs = [
    config.edl.outputDirectory,
    config.logging.eventLogDirectory,
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
      logger.debug({ dir }, 'Created directory');
    }
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

function setupEventHandlers(atem: AtemAdapter): void {
  atem.on('connection', (event) => {
    if (event.state === 'connected') {
      logger.info({ device: event.deviceName }, 'Connected to ATEM');
    } else if (event.state === 'disconnected') {
      logger.warn({ device: event.deviceName }, 'Disconnected from ATEM');
    } else if (event.state === 'error') {
      logger.error({ device: event.deviceName, error: event.error }, 'ATEM connection error');
    }
    logEvent(event);
  });

  atem.on('programChange', (event) => {
    logger.info(
      {
        input: event.input.name,
        inputId: event.input.inputId,
        transition: event.transitionType,
      },
      'Program change'
    );
    state.events.push(event);
    logEvent(event);
  });

  atem.on('previewChange', (event) => {
    logger.debug(
      { input: event.input.name, inputId: event.input.inputId },
      'Preview change'
    );
    logEvent(event);
  });

  atem.on('transitionStart', (event) => {
    logger.debug(
      {
        from: event.fromInput.name,
        to: event.toInput.name,
        type: event.transitionType,
        frames: event.transitionFrames,
      },
      'Transition started'
    );
    logEvent(event);
  });

  atem.on('transitionComplete', (event) => {
    logger.debug({ input: event.input.name }, 'Transition complete');
    logEvent(event);
  });

  atem.on('error', (error) => {
    logger.error({ error: error.message }, 'ATEM adapter error');
  });
}

// ============================================================================
// Event Logging
// ============================================================================

async function logEvent(event: SwitchingEvent): Promise<void> {
  if (!state.config.logging.eventLog) return;

  const entry = serialiseEvent(event);
  const line = JSON.stringify(entry) + '\n';
  const date = new Date().toISOString().split('T')[0];
  const logPath = resolve(state.config.logging.eventLogDirectory, `events-${date}.jsonl`);

  try {
    await appendFile(logPath, line);
  } catch (error) {
    logger.error({ error, path: logPath }, 'Failed to write event log');
  }
}

// ============================================================================
// EDL Generation
// ============================================================================

async function generateAndSaveEdl(): Promise<string | null> {
  if (state.events.length === 0) {
    logger.warn('No events to generate EDL from');
    return null;
  }

  const edl = generateEdlFromEvents(state.events, {
    title: `${state.config.edl.defaultTitle}_${state.sessionId}`,
    frameRate: state.config.edl.frameRate,
    dropFrame: state.config.edl.dropFrame,
    includeComments: state.config.edl.includeComments,
  });

  const filename = `${state.config.edl.defaultTitle}_${state.sessionId}.edl`;
  const filepath = resolve(state.config.edl.outputDirectory, filename);

  await writeFile(filepath, edl);
  logger.info({ path: filepath, events: state.events.length }, 'EDL generated');

  return filepath;
}

// ============================================================================
// Shutdown
// ============================================================================

function setupShutdownHandlers(): void {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    // Generate final EDL
    if (state.events.length > 0) {
      logger.info('Generating final EDL before shutdown...');
      await generateAndSaveEdl();
    }

    // Disconnect from ATEM
    if (state.atem) {
      await state.atem.disconnect();
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ============================================================================
// Utilities
// ============================================================================

function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]!.replace(/-/g, '');
  const time = now.toTimeString().split(' ')[0]!.replace(/:/g, '');
  return `${date}_${time}`;
}

// ============================================================================
// Entry Point
// ============================================================================

main().catch((error) => {
  logger.fatal({ error }, 'Unhandled error');
  process.exit(1);
});
