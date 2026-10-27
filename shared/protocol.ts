export const PROTOCOL_VERSION = 1;

export type ClientControl =
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'clearHistory' }
  | { type: 'kill' };

export type ServerEvent =
  | {
      type: 'ready';
      sessionId: string;
      pid: number;
      shellLabel: string;
      shellPath: string;
      user: string;
      host: string;
      cwd: string;
      cols: number;
      rows: number;
      replayedBytes: number;
    }
  | { type: 'exit'; code: number | null; signal: number | null }
  | { type: 'error'; message: string };

export interface SessionInfo {
  id: string;
  pid: number;
  shellLabel: string;
  cwd: string;
  cols: number;
  rows: number;
  attached: boolean;
  exited: boolean;
  bytes: number;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  protocol: number;
  sessions: SessionInfo[];
}
