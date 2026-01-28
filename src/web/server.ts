/**
 * Web Server for ATEM ISO EDL Generator.
 * Serves static files and provides API endpoints for status, events, and EDL generation.
 * Includes WebSocket server for real-time event streaming.
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createServer, type Server } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Logger } from 'pino';
import type { AppState } from '../app.js';
import { createApiRouter } from './api/routes.js';
import { WebSocketHandler } from './ws/handler.js';
import type { WebConfig } from '../core/config/schema.js';
import type {
  ConnectionEvent,
  ProgramChangeEvent,
  PreviewChangeEvent,
  TransitionStartEvent,
  TransitionCompleteEvent,
} from '../core/events/types.js';

// ============================================================================
// Types
// ============================================================================

export interface WebServerOptions {
  config: WebConfig;
  state: AppState;
  logger: Logger;
}

export interface WebServer {
  app: Express;
  server: Server;
  wsHandler: WebSocketHandler;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

// ============================================================================
// Server Factory
// ============================================================================

/**
 * Create and configure the web server.
 * Sets up Express app, HTTP server, and WebSocket handler.
 */
export function createWebServer(options: WebServerOptions): WebServer {
  const { config, state, logger } = options;
  const webLogger = logger.child({ module: 'web' });

  // Create Express app
  const app = express();

  // Parse JSON bodies
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    webLogger.debug({ method: req.method, path: req.path }, 'HTTP request');
    next();
  });

  // Basic auth if configured
  if (config.auth?.enabled && config.auth.username && config.auth.password) {
    const expectedAuth = Buffer.from(
      `${config.auth.username}:${config.auth.password}`
    ).toString('base64');

    app.use((req: Request, res: Response, next: NextFunction) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Basic ')) {
        const providedAuth = authHeader.slice(6);
        if (providedAuth === expectedAuth) {
          next();
          return;
        }
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="ATEM ISO EDL Generator"');
      res.status(401).json({ error: 'Authentication required' });
    });
  }

  // API routes
  const apiRouter = createApiRouter(state);
  app.use('/api', apiRouter);

  // Static file serving
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const staticPath = resolve(__dirname, 'static');
  app.use(express.static(staticPath));

  // SPA fallback - serve index.html for unmatched routes
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(resolve(staticPath, 'index.html'));
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    webLogger.error({ error: err.message, stack: err.stack }, 'HTTP error');
    res.status(500).json({ error: 'Internal server error' });
  });

  // Create HTTP server
  const server = createServer(app);

  // Create WebSocket handler
  const wsHandler = new WebSocketHandler(server, state, webLogger);

  // Wire up event broadcasting
  wireEventBroadcasting(state, wsHandler, webLogger);

  return {
    app,
    server,
    wsHandler,
    start: async () => {
      return new Promise((resolve, reject) => {
        server.listen(config.port, config.host, () => {
          webLogger.info(
            { host: config.host, port: config.port },
            'Web server listening'
          );
          resolve();
        });
        server.on('error', reject);
      });
    },
    stop: async () => {
      wsHandler.shutdown();
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            webLogger.info('Web server stopped');
            resolve();
          }
        });
      });
    },
  };
}

// ============================================================================
// Event Broadcasting
// ============================================================================

/**
 * Wire up ATEM adapter events to WebSocket broadcasting.
 */
function wireEventBroadcasting(
  state: AppState,
  wsHandler: WebSocketHandler,
  logger: Logger
): void {
  const { atem } = state;

  if (!atem) {
    logger.warn('No ATEM adapter available for event broadcasting');
    return;
  }

  // Connection events
  atem.on('connection', (event: ConnectionEvent) => {
    wsHandler.broadcastConnectionStatus(event.device, event.state, event.error);

    // Broadcast as general event too
    wsHandler.broadcastEvent({
      type: event.type,
      timestamp: event.timestamp.wallClock,
      data: {
        device: event.device,
        deviceName: event.deviceName,
        state: event.state,
        error: event.error,
      },
    });
  });

  // Program change events
  atem.on('programChange', (event: ProgramChangeEvent) => {
    wsHandler.broadcastProgramChange(event.input);

    wsHandler.broadcastEvent({
      type: event.type,
      timestamp: event.timestamp.wallClock,
      data: {
        input: event.input,
        previousInput: event.previousInput,
        transitionType: event.transitionType,
        transitionFrames: event.transitionFrames,
      },
    });
  });

  // Preview change events
  atem.on('previewChange', (event: PreviewChangeEvent) => {
    wsHandler.broadcastEvent({
      type: event.type,
      timestamp: event.timestamp.wallClock,
      data: {
        input: event.input,
        previousInput: event.previousInput,
      },
    });
  });

  // Transition events
  atem.on('transitionStart', (event: TransitionStartEvent) => {
    wsHandler.broadcastEvent({
      type: event.type,
      timestamp: event.timestamp.wallClock,
      data: {
        transitionType: event.transitionType,
        transitionFrames: event.transitionFrames,
        fromInput: event.fromInput,
        toInput: event.toInput,
      },
    });
  });

  atem.on('transitionComplete', (event: TransitionCompleteEvent) => {
    wsHandler.broadcastEvent({
      type: event.type,
      timestamp: event.timestamp.wallClock,
      data: {
        transitionType: event.transitionType,
        transitionFrames: event.transitionFrames,
        input: event.input,
      },
    });
  });

  logger.info('Event broadcasting wired to WebSocket handler');
}
