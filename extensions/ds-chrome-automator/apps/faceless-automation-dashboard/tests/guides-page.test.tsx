import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AdminContext } from '../src/admin/AdminContext';
import GuidesPage from '../src/pages/admin/GuidesPage';
import {
  adminSessionFixture,
  createAdminApiStub,
  guideDocumentFixture,
} from './admin-fixtures';

describe('GuidesPage', () => {
  it('lists current and future tool guides with create, edit, and published links', async () => {
    const api = createAdminApiStub({
      listGuides: vi.fn().mockResolvedValue({
        items: [
          {
            schemaVersion: 1,
            slug: guideDocumentFixture.slug,
            appId: guideDocumentFixture.appId,
            title: guideDocumentFixture.title,
            summary: guideDocumentFixture.summary,
            status: guideDocumentFixture.status,
            revision: guideDocumentFixture.revision,
            updatedAt: guideDocumentFixture.updatedAt,
            publishedAt: guideDocumentFixture.publishedAt,
          },
        ],
      }),
    });
    render(
      <MemoryRouter>
        <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
          <GuidesPage />
        </AdminContext.Provider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Grok Automator guide')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New guide' })).toHaveAttribute(
      'href',
      '/admin/guides/new',
    );
    expect(
      screen.getByRole('link', { name: 'Edit Grok Automator guide' }),
    ).toHaveAttribute('href', '/admin/guides/grok-automator/edit');
    expect(
      screen.getByRole('link', { name: 'Open published Grok Automator guide' }),
    ).toHaveAttribute('href', '/guide/grok-automator');
  });

  it('fails closed without displaying stale guide rows', async () => {
    const api = createAdminApiStub({
      listGuides: vi.fn().mockRejectedValue(new Error('offline')),
    });
    render(
      <MemoryRouter>
        <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
          <GuidesPage />
        </AdminContext.Provider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('Guide library unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Grok Automator guide')).not.toBeInTheDocument();
  });
});
