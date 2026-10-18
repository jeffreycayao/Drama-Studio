// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runPromptFill } from '../../src/prompt-fill';
import type { JobResponse } from '../../src/desktop/messages';

/**
 * The structure of suno.com/create as seen live (signed in, 2026-10-18):
 * Simple / Advanced tabs, a Lexical lyrics editor that takes pastes, the
 * style textarea inside data-testid="create-form-styles-wrapper" with a
 * rotating example placeholder, a "Song Title (Optional)" input, a Duration
 * "Custom" plain button, and Create.
 */
function liveSunoPage() {
  document.body.innerHTML = `
    <div role="tablist">
      <button type="button" role="tab" aria-selected="false" id="simple-tab">Simple</button>
      <button type="button" role="tab" aria-selected="true" id="advanced-tab">Advanced</button>
    </div>
    <div id="simple-panel"><textarea id="describe" placeholder="Describe the sound you want"></textarea></div>
    <div id="advanced-panel">
      <input id="title" type="text" placeholder="Song Title (Optional)">
      <div id="lyrics" contenteditable="true" aria-label="Lyrics editor"></div>
      <div data-testid="create-form-styles-wrapper"><textarea id="style" placeholder="reparto, industrial rock, winds"></textarea></div>
      <div>Duration <button type="button" id="duration-custom">Custom</button></div>
    </div>
    <button type="button" id="create">Create</button>`;
  // Like Lexical: handles paste itself, one paragraph per line.
  const lyrics = document.getElementById('lyrics')!;
  lyrics.addEventListener('paste', (event) => {
    const text =
      (event as ClipboardEvent).clipboardData?.getData('text/plain') ?? '';
    event.preventDefault();
    lyrics.replaceChildren(
      ...text.split('\n').map((line) => {
        const p = document.createElement('p');
        p.textContent = line;
        return p;
      }),
    );
  });
  const clicks = { create: vi.fn(), duration: vi.fn(), simple: vi.fn() };
  document.getElementById('create')!.addEventListener('click', clicks.create);
  document
    .getElementById('duration-custom')!
    .addEventListener('click', clicks.duration);
  document
    .getElementById('simple-tab')!
    .addEventListener('click', clicks.simple);
  return clicks;
}

function deps(job: JobResponse) {
  return {
    href: 'https://suno.com/create#dsjob=tok_0123456789abcdef',
    document,
    replaceUrl: vi.fn(),
    fetchHandoff: vi.fn(),
    fetchJob: vi.fn(async () => job),
    reportJob: vi.fn(async () => ({ ok: true })),
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
    wait: { timeoutMs: 60, intervalMs: 10 },
  };
}

const song = (
  params: Record<string, unknown>,
  prompt = 'dream pop, 100 bpm',
): JobResponse => ({
  ok: true,
  jobId: 'job_0123456789',
  site: 'suno',
  kind: 'audio',
  prompt,
  params,
  references: [],
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Suno as it is live', () => {
  it('fills style, multi-line lyrics and title, touching neither Create nor Duration › Custom', async () => {
    const clicks = liveSunoPage();
    await expect(
      runPromptFill(
        deps(
          song({
            custom: true,
            lyrics: '[Verse]\nStars fall slow\n[Chorus]\nHold the light',
            title: 'Slow Stars',
          }),
        ),
      ),
    ).resolves.toBe('filled');
    expect(
      (document.getElementById('style') as HTMLTextAreaElement).value,
    ).toBe('dream pop, 100 bpm');
    expect(
      [...document.querySelectorAll('#lyrics p')].map((p) => p.textContent),
    ).toEqual(['[Verse]', 'Stars fall slow', '[Chorus]', 'Hold the light']);
    expect((document.getElementById('title') as HTMLInputElement).value).toBe(
      'Slow Stars',
    );
    expect(clicks.create).not.toHaveBeenCalled();
    expect(clicks.duration).not.toHaveBeenCalled();
    expect(clicks.simple).not.toHaveBeenCalled();
  });

  it('switches to the Simple tab for a simple song before filling the description', async () => {
    const clicks = liveSunoPage();
    await expect(
      runPromptFill(deps(song({}, 'An upbeat synth song about rain'))),
    ).resolves.toBe('filled');
    expect(clicks.simple).toHaveBeenCalledOnce();
    expect(
      (document.getElementById('describe') as HTMLTextAreaElement).value,
    ).toBe('An upbeat synth song about rain');
    expect(
      (document.getElementById('style') as HTMLTextAreaElement).value,
    ).toBe('');
    expect(clicks.create).not.toHaveBeenCalled();
  });
});
