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

const TimecodeConfigSchema = z.object({
  source: z.enum(['system', 'ntp', 'hyperdeck']).default('system'),
  ntpServer: z.string().default('pool.ntp.org'),
  startTimecode: z.string().regex(/^(\d{2}:\d{2}:\d{2}[:;]\d{2}|auto)$/).default('01:00:00:00'),
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
  const { frameRate, dropFrame } = config.edl;

  if (dropFrame && frameRate !== 29.97 && frameRate !== 59.94) {
    errors.push(
      `Drop-frame timecode is only valid for 29.97 and 59.94 fps. ` +
      `Current frame rate is ${frameRate}. Set dropFrame to false.`
    );
  }

  return errors;
}
