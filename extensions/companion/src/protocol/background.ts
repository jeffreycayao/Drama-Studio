import { z } from 'zod/mini';

import { isAllowedGeneratedResourceUrl } from '../security/urls';
export const backgroundMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('SET_ZOOM'),
    zoomFactor: z.number().check(z.positive()),
  }),
  z.object({
    type: z.literal('DOWNLOAD_RESOURCE'),
    url: z
      .string()
      .check(
        z.minLength(1),
        z.refine(
          isAllowedGeneratedResourceUrl,
          'Unsupported generated media URL',
        ),
      ),
    filename: z.string().check(z.minLength(1)),
    folder: z.optional(z.string()),
    autoChangeFileName: z.optional(z.boolean()),
  }),
  z.object({
    type: z.literal('SET_FOLDER_NAME'),
    folderName: z.optional(z.string()),
    prefix: z.optional(z.string()),
    autoChangeFileName: z.optional(z.boolean()),
  }),
  z.object({
    type: z.literal('PROMPT_GROUP_STATUS'),
    data: z.optional(
      z.looseObject({
        status: z.enum([
          'queued',
          'running',
          'completed',
          'cancelled',
          'stopped',
          'error',
        ]),
      }),
    ),
  }),
]);

export type BackgroundMessage = z.infer<typeof backgroundMessageSchema>;
