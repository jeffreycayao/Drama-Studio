import { sendRuntimeEvent } from '../protocol/runtime';

function serializeLogValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function formatLogArguments(values: unknown[]): string {
  return values.map(serializeLogValue).join(' ');
}

function log(level: 'info' | 'warn' | 'error', values: unknown[]): void {
  sendRuntimeEvent({
    type: 'ACTION_LOG',
    data: { level, message: formatLogArguments(values), timestamp: Date.now() },
  });
}

export const logInfo = (...values: unknown[]): void => log('info', values);
export const logWarning = (...values: unknown[]): void => log('warn', values);
export const logError = (...values: unknown[]): void => log('error', values);
