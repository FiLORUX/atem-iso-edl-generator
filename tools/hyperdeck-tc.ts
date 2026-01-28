#!/usr/bin/env npx tsx
/**
 * HyperDeck Timecode Test Tool
 *
 * CLI utility for testing timecode reading from HyperDeck devices.
 * Useful for verifying SDI/RP-188 timecode setup before production use.
 *
 * Usage:
 *   npx tsx tools/hyperdeck-tc.ts <host> [options]
 *
 * Examples:
 *   npx tsx tools/hyperdeck-tc.ts 192.168.1.50
 *   npx tsx tools/hyperdeck-tc.ts 192.168.1.50 --poll
 *   npx tsx tools/hyperdeck-tc.ts 192.168.1.50 --duration 60
 *   npx tsx tools/hyperdeck-tc.ts 192.168.1.50 --fallback
 */

import { parseArgs } from 'node:util';
import {
  createHyperDeckProvider,
  createHyperDeckWithFallback,
  createSystemClockProvider,
  type TimecodeSnapshot,
} from '../src/providers/timecode/index.js';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

function printUsage(): void {
  console.log(`
HyperDeck Timecode Test Tool

Usage:
  npx tsx tools/hyperdeck-tc.ts <host> [options]

Arguments:
  host                 HyperDeck IP address or hostname

Options:
  --port, -p <num>     TCP port (default: 9993)
  --poll               Use polling instead of notifications
  --poll-rate <hz>     Polling rate in Hz (default: 10)
  --duration, -d <s>   Run for N seconds then exit
  --fallback           Test with system clock fallback
  --system             Test system clock only (no HyperDeck)
  --verbose, -v        Show extra debug info
  --help, -h           Show this help

Examples:
  npx tsx tools/hyperdeck-tc.ts 192.168.1.50
  npx tsx tools/hyperdeck-tc.ts 192.168.1.50 --poll --poll-rate 25
  npx tsx tools/hyperdeck-tc.ts 192.168.1.50 --fallback --duration 30
  npx tsx tools/hyperdeck-tc.ts --system
`);
}

interface CliOptions {
  host?: string;
  port: number;
  poll: boolean;
  pollRate: number;
  duration?: number;
  fallback: boolean;
  system: boolean;
  verbose: boolean;
}

function parseCliArgs(): CliOptions | null {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: {
        port: { type: 'string', short: 'p' },
        poll: { type: 'boolean', default: false },
        'poll-rate': { type: 'string' },
        duration: { type: 'string', short: 'd' },
        fallback: { type: 'boolean', default: false },
        system: { type: 'boolean', default: false },
        verbose: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });

    if (values.help) {
      printUsage();
      return null;
    }

    const host = positionals[0];
    const system = values.system ?? false;

    if (!host && !system) {
      console.error('Error: Host is required unless using --system mode\n');
      printUsage();
      return null;
    }

    return {
      host,
      port: values.port ? parseInt(values.port, 10) : 9993,
      poll: values.poll ?? false,
      pollRate: values['poll-rate'] ? parseInt(values['poll-rate'], 10) : 10,
      duration: values.duration ? parseInt(values.duration, 10) : undefined,
      fallback: values.fallback ?? false,
      system,
      verbose: values.verbose ?? false,
    };
  } catch (error) {
    console.error(`Error parsing arguments: ${error}`);
    printUsage();
    return null;
  }
}

// ============================================================================
// Display Helpers
// ============================================================================

function formatSnapshot(snapshot: TimecodeSnapshot, verbose: boolean): string {
  const status = formatStatus(snapshot.status);
  const source = formatSource(snapshot.source);
  const tc = snapshot.timecode ?? '--:--:--:--';
  const timelineTc = snapshot.timelineTimecode ?? '--:--:--:--';

  let line = `${tc} [${status}] ${source}`;

  if (verbose) {
    line += `  timeline=${timelineTc}`;
    if (snapshot.transport) {
      line += `  transport=${snapshot.transport.state}`;
      if (snapshot.transport.speed !== 1) {
        line += `@${snapshot.transport.speed}x`;
      }
    }
    if (snapshot.device) {
      line += `  device=${snapshot.device.name}`;
    }
  }

  if (snapshot.error) {
    line += `  error="${snapshot.error}"`;
  }

  return line;
}

function formatStatus(status: TimecodeSnapshot['status']): string {
  switch (status) {
    case 'OK':
      return '\x1b[32mOK\x1b[0m'; // Green
    case 'DEGRADED':
      return '\x1b[33mDEGRADED\x1b[0m'; // Yellow
    case 'NO_SIGNAL':
      return '\x1b[31mNO_SIGNAL\x1b[0m'; // Red
    case 'CONNECTING':
      return '\x1b[36mCONNECTING\x1b[0m'; // Cyan
    case 'DISCONNECTED':
      return '\x1b[90mDISCONNECTED\x1b[0m'; // Grey
    case 'ERROR':
      return '\x1b[31;1mERROR\x1b[0m'; // Bright red
    default:
      return status;
  }
}

function formatSource(source: TimecodeSnapshot['source']): string {
  switch (source) {
    case 'HYPERDECK_SDI':
      return '\x1b[32mSDI\x1b[0m'; // Green - real TC
    case 'HYPERDECK_INTERNAL':
      return '\x1b[33mINTERNAL\x1b[0m'; // Yellow - internal generator
    case 'HYPERDECK_CLIP':
      return '\x1b[36mCLIP\x1b[0m'; // Cyan
    case 'HYPERDECK_UNKNOWN':
      return '\x1b[90mUNKNOWN\x1b[0m'; // Grey
    case 'SYSTEM':
      return '\x1b[34mSYSTEM\x1b[0m'; // Blue
    case 'LTC_HARDWARE':
      return '\x1b[35mLTC\x1b[0m'; // Magenta
    case 'NTP':
      return '\x1b[36mNTP\x1b[0m'; // Cyan
    default:
      return source;
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
  const options = parseCliArgs();
  if (!options) {
    process.exit(1);
  }

  console.log('HyperDeck Timecode Test Tool');
  console.log('============================\n');

  // System clock mode
  if (options.system) {
    console.log('Mode: System clock only\n');
    await runSystemClockTest(options);
    return;
  }

  // Fallback mode with manager
  if (options.fallback) {
    console.log(`Mode: HyperDeck with fallback`);
    console.log(`Host: ${options.host}:${options.port}\n`);
    await runManagerTest(options);
    return;
  }

  // Direct HyperDeck mode
  console.log(`Mode: Direct HyperDeck connection`);
  console.log(`Host: ${options.host}:${options.port}`);
  console.log(`Notifications: ${options.poll ? 'disabled (polling)' : 'enabled'}`);
  if (options.poll) {
    console.log(`Poll rate: ${options.pollRate} Hz`);
  }
  console.log('');

  await runHyperDeckTest(options);
}

// ============================================================================
// Test Runners
// ============================================================================

async function runHyperDeckTest(options: CliOptions): Promise<void> {
  const provider = createHyperDeckProvider({
    host: options.host!,
    port: options.port,
    useNotifications: !options.poll,
    pollRateHz: options.pollRate,
    requireSdiSource: true,
    connectionTimeout: 10000,
    reconnect: {
      enabled: true,
      maxAttempts: 0,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
    },
  });

  let updateCount = 0;
  const startTime = Date.now();

  provider.on('update', (snapshot) => {
    updateCount++;
    process.stdout.write(`\r${formatSnapshot(snapshot, options.verbose)}    `);
  });

  provider.on('connected', () => {
    console.log('\n\x1b[32mConnected!\x1b[0m\n');
  });

  provider.on('disconnected', (error) => {
    console.log(`\n\x1b[33mDisconnected${error ? `: ${error.message}` : ''}\x1b[0m`);
  });

  provider.on('error', (error) => {
    if (options.verbose) {
      console.log(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    }
  });

  // Handle shutdown
  const cleanup = async () => {
    const duration = (Date.now() - startTime) / 1000;
    const rate = updateCount / duration;

    console.log('\n\n--- Statistics ---');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Updates: ${updateCount}`);
    console.log(`Rate: ${rate.toFixed(1)} Hz`);

    await provider.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Set duration timer if specified
  if (options.duration) {
    setTimeout(cleanup, options.duration * 1000);
  }

  // Connect
  console.log('Connecting...');
  try {
    await provider.connect();
  } catch (error) {
    console.error(`\x1b[31mConnection failed: ${error}\x1b[0m`);
    process.exit(1);
  }
}

async function runManagerTest(options: CliOptions): Promise<void> {
  const manager = createHyperDeckWithFallback({
    host: options.host!,
    port: options.port,
    frameRate: 25,
    dropFrame: false,
    requireSdiSource: true,
    fallbackDelayMs: 3000,
  });

  let updateCount = 0;
  const startTime = Date.now();

  manager.on('update', (snapshot) => {
    updateCount++;
    const onFallback = manager.isOnFallback ? ' \x1b[33m[FALLBACK]\x1b[0m' : '';
    process.stdout.write(`\r${formatSnapshot(snapshot, options.verbose)}${onFallback}    `);
  });

  manager.on('failover', (info) => {
    console.log(`\n\x1b[33mFailover: ${info.from} → ${info.to} (${info.reason})\x1b[0m`);
  });

  manager.on('restored', (info) => {
    console.log(`\n\x1b[32mRestored: ${info.provider}\x1b[0m`);
  });

  manager.on('connected', () => {
    console.log('\n\x1b[32mManager connected!\x1b[0m\n');
  });

  manager.on('error', (error) => {
    if (options.verbose) {
      console.log(`\n\x1b[31mError: ${error.message}\x1b[0m`);
    }
  });

  // Handle shutdown
  const cleanup = async () => {
    const duration = (Date.now() - startTime) / 1000;
    const rate = updateCount / duration;

    console.log('\n\n--- Statistics ---');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Updates: ${updateCount}`);
    console.log(`Rate: ${rate.toFixed(1)} Hz`);

    await manager.stop();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Set duration timer if specified
  if (options.duration) {
    setTimeout(cleanup, options.duration * 1000);
  }

  // Start
  console.log('Starting manager...');
  try {
    await manager.start();
  } catch (error) {
    console.error(`\x1b[31mStart failed: ${error}\x1b[0m`);
    process.exit(1);
  }
}

async function runSystemClockTest(options: CliOptions): Promise<void> {
  const provider = createSystemClockProvider({
    frameRate: 25,
    dropFrame: false,
    startTimecode: 'auto',
    updateRateHz: 25,
  });

  let updateCount = 0;
  const startTime = Date.now();

  provider.on('update', (snapshot) => {
    updateCount++;
    process.stdout.write(`\r${formatSnapshot(snapshot, options.verbose)}    `);
  });

  provider.on('error', (error) => {
    console.log(`\n\x1b[33mDrift warning: ${error.message}\x1b[0m`);
  });

  // Handle shutdown
  const cleanup = async () => {
    const duration = (Date.now() - startTime) / 1000;
    const rate = updateCount / duration;

    console.log('\n\n--- Statistics ---');
    console.log(`Duration: ${duration.toFixed(1)}s`);
    console.log(`Updates: ${updateCount}`);
    console.log(`Rate: ${rate.toFixed(1)} Hz`);

    await provider.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Set duration timer if specified
  if (options.duration) {
    setTimeout(cleanup, options.duration * 1000);
  }

  console.log('Starting system clock...\n');
  await provider.connect();
}

// Run
main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
