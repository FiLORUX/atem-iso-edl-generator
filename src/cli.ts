#!/usr/bin/env node
/**
 * ATEM ISO EDL Generator CLI.
 *
 * Command-line interface for running the application, generating EDLs,
 * and validating configuration files.
 *
 * @module atem-iso-edl-generator/cli
 */

import { Command } from 'commander';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { pino } from 'pino';
import { startApp } from './app.js';
import { safeParseConfig, validateDropFrame } from './core/config/schema.js';
import {
  type ProgramChangeEvent,
  type EventLogEntry,
  deserialiseEvent,
} from './core/events/types.js';
import { generateEdlFromEvents } from './generators/edl/cmx3600.js';
import { generateFcp7XmlFromEvents } from './generators/xml/fcp7.js';
import { generateDrp, type DrpOptions, type SourceMapping } from './generators/drp/resolve.js';
import { TimelineBuilder } from './core/timeline/model.js';

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command();

program
  .name('atem-iso-edl')
  .description('Frame-accurate EDL generation from Blackmagic ATEM switchers')
  .version('0.1.0');

// ============================================================================
// Start Command
// ============================================================================

program
  .command('start')
  .description('Start the ATEM ISO EDL Generator service')
  .option('-c, --config <path>', 'Path to configuration file', './config/config.yaml')
  .action(async (options: { config: string }) => {
    const { shutdown } = await startApp({ configPath: options.config });

    // Handle shutdown signals
    const handleSignal = async (signal: string) => {
      const logger = pino({ level: 'info' });
      logger.info({ signal }, 'Shutdown signal received');
      await shutdown();
      process.exit(0);
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
  });

// ============================================================================
// Generate EDL Command
// ============================================================================

interface GenerateEdlOptions {
  input: string;
  output: string;
  format: 'cmx3600' | 'fcp7xml' | 'drp';
  title: string;
  frameRate: number;
  dropFrame: boolean;
  includeComments: boolean;
  width: number;
  height: number;
  mediaPath: string;
}

program
  .command('generate-edl')
  .description('Generate EDL/XML from event log file')
  .requiredOption('-i, --input <path>', 'Path to event log JSONL file')
  .requiredOption('-o, --output <path>', 'Path for output file')
  .option('-f, --format <format>', 'Output format: cmx3600, fcp7xml, drp', 'cmx3600')
  .option('-t, --title <string>', 'Project title', 'LIVE_PRODUCTION')
  .option('-r, --frame-rate <number>', 'Frame rate', parseFloat, 25)
  .option('--drop-frame', 'Use drop-frame timecode', false)
  .option('--no-comments', 'Exclude comments from EDL')
  .option('-w, --width <number>', 'Video width (for fcp7xml/drp)', parseInt, 1920)
  .option('-h, --height <number>', 'Video height (for fcp7xml/drp)', parseInt, 1080)
  .option('-m, --media-path <path>', 'Base path for media files', '/Volumes/Media')
  .action(async (options: GenerateEdlOptions) => {
    const logger = pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });

    try {
      // Validate format
      const validFormats = ['cmx3600', 'fcp7xml', 'drp'];
      if (!validFormats.includes(options.format)) {
        logger.error({ format: options.format }, `Unsupported format. Valid formats: ${validFormats.join(', ')}`);
        process.exit(1);
      }

      // Validate drop-frame setting
      if (options.dropFrame && options.frameRate !== 29.97 && options.frameRate !== 59.94) {
        logger.error(
          { frameRate: options.frameRate },
          'Drop-frame timecode is only valid for 29.97 and 59.94 fps'
        );
        process.exit(1);
      }

      // Resolve paths
      const inputPath = resolve(options.input);
      const outputPath = resolve(options.output);

      // Check input file exists
      if (!existsSync(inputPath)) {
        logger.error({ path: inputPath }, 'Input file not found');
        process.exit(1);
      }

      logger.info({ path: inputPath }, 'Reading event log');

      // Read and parse JSONL file
      const content = await readFile(inputPath, 'utf-8');
      const lines = content.trim().split('\n').filter((line) => line.length > 0);

      if (lines.length === 0) {
        logger.error('Event log is empty');
        process.exit(1);
      }

      // Parse events
      const events: ProgramChangeEvent[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as EventLogEntry;
          const event = deserialiseEvent(entry);

          // Only include program change events
          if (event.type === 'program_change') {
            events.push(event as ProgramChangeEvent);
          }
        } catch (parseError) {
          logger.warn({ error: parseError }, 'Failed to parse event line, skipping');
        }
      }

      if (events.length === 0) {
        logger.error('No program change events found in log');
        process.exit(1);
      }

      logger.info({ events: events.length }, 'Parsed program change events');

      // Generate output based on format
      let output: string;

      switch (options.format) {
        case 'cmx3600': {
          output = generateEdlFromEvents(events, {
            title: options.title,
            frameRate: options.frameRate,
            dropFrame: options.dropFrame,
            includeComments: options.includeComments ?? true,
          });
          break;
        }

        case 'fcp7xml': {
          output = generateFcp7XmlFromEvents(events, {
            title: options.title,
            frameRate: options.frameRate,
            dropFrame: options.dropFrame,
            width: options.width,
            height: options.height,
            mediaBasePath: options.mediaPath,
          });
          break;
        }

        case 'drp': {
          // Build timeline from events
          const builder = new TimelineBuilder();
          const timeline = builder.fromProgramChanges(events, {
            frameRate: options.frameRate,
            dropFrame: options.dropFrame,
            title: options.title,
          });

          // Build source mappings from unique inputs in events
          const uniqueInputs = new Map<number, { name: string; reelName: string }>();
          for (const event of events) {
            if (!uniqueInputs.has(event.input.inputId)) {
              uniqueInputs.set(event.input.inputId, {
                name: event.input.name,
                reelName: event.input.reelName,
              });
            }
          }

          const sources: SourceMapping[] = Array.from(uniqueInputs.entries()).map(
            ([inputId, info]) => ({
              inputId,
              name: info.name,
              volume: 'Media',
              projectPath: options.title,
              filename: `${info.reelName}_ISO.mov`,
            })
          );

          const drpOptions: DrpOptions = {
            videoMode: `${options.height}p${Math.round(options.frameRate)}`,
            sources,
          };

          output = generateDrp(timeline, drpOptions);
          break;
        }

        default:
          throw new Error(`Unknown format: ${options.format}`);
      }

      // Write output
      await writeFile(outputPath, output);
      logger.info({ path: outputPath, format: options.format, events: events.length }, 'Output generated successfully');

    } catch (error) {
      logger.fatal({ error }, 'Failed to generate EDL');
      process.exit(1);
    }
  });

// ============================================================================
// Validate Config Command
// ============================================================================

program
  .command('validate-config')
  .description('Validate configuration file')
  .option('-c, --config <path>', 'Path to configuration file', './config/config.yaml')
  .action(async (options: { config: string }) => {
    const logger = pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });

    try {
      const configPath = resolve(options.config);

      // Check file exists
      if (!existsSync(configPath)) {
        logger.error({ path: configPath }, 'Configuration file not found');
        process.exit(1);
      }

      logger.info({ path: configPath }, 'Validating configuration');

      // Read and parse YAML
      const content = await readFile(configPath, 'utf-8');
      const raw = parseYaml(content);

      // Validate against schema
      const result = safeParseConfig(raw);

      if (!result.success) {
        logger.error('Configuration validation failed:');
        for (const issue of result.error.issues) {
          const path = issue.path.join('.');
          logger.error(`  ${path}: ${issue.message}`);
        }
        process.exit(1);
      }

      // Additional semantic validation
      const semanticErrors = validateDropFrame(result.data);

      if (semanticErrors.length > 0) {
        logger.error('Configuration semantic errors:');
        for (const error of semanticErrors) {
          logger.error(`  ${error}`);
        }
        process.exit(1);
      }

      logger.info('Configuration valid');
      console.log('\nParsed configuration:');
      console.log(JSON.stringify(result.data, null, 2));

    } catch (error) {
      logger.fatal({ error }, 'Failed to validate configuration');
      process.exit(1);
    }
  });

// ============================================================================
// Entry Point
// ============================================================================

program.parse();
