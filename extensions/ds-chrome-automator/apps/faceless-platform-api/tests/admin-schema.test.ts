import { describe, expect, it } from 'vitest';

import { platformSettingsSchema } from '../src/schemas/admin.js';
import { platformSettings } from './helpers.js';

describe('admin settings contract', () => {
  it('accepts the bundled accessible theme', () => {
    expect(platformSettingsSchema.parse(platformSettings)).toEqual(
      platformSettings,
    );
  });

  it('rejects inaccessible stored color pairs', () => {
    expect(() =>
      platformSettingsSchema.parse({
        ...platformSettings,
        theme: {
          ...platformSettings.theme,
          colors: {
            ...platformSettings.theme.colors,
            ink: '#101010',
          },
        },
      }),
    ).toThrow();
  });

  it('rejects social image URLs with credentials or fragments', () => {
    expect(() =>
      platformSettingsSchema.parse({
        ...platformSettings,
        seo: {
          ...platformSettings.seo,
          socialImageUrl: 'https://user:pass@example.com/social.png#secret',
        },
      }),
    ).toThrow();
  });
});
