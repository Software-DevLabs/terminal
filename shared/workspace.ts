export type EntryKind = 'file' | 'dir';

export interface WorkspaceEntry {
  name: string;
  /** POSIX-style path relative to the workspace root. */
  path: string;
  kind: EntryKind;
}

export interface ListResult {
  root: string;
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export interface ReadResult {
  root: string;
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

export interface WriteResult {
  size: number;
  mtime: number;
}

export interface FindHit {
  name: string;
  path: string;
  kind: EntryKind;
}

export interface FindResult {
  results: FindHit[];
  truncated: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchResult {
  results: SearchHit[];
  truncated: boolean;
  scanned: number;
}

export interface SystemInfo {
  elevated: boolean;
  canElevate: boolean;
  appExe: string | null;
  user: string;
  host: string;
  platform: string;
  cwd: string;
}

export interface ElevateResult {
  ok: boolean;
  alreadyElevated?: boolean;
  canceled?: boolean;
  error?: string;
}
