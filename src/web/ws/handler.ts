/**
 * WebSocket Handler for ATEM ISO EDL Generator.
 * Broadcasts real-time events to connected clients.
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server } from 'node:http';
import type { Logger } from 'pino';
import type { AppState } from '../../app.js';
import type { InputSource } from '../../core/events/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Message types sent from server to clients.
 */
export interface ServerMessage {
  type:
    | 'connection_status'
    | 'program_change'
    | 'event'
    | 'initial_state'
    | 'ping'
    | 'error';
  payload: Record<string, unknown>;
  timestamp: string;
}

/**
 * Message types received from clients.
 */
export interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'pong' | 'get_state';
  payload?: Record<string, unknown>;
}

/**
 * Extended WebSocket with metadata.
 */
interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  clientId: string;
  subscribedEvents: Set<string>;
}

// ============================================================================
// WebSocket Handler
// ============================================================================

export class WebSocketHandler {
  private readonly wss: WebSocketServer;
  private readonly state: AppState;
  private readonly logger: Logger;
  private readonly clients: Map<string, ExtendedWebSocket>;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private clientCounter = 0;

  constructor(server: Server, state: AppState, logger: Logger) {
    this.state = state;
    this.logger = logger.child({ module: 'websocket' });
    this.clients = new Map();

    // Create WebSocket server attached to HTTP server
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
    });

    this.setupEventHandlers();
    this.startHeartbeat();
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Broadcast connection status change to all clients.
   */
  broadcastConnectionStatus(
    device: 'atem' | 'hyperdeck',
    connectionState: 'connected' | 'disconnected' | 'error',
    error?: string
  ): void {
    const message: ServerMessage = {
      type: 'connection_status',
      payload: {
        device,
        state: connectionState,
        error,
      },
      timestamp: new Date().toISOString(),
    };

    this.broadcast(message);
  }

  /**
   * Broadcast program input change to all clients.
   */
  broadcastProgramChange(input: InputSource): void {
    const message: ServerMessage = {
      type: 'program_change',
      payload: {
        inputId: input.inputId,
        name: input.name,
        reelName: input.reelName,
      },
      timestamp: new Date().toISOString(),
    };

    this.broadcast(message);
  }

  /**
   * Broadcast generic event to all clients.
   */
  broadcastEvent(event: {
    type: string;
    timestamp: string;
    data: Record<string, unknown>;
  }): void {
    const message: ServerMessage = {
      type: 'event',
      payload: {
        eventType: event.type,
        eventTimestamp: event.timestamp,
        data: event.data,
      },
      timestamp: new Date().toISOString(),
    };

    this.broadcast(message);
  }

  /**
   * Get count of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Shutdown WebSocket server.
   */
  shutdown(): void {
    this.logger.info('Shutting down WebSocket server');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.close(1001, 'Server shutting down');
    }

    this.clients.clear();
    this.wss.close();
  }

  // --------------------------------------------------------------------------
  // Private Methods
  // --------------------------------------------------------------------------

  /**
   * Set up WebSocket server event handlers.
   */
  private setupEventHandlers(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws as ExtendedWebSocket);
    });

    this.wss.on('error', (error) => {
      this.logger.error({ error: error.message }, 'WebSocket server error');
    });
  }

  /**
   * Handle new client connection.
   */
  private handleConnection(ws: ExtendedWebSocket): void {
    // Assign client ID
    const clientId = `client-${String(++this.clientCounter)}`;
    ws.clientId = clientId;
    ws.isAlive = true;
    ws.subscribedEvents = new Set(['all']); // Subscribe to all by default

    this.clients.set(clientId, ws);
    this.logger.info({ clientId, clients: this.clients.size }, 'Client connected');

    // Send initial state
    this.sendInitialState(ws);

    // Handle messages
    ws.on('message', (data: RawData) => {
      this.handleMessage(ws, data);
    });

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle close
    ws.on('close', (code, reason) => {
      this.clients.delete(clientId);
      this.logger.info(
        {
          clientId,
          code,
          reason: reason.toString(),
          clients: this.clients.size,
        },
        'Client disconnected'
      );
    });

    // Handle errors
    ws.on('error', (error) => {
      this.logger.error({ clientId, error: error.message }, 'Client error');
      this.clients.delete(clientId);
    });
  }

  /**
   * Send initial state to newly connected client.
   */
  private sendInitialState(ws: ExtendedWebSocket): void {
    // Get current program/preview
    let currentProgram: { inputId: number; name: string; reelName: string } | null = null;
    let currentPreview: { inputId: number; name: string; reelName: string } | null = null;

    if (this.state.atem) {
      const programId = this.state.atem.getCurrentProgram();
      const previewId = this.state.atem.getCurrentPreview();

      if (programId !== null) {
        const config = this.state.config.inputs[programId];
        currentProgram = {
          inputId: programId,
          name: config?.name ?? `Input ${String(programId)}`,
          reelName: config?.reelName ?? `IN${String(programId)}`,
        };
      }

      if (previewId !== null) {
        const config = this.state.config.inputs[previewId];
        currentPreview = {
          inputId: previewId,
          name: config?.name ?? `Input ${String(previewId)}`,
          reelName: config?.reelName ?? `IN${String(previewId)}`,
        };
      }
    }

    // Get recent events (last 50)
    const recentEvents = this.state.events.slice(-50).map((event) => ({
      type: event.type,
      timestamp: event.timestamp.wallClock,
      input: event.input,
      transitionType: event.transitionType,
    }));

    // Build inputs array
    const inputs = Object.entries(this.state.config.inputs).map(([id, config]) => ({
      inputId: parseInt(id, 10),
      name: config.name,
      reelName: config.reelName,
    }));

    // Build hyperdecks array
    const hyperdecks = this.state.config.hyperdecks.map((hd) => ({
      name: hd.name,
      host: hd.host,
      port: hd.port,
      inputMapping: hd.inputMapping,
      enabled: hd.enabled,
      frameOffset: hd.frameOffset,
    }));

    // Build config with full settings
    const config: Record<string, unknown> = {
      atem: {
        host: this.state.config.atem.host,
        mixEffect: this.state.config.atem.mixEffect,
        frameOffset: this.state.config.atem.frameOffset ?? 0,
      },
      timecode: {
        frameRate: this.state.config.edl.frameRate,
        dropFrame: this.state.config.edl.dropFrame,
        startTimecode: this.state.config.timecode.startTimecode ?? '01:00:00:00',
        source: this.state.config.timecode.source,
      },
    };

    // Add HyperDeck timecode config if present
    if (this.state.config.timecode.hyperdeck) {
      (config.timecode as Record<string, unknown>).hyperdeck = {
        host: this.state.config.timecode.hyperdeck.host,
        port: this.state.config.timecode.hyperdeck.port ?? 9993,
      };
    }

    const message: ServerMessage = {
      type: 'initial_state',
      payload: {
        session: {
          id: this.state.sessionId,
          startTime: this.state.startTime.toISOString(),
        },
        atem: {
          connected: this.state.atem?.isConnected() ?? false,
          host: this.state.config.atem.host,
          currentProgram,
          currentPreview,
        },
        eventCount: this.state.events.length,
        recentEvents,
        config,
        inputs,
        hyperdecks,
        recording: {
          active: this.state.recording?.active ?? false,
          startTime: this.state.recording?.startTime?.toISOString() ?? null,
        },
      },
      timestamp: new Date().toISOString(),
    };

    this.send(ws, message);
  }

  /**
   * Handle incoming message from client.
   */
  private handleMessage(ws: ExtendedWebSocket, data: RawData): void {
    try {
      // RawData can be string, Buffer, or Buffer[]. Handle all cases.
      let dataStr: string;
      if (typeof data === 'string') {
        dataStr = data;
      } else if (Buffer.isBuffer(data)) {
        dataStr = data.toString('utf-8');
      } else if (Array.isArray(data)) {
        dataStr = Buffer.concat(data).toString('utf-8');
      } else {
        // ArrayBuffer
        dataStr = Buffer.from(data).toString('utf-8');
      }
      const message = JSON.parse(dataStr) as ClientMessage;

      switch (message.type) {
        case 'pong':
          ws.isAlive = true;
          break;

        case 'get_state':
          this.sendInitialState(ws);
          break;

        case 'subscribe':
          if (message.payload?.events && Array.isArray(message.payload.events)) {
            ws.subscribedEvents = new Set(message.payload.events as string[]);
            this.logger.debug(
              { clientId: ws.clientId, events: Array.from(ws.subscribedEvents) },
              'Client subscribed to events'
            );
          }
          break;

        case 'unsubscribe':
          if (message.payload?.events && Array.isArray(message.payload.events)) {
            for (const event of message.payload.events as string[]) {
              ws.subscribedEvents.delete(event);
            }
          }
          break;

        default:
          this.logger.warn({ clientId: ws.clientId, type: message.type }, 'Unknown message type');
      }
    } catch (error) {
      this.logger.error(
        { clientId: ws.clientId, error: (error as Error).message },
        'Failed to parse client message'
      );

      this.send(ws, {
        type: 'error',
        payload: { message: 'Invalid message format' },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Send message to single client.
   */
  private send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all connected clients.
   */
  private broadcast(message: ServerMessage): void {
    const messageStr = JSON.stringify(message);

    for (const client of this.clients.values()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  }

  /**
   * Start heartbeat interval to detect dead connections.
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, ws] of this.clients.entries()) {
        if (!ws.isAlive) {
          this.logger.info({ clientId }, 'Terminating inactive client');
          ws.terminate();
          this.clients.delete(clientId);
          continue;
        }

        ws.isAlive = false;
        ws.ping();
      }
    }, 30000); // 30 second heartbeat
  }
}
