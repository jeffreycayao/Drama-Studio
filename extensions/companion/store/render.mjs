// Renders the Chrome Web Store images from store/src/store-art.html with a
// local Chromium (no network): node store/render.mjs <chromium-executable>
// Output: store/assets/*.png at the sizes the Store asks for.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [chromePath] = process.argv.slice(2);
if (!chromePath)
  throw new Error('Usage: node store/render.mjs <chromium-executable>');

const ASSETS = [
  { id: 'batch', file: 'screenshot-1-batch.png', width: 1280, height: 800 },
  {
    id: 'desktop',
    file: 'screenshot-2-ai-sites.png',
    width: 1280,
    height: 800,
  },
  { id: 'link', file: 'screenshot-3-send-back.png', width: 1280, height: 800 },
  { id: 'promo', file: 'promo-small-440x280.png', width: 440, height: 280 },
  {
    id: 'icon',
    file: 'store-icon-128.png',
    width: 128,
    height: 128,
    transparent: true,
  },
];

const port = 9358;
const profile = mkdtempSync(path.join(tmpdir(), 'ds-store-art-'));
const chrome = spawn(
  chromePath,
  [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--no-first-run',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  let up = false;
  chrome.on('exit', (code) => {
    if (!up) console.error(`Chromium exited early (${code})`);
  });
  for (let i = 0; i < 160 && !up; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
      up = true;
    } catch {
      await sleep(250);
    }
  }
  if (!up) throw new Error('Chromium did not start.');
  const page = pathToFileURL(path.join(here, 'src', 'store-art.html')).href;
  const out = path.join(here, 'assets');
  mkdirSync(out, { recursive: true });
  for (const asset of ASSETS) {
    // A fresh tab per asset: CDP drops the session when a tab moves to a file: URL.
    const target = await (
      await fetch(
        `http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${page}#${asset.id}`)}`,
        { method: 'PUT' },
      )
    ).json();
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    let nextId = 0;
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++nextId;
        const onMessage = (event) => {
          const data = JSON.parse(event.data);
          if (data.id !== id) return;
          socket.removeEventListener('message', onMessage);
          if (data.error) reject(new Error(`${method}: ${data.error.message}`));
          else resolve(data.result);
        };
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ id, method, params }));
      });
    await call('Emulation.setDeviceMetricsOverride', {
      width: asset.width,
      height: asset.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    if (asset.transparent)
      await call('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
    for (let i = 0; i < 60; i += 1) {
      const ready = await call('Runtime.evaluate', {
        expression:
          'document.body?.dataset.ready === "1" && [...document.images].every((img) => img.complete)',
        returnByValue: true,
      });
      if (ready.result.value) break;
      await sleep(100);
    }
    await sleep(300);
    const shot = await call('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: asset.width, height: asset.height, scale: 1 },
    });
    writeFileSync(path.join(out, asset.file), Buffer.from(shot.data, 'base64'));
    console.log(`${asset.file} ${asset.width}x${asset.height}`);
    socket.close();
    await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(
      () => {},
    );
  }
} catch (error) {
  console.error('render failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await sleep(800);
  try {
    rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch {
    /* Chromium may still hold it */
  }
}
