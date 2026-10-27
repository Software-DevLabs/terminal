import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { open, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ElevateResult,
  FindHit,
  FindResult,
  ListResult,
  ReadResult,
  SearchResult,
  SystemInfo,
  WorkspaceEntry,
} from '../shared/workspace.ts';

const MAX_LIST = 2000;
const MAX_READ = 2 * 1024 * 1024;
const MAX_WRITE = 8 * 1024 * 1024;
const MAX_BODY = 16 * 1024 * 1024;
const MAX_FIND = 300;
const MAX_SCAN = 30_000;
const MAX_SEARCH_HITS = 500;
const SEARCH_FILE_LIMIT = 1024 * 1024;
const SEARCH_BUDGET_MS = 8000;
const FIND_BUDGET_MS = 5000;

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.bz2', '.xz', '.zst',
  '.exe', '.dll', '.so', '.dylib', '.pdb', '.lib', '.obj', '.class', '.node', '.msi',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.mp3', '.wav', '.ogg', '.flac', '.mp4', '.mkv', '.avi', '.mov', '.webm',
  '.sqlite', '.db', '.wasm',
]);

export class WorkspaceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function safeJoin(root: string, rel: string): string {
  const target = resolve(root, rel);
  if (!inside(root, target)) throw new WorkspaceError(403, 'That path is outside the workspace');
  return target;
}

function posix(path: string): string {
  return path.split('\\').join('/');
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new WorkspaceError(400, `${name} is required`);
  return value.trim();
}

async function canonicalRoot(value: unknown): Promise<string> {
  const requested = assertString(value, 'root');
  const absolute = resolve(requested);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new WorkspaceError(404, 'That workspace folder does not exist');
  }
  const info = await stat(real);
  if (!info.isDirectory()) throw new WorkspaceError(400, 'The workspace root must be a folder');
  return real;
}

/** Resolves a workspace-relative path, following symlinks only inside the root. */
async function resolveTarget(root: string, relValue: unknown): Promise<{ abs: string; rel: string }> {
  const rel = typeof relValue === 'string' ? relValue.replace(/\\/g, '/') : '';
  const joined = safeJoin(root, rel);
  let real: string;
  try {
    real = await realpath(joined);
  } catch {
    throw new WorkspaceError(404, 'That file or folder does not exist');
  }
  if (!inside(root, real)) throw new WorkspaceError(403, 'That path is outside the workspace');
  return { abs: real, rel: posix(relative(root, real)) };
}

function compareEntries(a: WorkspaceEntry, b: WorkspaceEntry): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export async function listDirectory(rootValue: unknown, pathValue: unknown): Promise<ListResult> {
  const root = await canonicalRoot(rootValue);
  const target = await resolveTarget(root, pathValue);
  const info = await stat(target.abs);
  if (!info.isDirectory()) throw new WorkspaceError(400, 'That path is not a folder');

  const dirents = await readdir(target.abs, { withFileTypes: true });
  const entries: WorkspaceEntry[] = [];
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink() || (!dirent.isFile() && !dirent.isDirectory())) continue;
    entries.push({
      name: dirent.name,
      path: target.rel ? `${target.rel}/${dirent.name}` : dirent.name,
      kind: dirent.isDirectory() ? 'dir' : 'file',
    });
  }
  entries.sort(compareEntries);
  return {
    root,
    path: target.rel,
    entries: entries.slice(0, MAX_LIST),
    truncated: entries.length > MAX_LIST,
  };
}

async function readBytes(abs: string, maxBytes: number): Promise<{ buffer: Buffer; size: number; truncated: boolean }> {
  const handle = await open(abs, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new WorkspaceError(400, 'That path is not a file');
    const take = Math.min(info.size, maxBytes);
    const buffer = Buffer.alloc(take);
    if (take > 0) await handle.read(buffer, 0, take, 0);
    return { buffer, size: info.size, truncated: info.size > maxBytes };
  } finally {
    await handle.close();
  }
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export async function readWorkspaceFile(rootValue: unknown, pathValue: unknown): Promise<ReadResult> {
  const root = await canonicalRoot(rootValue);
  const target = await resolveTarget(root, assertString(pathValue, 'path'));
  const { buffer, size, truncated } = await readBytes(target.abs, MAX_READ);
  if (looksBinary(buffer)) throw new WorkspaceError(415, 'Binary files cannot be previewed');
  return {
    root,
    path: target.rel,
    content: buffer.toString('utf8'),
    size,
    truncated,
  };
}

export async function writeWorkspaceFile(
  rootValue: unknown,
  pathValue: unknown,
  contentValue: unknown,
): Promise<{ size: number; mtime: number }> {
  if (typeof contentValue !== 'string') throw new WorkspaceError(400, 'content is required');
  const bytes = Buffer.byteLength(contentValue, 'utf8');
  if (bytes > MAX_WRITE) throw new WorkspaceError(413, 'This file is too large to save from the editor');
  const root = await canonicalRoot(rootValue);
  const target = await resolveTarget(root, assertString(pathValue, 'path'));
  const info = await stat(target.abs);
  if (!info.isFile()) throw new WorkspaceError(400, 'That path is not a file');
  await writeFile(target.abs, contentValue, 'utf8');
  const next = await stat(target.abs);
  return { size: next.size, mtime: next.mtimeMs };
}

async function* iterateFiles(root: string): AsyncGenerator<{ rel: string; name: string; abs: string }> {
  const queue: string[] = [''];
  while (queue.length > 0) {
    const rel = queue.shift() as string;
    const abs = rel ? join(root, rel) : root;
    let dirents;
    try {
      dirents = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (!IGNORED_DIRS.has(dirent.name.toLowerCase())) queue.push(childRel);
      } else if (dirent.isFile()) {
        yield { rel: childRel, name: dirent.name, abs: join(abs, dirent.name) };
      }
    }
  }
}

export async function findFiles(rootValue: unknown, queryValue: unknown): Promise<FindResult> {
  const root = await canonicalRoot(rootValue);
  const needle = assertString(queryValue, 'query').toLowerCase();
  const results: FindResult['results'] = [];
  let scanned = 0;
  let truncated = false;
  const deadline = Date.now() + FIND_BUDGET_MS;

  for await (const file of iterateFiles(root)) {
    scanned += 1;
    if (scanned > MAX_SCAN || Date.now() > deadline) {
      truncated = true;
      break;
    }
    const name = file.name.toLowerCase();
    const rel = file.rel.toLowerCase();
    if (!name.includes(needle) && !rel.includes(needle)) continue;
    results.push({ name: file.name, path: file.rel, kind: 'file' });
    if (results.length >= MAX_FIND) {
      truncated = true;
      break;
    }
  }

  results.sort((a, b) => {
    const score = (hit: FindHit) => {
      const name = hit.name.toLowerCase();
      if (name.startsWith(needle)) return 0;
      if (name.includes(needle)) return 1;
      return 2;
    };
    return score(a) - score(b) || a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
  });
  return { results, truncated };
}

export async function searchWorkspace(rootValue: unknown, queryValue: unknown): Promise<SearchResult> {
  const root = await canonicalRoot(rootValue);
  const needle = assertString(queryValue, 'query');
  const lowerNeedle = needle.toLowerCase();
  const results: SearchResult['results'] = [];
  const deadline = Date.now() + SEARCH_BUDGET_MS;
  let scanned = 0;
  let truncated = false;

  for await (const file of iterateFiles(root)) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    if (BINARY_EXT.has(extname(file.name).toLowerCase())) continue;
    let size: number;
    try {
      const info = await stat(file.abs);
      size = info.size;
    } catch {
      continue;
    }
    if (size === 0 || size > SEARCH_FILE_LIMIT) continue;
    scanned += 1;

    let buffer: Buffer;
    try {
      ({ buffer } = await readBytes(file.abs, SEARCH_FILE_LIMIT));
    } catch {
      continue;
    }
    if (looksBinary(buffer)) continue;
    const text = buffer.toString('utf8');
    if (!text.toLowerCase().includes(lowerNeedle)) continue;

    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      const column = line.toLowerCase().indexOf(lowerNeedle);
      if (column === -1) continue;
      results.push({
        path: file.rel,
        line: index + 1,
        column: column + 1,
        preview: line.trim().slice(0, 260),
      });
      if (results.length >= MAX_SEARCH_HITS) {
        truncated = true;
        break;
      }
    }
    if (results.length >= MAX_SEARCH_HITS) break;
  }

  return { results, truncated, scanned };
}

async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return typeof process.getuid === 'function' && process.getuid() === 0;
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolvePromise, reject) => {
      execFile(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
        ],
        { windowsHide: true, timeout: 6000 },
        (error, output) => {
          if (error) reject(error);
          else resolvePromise({ stdout: output });
        },
      );
    });
    return stdout.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export async function systemInfo(): Promise<SystemInfo> {
  const elevated = await isElevated();
  const appExe = process.env.MACTERM_APP_EXE ?? null;
  return {
    elevated,
    canElevate: process.platform === 'win32' && !elevated && Boolean(appExe && existsSync(appExe)),
    appExe,
    user: userInfo().username,
    host: hostname(),
    platform: process.platform,
    cwd: process.cwd(),
  };
}

export async function elevateApp(): Promise<ElevateResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Elevation is only available on Windows' };
  }
  const appExe = process.env.MACTERM_APP_EXE;
  if (!appExe || !existsSync(appExe)) {
    return { ok: false, error: 'macterm could not locate its own executable' };
  }
  if (await isElevated()) {
    return { ok: true, alreadyElevated: true };
  }

  const quoted = appExe.replace(/'/g, "''");
  const script =
    `try { Start-Process -FilePath '${quoted}' -Verb RunAs -ErrorAction Stop } ` +
    "catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  let stderr = '';
  try {
    const code = await new Promise<number | null>((resolvePromise, reject) => {
      const child = spawn(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new WorkspaceError(504, 'Timed out waiting for the Windows permission prompt'));
      }, 180_000);
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-2000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolvePromise(exitCode);
      });
    });

    if (code === 0) return { ok: true };
    const canceled = code === 1223 || /cancel/i.test(stderr);
    return {
      ok: false,
      canceled,
      error: stderr.trim().slice(0, 400) || (canceled ? 'Elevation was canceled' : 'Windows refused the elevation request'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw new WorkspaceError(413, 'Request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new WorkspaceError(400, 'Invalid JSON body');
  }
}

export async function handleWorkspaceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const route = url.pathname.slice('/workspace/'.length);
  try {
    if (route === 'system') {
      if (req.method !== 'GET') throw new WorkspaceError(405, 'Method not allowed');
      reply(res, 200, await systemInfo());
      return;
    }
    if (req.method !== 'POST') throw new WorkspaceError(405, 'Method not allowed');
    const body = await readBody(req);

    switch (route) {
      case 'list':
        reply(res, 200, await listDirectory(body.root, body.path ?? ''));
        return;
      case 'read':
        reply(res, 200, await readWorkspaceFile(body.root, body.path));
        return;
      case 'write':
        reply(res, 200, await writeWorkspaceFile(body.root, body.path, body.content));
        return;
      case 'find':
        reply(res, 200, await findFiles(body.root, body.query));
        return;
      case 'search':
        reply(res, 200, await searchWorkspace(body.root, body.query));
        return;
      case 'elevate':
        reply(res, 200, await elevateApp());
        return;
      default:
        throw new WorkspaceError(404, 'Unknown workspace endpoint');
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      reply(res, error.status, { error: error.message });
      return;
    }
    reply(res, 500, { error: error instanceof Error ? error.message : 'Workspace request failed' });
  }
}
