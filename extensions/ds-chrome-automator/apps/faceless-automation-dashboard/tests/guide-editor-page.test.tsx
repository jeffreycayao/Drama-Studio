import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AdminContext } from '../src/admin/AdminContext';
import { ApiFailure, type PlatformApi } from '../src/admin/api';
import GuideEditorPage from '../src/pages/admin/GuideEditorPage';
import {
  adminSessionFixture,
  createAdminApiStub,
  guideDocumentFixture,
} from './admin-fixtures';

function renderEditor(api: PlatformApi, create = false) {
  return render(
    <MemoryRouter
      initialEntries={[
        create ? '/admin/guides/new' : '/admin/guides/grok-automator/edit',
      ]}
    >
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <Routes>
          <Route
            path="/admin/guides/new"
            element={<GuideEditorPage create />}
          />
          <Route
            path="/admin/guides/:slug/edit"
            element={<GuideEditorPage />}
          />
        </Routes>
      </AdminContext.Provider>
    </MemoryRouter>,
  );
}

describe('GuideEditorPage', () => {
  it('saves an edited guide with the loaded optimistic revision', async () => {
    const updateGuide = vi
      .fn()
      .mockImplementation(
        async (
          _slug: string,
          input: Parameters<PlatformApi['updateGuide']>[1],
        ) => ({
          ...guideDocumentFixture,
          ...input,
          revision: '4',
          updatedAt: '2026-08-20T02:00:00.000Z',
        }),
      );
    const api = createAdminApiStub({
      getGuide: vi.fn().mockResolvedValue(guideDocumentFixture),
      updateGuide,
    });
    renderEditor(api);

    const title = await screen.findByLabelText('Guide title');
    expect(
      screen.getByRole('button', { name: 'Save revision' }),
    ).toBeDisabled();
    await userEvent.clear(title);
    await userEvent.type(title, 'Grok Automator operating guide');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save revision' }),
    );

    expect(updateGuide).toHaveBeenCalledWith(
      'grok-automator',
      expect.objectContaining({
        expectedRevision: '3',
        title: 'Grok Automator operating guide',
      }),
    );
    expect(
      await screen.findByText('Guide revision saved and published.'),
    ).toBeInTheDocument();
  });

  it('preserves the local draft when another administrator wins the revision', async () => {
    const api = createAdminApiStub({
      getGuide: vi.fn().mockResolvedValue(guideDocumentFixture),
      updateGuide: vi
        .fn()
        .mockRejectedValue(
          new ApiFailure('conflict', 'Guide changed; refresh and retry'),
        ),
    });
    renderEditor(api);

    const title = await screen.findByLabelText('Guide title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Preserved local draft');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save revision' }),
    );

    expect(
      await screen.findByText(/This guide changed on the server/u),
    ).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText('Guide title')).toHaveValue(
      'Preserved local draft',
    );
    expect(
      screen.getByRole('button', { name: 'Discard draft and load latest' }),
    ).toBeInTheDocument();
  });

  it('creates a future-tool guide through structured fields without a client revision', async () => {
    const createGuide = vi
      .fn()
      .mockImplementation(
        async (input: Parameters<PlatformApi['createGuide']>[0]) => ({
          schemaVersion: 1 as const,
          ...input,
          revision: '0',
          createdAt: '2026-08-20T03:00:00.000Z',
          updatedAt: '2026-08-20T03:00:00.000Z',
          publishedAt: null,
          updatedBy: {
            userId: 'admin_user_00000001',
            displayName: 'Admin User',
          },
        }),
      );
    const api = createAdminApiStub({
      createGuide,
      getGuide: vi.fn().mockImplementation(async (slug: string) => ({
        ...guideDocumentFixture,
        slug,
        appId: 'future-tool',
        title: 'Future Tool guide',
        status: 'draft' as const,
        publishedAt: null,
        revision: '0',
      })),
    });
    renderEditor(api, true);

    await userEvent.type(screen.getByLabelText('Guide slug'), 'future-tool');
    await userEvent.type(
      screen.getByLabelText('Application ID'),
      'future-tool',
    );
    await userEvent.type(
      screen.getByLabelText('Guide title'),
      'Future Tool guide',
    );
    await userEvent.type(
      screen.getByLabelText('Guide summary'),
      'A safe manual for a future automation tool.',
    );
    await userEvent.type(
      screen.getByLabelText('Block 1 paragraph text'),
      'Start with an owner-controlled account.',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save revision' }),
    );

    await waitFor(() => expect(createGuide).toHaveBeenCalledTimes(1));
    expect(createGuide).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'future-tool',
        appId: 'future-tool',
        title: 'Future Tool guide',
        status: 'draft',
        content: expect.objectContaining({ schemaVersion: 1 }),
      }),
    );
    expect(createGuide.mock.calls[0]?.[0]).not.toHaveProperty(
      'expectedRevision',
    );
  });

  it('offers repeatable safe block controls and rejects leading-digit identifiers', async () => {
    const api = createAdminApiStub({ createGuide: vi.fn() });
    renderEditor(api, true);

    const slug = screen.getByLabelText('Guide slug');
    const appId = screen.getByLabelText('Application ID');
    expect(slug).toHaveAttribute('pattern', '[a-z][a-z0-9]*(?:-[a-z0-9]+)*');
    expect(appId).toHaveAttribute('pattern', '[a-z][a-z0-9]*(?:-[a-z0-9]+)*');

    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByLabelText('Block 2 list item 1')).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText('Block 2 list item 1'),
      'First step',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Add list item' }),
    );
    expect(screen.getByLabelText('Block 2 list item 2')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Move block 2 up' }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Remove block 2' }),
    ).toBeEnabled();
  });
});
