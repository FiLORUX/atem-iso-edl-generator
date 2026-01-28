/**
 * ATEM ISO EDL Generator Application.
 *
 * Core application logic extracted for use by CLI and programmatic interfaces.
 *
 * @module atem-iso-edl-generator/app
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { pino, type Logger } from 'pino';
import { parseConfig, type Config } from './core/config/schema.js';
import { AtemAdapter } from './adapters/atem/adapter.js';
import {
  type ProgramChangeEvent,
  type SwitchingEvent,
  serialiseEvent,
} from './core/events/types.js';
import { generateEdlFromEvents } from './generators/edl/cmx3600.js';
import { createWebServer, type WebServer } from './web/server.js';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ============================================================================
// Logger Setup
// ============================================================================

/**
 * Create application logger with sensible defaults.
 */
export function createLogger(level?: string, prettyPrint = true): Logger {
  if (prettyPrint) {
    return pino({
      level: level ?? process.env['LOG_LEVEL'] ?? 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino({
    level: level ?? process.env['LOG_LEVEL'] ?? 'info',
  });
}

// ============================================================================
// Application State
// ============================================================================

export interface AppState {
  config: Config;
  atem: AtemAdapter | null;
  events: ProgramChangeEvent[];
  sessionId: string;
  startTime: Date;
  logger: Logger;
}

/**
 * Generate a unique session identifier based on current time.
 */
export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0]!.replace(/-/g, '');
  const time = now.toTimeString().split(' ')[0]!.replace(/:/g, '');
  return `${date}_${time}`;
}

/**
 * Create initial application state.
 */
export function createAppState(logger: Logger): AppState {
  return {
    config: null as unknown as Config,
    atem: null,
    events: [],
    sessionId: generateSessionId(),
    startTime: new Date(),
    logger,
  };
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Load and validate configuration from YAML file.
 */
export async function loadConfig(configPath: string, logger: Logger): Promise<Config> {
  const absolutePath = resolve(configPath);

  if (!existsSync(absolutePath)) {
    logger.error({ path: absolutePath }, 'Configuration file not found');
    logger.info('Copy config/config.example.yaml to config/config.yaml and edit with your settings');
    throw new Error(`Configuration file not found: ${absolutePath}`);
  }

  const content = await readFile(absolutePath, 'utf-8');
  const raw = parseYaml(content);

  const result = parseConfig(raw);
  return result;
}

/**
 * Ensure required output directories exist.
 */
export async function ensureDirectories(config: Config, logger: Logger): Promise<void> {
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

/**
 * Set up event handlers for ATEM adapter.
 */
export function setupEventHandlers(atem: AtemAdapter, state: AppState): void {
  const { logger } = state;

  atem.on('connection', (event) => {
    if (event.state === 'connected') {
      logger.info({ device: event.deviceName }, 'Connected to ATEM');
    } else if (event.state === 'disconnected') {
      logger.warn({ device: event.deviceName }, 'Disconnected from ATEM');
    } else if (event.state === 'error') {
      logger.error({ device: event.deviceName, error: event.error }, 'ATEM connection error');
    }
    logEvent(event, state).catch((err) => {
      logger.error({ error: err }, 'Failed to log connection event');
    });
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
    logEvent(event, state).catch((err) => {
      logger.error({ error: err }, 'Failed to log program change event');
    });
  });

  atem.on('previewChange', (event) => {
    logger.debug(
      { input: event.input.name, inputId: event.input.inputId },
      'Preview change'
    );
    logEvent(event, state).catch((err) => {
      logger.error({ error: err }, 'Failed to log preview change event');
    });
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
    logEvent(event, state).catch((err) => {
      logger.error({ error: err }, 'Failed to log transition start event');
    });
  });

  atem.on('transitionComplete', (event) => {
    logger.debug({ input: event.input.name }, 'Transition complete');
    logEvent(event, state).catch((err) => {
      logger.error({ error: err }, 'Failed to log transition complete event');
    });
  });

  atem.on('error', (error) => {
    logger.error({ error: error.message }, 'ATEM adapter error');
  });
}

// ============================================================================
// Event Logging
// ============================================================================

/**
 * Log event to JSONL file.
 */
export async function logEvent(event: SwitchingEvent, state: AppState): Promise<void> {
  if (!state.config.logging.eventLog) return;

  const entry = serialiseEvent(event);
  const line = JSON.stringify(entry) + '\n';
  const date = new Date().toISOString().split('T')[0];
  const logPath = resolve(state.config.logging.eventLogDirectory, `events-${date}.jsonl`);

  try {
    await appendFile(logPath, line);
  } catch (error) {
    state.logger.error({ error, path: logPath }, 'Failed to write event log');
  }
}

// ============================================================================
// EDL Generation
// ============================================================================

/**
 * Generate EDL from collected events and save to file.
 */
export async function generateAndSaveEdl(state: AppState): Promise<string | null> {
  const { logger, config, events, sessionId } = state;

  if (events.length === 0) {
    logger.warn('No events to generate EDL from');
    return null;
  }

  const edl = generateEdlFromEvents(events, {
    title: `${config.edl.defaultTitle}_${sessionId}`,
    frameRate: config.edl.frameRate,
    dropFrame: config.edl.dropFrame,
    includeComments: config.edl.includeComments,
  });

  const filename = `${config.edl.defaultTitle}_${sessionId}.edl`;
  const filepath = resolve(config.edl.outputDirectory, filename);

  await writeFile(filepath, edl);
  logger.info({ path: filepath, events: events.length }, 'EDL generated');

  return filepath;
}

// ============================================================================
// Application Lifecycle
// ============================================================================

export interface StartOptions {
  configPath?: string;
  /** Disable web server (useful for testing) */
  disableWeb?: boolean;
}

/**
 * Start the ATEM ISO EDL Generator application.
 * Returns a shutdown function for graceful termination.
 */
export async function startApp(options: StartOptions = {}): Promise<{
  state: AppState;
  webServer: WebServer | null;
  shutdown: () => Promise<void>;
}> {
  const logger = createLogger();
  const state = createAppState(logger);

  logger.info('ATEM ISO EDL Generator starting...');

  // Load configuration
  const configPath = options.configPath ?? process.env['CONFIG_PATH'] ?? './config/config.yaml';
  state.config = await loadConfig(configPath, logger);
  logger.info({ host: state.config.atem.host }, 'Configuration loaded');

  // Ensure output directories exist
  await ensureDirectories(state.config, logger);

  // Create ATEM adapter
  state.atem = new AtemAdapter({
    config: state.config.atem,
    inputs: state.config.inputs,
  });

  // Set up event handlers
  setupEventHandlers(state.atem, state);

  // Connect to ATEM
  logger.info({ host: state.config.atem.host }, 'Connecting to ATEM switcher...');
  try {
    await state.atem.connect();
  } catch (error) {
    logger.error({ error }, 'Failed to connect to ATEM');
    // Don't exit — adapter will attempt reconnection
  }

  // Start web server if enabled
  let webServer: WebServer | null = null;
  if (state.config.web.enabled && !options.disableWeb) {
    webServer = createWebServer({
      config: state.config.web,
      state,
      logger,
    });
    await webServer.start();
    logger.info(
      { host: state.config.web.host, port: state.config.web.port },
      'Web interface available'
    );
  }

  logger.info('ATEM ISO EDL Generator running. Press Ctrl+C to stop.');

  // Return shutdown function
  const shutdown = async () => {
    logger.info('Shutdown initiated');

    // Stop web server
    if (webServer) {
      await webServer.stop();
    }

    // Generate final EDL
    if (state.events.length > 0) {
      logger.info('Generating final EDL before shutdown...');
      await generateAndSaveEdl(state);
    }

    // Disconnect from ATEM
    if (state.atem) {
      await state.atem.disconnect();
    }

    logger.info('Shutdown complete');
  };

  return { state, webServer, shutdown };
}
