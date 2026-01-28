/**
 * Configuration Bridge
 *
 * Converts application configuration to timecode provider configuration.
 * Provides a clean interface for instantiating the timecode system from config.
 */

import type { TimecodeConfig, HyperDeckTimecodeConfig } from '../../core/config/schema.js';
import type { TimecodeManagerConfig, ProviderConfig } from './types.js';
import { TimecodeManager, createTimecodeManager } from './manager.js';

// ============================================================================
// Configuration Conversion
// ============================================================================

/**
 * Convert application timecode config to provider config for system clock.
 */
function createSystemProviderConfig(config: TimecodeConfig): ProviderConfig {
  return {
    type: 'system',
    config: {
      frameRate: config.frameRate,
      dropFrame: config.dropFrame,
      startTimecode: config.startTimecode,
      updateRateHz: Math.min(config.maxEmitRateHz, config.frameRate),
    },
  };
}

/**
 * Convert application timecode config to provider config for HyperDeck.
 */
function createHyperDeckProviderConfig(
  hyperdeck: HyperDeckTimecodeConfig
): ProviderConfig {
  return {
    type: 'hyperdeck',
    config: {
      host: hyperdeck.host,
      port: hyperdeck.port,
      pollRateHz: hyperdeck.pollRateHz,
      useNotifications: hyperdeck.useNotifications,
      requireSdiSource: hyperdeck.requireSdiSource,
      connectionTimeout: hyperdeck.connectionTimeoutMs,
      reconnect: hyperdeck.reconnect,
    },
  };
}

/**
 * Convert application config to manager config.
 */
export function createManagerConfigFromAppConfig(
  config: TimecodeConfig
): TimecodeManagerConfig {
  // Determine primary provider
  let primary: ProviderConfig;

  if (config.source === 'hyperdeck' && config.hyperdeck) {
    primary = createHyperDeckProviderConfig(config.hyperdeck);
  } else {
    // Default to system clock
    primary = createSystemProviderConfig(config);
  }

  // Build manager config
  const managerConfig: TimecodeManagerConfig = {
    primary,
    maxEmitRateHz: config.maxEmitRateHz,
  };

  // Add fallback if enabled
  if (config.fallback.enabled) {
    managerConfig.fallback = createSystemProviderConfig(config);
    managerConfig.fallbackDelayMs = config.fallback.delayMs;
  }

  return managerConfig;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a timecode manager from application configuration.
 */
export function createTimecodeManagerFromConfig(
  config: TimecodeConfig
): TimecodeManager {
  const managerConfig = createManagerConfigFromAppConfig(config);
  return createTimecodeManager(managerConfig);
}

/**
 * Create and start a timecode manager from application configuration.
 * Returns the started manager ready for use.
 */
export async function startTimecodeManagerFromConfig(
  config: TimecodeConfig
): Promise<TimecodeManager> {
  const manager = createTimecodeManagerFromConfig(config);
  await manager.start();
  return manager;
}
