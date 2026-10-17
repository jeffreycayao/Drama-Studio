import { IconChevronDown, IconLoader2, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { useAdmin } from '../../admin/AdminContext';
import {
  AdminPageHeader,
  EmptyPanel,
  LoadingPanel,
  UnavailablePanel,
} from '../../admin/AdminUi';
import type { AdminAuditEvent, AdminAuditEventList } from '../../admin/api';
import { formatDateTime } from '../../admin/format';

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | {
      status: 'ready';
      result: AdminAuditEventList;
      loadingMore: boolean;
      paginationMessage: string;
    };

function newestFirst(events: readonly AdminAuditEvent[]): AdminAuditEvent[] {
  return [...events].sort((left, right) => {
    const byTime = right.createdAt.localeCompare(left.createdAt);
    return byTime === 0 ? right.id.localeCompare(left.id) : byTime;
  });
}

function mergeAuditEvents(
  current: readonly AdminAuditEvent[],
  incoming: readonly AdminAuditEvent[],
): AdminAuditEvent[] {
  const byId = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) byId.set(event.id, event);
  return newestFirst([...byId.values()]);
}

export default function AuditPage() {
  const { api } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const paginationController = useRef<AbortController | null>(null);
  const paginationStatusId = useId();

  const load = useCallback(
    (signal: AbortSignal) => {
      void api
        .listAuditEvents(undefined, signal)
        .then((result) =>
          setState({
            status: 'ready',
            result: { ...result, items: newestFirst(result.items) },
            loadingMore: false,
            paginationMessage:
              result.nextCursor === null
                ? 'All audit activity is loaded.'
                : 'More audit activity is available.',
          }),
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
    return () => {
      controller.abort();
      paginationController.current?.abort();
    };
  }, [attempt, load]);

  const loadMore = useCallback(() => {
    if (
      state.status !== 'ready' ||
      state.loadingMore ||
      state.result.nextCursor === null
    ) {
      return;
    }

    const cursor = state.result.nextCursor;
    paginationController.current?.abort();
    const controller = new AbortController();
    paginationController.current = controller;
    setState({
      ...state,
      loadingMore: true,
      paginationMessage: 'Loading older audit activity.',
    });

    void api
      .listAuditEvents(cursor, controller.signal)
      .then((result) => {
        setState((current) => {
          if (
            current.status !== 'ready' ||
            current.result.nextCursor !== cursor
          ) {
            return current;
          }
          const items = mergeAuditEvents(current.result.items, result.items);
          const loadedCount = items.length - current.result.items.length;
          return {
            status: 'ready',
            result: { ...result, items },
            loadingMore: false,
            paginationMessage:
              result.nextCursor === null
                ? `Loaded ${loadedCount} older ${loadedCount === 1 ? 'event' : 'events'}. All audit activity is loaded.`
                : `Loaded ${loadedCount} older ${loadedCount === 1 ? 'event' : 'events'}.`,
          };
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setState((current) =>
          current.status === 'ready' && current.result.nextCursor === cursor
            ? {
                ...current,
                loadingMore: false,
                paginationMessage:
                  'Older audit activity could not be loaded. Existing verified events remain visible.',
              }
            : current,
        );
      })
      .finally(() => {
        if (paginationController.current === controller) {
          paginationController.current = null;
        }
      });
  }, [api, state]);

  function refresh(): void {
    paginationController.current?.abort();
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }

  return (
    <div className="admin-page">
      <AdminPageHeader
        title="Audit activity"
        description="Review server-recorded administrative changes and their reasons."
        action={
          <button
            className="admin-button admin-button--secondary"
            type="button"
            onClick={refresh}
          >
            <IconRefresh aria-hidden="true" stroke={1.75} />
            Refresh
          </button>
        }
      />

      {state.status === 'loading' ? (
        <LoadingPanel label="Loading audit activity" />
      ) : null}
      {state.status === 'unavailable' ? (
        <UnavailablePanel
          title="Audit activity unavailable"
          onRetry={refresh}
        />
      ) : null}
      {state.status === 'ready' && state.result.items.length === 0 ? (
        <EmptyPanel
          title="No audit activity"
          description="No administrative events were returned by the platform API."
        />
      ) : null}

      {state.status === 'ready' && state.result.items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="sr-only">
              Administrative audit events, newest first
            </caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {state.result.items.map((event) => (
                <tr key={event.id}>
                  <td className="admin-mono">
                    {formatDateTime(event.createdAt)}
                  </td>
                  <td className="admin-mono">{event.actorUserId}</td>
                  <td>{event.action}</td>
                  <td>
                    <strong>{event.targetType}</strong>
                    <small className="admin-mono">{event.targetId}</small>
                  </td>
                  <td>{event.reason ?? 'No reason supplied'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="admin-pagination">
            {state.result.nextCursor !== null ? (
              <button
                aria-describedby={paginationStatusId}
                aria-busy={state.loadingMore}
                className="admin-button admin-button--secondary"
                type="button"
                disabled={state.loadingMore}
                onClick={loadMore}
              >
                {state.loadingMore ? (
                  <IconLoader2
                    aria-hidden="true"
                    className="admin-state__spinner"
                    stroke={1.75}
                  />
                ) : (
                  <IconChevronDown aria-hidden="true" stroke={1.75} />
                )}
                {state.loadingMore
                  ? 'Loading older activity…'
                  : 'Load older activity'}
              </button>
            ) : null}
            <p
              id={paginationStatusId}
              aria-live="polite"
              className={
                state.paginationMessage.startsWith('Older')
                  ? 'admin-pagination__status admin-pagination__status--error'
                  : 'admin-pagination__status'
              }
              role={
                state.paginationMessage.startsWith('Older') ? 'alert' : 'status'
              }
            >
              {state.paginationMessage}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
