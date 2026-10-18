// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';

import {
  AI_SITES,
  AI_SITE_MEDIA_PATTERNS,
  aiSitesOnPromptSite,
  hostMatchesPattern,
} from '../../src/sites/ai-sites';
import { JOB_SITES, promptSiteForJob } from '../../src/sites/job-sites';
import { PROMPT_SITES } from '../../src/sites/prompt-sites';

describe('AI site catalog', () => {
  it('lists the image and video sites once each', () => {
    const ids = AI_SITES.map((site) => site.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'grok-imagine',
        'google-flow',
        'kling',
        'runway',
        'hailuo',
        'luma',
        'pika',
        'chatgpt-images',
        'gemini-images',
        'midjourney',
        'ideogram',
        'leonardo',
      ]),
    );
    expect(JOB_SITES).toBe(AI_SITES);
  });

  it('opens every job on https, on one of its prompt site hosts and paths', () => {
    for (const site of AI_SITES) {
      const promptSite = PROMPT_SITES.find(
        (item) => item.id === site.promptSite,
      );
      expect(promptSite, site.id).toBeDefined();
      const url = new URL(site.url);
      expect(url.protocol, site.id).toBe('https:');
      expect(url.hash, site.id).toBe('');
      expect(url.search, site.id).toBe('');
      expect(promptSite?.hostnames, site.id).toContain(url.hostname);
      expect(
        site.paths.some((prefix) => url.pathname.startsWith(prefix)),
        site.id,
      ).toBe(true);
      expect(site.kinds.length, site.id).toBeGreaterThan(0);
      expect(site.revision, site.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('keeps every selector valid CSS and a generic box last', () => {
    for (const site of AI_SITES) {
      const prompt = promptSiteForJob(site.id);
      expect(prompt?.label, site.id).toBe(site.label);
      for (const selector of [
        ...(prompt?.inputSelectors ?? []),
        ...site.fileInputSelectors,
      ]) {
        expect(
          () => document.createDocumentFragment().querySelector(selector),
          `${site.id}: ${selector}`,
        ).not.toThrow();
      }
      expect(['div[contenteditable="true"]', 'textarea'], site.id).toContain(
        prompt?.inputSelectors.at(-1),
      );
    }
  });

  it('names each media host as an exact or subdomain https pattern', () => {
    for (const pattern of AI_SITE_MEDIA_PATTERNS) {
      expect(pattern).toMatch(
        /^https:\/\/(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\*$/,
      );
    }
  });

  it('matches hosts exactly or as subdomains, never by suffix tricks', () => {
    expect(
      hostMatchesPattern('https://cdn.midjourney.com/*', 'cdn.midjourney.com'),
    ).toBe(true);
    expect(
      hostMatchesPattern(
        'https://cdn.midjourney.com/*',
        'evil-cdn.midjourney.com',
      ),
    ).toBe(false);
    expect(
      hostMatchesPattern('https://*.klingai.com/*', 's21-kling.klingai.com'),
    ).toBe(true);
    expect(hostMatchesPattern('https://*.klingai.com/*', 'klingai.com')).toBe(
      true,
    );
    expect(
      hostMatchesPattern('https://*.klingai.com/*', 'notklingai.com'),
    ).toBe(false);
    expect(
      hostMatchesPattern('https://*.klingai.com/*', 'klingai.com.evil.io'),
    ).toBe(false);
    expect(
      hostMatchesPattern('http://cdn.midjourney.com/*', 'cdn.midjourney.com'),
    ).toBe(false);
  });

  it('runs ChatGPT and Gemini jobs on the chat sites people already use', () => {
    expect(aiSitesOnPromptSite('chatgpt').map((site) => site.id)).toEqual([
      'chatgpt-images',
    ]);
    expect(aiSitesOnPromptSite('gemini').map((site) => site.id)).toEqual([
      'gemini-images',
    ]);
    expect(aiSitesOnPromptSite('claude')).toEqual([]);
  });
});
