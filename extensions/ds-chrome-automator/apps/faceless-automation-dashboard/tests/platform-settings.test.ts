import { platformSettingsSchema } from '../src/admin/api';
import { applyPlatformSettings } from '../src/platform/apply-settings';
import { platformSettingsFixture } from './admin-fixtures';

describe('platform settings boundary', () => {
  it('accepts only bundled font families, accessible named colors and HTTPS social images', () => {
    expect(
      platformSettingsSchema.safeParse(platformSettingsFixture).success,
    ).toBe(true);

    expect(
      platformSettingsSchema.safeParse({
        ...platformSettingsFixture,
        seo: {
          ...platformSettingsFixture.seo,
          socialImageUrl: 'http://assets.example.com/share.png',
        },
      }).success,
    ).toBe(false);

    expect(
      platformSettingsSchema.safeParse({
        ...platformSettingsFixture,
        theme: {
          ...platformSettingsFixture.theme,
          colors: {
            ...platformSettingsFixture.theme.colors,
            ink: '#101010',
          },
        },
      }).success,
    ).toBe(false);

    expect(
      platformSettingsSchema.safeParse({
        ...platformSettingsFixture,
        theme: {
          ...platformSettingsFixture.theme,
          fonts: {
            ...platformSettingsFixture.theme.fonts,
            body: 'Remote Sans',
          },
        },
      }).success,
    ).toBe(false);
  });

  it('applies validated public metadata and local font roles without runtime assets', () => {
    applyPlatformSettings({
      ...platformSettingsFixture,
      seo: {
        ...platformSettingsFixture.seo,
        siteTitle: 'Custom Studio',
        socialImageUrl: 'https://assets.example.com/share.png',
      },
    });

    expect(document.title).toBe('Custom Studio');
    expect(
      document.head.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toBe(platformSettingsFixture.seo.siteDescription);
    expect(
      document.head.querySelector<HTMLMetaElement>('meta[property="og:image"]')
        ?.content,
    ).toBe('https://assets.example.com/share.png');
    expect(
      document.documentElement.style.getPropertyValue('--fa-font-display'),
    ).toContain('Instrument Serif');
    expect(document.documentElement.style.getPropertyValue('--canvas')).toBe(
      '#050505',
    );
  });
});
