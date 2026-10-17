import { IconKeyOff, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useAdmin } from '../../admin/AdminContext';
import {
  AdminPageHeader,
  ConfirmActionDialog,
  EmptyPanel,
  LoadingPanel,
  SearchControl,
  StatusBadge,
  UnavailablePanel,
  type ConfirmAction,
} from '../../admin/AdminUi';
import type { AdminEntitlement, AdminEntitlementList } from '../../admin/api';
import { formatDateTime } from '../../admin/format';

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; result: AdminEntitlementList };

interface SelectedEntitlement {
  entitlement: AdminEntitlement;
  action: ConfirmAction;
}

export default function EntitlementsPage() {
  const { api } = useAdmin();
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [selected, setSelected] = useState<SelectedEntitlement | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => {
      void api
        .listEntitlements(activeQuery, signal)
        .then((result) => setState({ status: 'ready', result }))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return;
          setState({ status: 'unavailable' });
        });
    },
    [activeQuery, api],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [attempt, load]);

  function search(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setState({ status: 'loading' });
    setActiveQuery(query.trim());
    setAttempt((value) => value + 1);
  }

  function selectEntitlement(entitlement: AdminEntitlement): void {
    setMutationError(null);
    setSelected({
      entitlement,
      action: {
        title: 'Revoke this entitlement?',
        description: `${entitlement.userEmail} will immediately lose access to ${entitlement.code}. This does not issue a Stripe refund.`,
        confirmLabel: 'Revoke entitlement',
        tone: 'danger',
      },
    });
  }

  async function confirmRevocation(reason: string): Promise<void> {
    if (selected === null || mutating) return;
    setMutating(true);
    setMutationError(null);
    try {
      await api.revokeEntitlement(selected.entitlement.id, reason);
      setSelected(null);
      setState({ status: 'loading' });
      setAttempt((value) => value + 1);
    } catch {
      setMutationError('The platform API did not revoke this entitlement.');
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="admin-page">
      <AdminPageHeader
        title="Entitlements"
        description="Inspect product access and revoke individual grants."
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

      <form className="admin-toolbar" role="search" onSubmit={search}>
        <SearchControl
          value={query}
          label="Search by user, product or entitlement"
          onChange={setQuery}
        />
        <button className="admin-button admin-button--secondary" type="submit">
          Search
        </button>
      </form>

      {state.status === 'loading' ? (
        <LoadingPanel label="Loading entitlements" />
      ) : null}
      {state.status === 'unavailable' ? (
        <UnavailablePanel
          title="Entitlements unavailable"
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      {state.status === 'ready' && state.result.items.length === 0 ? (
        <EmptyPanel
          title="No matching entitlements"
          description="The platform API returned no access grants for this search."
        />
      ) : null}

      {state.status === 'ready' && state.result.items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Product</th>
                <th>Source</th>
                <th>Status</th>
                <th>Expires</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.result.items.map((entitlement) => (
                <tr key={entitlement.id}>
                  <td>
                    <strong>{entitlement.userEmail}</strong>
                    <small className="admin-mono">{entitlement.userId}</small>
                  </td>
                  <td>
                    <strong>{entitlement.code}</strong>
                    <small className="admin-mono">{entitlement.id}</small>
                  </td>
                  <td>{entitlement.source}</td>
                  <td>
                    <StatusBadge status={entitlement.status} />
                  </td>
                  <td className="admin-mono">
                    {formatDateTime(entitlement.expiresAt)}
                  </td>
                  <td className="admin-table__action">
                    <button
                      className="admin-row-action admin-row-action--danger"
                      type="button"
                      disabled={entitlement.status !== 'active'}
                      onClick={() => selectEntitlement(entitlement)}
                    >
                      <IconKeyOff aria-hidden="true" stroke={1.75} />
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ConfirmActionDialog
        action={selected?.action ?? null}
        busy={mutating}
        error={mutationError}
        onCancel={() => {
          if (!mutating) setSelected(null);
        }}
        onConfirm={confirmRevocation}
      />
    </div>
  );
}
