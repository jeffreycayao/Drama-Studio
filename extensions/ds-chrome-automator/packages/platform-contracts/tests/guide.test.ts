import { describe, expect, it } from 'vitest';

import {
  guideContentSchema,
  guideLinkHrefSchema,
  guidePublicDocumentSchema,
  updateGuideRequestSchema,
} from '../src/guide.js';

const content = {
  schemaVersion: 1 as const,
  sections: [
    {
      id: 'start',
      title: 'Get started',
      blocks: [
        { type: 'heading' as const, level: 3 as const, text: 'Open Grok' },
        { type: 'paragraph' as const, text: 'Open the extension.' },
        {
          type: 'link' as const,
          label: 'Account settings',
          href: '/account',
        },
      ],
    },
  ],
};

describe('tool guide contracts', () => {
  it('accepts a strict, provider-neutral structured document', () => {
    expect(
      guidePublicDocumentSchema.parse({
        appId: 'grok-automator',
        content,
        createdAt: '2026-08-20T00:00:00.000Z',
        publishedAt: '2026-08-20T00:00:00.000Z',
        revision: '0',
        schemaVersion: 1,
        slug: 'grok-automator',
        summary: 'A safe operating guide.',
        title: 'Grok Automator guide',
        updatedAt: '2026-08-20T00:00:00.000Z',
      }),
    ).toBeTruthy();
  });

  it('rejects raw object keys and duplicate section identifiers', () => {
    expect(() =>
      updateGuideRequestSchema.parse({
        appId: 'grok-automator',
        content: {
          schemaVersion: 1,
          sections: [content.sections[0], content.sections[0]],
        },
        expectedRevision: '0',
        rawHtml: '<script>alert(1)</script>',
        status: 'published',
        summary: 'A safe operating guide.',
        title: 'Grok Automator guide',
      }),
    ).toThrow();
  });

  it('allows only same-origin relative or credential-free HTTPS links', () => {
    expect(guideLinkHrefSchema.parse('/guide/grok-automator')).toBe(
      '/guide/grok-automator',
    );
    expect(guideLinkHrefSchema.parse('https://support.example.com/page')).toBe(
      'https://support.example.com/page',
    );
    expect(() => guideLinkHrefSchema.parse('//evil.example/path')).toThrow();
    expect(() => guideLinkHrefSchema.parse('/\n/evil.example')).toThrow();
    expect(() => guideLinkHrefSchema.parse('/\r/evil.example')).toThrow();
    expect(() => guideLinkHrefSchema.parse('/\t/evil.example')).toThrow();
    expect(() =>
      guideLinkHrefSchema.parse(`https://support.example.com/${'\ud800'}`),
    ).toThrow(/well-formed Unicode/u);
    expect(() => guideLinkHrefSchema.parse('javascript:alert(1)')).toThrow();
    expect(() =>
      guideLinkHrefSchema.parse('https://user:pass@example.com/path'),
    ).toThrow();
  });

  it('bounds aggregate blocks, links, and human-readable text', () => {
    expect(() =>
      guideContentSchema.parse({
        schemaVersion: 1,
        sections: Array.from({ length: 9 }, (_, section) => ({
          id: `section-${section}`,
          title: 'Section',
          blocks: Array.from({ length: 32 }, () => ({
            type: 'paragraph',
            text: 'Bounded',
          })),
        })),
      }),
    ).toThrow(/256 blocks/u);
    expect(() =>
      guideContentSchema.parse({
        schemaVersion: 1,
        sections: [
          {
            id: 'invalid-unicode',
            title: 'Invalid Unicode',
            blocks: [{ type: 'paragraph', text: '\ud800' }],
          },
        ],
      }),
    ).toThrow(/well-formed Unicode/u);
  });

  it('keeps optimistic revisions within the Postgres integer range', () => {
    expect(
      updateGuideRequestSchema.parse({
        appId: 'grok-automator',
        content,
        expectedRevision: '2147483647',
        status: 'draft',
        summary: 'A safe operating guide.',
        title: 'Grok Automator guide',
      }).expectedRevision,
    ).toBe('2147483647');
    expect(() =>
      updateGuideRequestSchema.parse({
        appId: 'grok-automator',
        content,
        expectedRevision: '2147483648',
        status: 'draft',
        summary: 'A safe operating guide.',
        title: 'Grok Automator guide',
      }),
    ).toThrow(/supported range/u);
    const malformed = () =>
      updateGuideRequestSchema.safeParse({
        appId: 'grok-automator',
        content,
        expectedRevision: 'abc',
        status: 'draft',
        summary: 'A safe operating guide.',
        title: 'Grok Automator guide',
      });
    expect(malformed).not.toThrow();
    expect(malformed().success).toBe(false);
  });
});
