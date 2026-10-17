import { list } from '@vercel/blob';

import { parseBlobConfig } from '../config/env.js';
import type { BlobPort } from '../ports/providers.js';

export function createBlobAdapter(environment: NodeJS.ProcessEnv): BlobPort {
  const { readWriteToken } = parseBlobConfig(environment);
  return {
    async ping() {
      await list({ limit: 1, token: readWriteToken });
    },
  };
}
