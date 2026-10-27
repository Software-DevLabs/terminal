#!/usr/bin/env node
/**
 * Dev supervisor: one token shared between the pty host and the vite bundle,
 * both processes' output prefixed, and both torn down together.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const port = Number(process.env.MACTERM_PORT ?? 53124);
const webPort = Number(process.env.MACTERM_WEB_PORT ?? 5173);
const token = process.env.MACTERM_TOKEN ?? randomBytes(24).toString('hex');
const url = `http://127.0.0.1:${webPort}/?token=${token}`;

const children = [];

function run(name, command, args, env, color) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const prefix = `\x1b[${color}m${name.padEnd(4)}\x1b[0m`;
  const pipe = (stream, sink) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) sink.write(`${prefix} ${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix} exited (${code})`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let closing = false;
function shutdown(code) {
  if (closing) return;
  closing = true;
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // already gone
    }
  }
  setTimeout(() => process.exit(code), 150).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('pty', process.env.MACTERM_NODE ?? 'node', ['server/index.ts'], { MACTERM_PORT: String(port), MACTERM_TOKEN: token }, '36');
run('web', process.env.MACTERM_NODE ?? 'node', ['node_modules/vite/bin/vite.js'], { MACTERM_WEB_PORT: String(webPort), MACTERM_PORT: String(port), MACTERM_TOKEN: token }, '35');

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${webPort}/`);
      if (response.ok) return true;
    } catch {
      // vite is still booting
    }
    await new Promise((resolveAfter) => setTimeout(resolveAfter, 250));
  }
  return false;
}

const ready = await waitUntilReady();
if (!ready) {
  console.error('\x1b[31m[dev] vite never came up on port ' + webPort + '\x1b[0m');
  shutdown(1);
} else {
  console.log(`\n\x1b[1m  macterm  \x1b[0m ${url}\n`);
  if (!process.env.MACTERM_NO_OPEN) {
    spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
  }
}
