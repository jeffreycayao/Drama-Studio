// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';

import { query } from '../../src/content/dom/jquery-bridge';
import { automationConfigSchema } from '../../src/protocol/content';
import { grokAdapter } from '../../src/sites/grok';
import { checkSiteHealth } from '../../src/sites/health';
import { detectPageStop } from '../../src/sites/page-state';

const count = (selector: string): number => query(selector).length;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Grok site adapter', () => {
  it('is a complete batch-runner configuration', () => {
    const parsed = automationConfigSchema.safeParse(grokAdapter);
    expect(parsed.success).toBe(true);
    expect(grokAdapter.revision).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('every health requirement names a real selector', () => {
    for (const requirement of grokAdapter.health) {
      for (const key of requirement) {
        expect(grokAdapter.selectors[key]).toBeTruthy();
      }
    }
  });
});

describe('site health check', () => {
  it('passes when the prompt box is on the page', () => {
    document.body.innerHTML = '<form><div contenteditable="true"></div></form>';
    expect(checkSiteHealth(grokAdapter, count)).toMatchObject({
      ok: true,
      missing: [],
    });
  });

  it('accepts the drop-zone textarea as the prompt box too', () => {
    document.body.innerHTML =
      '<div data-testid="drop-ui"><textarea></textarea></div>';
    expect(checkSiteHealth(grokAdapter, count).ok).toBe(true);
  });

  it('names what is missing when the site changed', () => {
    document.body.innerHTML = '<main><p>A brand new layout</p></main>';
    const health = checkSiteHealth(grokAdapter, count);
    expect(health.ok).toBe(false);
    expect(health.missing).toEqual([
      'promptContentEditable | promptDropUiTextarea',
    ]);
  });

  it('treats a selector the engine rejects as missing, not as a crash', () => {
    const health = checkSiteHealth(grokAdapter, () => {
      throw new Error('bad selector');
    });
    expect(health.ok).toBe(false);
  });
});

describe('page stop detection', () => {
  const page = grokAdapter.page;

  it('is quiet on a normal page', () => {
    document.body.innerHTML =
      '<form><div contenteditable="true"></div></form><div role="status">Generating 42%</div>';
    expect(detectPageStop(page, document, '/imagine')).toBeNull();
  });

  it.each([
    [
      'captcha',
      '<iframe src="https://challenges.cloudflare.com/turnstile"></iframe>',
    ],
    ['captcha', '<div class="cf-turnstile"></div>'],
    ['captcha', '<div role="dialog">Please verify you are human</div>'],
    ['usage-limit', '<div role="alert">Rate limit exceeded</div>'],
    [
      'usage-limit',
      '<li data-sonner-toast>You have reached your daily video limit</li>',
    ],
    ['moderation', '<div role="alert">Content moderated</div>'],
    [
      'moderation',
      '<div role="alert">This request violates our usage policy</div>',
    ],
    ['sign-in', '<a href="/sign-in?redirect=imagine">Sign in</a>'],
  ])('recognises %s', (reason, html) => {
    document.body.innerHTML = html;
    expect(detectPageStop(page, document, '/imagine')?.reason).toBe(reason);
  });

  it('recognises a sign-in page by its path', () => {
    expect(detectPageStop(page, document, '/sign-in')?.reason).toBe('sign-in');
  });

  it('puts a CAPTCHA ahead of a limit message', () => {
    document.body.innerHTML =
      '<div role="alert">Too many requests</div><div class="cf-turnstile"></div>';
    expect(detectPageStop(page, document, '/imagine')?.reason).toBe('captcha');
  });

  it('never reads limit wording out of what the user typed', () => {
    document.body.innerHTML = `
      <div role="dialog">
        <textarea>write a scene about a rate limit</textarea>
        <div contenteditable="true">too many requests, says the robot</div>
      </div>`;
    expect(detectPageStop(page, document, '/imagine')).toBeNull();
  });

  it('ignores limit wording outside alerts, dialogs and toasts', () => {
    document.body.innerHTML =
      '<article><p>Daily limit reached, said the character.</p></article>';
    expect(detectPageStop(page, document, '/imagine')).toBeNull();
  });

  it('ignores hidden alerts', () => {
    document.body.innerHTML =
      '<div role="alert" hidden>Rate limit exceeded</div>';
    expect(detectPageStop(page, document, '/imagine')).toBeNull();
  });

  it('explains every stop in plain words', () => {
    for (const signal of page.signals) {
      expect(signal.message.length).toBeGreaterThan(20);
      expect(signal.message).not.toMatch(/selector|DOM|adapter/i);
    }
  });
});
