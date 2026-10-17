import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extensionIdFromTargets,
  extensionIdFromUnpackedPath,
} from './lib/extension-identity.mjs';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const usage =
  'Usage: node scripts/smoke-extension.mjs <chromium-executable> [--capture-dir <directory>]';

export const captureStateFiles = Object.freeze({
  freshTipModal: '01-fresh-tip-modal.png',
  controlTop: '02-control-top.png',
  controlBottom: '03-control-bottom.png',
  settingsTop: '04-settings-top.png',
  settingsBottom: '05-settings-bottom.png',
  debug: '06-debug.png',
});

export function parseSmokeArguments(argv) {
  const [browserPath, ...options] = argv;
  if (!browserPath) throw new Error(usage);
  if (options.length === 0) return { browserPath, captureDir: null };
  if (
    options.length !== 2 ||
    options[0] !== '--capture-dir' ||
    !options[1]?.trim()
  ) {
    throw new Error(usage);
  }
  return { browserPath, captureDir: path.resolve(options[1]) };
}

export function assertFooterSnapshot(snapshot, { version }) {
  if (!snapshot || snapshot.count !== 1) {
    throw new Error(
      `Expected exactly one application footer; received ${String(snapshot?.count ?? 0)}`,
    );
  }
  if (snapshot.versionText !== `Companion v${version}`) {
    throw new Error(
      `Footer version text is stale: ${String(snapshot.versionText)}`,
    );
  }
  if (!/Drama Studio/u.test(snapshot.legal ?? '')) {
    throw new Error(
      `Footer must credit Drama Studio: ${String(snapshot.legal)}`,
    );
  }
  if (snapshot.remoteResources.length > 0) {
    throw new Error(
      `The side panel loaded remote resources: ${snapshot.remoteResources.join(', ')}`,
    );
  }
}

const reservePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a DevTools port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const delay = (milliseconds) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });

const waitForExit = async (child, timeoutMilliseconds) => {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(true);
    };
    const onExit = () => finish();
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMilliseconds);
    timer.unref();
    child.once('exit', onExit);
  });
};

const runTaskkill = (pid) =>
  new Promise((resolve) => {
    const taskkill = spawn('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    taskkill.once('error', () => resolve());
    taskkill.once('exit', () => resolve());
  });

const terminateProcessTree = async (child) => {
  if (!child.pid) return;

  if (process.platform === 'win32') {
    await runTaskkill(child.pid);
    await waitForExit(child, 5_000);
    return;
  }

  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  signalGroup('SIGTERM');
  if (!(await waitForExit(child, 3_000))) {
    signalGroup('SIGKILL');
    await waitForExit(child, 2_000);
  }
};

export async function runSmoke(argv = process.argv.slice(2)) {
  const { browserPath, captureDir } = parseSmokeArguments(argv);
  const extensionPath = path.join(projectRoot, '.output', 'chrome-mv3');
  await Promise.all([
    access(path.resolve(browserPath)),
    access(path.join(extensionPath, 'manifest.json')),
    captureDir ? mkdir(captureDir, { recursive: true }) : Promise.resolve(),
  ]);
  const extensionId = extensionIdFromUnpackedPath(path.resolve(extensionPath));
  const targetUrl = `chrome-extension://${extensionId}/sidepanel.html`;

  const temporaryRoot = path.join(projectRoot, '.recovery-tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const profilePath = await mkdtemp(
    path.join(temporaryRoot, 'chromium-smoke-'),
  );

  const port = await reservePort();
  const browser = spawn(
    path.resolve(browserPath),
    [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profilePath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-sync',
      '--disable-component-update',
      '--window-position=-32000,-32000',
      '--window-size=900,900',
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      targetUrl,
    ],
    {
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    },
  );

  let browserTermination = null;
  const stopBrowser = () => {
    browserTermination ??= terminateProcessTree(browser);
    return browserTermination;
  };

  let browserError = '';
  let spawnError = null;
  let devtoolsSocket = null;
  browser.once('error', (error) => {
    spawnError = error;
  });
  browser.stderr.setEncoding('utf8');
  browser.stderr.on('data', (chunk) => {
    browserError += chunk;
  });

  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    void stopBrowser();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  const assertBrowserRunning = () => {
    if (interrupted) throw new Error('Extension smoke test was interrupted');
    if (spawnError)
      throw new Error(`Could not launch Chromium: ${spawnError.message}`);
    if (browser.exitCode !== null || browser.signalCode !== null) {
      throw new Error(
        `Chromium exited before the smoke test completed (${browser.exitCode ?? browser.signalCode})\n${browserError}`,
      );
    }
  };

  const waitForJson = async (url, timeoutMilliseconds = 20_000) => {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      assertBrowserRunning();
      try {
        const response = await fetch(url);
        if (response.ok) return response.json();
      } catch {
        // Chromium is still starting.
      }
      await delay(200);
    }
    throw new Error(`Timed out waiting for ${url}\n${browserError}`);
  };

  const connect = async (url) => {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return socket;
  };

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForJson(`${baseUrl}/json/version`);

    let page;
    const deadline = Date.now() + 20_000;
    while (!page && Date.now() < deadline) {
      const targets = await waitForJson(`${baseUrl}/json/list`);
      const backgroundExtensionId = extensionIdFromTargets(targets);
      if (backgroundExtensionId && backgroundExtensionId !== extensionId) {
        throw new Error(
          `Chromium loaded extension ${backgroundExtensionId}, but the unpacked path resolves to ${extensionId}`,
        );
      }
      page ??= targets.find(
        (candidate) =>
          candidate.type === 'page' &&
          (candidate.url === targetUrl || candidate.url === 'about:blank'),
      );
      if (!page) await delay(200);
    }
    if (!page?.webSocketDebuggerUrl) {
      throw new Error(
        `Could not find the disposable browser page\n${browserError}`,
      );
    }

    devtoolsSocket = await connect(page.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const runtimeErrors = [];
    devtoolsSocket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const handler = pending.get(message.id);
        if (!handler) return;
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error.message));
        else handler.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.exceptionThrown') {
        runtimeErrors.push(message.params.exceptionDetails.text);
      }
      if (message.method === 'Log.entryAdded') {
        if (message.params.entry.level === 'error') {
          runtimeErrors.push(message.params.entry.text);
        }
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 10_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        devtoolsSocket.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (source, awaitPromise = false) => {
      const result = await send('Runtime.evaluate', {
        expression: source,
        awaitPromise,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(
          `Browser evaluation failed: ${result.exceptionDetails.text ?? 'Unknown exception'}`,
        );
      }
      return result.result?.value;
    };

    const waitForPageState = async (
      source,
      description,
      timeoutMilliseconds = 10_000,
    ) => {
      const stateDeadline = Date.now() + timeoutMilliseconds;
      while (Date.now() < stateDeadline) {
        assertBrowserRunning();
        if (await evaluate(source)) return;
        await delay(100);
      }
      throw new Error(`Timed out waiting for ${description}`);
    };

    const clickButton = async (label, aliases = []) => {
      const outcome = await evaluate(`(() => {
      const normalize = (value) => value.replace(/\\s+/g, ' ').trim().toLocaleLowerCase();
      const expected = ${JSON.stringify([label, ...aliases])}.map(normalize);
      const buttons = [...document.querySelectorAll('button')];
      const button = buttons
        .find((candidate) => expected.includes(normalize(candidate.textContent ?? '')));
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return {
          clicked: false,
          available: buttons.map((candidate) => normalize(candidate.textContent ?? '')).filter(Boolean),
        };
      }
      button.click();
      return { clicked: true };
    })()`);
      if (!outcome?.clicked) {
        throw new Error(
          `Could not click enabled ${label} button. Available buttons: ${outcome?.available?.join(', ') ?? 'unknown'}`,
        );
      }
    };

    const scrollToEdge = async (edge) => {
      let previousDocumentHeight = null;
      let settled = null;

      for (let attempt = 0; attempt < 8; attempt += 1) {
        await evaluate(`(() => {
        window.scrollTo(0, ${edge === 'top' ? '0' : 'document.documentElement.scrollHeight'});
        return true;
      })()`);
        await delay(100);
        settled = await evaluate(`(() => ({
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
      }))()`);

        const atEdge =
          edge === 'top'
            ? settled.scrollY === 0
            : settled.documentHeight <= settled.viewportHeight ||
              settled.scrollY + settled.viewportHeight >=
                settled.documentHeight - 2;
        const heightIsStable =
          previousDocumentHeight === settled.documentHeight;
        if (atEdge && heightIsStable) return;
        previousDocumentHeight = settled.documentHeight;
      }

      throw new Error(
        `Panel did not settle at the ${edge} edge (${JSON.stringify(settled)})`,
      );
    };

    const capturedPaths = {};
    const capture = async (state) => {
      if (!captureDir) return;
      const filePath = path.join(captureDir, captureStateFiles[state]);
      const screenshot = await send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      });
      if (!screenshot.data)
        throw new Error(`No PNG data captured for ${state}`);
      await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
      capturedPaths[state] = filePath;
    };

    await send('Runtime.enable');
    await send('Log.enable');
    await send('Page.enable');
    const expression = `(() => {
    const footer = document.querySelector('footer.app-footer');
    return {
      href: location.href,
      title: document.title,
      mounted: document.querySelector('#app')?.hasAttribute('data-v-app') ?? false,
      appHtmlLength: document.querySelector('#app')?.outerHTML.length ?? 0,
      text: document.body.innerText.slice(0, 500),
      manifestVersion: chrome.runtime.getManifest().version,
      footer: {
        count: document.querySelectorAll('footer.app-footer').length,
        versionText:
          footer?.querySelector('.app-footer__version')?.textContent?.trim() ?? null,
        legal:
          footer?.querySelector('.app-footer__legal')?.textContent?.trim() ?? null,
        remoteResources: performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => /^https?:/i.test(name)),
      },
    };
  })()`;
    let smoke;
    let lastNavigationError = null;
    const mountDeadline = Date.now() + 20_000;
    while (!smoke?.mounted && Date.now() < mountDeadline) {
      try {
        smoke = await evaluate(expression);
      } catch {
        smoke = null;
      }
      if (smoke?.mounted) break;

      const navigation = await send('Page.navigate', { url: targetUrl });
      lastNavigationError = navigation.errorText ?? null;
      await delay(300);
    }

    if (!smoke?.mounted || smoke.appHtmlLength < 100) {
      throw new Error('Vue side panel did not mount meaningful content');
    }
    await waitForPageState(
      `document.querySelector('footer.app-footer .app-footer__version') !== null`,
      'the footer version',
    );
    smoke = await evaluate(expression);
    assertFooterSnapshot(smoke.footer, { version: smoke.manifestVersion });

    let grokContext = null;
    if (captureDir) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: 536,
        height: 890,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: 536,
        screenHeight: 890,
      });
      await waitForPageState(
        `window.innerWidth === 536 && window.innerHeight === 890`,
        'the 536x890 capture viewport',
      );
      await waitForPageState(
        `document.querySelector('#tip-modal-title')?.textContent?.trim() === 'Before you start'`,
        'the first-run tips',
      );

      const openedGrokTab = await evaluate(
        `new Promise((resolve) => chrome.tabs.create(
        { url: 'https://grok.com/imagine', active: true },
        (tab) => {
          const message = chrome.runtime.lastError?.message;
          resolve(message ? { opened: false, message } : { opened: true, tabId: tab?.id });
        },
      ))`,
        true,
      );
      grokContext = { ...openedGrokTab, warningCleared: false };
      if (openedGrokTab?.opened) {
        try {
          await waitForPageState(
            `document.querySelector('.grok-warning') === null`,
            'the Grok page poll to clear the control warning',
            15_000,
          );
          grokContext.warningCleared = true;
        } catch (error) {
          grokContext.message = `Grok context did not become ready; captures retain the offline warning. ${error.message}`;
        }
      }

      await capture('freshTipModal');
      await clickButton('Got it');
      await waitForPageState(
        `document.querySelector('#tip-modal-title') === null && document.querySelector('.control-tab') !== null`,
        'the Batch tab after dismissing tips',
      );
      await scrollToEdge('top');
      await capture('controlTop');
      await scrollToEdge('bottom');
      await capture('controlBottom');

      await clickButton('Settings');
      await waitForPageState(
        `document.querySelector('.reference-settings') !== null && document.querySelector('.main-tabs button.active')?.textContent?.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'settings'`,
        'the Settings tab',
      );
      await scrollToEdge('top');
      await capture('settingsTop');
      await scrollToEdge('bottom');
      await capture('settingsBottom');

      await clickButton('Activity');
      await waitForPageState(
        `document.querySelector('.reference-debug') !== null && document.querySelector('.main-tabs button.active')?.textContent?.replace(/\\s+/g, ' ').trim().toLocaleLowerCase() === 'activity'`,
        'the Activity tab',
      );
      await scrollToEdge('top');
      await capture('debug');
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          extensionId,
          smoke,
          runtimeErrors,
          lastNavigationError,
          ...(captureDir ? { grokContext, captures: capturedPaths } : {}),
        },
        null,
        2,
      )}\n`,
    );
    if (runtimeErrors.length > 0) {
      throw new Error(
        `Runtime errors were captured:\n${runtimeErrors.join('\n')}`,
      );
    }
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    if (devtoolsSocket && devtoolsSocket.readyState < WebSocket.CLOSING) {
      devtoolsSocket.close();
    }
    await stopBrowser();
    await rm(profilePath, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) await runSmoke();
