import type { AppConfig, ThemeSpec } from '../../shared/config.ts';

export interface Identity {
  user: string;
  host: string;
}

export interface ServerConfig extends AppConfig {
  identity: Identity;
}

export function themeOf(config: AppConfig, name: string): ThemeSpec {
  return config.themes[name] ?? config.themes[config.theme] ?? Object.values(config.themes)[0]!;
}

export function authToken(): string {
  return new URLSearchParams(location.search).get('token') ?? __MACTERM_TOKEN__;
}

/**
 * Same-origin paths: vite proxies /pty and /config to the pty host in dev, and the
 * host serves the built bundle itself in production, so the browser never crosses
 * an origin and the token stays the only gate.
 */
export function ptyUrl(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams({ token: authToken() });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/pty?${query}`;
}

export async function fetchConfig(): Promise<ServerConfig> {
  const response = await fetch('/config', { cache: 'no-store' });
  if (!response.ok) throw new Error(`config request failed: ${response.status}`);
  return (await response.json()) as ServerConfig;
}
