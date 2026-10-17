import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { AdminGate } from '../src/admin/AdminGate';
import { ApiFailure } from '../src/admin/api';
import { createAdminApiStub } from './admin-fixtures';

function renderGate(api = createAdminApiStub()) {
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <Routes>
        <Route
          path="/admin/*"
          element={
            <AdminGate bootstrapApi={api} createAuthorizedApi={() => api} />
          }
        >
          <Route path="users" element={<div>Protected user directory</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminGate', () => {
  it('renders protected content only after an admin session is verified', async () => {
    renderGate();

    expect(screen.getByText('Verifying admin access')).toBeInTheDocument();
    expect(
      await screen.findByText('Protected user directory'),
    ).toBeInTheDocument();
  });

  it('routes an unauthenticated user only to Google sign-in', async () => {
    const api = createAdminApiStub({
      getAdminSession: vi
        .fn()
        .mockRejectedValue(new ApiFailure('unauthorized', 'Sign in required.')),
    });
    renderGate(api);

    const link = await screen.findByRole('link', {
      name: 'Continue with Google',
    });
    expect(link).toHaveAttribute('href', '/auth?returnTo=%2Fadmin%2Fusers');
    expect(
      screen.queryByText('Protected user directory'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('fails closed when the API is unavailable and retries verification', async () => {
    const getAdminSession = vi
      .fn()
      .mockRejectedValueOnce(new ApiFailure('network', 'Offline.'))
      .mockResolvedValueOnce({
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
      });
    const api = createAdminApiStub({ getAdminSession });
    renderGate(api);

    expect(
      await screen.findByRole('heading', { name: 'Admin console unavailable' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Protected user directory'),
    ).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Retry verification' }),
    );
    await waitFor(() => expect(getAdminSession).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByText('Protected user directory'),
    ).toBeInTheDocument();
  });

  it('does not render controls for a signed-in non-admin account', async () => {
    const api = createAdminApiStub({
      getAdminSession: vi
        .fn()
        .mockRejectedValue(new ApiFailure('forbidden', 'Admin required.')),
    });
    renderGate(api);

    expect(
      await screen.findByRole('heading', {
        name: 'Administrator access required',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Protected user directory'),
    ).not.toBeInTheDocument();
  });
});
