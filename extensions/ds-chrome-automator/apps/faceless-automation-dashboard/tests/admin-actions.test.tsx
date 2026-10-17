import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdminContext } from '../src/admin/AdminContext';
import EntitlementsPage from '../src/pages/admin/EntitlementsPage';
import UsersPage from '../src/pages/admin/UsersPage';
import { adminSessionFixture, createAdminApiStub } from './admin-fixtures';

describe('admin account and entitlement actions', () => {
  it('requires an audit reason before banning a user', async () => {
    const setUserBan = vi.fn().mockResolvedValue(undefined);
    const listUsers = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'customer_user_0001',
          email: 'customer@example.com',
          displayName: 'Customer One',
          status: 'active',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastLoginAt: '2026-08-16T00:00:00.000Z',
          bannedAt: null,
          banReason: null,
        },
      ],
      nextCursor: null,
    });
    const api = createAdminApiStub({ listUsers, setUserBan });
    render(
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <UsersPage />
      </AdminContext.Provider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Ban' }));
    const submit = screen.getByRole('button', { name: 'Ban user' });
    expect(submit).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText('Audit reason'),
      'Confirmed abusive activity',
    );
    await userEvent.click(submit);

    await waitFor(() =>
      expect(setUserBan).toHaveBeenCalledWith(
        'customer_user_0001',
        true,
        'Confirmed abusive activity',
      ),
    );
  });

  it('makes entitlement revocation explicit and does not claim a Stripe refund', async () => {
    const revokeEntitlement = vi.fn().mockResolvedValue(undefined);
    const api = createAdminApiStub({
      listEntitlements: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'entitlement_0001',
            userId: 'customer_user_0001',
            userEmail: 'customer@example.com',
            code: 'extension:grok-automator',
            status: 'active',
            source: 'stripe',
            grantedAt: '2026-08-01T00:00:00.000Z',
            expiresAt: null,
            revokedAt: null,
            revokeReason: null,
          },
        ],
        nextCursor: null,
      }),
      revokeEntitlement,
    });
    render(
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <EntitlementsPage />
      </AdminContext.Provider>,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Revoke' }),
    );
    expect(
      screen.getByText(/does not issue a Stripe refund/iu),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText('Audit reason'),
      'Customer request',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Revoke entitlement' }),
    );

    await waitFor(() =>
      expect(revokeEntitlement).toHaveBeenCalledWith(
        'entitlement_0001',
        'Customer request',
      ),
    );
  });
});
