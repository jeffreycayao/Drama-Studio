import { describe, expect, it } from 'vitest';

import {
  MAX_LINK_PROMPT_CHARS,
  readPromptSource,
  urlWithoutPromptParameters,
} from '../../src/prompt-fill/source';

const url = (value: string): URL => new URL(value);
const TOKEN = 'abcDEF123_-abcDEF123';

describe('reading the prompt source', () => {
  it('reads a hand-off token from #ds=', () => {
    expect(readPromptSource(url(`https://chatgpt.com/#ds=${TOKEN}`))).toEqual({
      kind: 'handoff',
      token: TOKEN,
    });
  });

  it('rejects a malformed hand-off token outright', () => {
    expect(readPromptSource(url('https://chatgpt.com/#ds=../../x'))).toBeNull();
    expect(readPromptSource(url('https://chatgpt.com/#ds=short'))).toBeNull();
  });

  it('prefers the hand-off token over a plain prompt', () => {
    expect(
      readPromptSource(url(`https://claude.ai/#prompt=hi&ds=${TOKEN}`)),
    ).toMatchObject({ kind: 'handoff' });
  });

  it('reads #prompt= and #q= as link prompts, keeping line breaks', () => {
    expect(
      readPromptSource(
        url('https://claude.ai/#prompt=line%20one%0Aline%20two'),
      ),
    ).toEqual({ kind: 'link', text: 'line one\nline two', location: 'hash' });
    expect(readPromptSource(url('https://claude.ai/#q=hello'))).toMatchObject({
      text: 'hello',
      location: 'hash',
    });
  });

  it('falls back to ?prompt= and ?q=', () => {
    expect(
      readPromptSource(url('https://gemini.google.com/app?prompt=hi')),
    ).toEqual({ kind: 'link', text: 'hi', location: 'query' });
  });

  it('can ignore the query for sites that read ?q= themselves', () => {
    expect(
      readPromptSource(url('https://www.perplexity.ai/?q=hi'), {
        ignoreQuery: true,
      }),
    ).toBeNull();
  });

  it('ignores empty prompts and pages without one', () => {
    expect(
      readPromptSource(url('https://claude.ai/#prompt=%20%20')),
    ).toBeNull();
    expect(readPromptSource(url('https://claude.ai/new'))).toBeNull();
  });

  it('caps very long link prompts', () => {
    const long = 'a'.repeat(MAX_LINK_PROMPT_CHARS + 10);
    const source = readPromptSource(url(`https://claude.ai/#prompt=${long}`));
    expect(source?.kind === 'link' && source.text.length).toBe(
      MAX_LINK_PROMPT_CHARS,
    );
  });
});

describe('clearing the address bar', () => {
  it('drops the Companion parameters and keeps the rest', () => {
    expect(
      urlWithoutPromptParameters(
        url('https://chatgpt.com/c/1?model=x&prompt=hi#prompt=secret&tab=2'),
      ),
    ).toBe('https://chatgpt.com/c/1?model=x#tab=2');
  });

  it('removes the hash entirely when only the token was there', () => {
    expect(
      urlWithoutPromptParameters(url(`https://claude.ai/new#ds=${TOKEN}`)),
    ).toBe('https://claude.ai/new');
  });

  it('can keep the query for sites that use it natively', () => {
    expect(
      urlWithoutPromptParameters(url('https://www.perplexity.ai/?q=hi'), {
        keepQuery: true,
      }),
    ).toBe('https://www.perplexity.ai/?q=hi');
  });

  it('leaves an unrelated hash alone', () => {
    expect(
      urlWithoutPromptParameters(url('https://gemini.google.com/app#section')),
    ).toBe('https://gemini.google.com/app#section');
  });
});
