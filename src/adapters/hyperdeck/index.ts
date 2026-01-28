/**
 * HyperDeck adapter module.
 * Provides connectivity to Blackmagic HyperDeck recorders.
 */

export {
  HyperDeckAdapter,
  createHyperDeckAdapter,
  createHyperDeckAdapters,
} from './adapter.js';

export type {
  TransportInfo,
  TransportStatus,
  ClipInfo,
  ClipList,
  SlotInfo,
  SlotStatus,
  ProtocolResponse,
  AsyncNotification,
  HyperDeckState,
  HyperDeckConnectionOptions,
  ReconnectConfig,
  HyperDeckAdapterOptions,
  HyperDeckAdapterEvents,
  PendingCommand,
} from './types.js';

export {
  parseResponse,
  parseTransportInfo,
  parseClipList,
  parseSlotInfo,
  parseAsyncNotification,
  isSuccessCode,
  isNotificationCode,
  isErrorCode,
  formatCommand,
  Commands,
  ResponseCodes,
  createGotoClipCommand,
  createGotoTimecodeCommand,
  createRecordCommand,
  TERMINATOR,
  END_OF_RESPONSE,
} from './protocol.js';
