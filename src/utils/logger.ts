/**
 * Unified logger utility for the application
 * Provides logging functions with different severity levels
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOptions {
  // Enable disable specific log levels in production
  enabledLevels?: {
    debug?: boolean;
    info?: boolean;
    warn?: boolean;
    error?: boolean;
  };
  // Include timestamp in log messages
  includeTimestamp?: boolean;
}

class Logger {
  private enabledLevels: Record<LogLevel, boolean>;
  private includeTimestamp: boolean;

  constructor(options?: LoggerOptions) {
    this.enabledLevels = {
      debug: options?.enabledLevels?.debug ?? true,
      info: options?.enabledLevels?.info ?? true,
      warn: options?.enabledLevels?.warn ?? true,
      error: options?.enabledLevels?.error ?? true,
    };
    this.includeTimestamp = options?.includeTimestamp ?? true;
  }

  /**
   * Format the log message with optional timestamp
   */
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = this.includeTimestamp ? `[${new Date().toISOString()}] ` : '';
    return `${timestamp}[${level.toUpperCase()}] ${message}`;
  }

  /**
   * Debug level logging - for detailed information
   */
  debug(message: string, ...args: any[]): void {
    if (this.enabledLevels.debug) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  /**
   * Info level logging - for general information
   */
  info(message: string, ...args: any[]): void {
    if (this.enabledLevels.info) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  /**
   * Warning level logging - for potential issues
   */
  warn(message: string, ...args: any[]): void {
    if (this.enabledLevels.warn) {
      console.warn(this.formatMessage('warn', message), ...args);
    }
  }

  /**
   * Error level logging - for errors and exceptions
   */
  error(message: string, ...args: any[]): void {
    if (this.enabledLevels.error) {
      console.error(this.formatMessage('error', message), ...args);
    }
  }
}

// Create and export a default logger instance
export const logger = new Logger();

// Export the Logger class for custom instances
export { Logger };

// Export types
export type { LogLevel, LoggerOptions }; 