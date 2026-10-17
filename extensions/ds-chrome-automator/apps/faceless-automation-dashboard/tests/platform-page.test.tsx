import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdminContext } from '../src/admin/AdminContext';
import PlatformPage from '../src/pages/admin/PlatformPage';
import {
  adminSessionFixture,
  createAdminApiStub,
  platformSettingsFixture,
} from './admin-fixtures';

describe('PlatformPage', () => {
  it('shows no editable settings when the API is unavailable', async () => {
    const api = createAdminApiStub({
      getPlatformSettings: vi.fn().mockRejectedValue(new Error('offline')),
    });
    render(
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <PlatformPage />
      </AdminContext.Provider>,
    );

    expect(
      await screen.findByText('Platform settings unavailable'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Site title')).not.toBeInTheDocument();
  });

  it('loads validated settings and saves only a changed draft', async () => {
    const updatePlatformSettings = vi
      .fn()
      .mockResolvedValue(platformSettingsFixture);
    const api = createAdminApiStub({
      getPlatformSettings: vi.fn().mockResolvedValue(platformSettingsFixture),
      updatePlatformSettings,
    });
    render(
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <PlatformPage />
      </AdminContext.Provider>,
    );

    const title = await screen.findByLabelText('Site title');
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    await userEvent.clear(title);
    await userEvent.type(title, 'Custom Automation Studio');
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(updatePlatformSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        seo: expect.objectContaining({
          siteTitle: 'Custom Automation Studio',
        }),
      }),
    );
    expect(
      await screen.findByText('Platform settings saved and audited.'),
    ).toBeInTheDocument();
  });
});
