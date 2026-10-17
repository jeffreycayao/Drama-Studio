import {
  IconRefresh,
  IconUserCancel,
  IconUserCheck,
} from '@tabler/icons-react';
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
import type { AdminUser, AdminUserList } from '../../admin/api';
import { formatDateTime } from '../../admin/format';

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; result: AdminUserList };

interface SelectedUser {
  user: AdminUser;
  banned: boolean;
  action: ConfirmAction;
}

export default function UsersPage() {
  const { api, session } = useAdmin();
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [selected, setSelected] = useState<SelectedUser | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => {
      void api
        .listUsers(activeQuery, signal)
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

  function selectUser(user: AdminUser): void {
    const banned = user.status === 'active';
    setMutationError(null);
    setSelected({
      user,
      banned,
      action: {
        title: banned ? 'Ban this user?' : 'Restore this user?',
        description: banned
          ? `${user.email} will lose access to all Paks Tools Faceless automations services until an administrator restores the account.`
          : `${user.email} will be allowed to sign in again. Existing entitlements remain independently enforced.`,
        confirmLabel: banned ? 'Ban user' : 'Restore user',
        tone: banned ? 'danger' : 'neutral',
      },
    });
  }

  async function confirmMutation(reason: string): Promise<void> {
    if (selected === null || mutating) return;
    setMutating(true);
    setMutationError(null);
    try {
      await api.setUserBan(selected.user.id, selected.banned, reason);
      setSelected(null);
      setState({ status: 'loading' });
      setAttempt((value) => value + 1);
    } catch {
      setMutationError('The platform API did not apply this account change.');
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="admin-page">
      <AdminPageHeader
        title="Users"
        description="Review Google-authenticated accounts and enforce account access."
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
          label="Search users by name or email"
          onChange={setQuery}
        />
        <button className="admin-button admin-button--secondary" type="submit">
          Search
        </button>
      </form>

      {state.status === 'loading' ? (
        <LoadingPanel label="Loading users" />
      ) : null}
      {state.status === 'unavailable' ? (
        <UnavailablePanel
          title="User directory unavailable"
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      {state.status === 'ready' && state.result.items.length === 0 ? (
        <EmptyPanel
          title="No matching users"
          description="The platform API returned no accounts for this search."
        />
      ) : null}

      {state.status === 'ready' && state.result.items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Last seen</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.result.items.map((user) => {
                const isCurrentAdmin = user.id === session.account.userId;
                return (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.displayName ?? 'Unnamed user'}</strong>
                      <small>{user.email}</small>
                    </td>
                    <td>
                      <StatusBadge status={user.status} />
                    </td>
                    <td className="admin-mono">
                      {formatDateTime(user.createdAt)}
                    </td>
                    <td className="admin-mono">
                      {formatDateTime(user.lastLoginAt)}
                    </td>
                    <td className="admin-table__action">
                      <button
                        className={`admin-row-action${user.status === 'active' ? ' admin-row-action--danger' : ''}`}
                        type="button"
                        disabled={isCurrentAdmin}
                        title={
                          isCurrentAdmin
                            ? 'You cannot ban the active administrator session.'
                            : undefined
                        }
                        onClick={() => selectUser(user)}
                      >
                        {user.status === 'active' ? (
                          <IconUserCancel aria-hidden="true" stroke={1.75} />
                        ) : (
                          <IconUserCheck aria-hidden="true" stroke={1.75} />
                        )}
                        {user.status === 'active' ? 'Ban' : 'Restore'}
                      </button>
                    </td>
                  </tr>
                );
              })}
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
        onConfirm={confirmMutation}
      />
    </div>
  );
}
