import { describe, expect, test } from 'bun:test';
import { Terminal } from '@xterm/headless';
import { clearScrollbackOnErase } from './clearScrollback.ts';

const ROWS = 5;

function open() {
  return new Terminal({ cols: 20, rows: ROWS, scrollback: 1000, allowProposedApi: true });
}

async function write(term: Terminal, data: string): Promise<void> {
  await new Promise<void>((resolve) => term.write(data, resolve));
}

describe('clearScrollbackOnErase', () => {
  test('ED 2 from the shell also drops the saved lines', async () => {
    const term = open();
    let cleared = 0;
    clearScrollbackOnErase(term, () => {
      cleared += 1;
    });

    await write(term, Array.from({ length: 40 }, (_, i) => `line ${i}\r\n`).join(''));
    expect(term.buffer.active.length).toBeGreaterThan(ROWS);

    await write(term, '\u001b[H\u001b[2J');
    expect(cleared).toBe(1);
    expect(term.buffer.active.length).toBe(ROWS);
    expect(term.buffer.active.baseY).toBe(0);
  });

  test('other erase modes and plain output keep the scrollback', async () => {
    const term = open();
    let cleared = 0;
    clearScrollbackOnErase(term, () => {
      cleared += 1;
    });

    await write(term, Array.from({ length: 40 }, (_, i) => `line ${i}\r\n`).join(''));
    const depth = term.buffer.active.length;
    await write(term, '\u001b[K');
    expect(cleared).toBe(0);
    expect(term.buffer.active.length).toBe(depth);
  });
});
