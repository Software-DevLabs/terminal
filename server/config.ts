import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../shared/config.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const projectRoot = join(here, '..');

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T));
  }
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = merge((base as Record<string, unknown>)[key], value);
  }
  return out as T;
}

export function loadConfig(): AppConfig {
  const defaults = JSON.parse(
    readFileSync(join(projectRoot, 'config', 'default.json'), 'utf8'),
  ) as AppConfig;
  const userPath = join(projectRoot, 'config', 'user.json');
  const userOverride = existsSync(userPath)
    ? (JSON.parse(readFileSync(userPath, 'utf8')) as Partial<AppConfig>)
    : {};
  const config = merge(defaults, userOverride);

  if (!config.shells[config.shell]) {
    config.shell = 'powershell';
  }
  if (!config.themes[config.theme]) {
    config.theme = 'mac-light';
  }
  return config;
}
