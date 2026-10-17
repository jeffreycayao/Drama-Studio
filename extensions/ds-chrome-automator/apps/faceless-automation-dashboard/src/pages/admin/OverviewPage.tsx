import { IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';

import { useAdmin } from '../../admin/AdminContext';
import {
  AdminPageHeader,
  EmptyPanel,
  LoadingPanel,
  UnavailablePanel,
} from '../../admin/AdminUi';
import type { AdminAuditEventList, AdminOverview } from '../../admin/api';
import { formatDateTime } from '../../admin/format';

type OverviewState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; overview: AdminOverview; audit: AdminAuditEventList };

export default function OverviewPage() {
  const { api } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OverviewState>({ status: 'loading' });

  const load = useCallback(
    (signal: AbortSignal) => {
      void Promise.all([
        api.getAdminOverview(signal),
        api.listAuditEvents(undefined, signal),
      ])
        .then(([overview, audit]) =>
          setState({ status: 'ready', overview, audit }),
        )
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return;
          setState({ status: 'unavailable' });
        });
    },
    [api],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [attempt, load]);

  return (
    <div className="admin-page">
      <AdminPageHeader
        title="Overview"
        description="Verified platform access, licensing and administrative activity."
        action={
          <button
            className="admin-button admin-button--secondary"
            type="button"
            onClick={() => {
              setState({ status: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            <IconRefresh aria-hidden="true" stroke={1.75} />
            Refresh
          </button>
        }
      />

      {state.status === 'loading' ? <LoadingPanel /> : null}
      {state.status === 'unavailable' ? (
        <UnavailablePanel
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}

      {state.status === 'ready' ? (
        <>
          <section aria-labelledby="verified-metrics-heading">
            <div className="admin-section-heading">
              <div>
                <h2 id="verified-metrics-heading">Verified metrics</h2>
                <p>Live values returned by the platform API.</p>
              </div>
            </div>
            <dl className="admin-metrics">
              <div>
                <dt>Users</dt>
                <dd>{state.overview.users.total.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Active entitlements</dt>
                <dd>{state.overview.entitlements.active.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Banned users</dt>
                <dd>{state.overview.users.banned.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Pending Stripe events</dt>
                <dd>{state.overview.pendingStripeEvents.toLocaleString()}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="recent-activity-heading">
            <div className="admin-section-heading">
              <div>
                <h2 id="recent-activity-heading">Recent audit activity</h2>
                <p>Server-recorded administrative actions.</p>
              </div>
            </div>
            {state.audit.items.length === 0 ? (
              <EmptyPanel
                title="No audit activity"
                description="No administrative events were returned by the platform API."
              />
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Resource</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.audit.items.slice(0, 5).map((event) => (
                      <tr key={event.id}>
                        <td className="admin-mono">
                          {formatDateTime(event.createdAt)}
                        </td>
                        <td className="admin-mono">{event.actorUserId}</td>
                        <td>{event.action}</td>
                        <td>
                          {event.targetType}:{event.targetId}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
