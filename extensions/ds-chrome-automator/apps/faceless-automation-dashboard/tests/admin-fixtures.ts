import type {
  AdminSession,
  GuideAdminDocument,
  GuidePublicDocument,
  PlatformApi,
  PlatformSettings,
} from '../src/admin/api';

export const adminSessionFixture: AdminSession = {
  schemaVersion: 1,
  account: {
    userId: 'admin_user_0001',
    provider: 'google',
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin',
  },
  csrfToken: 'csrf-token-00000000000000000000000000000000',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

export const platformSettingsFixture: PlatformSettings = {
  schemaVersion: 1,
  revision: 'revision-0001',
  updatedAt: '2026-08-16T00:00:00.000Z',
  seo: {
    siteTitle: 'Paks Tools Faceless automations',
    siteDescription: 'One secure home for focused browser automation tools.',
    openGraphTitle: 'Paks Tools Faceless automations',
    openGraphDescription:
      'One secure home for focused browser automation tools.',
    socialImageUrl: null,
  },
  theme: {
    colors: {
      canvas: '#050505',
      surface: '#0b0b0b',
      ink: '#f7f7f5',
      mutedInk: '#a1a1a1',
      border: '#3a3a3a',
      gold: '#d4af37',
    },
    fonts: {
      display: 'Instrument Serif',
      body: 'Manrope',
      metadata: 'IBM Plex Mono',
    },
  },
};

export const guideDocumentFixture: GuideAdminDocument = {
  schemaVersion: 1,
  slug: 'grok-automator',
  appId: 'grok-automator',
  title: 'Grok Automator guide',
  summary: 'Operate Grok Automator safely from setup through export.',
  status: 'published',
  content: {
    schemaVersion: 1,
    sections: [
      {
        id: 'getting-started',
        title: 'Getting started',
        blocks: [
          { type: 'heading', level: 3, text: 'Before you begin' },
          {
            type: 'paragraph',
            text: 'Connect the extension with your verified Paks Tools account.',
          },
          {
            type: 'list',
            style: 'ordered',
            items: ['Open Grok.', 'Review the prompt queue.', 'Start the run.'],
          },
          {
            type: 'callout',
            tone: 'warning',
            title: 'Keep the tab open',
            text: 'Closing the active Grok tab interrupts the current run.',
          },
          {
            type: 'link',
            label: 'Return to all tools',
            href: '/',
          },
        ],
      },
    ],
  },
  revision: '3',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T01:00:00.000Z',
  publishedAt: '2026-08-20T01:00:00.000Z',
  updatedBy: {
    userId: 'admin_user_00000001',
    displayName: 'Admin User',
  },
};

export const publicGuideFixture: GuidePublicDocument = {
  schemaVersion: guideDocumentFixture.schemaVersion,
  slug: guideDocumentFixture.slug,
  appId: guideDocumentFixture.appId,
  title: guideDocumentFixture.title,
  summary: guideDocumentFixture.summary,
  content: guideDocumentFixture.content,
  revision: guideDocumentFixture.revision,
  createdAt: guideDocumentFixture.createdAt,
  updatedAt: guideDocumentFixture.updatedAt,
  publishedAt: guideDocumentFixture.publishedAt ?? '2026-08-20T01:00:00.000Z',
};

export function createAdminApiStub(
  overrides: Partial<PlatformApi> = {},
): PlatformApi {
  return {
    getPublicPlatformSettings: vi.fn().mockRejectedValue(new Error('unused')),
    getPublicGuide: vi.fn().mockRejectedValue(new Error('unused')),
    getExtensionAuthFlow: vi.fn().mockRejectedValue(new Error('unused')),
    verifyExtensionAuthFlow: vi.fn().mockRejectedValue(new Error('unused')),
    getAdminSession: vi.fn().mockResolvedValue(adminSessionFixture),
    getAdminOverview: vi.fn().mockRejectedValue(new Error('unused')),
    listGuides: vi.fn().mockRejectedValue(new Error('unused')),
    createGuide: vi.fn().mockRejectedValue(new Error('unused')),
    getGuide: vi.fn().mockRejectedValue(new Error('unused')),
    updateGuide: vi.fn().mockRejectedValue(new Error('unused')),
    getPlatformSettings: vi.fn().mockRejectedValue(new Error('unused')),
    updatePlatformSettings: vi.fn().mockRejectedValue(new Error('unused')),
    listUsers: vi.fn().mockRejectedValue(new Error('unused')),
    setUserBan: vi.fn().mockRejectedValue(new Error('unused')),
    listEntitlements: vi.fn().mockRejectedValue(new Error('unused')),
    revokeEntitlement: vi.fn().mockRejectedValue(new Error('unused')),
    listAuditEvents: vi.fn().mockRejectedValue(new Error('unused')),
    logout: vi.fn().mockRejectedValue(new Error('unused')),
    ...overrides,
  };
}
