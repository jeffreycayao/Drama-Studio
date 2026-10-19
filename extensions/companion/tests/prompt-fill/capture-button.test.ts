// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureButtonSite,
  isSiteResult,
  mountCaptureButton,
  resultMediaUrl,
  type CaptureButton,
} from '../../src/prompt-fill/capture-button';
import {
  AI_SITES,
  aiSitesOnPromptSite,
  findAiSite,
  type AiSite,
} from '../../src/sites/ai-sites';
import { loadGrokFixture } from './grok-fixture';

const grok = findAiSite('grok-imagine') as AiSite;
const byId = (id: string): HTMLElement =>
  document.getElementById(id) as HTMLElement;

let mounted: CaptureButton | null = null;

function mount(
  overrides: Partial<Parameters<typeof mountCaptureButton>[0]> = {},
) {
  const send = vi.fn(async () => 'Sent to Drama Studio.');
  const notify = vi.fn();
  mounted = mountCaptureButton({
    site: grok,
    pathname: () => '/imagine',
    send,
    notify,
    allowUntrustedClicks: true,
    ...overrides,
  });
  return { send, notify, button: mounted.button, current: mounted.current };
}

const hover = (element: Element): void => {
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
};

beforeEach(() => {
  loadGrokFixture();
});

afterEach(() => {
  mounted?.dispose();
  mounted = null;
});

describe('on-page Send to Drama Studio', () => {
  it('is offered on Grok Imagine only', () => {
    expect(captureButtonSite(aiSitesOnPromptSite('grok'))?.id).toBe(
      'grok-imagine',
    );
    for (const site of AI_SITES.filter(
      (entry) => entry.id !== 'grok-imagine',
    )) {
      expect(site.resultMedia, site.id).toBeUndefined();
    }
  });

  it('recognises Grok results from its own hosts only', () => {
    expect(isSiteResult(grok, byId('result-image'))).toBe(true);
    expect(isSiteResult(grok, byId('result-video'))).toBe(true);
    expect(isSiteResult(grok, byId('result-blob'))).toBe(false);
    expect(isSiteResult(grok, byId('result-elsewhere'))).toBe(false);
    expect(isSiteResult(grok, byId('avatar'))).toBe(false);
  });

  it('reads the file address of a video from its source element too', () => {
    const video = document.createElement('video');
    const source = document.createElement('source');
    source.src = 'https://vidgen.x.ai/clip.mp4';
    video.append(source);
    expect(resultMediaUrl(video)).toBe('https://vidgen.x.ai/clip.mp4');
  });

  it('shows over a result and hides away from it', () => {
    const { button, current } = mount();
    expect(button.hidden).toBe(true);

    hover(byId('result-image'));
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe('Send to Drama Studio');
    expect(current()?.id).toBe('result-image');

    hover(byId('composer'));
    expect(button.hidden).toBe(true);

    hover(byId('avatar'));
    expect(button.hidden).toBe(true);
  });

  it('stays hidden off the Imagine pages', () => {
    const { button } = mount({ pathname: () => '/chat' });
    hover(byId('result-image'));
    expect(button.hidden).toBe(true);
  });

  it('sends the file under the pointer and shows the answer', async () => {
    const { send, notify, button } = mount();
    hover(byId('result-video'));

    button.click();
    expect(button.textContent).toBe('Sending…');
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith('Sent to Drama Studio.'),
    );

    expect(send).toHaveBeenCalledWith(
      'https://vidgen.x.ai/xai-vidgen-bucket/fixture.mp4',
    );
    expect(button.textContent).toBe('Send to Drama Studio');
  });

  it('ignores clicks a page script makes', async () => {
    const { send, button } = mount({ allowUntrustedClicks: false });
    hover(byId('result-image'));
    button.click();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one file at a time', async () => {
    let finish: (value: string) => void = () => {};
    const send = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const { button, notify } = mount({ send });
    hover(byId('result-image'));
    button.click();
    button.click();
    finish('done');
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('never presses Generate and keeps the press away from the page', async () => {
    const page = loadGrokFixture();
    const pagePresses = vi.fn();
    document.addEventListener('click', pagePresses);
    const { button, notify } = mount();
    hover(byId('result-image'));
    button.click();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(page.generatePresses()).toBe(0);
    expect(pagePresses).not.toHaveBeenCalled();
    document.removeEventListener('click', pagePresses);
  });

  it('says so when sending fails', async () => {
    const { button, notify } = mount({
      send: vi.fn(async () => {
        throw new Error('link down');
      }),
    });
    hover(byId('result-image'));
    button.click();
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith(
        expect.stringContaining('Could not send'),
      ),
    );
  });
});
