// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fillPromptInput,
  findPromptInput,
  waitForPromptInput,
} from '../../src/prompt-fill/fill';
import {
  PROMPT_FILL_MATCHES,
  PROMPT_SITES,
  promptSiteForHostname,
  type PromptSiteId,
} from '../../src/sites/prompt-sites';

/** Simplified copies of each site's composer, with decoys around it. */
const FIXTURES: Record<PromptSiteId, { html: string; expected: string }> = {
  gemini: {
    html: `<div contenteditable="true" id="decoy-note"></div>
      <rich-textarea><div contenteditable="true" role="textbox" class="ql-editor" id="target"></div></rich-textarea>`,
    expected: 'target',
  },
  chatgpt: {
    html: `<div contenteditable="true" id="decoy"></div>
      <textarea id="prompt-textarea" placeholder="Message ChatGPT"></textarea>`,
    expected: 'prompt-textarea',
  },
  claude: {
    html: `<div contenteditable="true" class="ProseMirror" data-testid="chat-input" id="target"></div>`,
    expected: 'target',
  },
  perplexity: {
    html: `<textarea placeholder="Ask anything..." id="target"></textarea>`,
    expected: 'target',
  },
  manus: {
    html: `<textarea placeholder="Give Manus a task" id="decoy" disabled></textarea>
      <textarea placeholder="What can I do for you?" id="target"></textarea>`,
    expected: 'target',
  },
  grok: {
    html: `<textarea placeholder="Ask Grok anything" id="target"></textarea>`,
    expected: 'target',
  },
  flow: {
    html: `<textarea id="decoy-search" disabled placeholder="Search"></textarea>
      <textarea placeholder="Generate a video with text..." id="target"></textarea>`,
    expected: 'target',
  },
  kling: {
    html: `<div contenteditable="true" role="textbox" id="target"></div>
      <textarea id="decoy-hidden-field"></textarea>`,
    expected: 'target',
  },
  runway: {
    html: `<div contenteditable="true" role="textbox" aria-label="Prompt" id="target"></div>`,
    expected: 'target',
  },
  hailuo: {
    html: `<textarea placeholder="Describe the video you want" id="target"></textarea>`,
    expected: 'target',
  },
  luma: {
    html: `<textarea placeholder="What do you want to imagine?" id="target"></textarea>`,
    expected: 'target',
  },
  pika: {
    html: `<textarea placeholder="Describe your video" id="target"></textarea>`,
    expected: 'target',
  },
  midjourney: {
    html: `<textarea id="desktop_input_bar" placeholder="What will you imagine?"></textarea>`,
    expected: 'desktop_input_bar',
  },
  ideogram: {
    html: `<textarea placeholder="Describe what you want to see" id="target"></textarea>`,
    expected: 'target',
  },
  leonardo: {
    html: `<textarea placeholder="Type a prompt..." id="target"></textarea>`,
    expected: 'target',
  },
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('prompt sites', () => {
  it('has a fixture for every site', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      PROMPT_SITES.map((site) => site.id).sort(),
    );
  });

  it('matches exact hostnames only', () => {
    expect(promptSiteForHostname('chatgpt.com')?.id).toBe('chatgpt');
    expect(promptSiteForHostname('CLAUDE.AI.')?.id).toBe('claude');
    expect(promptSiteForHostname('evil-chatgpt.com')).toBeNull();
    expect(promptSiteForHostname('claude.ai.evil.example')).toBeNull();
  });

  it('turns every hostname into one https content-script match', () => {
    expect(PROMPT_FILL_MATCHES).toContain('https://gemini.google.com/*');
    expect(PROMPT_FILL_MATCHES.every((m) => m.startsWith('https://'))).toBe(
      true,
    );
    expect(PROMPT_FILL_MATCHES.some((m) => m.includes('*.'))).toBe(false);
  });
});

describe.each(PROMPT_SITES)('$label prompt box', (site) => {
  it('finds the composer, not a decoy', () => {
    document.body.innerHTML = FIXTURES[site.id].html;
    expect(findPromptInput(site)?.id).toBe(FIXTURES[site.id].expected);
  });

  it('fills it with the exact text and never submits', () => {
    document.body.innerHTML = `<form>${FIXTURES[site.id].html}</form>`;
    const form = document.querySelector('form')!;
    const submitted = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener('submit', submitted);
    const input = findPromptInput(site)!;
    const text = 'First line\nSecond line with <b>tags</b> & "quotes"';

    fillPromptInput(input, text);

    if (input instanceof HTMLTextAreaElement) {
      expect(input.value).toBe(text);
    } else {
      expect(input.innerText ?? input.textContent).toContain('First line');
      expect(input.querySelector('b')).toBeNull();
      expect(input.textContent).toContain('<b>tags</b>');
      expect(input.querySelectorAll('br')).toHaveLength(1);
    }
    expect(submitted).not.toHaveBeenCalled();
  });
});

describe('filling', () => {
  it('fires input events so page frameworks notice the change', () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const textarea = document.getElementById('t') as HTMLTextAreaElement;
    const onInput = vi.fn();
    textarea.addEventListener('input', onInput);
    fillPromptInput(textarea, 'hello');
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it('waits for a prompt box that renders late', async () => {
    const site = PROMPT_SITES.find((candidate) => candidate.id === 'claude')!;
    setTimeout(() => {
      document.body.innerHTML =
        '<div contenteditable="true" class="ProseMirror" id="late"></div>';
    }, 30);
    const input = await waitForPromptInput(site, document, {
      timeoutMs: 1_000,
      intervalMs: 10,
    });
    expect(input?.id).toBe('late');
  });

  it('gives up after the timeout', async () => {
    const site = PROMPT_SITES[0]!;
    await expect(
      waitForPromptInput(site, document, { timeoutMs: 30, intervalMs: 10 }),
    ).resolves.toBeNull();
  });
});
