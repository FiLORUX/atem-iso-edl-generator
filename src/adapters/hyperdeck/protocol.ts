/**
 * HyperDeck Ethernet Protocol helpers.
 * Handles parsing and formatting of HyperDeck protocol messages.
 *
 * The HyperDeck protocol is a simple text-based protocol over TCP:
 * - Commands are sent as single lines terminated with \r\n
 * - Responses begin with a three-digit code followed by a message
 * - Multi-line responses have data on subsequent lines until blank line
 * - Async notifications are sent without a preceding command
 */

import type {
  TransportInfo,
  TransportStatus,
  ClipInfo,
  ClipList,
  SlotInfo,
  SlotStatus,
  ProtocolResponse,
  AsyncNotification,
} from './types.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Protocol response codes.
 */
export const ResponseCodes = {
  // Informational
  NOTIFY_TRANSPORT: 500,
  NOTIFY_SLOT: 502,
  NOTIFY_REMOTE: 504,
  NOTIFY_CONFIGURATION: 506,

  // Success
  OK: 200,
  TRANSPORT_INFO: 208,
  SLOT_INFO: 202,
  CLIPS_INFO: 206,

  // Errors
  SYNTAX_ERROR: 100,
  UNSUPPORTED: 101,
  INVALID_STATE: 102,
  INVALID_PARAMETER: 103,
  INVALID_VALUE: 104,
  CONNECTION_REJECTED: 120,
  INTERNAL_ERROR: 150,
} as const;

/**
 * Protocol message terminator.
 */
export const TERMINATOR = '\r\n';

/**
 * Blank line indicating end of multi-line response.
 */
export const END_OF_RESPONSE = '\r\n\r\n';

// ============================================================================
// Response Parsing
// ============================================================================

/**
 * Parse a protocol response from raw data.
 * Handles both single-line and multi-line responses.
 *
 * @param data - Raw response string from HyperDeck
 * @returns Parsed protocol response
 *
 * @example
 * // Single-line response
 * parseResponse('200 ok\r\n')
 * // => { code: 200, message: 'ok', data: {} }
 *
 * @example
 * // Multi-line response
 * parseResponse('208 transport info:\r\nstatus: record\r\nspeed: 100\r\n\r\n')
 * // => { code: 208, message: 'transport info', data: { status: 'record', speed: '100' } }
 */
export function parseResponse(data: string): ProtocolResponse {
  const lines = data.trim().split(TERMINATOR);

  if (lines.length === 0 || !lines[0]) {
    return { code: 0, message: '', data: {} };
  }

  // Parse first line: "CODE message:"
  const headerRegex = /^(\d{3})\s+(.+?)(:)?$/;
  const headerMatch = headerRegex.exec(lines[0]);
  if (!headerMatch) {
    return { code: 0, message: lines[0], data: {} };
  }

  const code = parseInt(headerMatch[1] ?? '0', 10);
  const message = (headerMatch[2] ?? '').replace(/:$/, '');
  const responseData: Record<string, string> = {};

  // Parse subsequent lines as key: value pairs
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      responseData[key] = value;
    }
  }

  return { code, message, data: responseData };
}

/**
 * Check if a response code indicates success (2xx).
 */
export function isSuccessCode(code: number): boolean {
  return code >= 200 && code < 300;
}

/**
 * Check if a response code indicates an async notification (5xx).
 */
export function isNotificationCode(code: number): boolean {
  return code >= 500 && code < 600;
}

/**
 * Check if a response code indicates an error (1xx).
 */
export function isErrorCode(code: number): boolean {
  return code >= 100 && code < 200;
}

// ============================================================================
// Async Notification Parsing
// ============================================================================

/**
 * Parse an async notification.
 * Notifications are identified by their response code.
 *
 * @param response - Parsed protocol response
 * @returns Async notification or null if not a notification
 */
export function parseAsyncNotification(response: ProtocolResponse): AsyncNotification | null {
  switch (response.code) {
    case ResponseCodes.NOTIFY_TRANSPORT:
      return { type: 'transport', data: response.data };
    case ResponseCodes.NOTIFY_SLOT:
      return { type: 'slot', data: response.data };
    case ResponseCodes.NOTIFY_REMOTE:
      return { type: 'remote', data: response.data };
    case ResponseCodes.NOTIFY_CONFIGURATION:
      return { type: 'configuration', data: response.data };
    default:
      return null;
  }
}

// ============================================================================
// Transport Info Parsing
// ============================================================================

/**
 * Parse transport status string to enum.
 */
function parseTransportStatus(status: string): TransportStatus {
  const normalised = status.toLowerCase().trim();
  const validStatuses: TransportStatus[] = [
    'preview', 'stopped', 'play', 'forward', 'rewind', 'jog', 'shuttle', 'record'
  ];

  return validStatuses.includes(normalised as TransportStatus)
    ? (normalised as TransportStatus)
    : 'stopped';
}

/**
 * Parse boolean value from protocol response.
 * HyperDeck uses 'true'/'false' strings.
 */
function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

/**
 * Parse integer value from protocol response.
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse transport info response data.
 *
 * @param data - Key-value data from response
 * @returns Parsed transport information
 */
export function parseTransportInfo(data: Record<string, string>): TransportInfo {
  return {
    status: parseTransportStatus(data.status ?? 'stopped'),
    speed: parseInteger(data.speed, 0),
    slotId: parseInteger(data['slot id'], 1),
    clipId: parseInteger(data['clip id'], 0),
    singleClip: parseBoolean(data['single clip']),
    displayTimecode: data['display timecode'] ?? '00:00:00:00',
    timecode: data.timecode ?? '00:00:00:00',
    videoFormat: data['video format'] ?? 'unknown',
    loop: parseBoolean(data.loop),
  };
}

// ============================================================================
// Clip List Parsing
// ============================================================================

/**
 * Parse a single clip line from clip list response.
 * Format: "ID: name startTC duration"
 *
 * @param line - Raw clip line
 * @param id - Clip ID (extracted from key)
 * @returns Parsed clip info or null if invalid
 */
function parseClipLine(line: string, id: number): ClipInfo | null {
  // Clip format varies by HyperDeck firmware version
  // Common format: "name 00:00:00:00 00:00:00:00"
  // Some versions: "name.mov 00:00:00:00 00:00:00:00"

  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) {
    // Minimal format: just name
    return {
      id,
      name: line.trim(),
      startTimecode: '00:00:00:00',
      duration: '00:00:00:00',
    };
  }

  // Last two parts are typically timecodes
  const duration = parts.pop() ?? '00:00:00:00';
  const startTimecode = parts.pop() ?? '00:00:00:00';
  const name = parts.join(' ');

  return {
    id,
    name,
    startTimecode,
    duration,
  };
}

/**
 * Parse clip list response data.
 * The response contains 'clip count' and numbered clip entries.
 *
 * @param data - Key-value data from response
 * @returns Parsed clip list
 *
 * @example
 * parseClipList({
 *   'clip count': '2',
 *   '1': 'clip001.mov 00:00:00:00 00:01:30:00',
 *   '2': 'clip002.mov 00:01:30:00 00:02:15:12'
 * })
 */
export function parseClipList(data: Record<string, string>): ClipList {
  const clipCount = parseInteger(data['clip count'], 0);
  const clips: ClipInfo[] = [];

  // Clip entries are numbered starting from 1
  for (let i = 1; i <= clipCount; i++) {
    const clipData = data[i.toString()];
    if (clipData) {
      const clip = parseClipLine(clipData, i);
      if (clip) {
        clips.push(clip);
      }
    }
  }

  return { clipCount, clips };
}

// ============================================================================
// Slot Info Parsing
// ============================================================================

/**
 * Parse slot status string to enum.
 */
function parseSlotStatus(status: string): SlotStatus {
  const normalised = status.toLowerCase().trim();
  const validStatuses: SlotStatus[] = ['empty', 'mounting', 'error', 'mounted'];

  return validStatuses.includes(normalised as SlotStatus)
    ? (normalised as SlotStatus)
    : 'empty';
}

/**
 * Parse slot info response data.
 *
 * @param data - Key-value data from response
 * @returns Parsed slot information
 */
export function parseSlotInfo(data: Record<string, string>): SlotInfo {
  return {
    slotId: parseInteger(data['slot id'], 1),
    status: parseSlotStatus(data.status ?? 'empty'),
    volumeName: data['volume name'] ?? '',
    recordingTime: parseInteger(data['recording time'], 0),
    videoFormat: data['video format'] ?? 'unknown',
  };
}

// ============================================================================
// Command Formatting
// ============================================================================

/**
 * Format a command with optional parameters.
 * Parameters are appended as "key: value" pairs.
 *
 * @param command - Base command name
 * @param params - Optional key-value parameters
 * @returns Formatted command string with terminator
 *
 * @example
 * formatCommand('transport info')
 * // => 'transport info\r\n'
 *
 * @example
 * formatCommand('notify', { transport: 'true', slot: 'true' })
 * // => 'notify: transport: true slot: true\r\n'
 *
 * @example
 * formatCommand('goto', { clip: '5' })
 * // => 'goto: clip: 5\r\n'
 */
export function formatCommand(command: string, params?: Record<string, string | boolean | number>): string {
  if (!params || Object.keys(params).length === 0) {
    return `${command}${TERMINATOR}`;
  }

  // Format parameters as "key: value" pairs separated by spaces
  const paramString = Object.entries(params)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' ');

  return `${command}: ${paramString}${TERMINATOR}`;
}

// ============================================================================
// Common Commands
// ============================================================================

/**
 * Pre-formatted common commands for convenience.
 */
export const Commands = {
  /** Query transport status */
  TRANSPORT_INFO: formatCommand('transport info'),

  /** Query clips on current slot */
  CLIPS_GET: formatCommand('clips get'),

  /** Subscribe to transport notifications */
  NOTIFY_TRANSPORT: formatCommand('notify', { transport: 'true' }),

  /** Subscribe to slot notifications */
  NOTIFY_SLOT: formatCommand('notify', { slot: 'true' }),

  /** Subscribe to all notifications */
  NOTIFY_ALL: formatCommand('notify', {
    transport: 'true',
    slot: 'true',
    remote: 'true',
    configuration: 'true',
  }),

  /** Stop transport */
  STOP: formatCommand('stop'),

  /** Start recording */
  RECORD: formatCommand('record'),

  /** Start playback */
  PLAY: formatCommand('play'),

  /** Query device info */
  DEVICE_INFO: formatCommand('device info'),

  /** Query slot info for slot 1 */
  SLOT_INFO_1: formatCommand('slot info', { 'slot id': 1 }),

  /** Query slot info for slot 2 */
  SLOT_INFO_2: formatCommand('slot info', { 'slot id': 2 }),

  /** Ping/keepalive (empty command) */
  PING: TERMINATOR,
} as const;

/**
 * Create a goto command for a specific clip.
 */
export function createGotoClipCommand(clipId: number): string {
  return formatCommand('goto', { clip: clipId.toString() });
}

/**
 * Create a goto command for a specific timecode.
 */
export function createGotoTimecodeCommand(timecode: string): string {
  return formatCommand('goto', { timecode });
}

/**
 * Create a record command with optional name.
 */
export function createRecordCommand(name?: string): string {
  return name
    ? formatCommand('record', { name })
    : Commands.RECORD;
}
