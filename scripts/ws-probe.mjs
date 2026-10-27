import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

const token = process.argv[2] ?? 'testtoken123';
const id = randomUUID();
const url = `ws://127.0.0.1:53124/pty?token=${token}&session=${id}&cols=80&rows=24`;
const socket = new WebSocket(url, { binaryType: 'nodebuffer' });

let text = '';
socket.on('open', () => {
  console.log('[open]');
});
socket.on('message', (data, isBinary) => {
  if (!isBinary) {
    console.log('[event]', data.toString());
    return;
  }
  const chunk = data.toString('utf8');
  text += chunk;
  process.stdout.write(chunk);
});
socket.on('close', (code, reason) => console.log('[close]', code, reason.toString()));

setTimeout(() => socket.send(Buffer.from('Get-Date\r', 'utf8')), 900);
setTimeout(() => socket.send(JSON.stringify({ type: 'resize', cols: 100, rows: 28 })), 1800);
setTimeout(() => socket.send(Buffer.from('$host.UI.RawUI.BufferSize | Out-String\r', 'utf8')), 2100);
setTimeout(() => {
  socket.send(JSON.stringify({ type: 'kill' }));
}, 3200);
setTimeout(() => process.exit(0), 3800);
