import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = join(ROOT, 'vendor', 'node');
const BINARY = process.platform === 'win32' ? 'node.exe' : 'node';
const TARGET = join(OUT_DIR, BINARY);
const MIN_MAJOR = 24;

if (process.argv.includes('--force')) rmSync(TARGET, { force: true });

if (existsSync(TARGET) && statSync(TARGET).size > 10_000_000) {
  console.log(`vendor/node: reusing ${BINARY}`);
} else {
  const dist = process.env.MACTERM_NODE_DIST ?? 'https://nodejs.org/dist';
  const index = await fetch(`${dist}/index.json`).then((response) => {
    if (!response.ok) throw new Error(`${dist}/index.json -> ${response.status}`);
    return response.json();
  });

  const release = index.find(
    (entry) => entry.version.startsWith(`v${MIN_MAJOR}.`) && entry.files?.includes('win-x64-zip'),
  );
  if (!release) throw new Error(`no Node ${MIN_MAJOR}.x win-x64 build found in ${dist}`);

  const folder = `node-${release.version}-win-x64`;
  const archiveName = `${folder}.zip`;
  mkdirSync(OUT_DIR, { recursive: true });
  // Unpack beside the target: temp on C: would need ~120 MB on a nearly full drive.
  const work = mkdtempSync(join(OUT_DIR, 'tmp-'));
  try {
    console.log(`vendor/node: downloading ${release.version}`);
    const response = await fetch(`${dist}/${release.version}/${archiveName}`);
    if (!response.ok) throw new Error(`${archiveName} -> ${response.status}`);
    const archive = join(work, archiveName);
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()));

    // `tar` is GNU tar under Git Bash, which reads `C:\...` as a remote host, so
    // unpack through Expand-Archive instead; it ships with Windows and the runner.
    const extracted = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${work}' -Force`],
      { stdio: 'inherit' },
    );
    if (extracted.status !== 0) throw new Error('Expand-Archive failed to unpack node');

    copyFileSync(join(work, folder, BINARY), TARGET);
    console.log(`vendor/node: ${release.version} -> ${join('vendor', 'node', BINARY)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
