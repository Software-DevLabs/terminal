import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { existsSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { loadConfig, projectRoot } from './config.ts';
import { Session } from './session.ts';
import { handleWorkspaceRequest } from './workspace.ts';
import type { ClientControl } from '../shared/protocol.ts';

const VERSION = '0.1.0';

const PORT = Number(process.env.MACTERM_PORT ?? 53124);
const HOST = '127.0.0.1';
const TOKEN = process.env.MACTERM_TOKEN ?? '';
const SERVE_DIST = existsSync(join(projectRoot, 'dist', 'index.html'));

if (!TOKEN) {
  console.error(
    '[macterm] MACTERM_TOKEN is required so a random local page cannot open a shell here.\n' +
      '           Run `bun run dev` (it generates one) or export it yourself.',
  );
  process.exit(1);
}

const config = loadConfig();
const sessions = new Map<string, Session>();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function originAllowed(header: string | undefined): boolean {
  if (!header) return true;
  try {
    const url = new URL(header);
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);

  if (url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      version: VERSION,
      protocol: 1,
      user: userInfo().username,
      host: hostname(),
      sessions: [...sessions.values()].map((s) => ({
        id: s.id,
        pid: s.pid,
        shellLabel: s.shellLabel,
        cwd: s.cwd,
        cols: s.cols,
        rows: s.rows,
        attached: s.clientCount > 0,
        exited: s.exited,
        bytes: s.replayedBytes,
      })),
    });
    return;
  }

  if (url.pathname === '/config') {
    json(res, 200, { ...config, identity: { user: userInfo().username, host: hostname() } });
    return;
  }

  if (url.pathname.startsWith('/workspace/')) {
    if (url.searchParams.get('token') !== TOKEN || !originAllowed(req.headers.origin)) {
      json(res, 401, { error: 'unauthorized' });
      return;
    }
    await handleWorkspaceRequest(req, res, url);
    return;
  }

  if (!SERVE_DIST) {
    json(res, 404, { error: 'static hosting is off; use the vite dev server' });
    return;
  }

  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(projectRoot, 'dist', requested);
  if (!filePath.startsWith(join(projectRoot, 'dist'))) {
    json(res, 403, { error: 'forbidden' });
    return;
  }
  if (!extname(filePath) || !existsSync(filePath)) {
    filePath = join(projectRoot, 'dist', 'index.html');
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'content-length': body.byteLength,
    });
    res.end(body);
  } catch {
    json(res, 404, { error: 'not found' });
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  if (url.pathname !== '/pty' || url.searchParams.get('token') !== TOKEN || !originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => wss.emit('connection', client, req));
});

wss.on('connection', (client: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const cols = Math.max(2, Number(url.searchParams.get('cols') ?? 80));
  const rows = Math.max(1, Number(url.searchParams.get('rows') ?? 24));
  const requestedCwd = url.searchParams.get('cwd');
  const shellKey = url.searchParams.get('shell') ?? config.shell;
  const shell = config.shells[shellKey] ?? config.shells[config.shell] ?? Object.values(config.shells)[0];
  if (!shell) {
    client.close(1011, 'no shell configured');
    return;
  }

  let session: Session;
  const existingId = url.searchParams.get('session');
  const reattached = existingId ? sessions.get(existingId) : undefined;

  if (reattached) {
    session = reattached;
    // Ring bytes were laid out for another width; replaying them would paint
    // text at columns the grid no longer has. The resize below makes ConPTY
    // repaint the live screen instead.
    if (session.cols !== cols) session.dropHistory();
  } else {
    const id = existingId && !sessions.has(existingId) ? existingId : randomUUID();
    session = new Session(id, {
      shell,
      cols,
      rows,
      cwd: requestedCwd && existsSync(requestedCwd) ? requestedCwd : undefined,
    });
    sessions.set(id, session);
  }

  client.on('message', (data: RawData, isBinary: boolean) => {
    if (session.exited) return;
    if (isBinary) {
      session.write(Buffer.from(data as Buffer).toString('utf8'));
      return;
    }
    const text = Buffer.from(data as Buffer).toString('utf8');
    let message: ClientControl;
    try {
      message = JSON.parse(text) as ClientControl;
    } catch {
      return;
    }
    if (message.type === 'resize') {
      session.resize(message.cols, message.rows);
    } else if (message.type === 'clearHistory') {
      // The screen was wiped; keep the replay from resurrecting it on reload.
      session.dropHistory();
    } else if (message.type === 'kill') {
      sessions.delete(session.id);
      session.kill();
      client.close();
    }
  });

  client.on('close', () => session.detach(client));
  client.on('error', () => session.detach(client));

  // Announce before replaying so the client can clear its grid first.
  client.send(
    JSON.stringify({
      type: 'ready',
      sessionId: session.id,
      pid: session.pid,
      shellLabel: session.shellLabel,
      shellPath: session.shellPath,
      user: userInfo().username,
      host: hostname(),
      cwd: session.cwd,
      cols,
      rows,
      replayedBytes: session.replayedBytes,
    }),
  );
  session.attach(client);
  // After the attach: a resize makes ConPTY repaint the whole screen, and that
  // repaint is only useful to this client once it is on the session.
  session.resize(cols, rows);
});

server.listen(PORT, HOST, () => {
  console.log(`[macterm] pty host on http://${HOST}:${PORT} (shell: ${config.shell}, static: ${SERVE_DIST ? 'on' : 'off'})`);
});

function shutdown(): void {
  for (const session of sessions.values()) {
    session.kill();
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  console.error('[macterm] uncaught:', error);
});
