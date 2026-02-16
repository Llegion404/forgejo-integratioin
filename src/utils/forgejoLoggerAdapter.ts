import { ForgejoLogger } from 'forgejo-ts';
import { logDebug, logInfo, logWarn, logError } from './logger';

/**
 * Adapter that bridges forgejo-ts's ForgejoLogger interface
 * to the VS Code extension's logging system.
 */
export const vscodeLogger: ForgejoLogger = {
  debug: logDebug,
  info: logInfo,
  warn: logWarn,
  error: logError,
};
