/**
 * Configuration schema for ATEM ISO EDL Generator.
 * Zod-validated configuration with sensible defaults.
 */

import { z } from 'zod';

// ============================================================================
// Sub-schemas
// ============================================================================

const ReconnectConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().min(0).default(0), // 0 = infinite
  initialDelayMs: z.number().int().positive().default(1000),
  maxDelayMs: z.number().int().positive().default(30000),
});

const AtemConfigSchema = z.object({
  host: z.string().ip({ version: 'v4' }),
  mixEffect: z.number().int().min(0).max(3).default(0),
  /**
   * Frame offset for timestamp compensation.
   * Positive values delay timestamps (compensate for ATEM processing latency).
   * Negative values advance timestamps.
   * Typical ATEM processing delay is 1-2 frames.
   */
  frameOffset: z.number().int().default(0),
  reconnect: ReconnectConfigSchema.default({}),
});

const HyperDeckConfigSchema = z.object({
  name: z.string().min(1).max(32),
  host: z.string().ip({ version: 'v4' }),
  port: z.number().int().min(1).max(65535).default(9993),
  inputMapping: z.number().int().positive(),
  enabled: z.boolean().default(true),
  /**
   * Frame offset for this specific HyperDeck.
   * Compensates for recording delay differences between decks.
   * Positive values delay timestamps, negative values advance.
   */
  frameOffset: z.number().int().default(0),
});

const InputConfigSchema = z.object({
  name: z.string().min(1).max(64),
  reelName: z.string().min(1).max(8), // CMX 3600 limit
  filePrefix: z.string().nullable().default(null),
});

const EdlConfigSchema = z.object({
  outputDirectory: z.string().default('./output'),
  format: z.enum(['cmx3600']).default('cmx3600'),
  frameRate: z.union([
    z.literal(23.976),
    z.literal(24),
    z.literal(25),
    z.literal(29.97),
    z.literal(30),
    z.literal(50),
    z.literal(59.94),
    z.literal(60),
  ]).default(25),
  dropFrame: z.boolean().default(false),
  includeComments: z.boolean().default(true),
  defaultTitle: z.string().default('LIVE_PRODUCTION'),
});

const TimecodeProviderReconnectSchema = z.object({
  enabled: z.boolean().default(true),
  maxAttempts: z.number().int().min(0).default(0), // 0 = infinite
  initialDelayMs: z.number().int().positive().default(1000),
  maxDelayMs: z.number().int().positive().default(30000),
});

const HyperDeckTimecodeConfigSchema = z.object({
  /**
   * IP address or hostname of the HyperDeck providing timecode.
   */
  host: z.string(),

  /**
   * TCP port for HyperDeck protocol.
   */
  port: z.number().int().min(1).max(65535).default(9993),

  /**
   * Polling rate in Hz when notifications are unavailable.
   */
  pollRateHz: z.number().int().min(1).max(25).default(10),

  /**
   * Use protocol notifications if available (1.11+).
   */
  useNotifications: z.boolean().default(true),

  /**
   * Only report OK status if timecode source is SDI.
   * Enable for "real TC" use case with RP-188 embedded in SDI.
   */
  requireSdiSource: z.boolean().default(true),

  /**
   * Connection timeout in milliseconds.
   */
  connectionTimeoutMs: z.number().int().positive().default(5000),

  /**
   * Reconnection settings.
   */
  reconnect: TimecodeProviderReconnectSchema.default({}),
});

const FallbackConfigSchema = z.object({
  /**
   * Enable automatic fallback to system clock.
   */
  enabled: z.boolean().default(true),

  /**
   * Delay before switching to fallback (ms).
   */
  delayMs: z.number().int().positive().default(3000),
});

const TimecodeConfigSchema = z.object({
  /**
   * Primary timecode source.
   * - 'system': Generate from computer clock
   * - 'hyperdeck': Read from HyperDeck SDI input (RP-188)
   */
  source: z.enum(['system', 'hyperdeck']).default('system'),

  /**
   * Frame rate for timecode generation/validation.
   * Should match edl.frameRate for consistency.
   */
  frameRate: z.union([
    z.literal(23.976),
    z.literal(24),
    z.literal(25),
    z.literal(29.97),
    z.literal(30),
    z.literal(50),
    z.literal(59.94),
    z.literal(60),
  ]).default(25),

  /**
   * Whether to use drop-frame timecode.
   * Only valid for 29.97 and 59.94 fps.
   */
  dropFrame: z.boolean().default(false),

  /**
   * Starting timecode for system clock mode.
   * Use 'auto' for time-of-day timecode.
   */
  startTimecode: z.string().regex(/^(\d{2}:\d{2}:\d{2}[:;]\d{2}|auto)$/).default('auto'),

  /**
   * HyperDeck configuration (when source is 'hyperdeck').
   */
  hyperdeck: HyperDeckTimecodeConfigSchema.optional(),

  /**
   * Fallback configuration.
   */
  fallback: FallbackConfigSchema.default({}),

  /**
   * Maximum emission rate to downstream consumers (Hz).
   */
  maxEmitRateHz: z.number().int().min(1).max(60).default(25),
});

const WebAuthConfigSchema = z.object({
  enabled: z.boolean().default(false),
  username: z.string().optional(),
  password: z.string().optional(),
});

const WebConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
  auth: WebAuthConfigSchema.optional(),
});

const LoggingConfigSchema = z.object({
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  eventLog: z.boolean().default(true),
  eventLogDirectory: z.string().default('./logs'),
  rotateDaily: z.boolean().default(true),
  prettyPrint: z.boolean().default(true),
});

const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: z.number().int().min(1).max(65535).default(9090),
});

const WatchdogConfigSchema = z.object({
  enabled: z.boolean().default(false),
  timeoutMs: z.number().int().positive().default(300000),
});

const HealthConfigSchema = z.object({
  enabled: z.boolean().default(true),
  metrics: MetricsConfigSchema.default({}),
  watchdog: WatchdogConfigSchema.default({}),
});

// ============================================================================
// Main Configuration Schema
// ============================================================================

export const ConfigSchema = z.object({
  atem: AtemConfigSchema,
  hyperdecks: z.array(HyperDeckConfigSchema).default([]),
  inputs: z.record(z.coerce.number(), InputConfigSchema).default({}),
  edl: EdlConfigSchema.default({}),
  timecode: TimecodeConfigSchema.default({}),
  web: WebConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  health: HealthConfigSchema.default({}),
});

// ============================================================================
// Type Exports
// ============================================================================

export type Config = z.infer<typeof ConfigSchema>;
export type AtemConfig = z.infer<typeof AtemConfigSchema>;
export type HyperDeckConfig = z.infer<typeof HyperDeckConfigSchema>;
export type InputConfig = z.infer<typeof InputConfigSchema>;
export type EdlConfig = z.infer<typeof EdlConfigSchema>;
export type TimecodeConfig = z.infer<typeof TimecodeConfigSchema>;
export type HyperDeckTimecodeConfig = z.infer<typeof HyperDeckTimecodeConfigSchema>;
export type WebConfig = z.infer<typeof WebConfigSchema>;
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;
export type HealthConfig = z.infer<typeof HealthConfigSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate and parse configuration.
 * Returns parsed config or throws ZodError.
 */
export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}

/**
 * Validate configuration without throwing.
 * Returns result object with success flag.
 */
export function safeParseConfig(raw: unknown): z.SafeParseReturnType<unknown, Config> {
  return ConfigSchema.safeParse(raw);
}

/**
 * Validate drop-frame setting against frame rate.
 * Drop-frame is only valid for 29.97 and 59.94.
 */
export function validateDropFrame(config: Config): string[] {
  const errors: string[] = [];

  // Check EDL frame rate
  const { frameRate: edlFrameRate, dropFrame: edlDropFrame } = config.edl;
  if (edlDropFrame && edlFrameRate !== 29.97 && edlFrameRate !== 59.94) {
    errors.push(
      `EDL drop-frame timecode is only valid for 29.97 and 59.94 fps. ` +
      `Current frame rate is ${edlFrameRate}. Set edl.dropFrame to false.`
    );
  }

  // Check timecode provider frame rate
  const { frameRate: tcFrameRate, dropFrame: tcDropFrame } = config.timecode;
  if (tcDropFrame && tcFrameRate !== 29.97 && tcFrameRate !== 59.94) {
    errors.push(
      `Timecode drop-frame is only valid for 29.97 and 59.94 fps. ` +
      `Current frame rate is ${tcFrameRate}. Set timecode.dropFrame to false.`
    );
  }

  // Warn if frame rates don't match
  if (edlFrameRate !== tcFrameRate) {
    errors.push(
      `EDL frame rate (${edlFrameRate}) does not match timecode frame rate (${tcFrameRate}). ` +
      `This may cause timing inconsistencies.`
    );
  }

  return errors;
}

/**
 * Validate HyperDeck timecode configuration.
 * Ensures HyperDeck is configured when source is 'hyperdeck'.
 */
export function validateTimecodeConfig(config: Config): string[] {
  const errors: string[] = [];

  if (config.timecode.source === 'hyperdeck' && !config.timecode.hyperdeck) {
    errors.push(
      `Timecode source is 'hyperdeck' but no HyperDeck configuration provided. ` +
      `Add timecode.hyperdeck configuration with at least a host.`
    );
  }

  return errors;
}
