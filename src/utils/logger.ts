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
  // Enable colored output
  enableColors?: boolean;
}

// ANSI color codes
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
} as const;

class Logger {
  private enabledLevels: Record<LogLevel, boolean>;
  private includeTimestamp: boolean;
  private enableColors: boolean;

  constructor(options?: LoggerOptions) {
    this.enabledLevels = {
      debug: options?.enabledLevels?.debug ?? true,
      info: options?.enabledLevels?.info ?? true,
      warn: options?.enabledLevels?.warn ?? true,
      error: options?.enabledLevels?.error ?? true,
    };
    this.includeTimestamp = options?.includeTimestamp ?? true;
    this.enableColors = options?.enableColors ?? true;
  }

  /**
   * Format the log message with optional timestamp and colors
   */
  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = this.includeTimestamp ? `[${new Date().toISOString()}] ` : '';
    const levelColor = this.getLevelColor(level);
    const resetColor = this.enableColors ? COLORS.reset : '';

    return `${timestamp}${levelColor}[${level.toUpperCase()}]${resetColor} ${message}`;
  }

  /**
   * Get the appropriate color for each log level
   */
  private getLevelColor(level: LogLevel): string {
    if (!this.enableColors) return '';

    switch (level) {
      case 'debug':
        return COLORS.cyan;
      case 'info':
        return COLORS.green;
      case 'warn':
        return COLORS.yellow;
      case 'error':
        return COLORS.red;
      default:
        return COLORS.white;
    }
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