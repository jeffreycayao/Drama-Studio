// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fillSong, switchToCustomMode } from '../../src/prompt-fill/song';
import { findAiSite } from '../../src/sites/ai-sites';
import { promptSiteForJob } from '../../src/sites/job-sites';

const suno = findAiSite('suno')!;
const song = suno.song!;
const site = promptSiteForJob('suno')!;
const wait = { timeoutMs: 60, intervalMs: 10 };

/** A simplified Suno create page: Simple and Custom tabs, Create button. */
function sunoPage({ custom = false } = {}) {
  document.body.innerHTML = `
    <div role="tablist">
      <button role="tab" aria-selected="${!custom}" id="simple">Simple</button>
      <button role="tab" aria-selected="${custom}" id="custom">Custom</button>
    </div>
    <form id="form">
      <div id="panel"></div>
      <button type="submit" id="create">Create</button>
    </form>`;
  const panel = document.getElementById('panel')!;
  const showCustom = () => {
    panel.innerHTML = `
      <textarea id="lyrics" placeholder="Write some lyrics or a prompt, or leave blank for instrumental"></textarea>
      <textarea id="style" placeholder="Enter style of music"></textarea>
      <input id="title" type="text" placeholder="Enter a title (optional)">`;
  };
  if (custom) showCustom();
  else
    panel.innerHTML =
      '<textarea id="description" placeholder="Describe the song you want"></textarea>';
  document.getElementById('custom')!.addEventListener('click', () => {
    document.getElementById('custom')!.setAttribute('aria-selected', 'true');
    showCustom();
  });
  const created = vi.fn();
  document.getElementById('create')!.addEventListener('click', created);
  document.getElementById('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    created();
  });
  return { created };
}

const value = (id: string): string =>
  (document.getElementById(id) as HTMLTextAreaElement | HTMLInputElement | null)
    ?.value ?? '';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('Suno custom mode', () => {
  it('switches to Custom and fills style, lyrics and title, never pressing Create', async () => {
    const { created } = sunoPage();
    const result = await fillSong(
      site,
      song,
      document,
      'lo-fi synthwave, warm analog pads, 90 bpm',
      {
        custom: true,
        lyrics: '[Verse]\nNeon rain on the window',
        title: 'Neon Rain',
      },
      wait,
    );
    expect(result).toEqual({ style: true, lyrics: true, title: true });
    expect(value('style')).toBe('lo-fi synthwave, warm analog pads, 90 bpm');
    expect(value('lyrics')).toBe('[Verse]\nNeon rain on the window');
    expect(value('title')).toBe('Neon Rain');
    expect(created).not.toHaveBeenCalled();
  });

  it('does not click the mode tab when Custom is already open', () => {
    sunoPage({ custom: true });
    const clicked = vi.fn();
    document.getElementById('custom')!.addEventListener('click', clicked);
    expect(switchToCustomMode(song, document)).toBe(true);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('never clicks a submit button, even one labelled Custom', () => {
    document.body.innerHTML =
      '<form><button type="submit" id="go">Custom</button></form>';
    const clicked = vi.fn();
    document.getElementById('go')!.addEventListener('click', (event) => {
      event.preventDefault();
      clicked();
    });
    expect(switchToCustomMode(song, document)).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });

  it('leaves the lyrics box alone for an instrumental', async () => {
    sunoPage({ custom: true });
    const result = await fillSong(
      site,
      song,
      document,
      'ambient piano',
      { custom: true, instrumental: true, lyrics: 'ignored' },
      wait,
    );
    expect(result.lyrics).toBeNull();
    expect(value('lyrics')).toBe('');
    expect(value('style')).toBe('ambient piano');
  });

  it('reports a page with no style box instead of filling the wrong field', async () => {
    document.body.innerHTML =
      '<textarea id="other" placeholder="Search"></textarea>';
    const result = await fillSong(
      site,
      song,
      document,
      'rock',
      { custom: true },
      wait,
    );
    expect(result.style).toBe(false);
    expect(value('other')).toBe('');
  });
});
