import { z } from 'zod';

import {
  appIdSchema,
  isoDateTimeSchema,
  opaqueIdSchema,
} from './primitives.js';

const lowerKebabPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const decimalRevisionSchema = z
  .string()
  .max(10)
  .regex(/^(?:0|[1-9]\d*)$/u)
  .refine((value) => {
    const revision = Number(value);
    return Number.isSafeInteger(revision) && revision <= 2_147_483_647;
  }, 'Guide revision exceeds the supported range');
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value),
      'Text contains unsupported control characters',
    )
    .refine(isWellFormedUnicode, 'Text must contain well-formed Unicode');

export const guideSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(lowerKebabPattern, 'Guide slugs must use lowercase kebab-case');

export const guideSectionIdSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(lowerKebabPattern, 'Section IDs must use lowercase kebab-case');

export const guideLinkHrefSchema = z
  .string()
  .min(1)
  .max(2_048)
  .superRefine((value, context) => {
    if (!isWellFormedUnicode(value)) {
      context.addIssue({
        code: 'custom',
        message: 'Guide links must contain well-formed Unicode',
      });
      return;
    }
    if (/[\u0000-\u001F\u007F]/u.test(value) || value.includes('\\')) {
      context.addIssue({
        code: 'custom',
        message: 'Guide links contain unsupported characters',
      });
      return;
    }
    if (value.startsWith('/')) {
      let relativeUrl: URL;
      try {
        relativeUrl = new URL(value, 'https://guide.invalid');
      } catch {
        context.addIssue({ code: 'custom', message: 'Guide link is invalid' });
        return;
      }
      if (
        value.startsWith('//') ||
        relativeUrl.origin !== 'https://guide.invalid'
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Relative guide links must remain on the current origin',
        });
      }
      return;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Guide link is invalid' });
      return;
    }
    if (
      url.protocol !== 'https:' ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Guide links must use credential-free HTTPS',
      });
    }
  });

export const guideBlockSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('heading'),
    level: z.union([z.literal(3), z.literal(4)]),
    text: safeText(120),
  }),
  z.strictObject({
    type: z.literal('paragraph'),
    text: safeText(5_000),
  }),
  z.strictObject({
    type: z.literal('list'),
    style: z.enum(['ordered', 'unordered']),
    items: z.array(safeText(500)).min(1).max(50),
  }),
  z.strictObject({
    type: z.literal('callout'),
    tone: z.enum(['info', 'warning', 'success']),
    title: safeText(120).nullable(),
    text: safeText(3_000),
  }),
  z.strictObject({
    type: z.literal('link'),
    label: safeText(120),
    href: guideLinkHrefSchema,
  }),
]);

export const guideContentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sections: z
      .array(
        z.strictObject({
          id: guideSectionIdSchema,
          title: safeText(120),
          blocks: z.array(guideBlockSchema).min(1).max(32),
        }),
      )
      .min(1)
      .max(24),
  })
  .superRefine(({ sections }, context) => {
    const sectionIds = sections.map(({ id }) => id);
    if (new Set(sectionIds).size !== sectionIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Guide section IDs must be unique',
        path: ['sections'],
      });
    }

    const blocks = sections.flatMap(({ blocks }) => blocks);
    if (blocks.length > 256) {
      context.addIssue({
        code: 'custom',
        message: 'A guide may contain at most 256 blocks',
        path: ['sections'],
      });
    }
    if (blocks.filter(({ type }) => type === 'link').length > 64) {
      context.addIssue({
        code: 'custom',
        message: 'A guide may contain at most 64 links',
        path: ['sections'],
      });
    }

    let textLength = 0;
    for (const section of sections) {
      textLength += section.title.length;
      for (const block of section.blocks) {
        if (block.type === 'heading') textLength += block.text.length;
        if (block.type === 'paragraph') textLength += block.text.length;
        if (block.type === 'list') {
          textLength += block.items.reduce(
            (total, item) => total + item.length,
            0,
          );
        }
        if (block.type === 'callout') {
          textLength += (block.title?.length ?? 0) + block.text.length;
        }
        if (block.type === 'link') textLength += block.label.length;
      }
    }
    if (textLength > 100_000) {
      context.addIssue({
        code: 'custom',
        message: 'Guide content may contain at most 100,000 text characters',
        path: ['sections'],
      });
    }
  });

export const guideStatusSchema = z.enum(['draft', 'published']);

const guidePublicFields = {
  schemaVersion: z.literal(1),
  slug: guideSlugSchema,
  appId: appIdSchema,
  title: safeText(120),
  summary: safeText(320),
  content: guideContentSchema,
  revision: decimalRevisionSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  publishedAt: isoDateTimeSchema,
} as const;

export const guidePublicDocumentSchema = z.strictObject(guidePublicFields);

export const guideAdminAttributionSchema = z.strictObject({
  userId: opaqueIdSchema,
  displayName: safeText(120).nullable(),
});

export const guideAdminDocumentSchema = z.strictObject({
  ...guidePublicFields,
  status: guideStatusSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  updatedBy: guideAdminAttributionSchema.nullable(),
});

export const guideAdminSummarySchema = guideAdminDocumentSchema.pick({
  schemaVersion: true,
  slug: true,
  appId: true,
  title: true,
  summary: true,
  status: true,
  revision: true,
  updatedAt: true,
  publishedAt: true,
});

export const guideAdminListResponseSchema = z.strictObject({
  items: z.array(guideAdminSummarySchema).max(250),
});

export const updateGuideRequestSchema = z.strictObject({
  expectedRevision: decimalRevisionSchema,
  appId: appIdSchema,
  title: safeText(120),
  summary: safeText(320),
  status: guideStatusSchema,
  content: guideContentSchema,
});

export const createGuideRequestSchema = z.strictObject({
  slug: guideSlugSchema,
  appId: appIdSchema,
  title: safeText(120),
  summary: safeText(320),
  status: guideStatusSchema,
  content: guideContentSchema,
});

export type GuideAdminDocument = z.infer<typeof guideAdminDocumentSchema>;
export type GuideAdminSummary = z.infer<typeof guideAdminSummarySchema>;
export type GuideContent = z.infer<typeof guideContentSchema>;
export type GuidePublicDocument = z.infer<typeof guidePublicDocumentSchema>;
export type CreateGuideRequest = z.infer<typeof createGuideRequestSchema>;
export type UpdateGuideRequest = z.infer<typeof updateGuideRequestSchema>;
