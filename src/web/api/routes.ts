/**
 * API Route Handlers for ATEM ISO EDL Generator.
 * Provides endpoints for status, events, EDL generation, and health checks.
 */

import { Router, type Request, type Response } from 'express';
import type { AppState } from '../../app.js';
import { generateEdlFromEvents } from '../../generators/edl/cmx3600.js';
import { serialiseEvent } from '../../core/events/types.js';

// ============================================================================
// Types
// ============================================================================

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
    frameRate: number;
    dropFrame: boolean;
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
}

interface EdlGenerateResponse {
  edl: string;
  filename: string;
  eventCount: number;
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

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Create API router with all endpoints.
 */
export function createApiRouter(state: AppState): Router {
  const router = Router();

  // GET /api/status - Return connection states and current status
  router.get('/status', (_req: Request, res: Response) => {
    const status = buildStatusResponse(state);
    res.json(status);
  });

  // GET /api/events - Return recent events
  router.get('/events', (req: Request, res: Response) => {
    const limitParam = req.query.limit as string | undefined;
    const offsetParam = req.query.offset as string | undefined;
    const limit = Math.min(parseInt(limitParam ?? '100', 10) || 100, 500);
    const offset = parseInt(offsetParam ?? '0', 10) || 0;

    const events = buildEventsResponse(state, limit, offset);
    res.json(events);
  });

  // POST /api/edl/generate - Generate and return EDL content
  router.post('/edl/generate', (req: Request, res: Response) => {
    const body = req.body as EdlGenerateRequest;

    if (state.events.length === 0) {
      res.status(400).json({
        error: 'No events to generate EDL from',
        eventCount: 0,
      });
      return;
    }

    const edlResponse = generateEdlResponse(state, body);
    res.json(edlResponse);
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

    const titleParam = req.query.title as string | undefined;
    const title = titleParam ?? state.config.edl.defaultTitle;
    const filename = `${title}_${state.sessionId}.edl`;

    const edl = generateEdlFromEvents(state.events, {
      title: `${title}_${state.sessionId}`,
      frameRate: state.config.edl.frameRate,
      dropFrame: state.config.edl.dropFrame,
      includeComments: true,
    });

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(edl);
  });

  // GET /api/health - Return health check
  router.get('/health', (_req: Request, res: Response) => {
    const health = buildHealthResponse(state);
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  });

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
      frameRate: state.config.edl.frameRate,
      dropFrame: state.config.edl.dropFrame,
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
 * Generate EDL content from events.
 */
function generateEdlResponse(state: AppState, options: EdlGenerateRequest): EdlGenerateResponse {
  const title = options.title ?? state.config.edl.defaultTitle;
  const filename = `${title}_${state.sessionId}.edl`;

  const edl = generateEdlFromEvents(state.events, {
    title: `${title}_${state.sessionId}`,
    frameRate: state.config.edl.frameRate,
    dropFrame: state.config.edl.dropFrame,
    includeComments: options.includeComments ?? true,
  });

  return {
    edl,
    filename,
    eventCount: state.events.length,
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
