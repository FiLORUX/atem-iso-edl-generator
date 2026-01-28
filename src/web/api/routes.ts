/**
 * API Route Handlers for ATEM ISO EDL Generator.
 * Provides endpoints for status, events, EDL generation, recording control,
 * configuration, and health checks.
 */

import { Router, type Request, type Response } from 'express';
import type { AppState } from '../../app.js';
import { generateEdlFromEvents } from '../../generators/edl/cmx3600.js';
import { generateDrp, type DrpOptions, type SourceMapping } from '../../generators/drp/resolve.js';
import { generateFcp7XmlFromEvents, type Fcp7Options } from '../../generators/xml/fcp7.js';
import { TimelineBuilder } from '../../core/timeline/model.js';
import { serialiseEvent } from '../../core/events/types.js';

// ============================================================================
// Types
// ============================================================================

type ExportFormat = 'cmx3600' | 'resolve' | 'fcpxml';

interface StatusResponse {
  session: {
    id: string;
    startTime: string;
    uptime: number;
  };
  atem: {
    connected: boolean;
    host: string;
    currentProgram: {
      inputId: number;
      name: string;
      reelName: string;
    } | null;
    currentPreview: {
      inputId: number;
      name: string;
      reelName: string;
    } | null;
  };
  events: {
    count: number;
    lastEvent: string | null;
  };
  config: {
    atem: {
      host: string;
      mixEffect: number;
      frameOffset: number;
    };
    timecode: {
      frameRate: number;
      dropFrame: boolean;
      startTimecode: string;
      source: string;
      hyperdeck?: {
        host: string;
        port: number;
      };
    };
  };
  inputs: Array<{
    inputId: number;
    name: string;
    reelName: string;
  }>;
  hyperdecks: Array<{
    name: string;
    host: string;
    port: number;
    inputMapping: number;
    enabled: boolean;
    frameOffset: number;
  }>;
  recording: {
    active: boolean;
    startTime: string | null;
  };
}

interface EventsResponse {
  events: {
    id: string;
    type: string;
    timestamp: {
      wallClock: string;
      sequence: number;
    };
    data: Record<string, unknown>;
  }[];
  total: number;
  offset: number;
  limit: number;
}

interface EdlGenerateRequest {
  title?: string;
  includeComments?: boolean;
  format?: ExportFormat;
}

interface EdlGenerateResponse {
  content: string;
  filename: string;
  eventCount: number;
  format: ExportFormat;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    atem: {
      status: 'up' | 'down';
      host: string;
    };
    events: {
      count: number;
    };
  };
}

interface ConfigUpdateRequest {
  atem?: {
    host?: string;
    meIndex?: number;
    mixEffect?: number;
    frameOffset?: number;
  };
  timecode?: {
    frameRate?: number;
    dropFrame?: boolean;
    startTimecode?: string;
    source?: string;
    hyperdeck?: {
      host: string;
      port?: number;
    };
  };
  inputs?: Array<{
    inputId: number;
    name: string;
    reelName: string;
  }>;
  hyperdecks?: Array<{
    name: string;
    host: string;
    port?: number;
    inputMapping: number;
    enabled?: boolean;
    frameOffset?: number;
  }>;
}

interface RecordingResponse {
  recording: boolean;
  startTime: string | null;
  eventCount: number;
}

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Create API router with all endpoints.
 */
export function createApiRouter(state: AppState): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // Status & Health
  // -------------------------------------------------------------------------

  // GET /api/status - Return connection states and current status
  router.get('/status', (_req: Request, res: Response) => {
    const status = buildStatusResponse(state);
    res.json(status);
  });

  // GET /api/health - Return health check
  router.get('/health', (_req: Request, res: Response) => {
    const health = buildHealthResponse(state);
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  // GET /api/events - Return recent events
  router.get('/events', (req: Request, res: Response) => {
    const limitParam = req.query.limit as string | undefined;
    const offsetParam = req.query.offset as string | undefined;
    const limit = Math.min(parseInt(limitParam ?? '100', 10) || 100, 500);
    const offset = parseInt(offsetParam ?? '0', 10) || 0;

    const events = buildEventsResponse(state, limit, offset);
    res.json(events);
  });

  // -------------------------------------------------------------------------
  // EDL Generation & Export
  // -------------------------------------------------------------------------

  // GET /api/edl/generate - Generate and return EDL content (supports query params)
  router.get('/edl/generate', (req: Request, res: Response) => {
    if (state.events.length === 0) {
      res.status(400).json({
        error: 'No events to generate EDL from',
        eventCount: 0,
      });
      return;
    }

    const format = (req.query.format as ExportFormat) || 'cmx3600';
    const title = (req.query.title as string) || state.config.edl.defaultTitle;
    const includeComments = req.query.comments !== 'false';
    const includeClipNames = req.query.clipNames !== 'false';

    try {
      const result = generateExport(state, {
        format,
        title,
        includeComments,
        includeClipNames,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Export generation failed',
      });
    }
  });

  // POST /api/edl/generate - Generate and return EDL content (supports body)
  router.post('/edl/generate', (req: Request, res: Response) => {
    const body = req.body as EdlGenerateRequest;

    if (state.events.length === 0) {
      res.status(400).json({
        error: 'No events to generate EDL from',
        eventCount: 0,
      });
      return;
    }

    const format = body.format || 'cmx3600';
    const title = body.title || state.config.edl.defaultTitle;

    try {
      const result = generateExport(state, {
        format,
        title,
        includeComments: body.includeComments ?? true,
        includeClipNames: true,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Export generation failed',
      });
    }
  });

  // GET /api/edl/download - Download EDL as file
  router.get('/edl/download', (req: Request, res: Response) => {
    if (state.events.length === 0) {
      res.status(400).json({
        error: 'No events to generate EDL from',
        eventCount: 0,
      });
      return;
    }

    const format = (req.query.format as ExportFormat) || 'cmx3600';
    const titleParam = req.query.title as string | undefined;
    const title = titleParam ?? state.config.edl.defaultTitle;
    const includeComments = req.query.comments !== 'false';
    const includeClipNames = req.query.clipNames !== 'false';

    try {
      const result = generateExport(state, {
        format,
        title,
        includeComments,
        includeClipNames,
      });

      const contentType = format === 'fcpxml' ? 'application/xml' : 'text/plain';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.send(result.content);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Export generation failed',
      });
    }
  });

  // -------------------------------------------------------------------------
  // Recording Control
  // -------------------------------------------------------------------------

  // POST /api/recording/start - Start recording
  router.post('/recording/start', (_req: Request, res: Response) => {
    if (state.recording?.active) {
      res.status(400).json({
        error: 'Recording already active',
        recording: true,
        startTime: state.recording.startTime?.toISOString() ?? null,
      });
      return;
    }

    // Initialize recording state if not present
    if (!state.recording) {
      (state as AppState & { recording: RecordingState }).recording = {
        active: false,
        startTime: null,
      };
    }

    state.recording!.active = true;
    state.recording!.startTime = new Date();

    state.logger.info('Recording started');

    res.json({
      recording: true,
      startTime: state.recording!.startTime.toISOString(),
      eventCount: state.events.length,
    } satisfies RecordingResponse);
  });

  // POST /api/recording/stop - Stop recording
  router.post('/recording/stop', (_req: Request, res: Response) => {
    if (!state.recording?.active) {
      res.status(400).json({
        error: 'Recording not active',
        recording: false,
        startTime: null,
      });
      return;
    }

    state.recording.active = false;
    const startTime = state.recording.startTime;
    state.recording.startTime = null;

    state.logger.info({ eventCount: state.events.length }, 'Recording stopped');

    res.json({
      recording: false,
      startTime: startTime?.toISOString() ?? null,
      eventCount: state.events.length,
    } satisfies RecordingResponse);
  });

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  // GET /api/config - Get current config (sanitised)
  router.get('/config', (_req: Request, res: Response) => {
    const sanitisedConfig = buildConfigResponse(state);
    res.json(sanitisedConfig);
  });

  // POST /api/config - Update configuration
  router.post('/config', (req: Request, res: Response) => {
    const body = req.body as ConfigUpdateRequest;

    try {
      // Update ATEM settings (note: requires restart for host change)
      if (body.atem) {
        if (body.atem.host !== undefined) {
          state.config.atem.host = body.atem.host;
        }
        // Accept both meIndex and mixEffect
        if (body.atem.meIndex !== undefined) {
          state.config.atem.mixEffect = body.atem.meIndex;
        }
        if (body.atem.mixEffect !== undefined) {
          state.config.atem.mixEffect = body.atem.mixEffect;
        }
        if (body.atem.frameOffset !== undefined) {
          state.config.atem.frameOffset = body.atem.frameOffset;
        }
      }

      // Update EDL/timecode settings
      if (body.timecode) {
        if (body.timecode.frameRate !== undefined) {
          const validRates = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60] as const;
          const rate = validRates.find((r) => r === body.timecode!.frameRate);
          if (rate) {
            state.config.edl.frameRate = rate;
          }
        }
        if (body.timecode.dropFrame !== undefined) {
          state.config.edl.dropFrame = body.timecode.dropFrame;
        }
        if (body.timecode.startTimecode !== undefined) {
          state.config.timecode.startTimecode = body.timecode.startTimecode;
        }
        if (body.timecode.source !== undefined) {
          if (body.timecode.source === 'system' || body.timecode.source === 'hyperdeck') {
            state.config.timecode.source = body.timecode.source;
          }
        }
        // Update HyperDeck timecode source config
        if (body.timecode.hyperdeck !== undefined) {
          if (!state.config.timecode.hyperdeck) {
            state.config.timecode.hyperdeck = {
              host: body.timecode.hyperdeck.host,
              port: body.timecode.hyperdeck.port ?? 9993,
              pollRateHz: 10,
              useNotifications: true,
              requireSdiSource: true,
              connectionTimeoutMs: 5000,
              reconnect: {
                enabled: true,
                maxAttempts: 0,
                initialDelayMs: 1000,
                maxDelayMs: 30000,
              },
            };
          } else {
            state.config.timecode.hyperdeck.host = body.timecode.hyperdeck.host;
            if (body.timecode.hyperdeck.port !== undefined) {
              state.config.timecode.hyperdeck.port = body.timecode.hyperdeck.port;
            }
          }
        }
      }

      // Update HyperDeck configurations
      if (body.hyperdecks && Array.isArray(body.hyperdecks)) {
        state.config.hyperdecks = body.hyperdecks.map((hd) => ({
          name: hd.name,
          host: hd.host,
          port: hd.port ?? 9993,
          inputMapping: hd.inputMapping,
          enabled: hd.enabled ?? true,
          frameOffset: hd.frameOffset ?? 0,
        }));
      }

      // Update input mappings
      if (body.inputs && Array.isArray(body.inputs)) {
        const newInputs: Record<number, { name: string; reelName: string; filePrefix: string | null }> = {};
        for (const input of body.inputs) {
          if (input.inputId && input.name) {
            newInputs[input.inputId] = {
              name: input.name,
              reelName: input.reelName || `IN${input.inputId}`,
              filePrefix: null,
            };
          }
        }
        state.config.inputs = newInputs;
      }

      state.logger.info('Configuration updated via API');

      res.json({
        success: true,
        config: buildConfigResponse(state),
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Configuration update failed',
      });
    }
  });

  // POST /api/config/reset - Reset to defaults
  router.post('/config/reset', (_req: Request, res: Response) => {
    // Reset to sensible defaults
    state.config.edl.frameRate = 25;
    state.config.edl.dropFrame = false;
    state.config.timecode.startTimecode = '01:00:00:00';
    state.config.edl.defaultTitle = 'PROGRAMME';

    state.logger.info('Configuration reset to defaults');

    res.json({
      success: true,
      config: buildConfigResponse(state),
    });
  });

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  // GET /api/inputs - Return configured inputs
  router.get('/inputs', (_req: Request, res: Response) => {
    const inputs = Object.entries(state.config.inputs).map(([id, config]) => ({
      inputId: parseInt(id, 10),
      name: config.name,
      reelName: config.reelName,
    }));
    res.json({ inputs });
  });

  return router;
}

// ============================================================================
// Recording State Type
// ============================================================================

interface RecordingState {
  active: boolean;
  startTime: Date | null;
}

// Extend AppState to include recording
declare module '../../app.js' {
  interface AppState {
    recording?: RecordingState;
  }
}

// ============================================================================
// Export Generation
// ============================================================================

interface ExportOptions {
  format: ExportFormat;
  title: string;
  includeComments: boolean;
  includeClipNames: boolean;
}

/**
 * Generate export in the specified format.
 */
function generateExport(state: AppState, options: ExportOptions): EdlGenerateResponse {
  const { format, title, includeComments } = options;
  const fullTitle = `${title}_${state.sessionId}`;
  const frameRate = state.config.edl.frameRate;
  const dropFrame = state.config.edl.dropFrame;

  let content: string;
  let filename: string;

  switch (format) {
    case 'resolve': {
      // Build timeline from events
      const builder = new TimelineBuilder();
      const timeline = builder.fromProgramChanges(state.events, {
        frameRate,
        dropFrame,
        title: fullTitle,
      });

      // Build source mappings from config inputs
      const sources: SourceMapping[] = Object.entries(state.config.inputs).map(
        ([id, config]) => ({
          inputId: parseInt(id, 10),
          name: config.name,
          volume: 'Macintosh HD',
          projectPath: 'Recordings',
          filename: `${config.reelName}.mov`,
        })
      );

      const drpOptions: DrpOptions = {
        sources,
        videoMode: `${frameRate}p`,
        defaultVolume: 'Macintosh HD',
        defaultProjectPath: 'Recordings',
      };

      content = generateDrp(timeline, drpOptions);
      filename = `${fullTitle}.drp`;
      break;
    }

    case 'fcpxml': {
      const fcp7Options: Fcp7Options = {
        title: fullTitle,
        frameRate,
        dropFrame,
        width: 1920,
        height: 1080,
      };

      content = generateFcp7XmlFromEvents(state.events, fcp7Options);
      filename = `${fullTitle}.xml`;
      break;
    }

    case 'cmx3600':
    default: {
      content = generateEdlFromEvents(state.events, {
        title: fullTitle,
        frameRate,
        dropFrame,
        includeComments,
      });
      filename = `${fullTitle}.edl`;
      break;
    }
  }

  return {
    content,
    filename,
    eventCount: state.events.length,
    format,
  };
}

// ============================================================================
// Response Builders
// ============================================================================

/**
 * Build status response from application state.
 */
function buildStatusResponse(state: AppState): StatusResponse {
  const now = new Date();
  const uptimeMs = now.getTime() - state.startTime.getTime();

  // Get current program/preview from ATEM adapter
  let currentProgram: StatusResponse['atem']['currentProgram'] = null;
  let currentPreview: StatusResponse['atem']['currentPreview'] = null;

  if (state.atem) {
    const programId = state.atem.getCurrentProgram();
    const previewId = state.atem.getCurrentPreview();

    if (programId !== null) {
      const config = state.config.inputs[programId];
      currentProgram = {
        inputId: programId,
        name: config?.name ?? `Input ${String(programId)}`,
        reelName: config?.reelName ?? `IN${String(programId)}`,
      };
    }

    if (previewId !== null) {
      const config = state.config.inputs[previewId];
      currentPreview = {
        inputId: previewId,
        name: config?.name ?? `Input ${String(previewId)}`,
        reelName: config?.reelName ?? `IN${String(previewId)}`,
      };
    }
  }

  // Get last event timestamp
  let lastEvent: string | null = null;
  if (state.events.length > 0) {
    const last = state.events[state.events.length - 1];
    if (last) {
      lastEvent = last.timestamp.wallClock;
    }
  }

  return {
    session: {
      id: state.sessionId,
      startTime: state.startTime.toISOString(),
      uptime: Math.floor(uptimeMs / 1000),
    },
    atem: {
      connected: state.atem?.isConnected() ?? false,
      host: state.config.atem.host,
      currentProgram,
      currentPreview,
    },
    events: {
      count: state.events.length,
      lastEvent,
    },
    config: {
      atem: {
        host: state.config.atem.host,
        mixEffect: state.config.atem.mixEffect,
        frameOffset: state.config.atem.frameOffset ?? 0,
      },
      timecode: {
        frameRate: state.config.edl.frameRate,
        dropFrame: state.config.edl.dropFrame,
        startTimecode: state.config.timecode.startTimecode ?? '01:00:00:00',
        source: state.config.timecode.source,
        ...(state.config.timecode.hyperdeck && {
          hyperdeck: {
            host: state.config.timecode.hyperdeck.host,
            port: state.config.timecode.hyperdeck.port ?? 9993,
          },
        }),
      },
    },
    inputs: Object.entries(state.config.inputs).map(([id, config]) => ({
      inputId: parseInt(id, 10),
      name: config.name,
      reelName: config.reelName,
    })),
    hyperdecks: state.config.hyperdecks.map((hd) => ({
      name: hd.name,
      host: hd.host,
      port: hd.port,
      inputMapping: hd.inputMapping,
      enabled: hd.enabled,
      frameOffset: hd.frameOffset,
    })),
    recording: {
      active: state.recording?.active ?? false,
      startTime: state.recording?.startTime?.toISOString() ?? null,
    },
  };
}

/**
 * Build events response with pagination.
 */
function buildEventsResponse(state: AppState, limit: number, offset: number): EventsResponse {
  const total = state.events.length;

  // Get events in reverse chronological order (newest first)
  const events = state.events
    .slice()
    .reverse()
    .slice(offset, offset + limit)
    .map((event) => {
      const serialised = serialiseEvent(event);
      return {
        id: serialised.id,
        type: serialised.type,
        timestamp: {
          wallClock: serialised.timestamp.wallClock,
          sequence: serialised.timestamp.sequence,
        },
        data: serialised.data as Record<string, unknown>,
      };
    });

  return {
    events,
    total,
    offset,
    limit,
  };
}

/**
 * Build health check response.
 */
function buildHealthResponse(state: AppState): HealthResponse {
  const atemUp = state.atem?.isConnected() ?? false;

  let status: HealthResponse['status'];
  if (atemUp) {
    status = 'healthy';
  } else if (state.events.length > 0) {
    // If we have events but ATEM disconnected, we're degraded
    status = 'degraded';
  } else {
    status = 'unhealthy';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    checks: {
      atem: {
        status: atemUp ? 'up' : 'down',
        host: state.config.atem.host,
      },
      events: {
        count: state.events.length,
      },
    },
  };
}

/**
 * Build sanitised config response for GUI.
 */
function buildConfigResponse(state: AppState): {
  atem: { host: string; meIndex: number };
  timecode: {
    frameRate: number;
    dropFrame: boolean;
    startTimecode: string;
    source: string;
  };
  inputs: Array<{ inputId: number; name: string; reelName: string }>;
} {
  return {
    atem: {
      host: state.config.atem.host,
      meIndex: state.config.atem.mixEffect,
    },
    timecode: {
      frameRate: state.config.edl.frameRate,
      dropFrame: state.config.edl.dropFrame,
      startTimecode: state.config.timecode.startTimecode ?? '01:00:00:00',
      source: state.config.timecode.source,
    },
    inputs: Object.entries(state.config.inputs).map(([id, config]) => ({
      inputId: parseInt(id, 10),
      name: config.name,
      reelName: config.reelName,
    })),
  };
}
