import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AdminContext } from '../src/admin/AdminContext';
import AuditPage from '../src/pages/admin/AuditPage';
import { adminSessionFixture, createAdminApiStub } from './admin-fixtures';

const auditCursor = 'A'.repeat(64);

const newestEvent = {
  id: 'audit_event_0003',
  actorUserId: 'admin_user_0001',
  action: 'user.ban',
  targetType: 'user',
  targetId: 'customer_user_0003',
  reason: 'Confirmed abuse',
  createdAt: '2026-08-20T03:00:00.000Z',
} as const;

const olderEvent = {
  id: 'audit_event_0002',
  actorUserId: 'admin_user_0001',
  action: 'entitlement.revoke',
  targetType: 'entitlement',
  targetId: 'entitlement_0002',
  reason: 'Customer request',
  createdAt: '2026-08-19T03:00:00.000Z',
} as const;

describe('audit activity pagination', () => {
  it('loads nextCursor pages and keeps events in newest-first order', async () => {
    const listAuditEvents = vi
      .fn()
      .mockResolvedValueOnce({
        items: [newestEvent],
        nextCursor: auditCursor,
      })
      .mockResolvedValueOnce({ items: [olderEvent], nextCursor: null });
    const api = createAdminApiStub({ listAuditEvents });

    render(
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <AuditPage />
      </AdminContext.Provider>,
    );

    expect(await screen.findByText('user.ban')).toBeInTheDocument();
    expect(listAuditEvents).toHaveBeenNthCalledWith(
      1,
      undefined,
      expect.any(AbortSignal),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Load older activity' }),
    );

    expect(await screen.findByText('entitlement.revoke')).toBeInTheDocument();
    expect(listAuditEvents).toHaveBeenNthCalledWith(
      2,
      auditCursor,
      expect.any(AbortSignal),
    );
    expect(
      screen.queryByRole('button', { name: 'Load older activity' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'All audit activity is loaded',
    );

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('user.ban');
    expect(rows[2]).toHaveTextContent('entitlement.revoke');
  });

  it('retains verified rows and announces a later-page failure', async () => {
    const listAuditEvents = vi
      .fn()
      .mockResolvedValueOnce({
        items: [newestEvent],
        nextCursor: auditCursor,
      })
      .mockRejectedValueOnce(new Error('network unavailable'));
    const api = createAdminApiStub({ listAuditEvents });

    render(
      <AdminContext.Provider value={{ api, session: adminSessionFixture }}>
        <AuditPage />
      </AdminContext.Provider>,
    );

    await userEvent.click(
      await screen.findByRole('button', { name: 'Load older activity' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Existing verified events remain visible',
      ),
    );
    expect(screen.getByText('user.ban')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Load older activity' }),
    ).toBeEnabled();
  });
});
