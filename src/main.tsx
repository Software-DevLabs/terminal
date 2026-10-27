import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { fetchConfig } from './client/config.ts';
import '@xterm/xterm/css/xterm.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');
const root = createRoot(container);

fetchConfig()
  .then((config) => {
    root.render(
      <StrictMode>
        <App config={config} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    root.render(
      <div className="desktop">
        <div className="boot-error">
          <h1>macterm cannot reach the pty host</h1>
          <p>{message}</p>
          <p className="boot-hint">
            Start it with <code>bun run dev</code>, then reload this page.
          </p>
        </div>
      </div>,
    );
  });
