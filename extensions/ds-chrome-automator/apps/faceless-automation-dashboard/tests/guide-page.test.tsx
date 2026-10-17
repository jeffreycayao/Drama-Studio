import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ApiFailure } from '../src/admin/api';
import GuidePage from '../src/pages/GuidePage';
import { createAdminApiStub, publicGuideFixture } from './admin-fixtures';

describe('GuidePage', () => {
  it('renders a verified structured guide and builds a section table of contents', async () => {
    const api = createAdminApiStub({
      getPublicGuide: vi.fn().mockResolvedValue(publicGuideFixture),
    });
    render(
      <MemoryRouter>
        <GuidePage api={api} slug="grok-automator" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Grok Automator guide',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'On this page' }),
    ).toHaveTextContent('Getting started');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Getting started' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Before you begin' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Open Grok.').closest('ol')).toBeInTheDocument();
    expect(screen.getByText('Keep the tab open')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Return to all tools' }),
    ).toHaveAttribute('href', '/');
  });

  it('renders hostile-looking text as text without creating executable elements', async () => {
    const hostileText = '<img src=x onerror=alert(1)>';
    const api = createAdminApiStub({
      getPublicGuide: vi.fn().mockResolvedValue({
        ...publicGuideFixture,
        content: {
          schemaVersion: 1,
          sections: [
            {
              id: 'safe-rendering',
              title: 'Safe rendering',
              blocks: [{ type: 'paragraph', text: hostileText }],
            },
          ],
        },
      }),
    });
    const { container } = render(
      <MemoryRouter>
        <GuidePage api={api} slug="grok-automator" />
      </MemoryRouter>,
    );

    expect(await screen.findByText(hostileText)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('distinguishes unpublished or missing guides from temporary API failure', async () => {
    const missingApi = createAdminApiStub({
      getPublicGuide: vi
        .fn()
        .mockRejectedValue(new ApiFailure('not-found', 'Guide was not found.')),
    });
    const { unmount } = render(
      <MemoryRouter>
        <GuidePage api={missingApi} slug="grok-automator" />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Guide not found' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
    unmount();

    const getPublicGuide = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure('network', 'Offline.'))
      .mockResolvedValueOnce(publicGuideFixture);
    render(
      <MemoryRouter>
        <GuidePage
          api={createAdminApiStub({ getPublicGuide })}
          slug="grok-automator"
        />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Guide temporarily unavailable',
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Grok Automator guide',
      }),
    ).toBeInTheDocument();
  });
});
