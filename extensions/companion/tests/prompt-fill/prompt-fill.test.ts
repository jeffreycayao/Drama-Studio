// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runPromptFill } from '../../src/prompt-fill';
import { mountConsentBar } from '../../src/prompt-fill/consent-bar';
import type { HandoffResponse, JobResponse } from '../../src/desktop/messages';

const TOKEN = 'tok_0123456789abcdef';

function setup(
  href: string,
  options: {
    confirm?: boolean;
    handoff?: HandoffResponse;
    job?: JobResponse;
    html?: string;
  } = {},
) {
  document.body.innerHTML =
    options.html ??
    '<div contenteditable="true" class="ProseMirror" id="composer"></div>';
  const dependencies = {
    href,
    document,
    replaceUrl: vi.fn(),
    fetchHandoff: vi.fn(
      async () => options.handoff ?? { ok: true as const, prompt: 'from app' },
    ),
    fetchJob: vi.fn(
      async (): Promise<JobResponse> =>
        options.job ?? {
          ok: true,
          jobId: 'job_0123456789',
          site: 'grok-imagine',
          kind: 'video',
          prompt: 'A lantern drifting over a lake',
          params: { aspect: '16:9' },
          references: [],
        },
    ),
    reportJob: vi.fn(async () => ({ ok: true })),
    confirm: vi.fn(async () => options.confirm ?? true),
    notify: vi.fn(),
    wait: { timeoutMs: 50, intervalMs: 10 },
  };
  return dependencies;
}

const composerText = (): string =>
  document.getElementById('composer')?.textContent ?? '';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('prompt-fill', () => {
  it('asks before filling a prompt from a plain link', async () => {
    const deps = setup('https://claude.ai/new#prompt=Write%20a%20logline');

    await expect(runPromptFill(deps)).resolves.toBe('filled');

    expect(deps.confirm).toHaveBeenCalledWith({
      siteLabel: 'Claude',
      text: 'Write a logline',
    });
    expect(composerText()).toBe('Write a logline');
  });

  it('fills nothing when the person dismisses the link prompt', async () => {
    const deps = setup('https://claude.ai/new#prompt=planted', {
      confirm: false,
    });

    await expect(runPromptFill(deps)).resolves.toBe('dismissed');
    expect(composerText()).toBe('');
  });

  it('clears the prompt from the address bar before asking', async () => {
    const deps = setup('https://claude.ai/new#prompt=secret');
    deps.confirm.mockImplementation(async () => {
      expect(deps.replaceUrl).toHaveBeenCalledWith('https://claude.ai/new');
      return false;
    });
    await runPromptFill(deps);
    expect(deps.replaceUrl).toHaveBeenCalledTimes(1);
  });

  it('fills a Drama Studio hand-off without asking', async () => {
    const deps = setup(`https://claude.ai/new#ds=${TOKEN}`);

    await expect(runPromptFill(deps)).resolves.toBe('filled');

    expect(deps.fetchHandoff).toHaveBeenCalledWith(TOKEN);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(composerText()).toBe('from app');
  });

  it('explains a failed hand-off in plain words', async () => {
    const deps = setup(`https://claude.ai/new#ds=${TOKEN}`, {
      handoff: { ok: false, code: 'app-not-running' },
    });

    await expect(runPromptFill(deps)).resolves.toBe('handoff-failed');
    expect(deps.notify).toHaveBeenCalledWith(
      'Open Drama Studio, then try again.',
    );
    expect(composerText()).toBe('');
  });

  it('does nothing on pages without a prompt', async () => {
    const deps = setup('https://claude.ai/new');
    await expect(runPromptFill(deps)).resolves.toBe('no-prompt');
    expect(deps.replaceUrl).not.toHaveBeenCalled();
  });

  it('does nothing on sites it does not know', async () => {
    const deps = setup('https://example.com/#prompt=hi');
    await expect(runPromptFill(deps)).resolves.toBe('unsupported-site');
  });

  it('leaves Perplexity ?q= links to Perplexity', async () => {
    const deps = setup('https://www.perplexity.ai/search?q=hello', {
      html: '<textarea placeholder="Ask anything"></textarea>',
    });
    await expect(runPromptFill(deps)).resolves.toBe('no-prompt');
  });

  it('tells the person when the prompt box never appears', async () => {
    const deps = setup('https://claude.ai/new#prompt=hi', { html: '' });
    await expect(runPromptFill(deps)).resolves.toBe('no-input');
    expect(deps.notify).toHaveBeenCalled();
  });
});

describe('consent bar', () => {
  it('resolves true on Fill and removes itself', async () => {
    const bar = mountConsentBar(
      { siteLabel: 'Gemini', text: 'hello' },
      document,
      {
        allowUntrustedClicks: true,
      },
    );
    expect(document.body.contains(bar.host)).toBe(true);
    bar.fillButton.click();
    await expect(bar.result).resolves.toBe(true);
    expect(document.body.contains(bar.host)).toBe(false);
  });

  it('ignores clicks a page script fakes', async () => {
    const bar = mountConsentBar({ siteLabel: 'Gemini', text: 'hello' });
    bar.fillButton.click(); // untrusted
    bar.dismissButton.click();
    await expect(bar.result).resolves.toBe(false);
  });

  it('dismisses on Escape', async () => {
    const bar = mountConsentBar({ siteLabel: 'Gemini', text: 'hello' });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(bar.result).resolves.toBe(false);
  });

  it('shows the prompt as text, never as markup', () => {
    const bar = mountConsentBar({
      siteLabel: 'Gemini',
      text: '<img src=x onerror=alert(1)>',
    });
    expect(document.querySelector('img')).toBeNull();
    bar.dismissButton.click();
  });
});

describe('prompt-fill browser jobs', () => {
  const grokImagine = `https://grok.com/imagine#dsjob=${TOKEN}`;

  it('fills the job prompt, clears the token and waits for the person', async () => {
    const deps = setup(grokImagine, {
      html: "<form><div contenteditable='true' id='composer'></div></form>",
    });

    await expect(runPromptFill(deps)).resolves.toBe('filled');

    expect(deps.fetchJob).toHaveBeenCalledWith(TOKEN);
    expect(deps.replaceUrl).toHaveBeenCalledWith('https://grok.com/imagine');
    expect(composerText()).toBe('A lantern drifting over a lake');
    expect(deps.reportJob.mock.calls).toEqual([
      ['job_0123456789', 'filling'],
      ['job_0123456789', 'waiting-user'],
    ]);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining('press Generate'),
    );
  });

  it('never presses a send or generate button', async () => {
    const clicked = vi.fn();
    const deps = setup(grokImagine, {
      html: "<form><div contenteditable='true' id='composer'></div><button type='submit' id='go'>Generate</button></form>",
    });
    document.getElementById('go')?.addEventListener('click', clicked);
    document.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      clicked();
    });

    await runPromptFill(deps);

    expect(clicked).not.toHaveBeenCalled();
  });

  it('mentions reference files the person still has to add', async () => {
    const deps = setup(grokImagine, {
      job: {
        ok: true,
        jobId: 'job_0123456789',
        site: 'grok-imagine',
        kind: 'image',
        prompt: 'A red kite',
        params: {},
        references: [
          {
            refId: 'ref_01234567',
            name: 'kite.png',
            mime: 'image/png',
            bytes: 10,
          },
        ],
      },
    });

    await runPromptFill(deps);

    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining('reference files'),
    );
  });

  it('shows the desktop reason when the job cannot be fetched', async () => {
    const deps = setup(grokImagine, {
      job: { ok: false, code: 'job-expired' },
    });

    await expect(runPromptFill(deps)).resolves.toBe('job-failed');

    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining('expired'),
    );
    expect(deps.reportJob).not.toHaveBeenCalled();
    expect(composerText()).toBe('');
  });

  it('refuses a job meant for another site', async () => {
    const deps = setup(`https://claude.ai/new#dsjob=${TOKEN}`);

    await expect(runPromptFill(deps)).resolves.toBe('job-failed');

    expect(composerText()).toBe('');
    expect(deps.reportJob).toHaveBeenCalledWith(
      'job_0123456789',
      'failed',
      'opened on a different site',
    );
  });

  it('reports a missing prompt box as a failed job', async () => {
    const deps = setup(grokImagine, { html: '<p>signed out</p>' });

    await expect(runPromptFill(deps)).resolves.toBe('no-input');

    expect(deps.reportJob).toHaveBeenLastCalledWith(
      'job_0123456789',
      'failed',
      'prompt box not found',
    );
  });
});
