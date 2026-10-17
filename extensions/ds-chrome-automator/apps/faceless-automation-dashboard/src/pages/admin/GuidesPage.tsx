import {
  IconBook2,
  IconEdit,
  IconExternalLink,
  IconPlus,
  IconRefresh,
} from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAdmin } from '../../admin/AdminContext';
import {
  AdminPageHeader,
  EmptyPanel,
  LoadingPanel,
  StatusBadge,
  UnavailablePanel,
} from '../../admin/AdminUi';
import type { GuideAdminList } from '../../admin/api';
import { formatDateTime } from '../../admin/format';

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; guides: GuideAdminList };

export function GuidesPage() {
  const { api } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });

  const load = useCallback(
    (signal: AbortSignal) => {
      void api
        .listGuides(signal)
        .then((guides) => setState({ status: 'ready', guides }))
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
        title="Guides"
        description="Publish structured product manuals without executable markup or remote embeds."
        action={
          <span className="guide-admin-header-actions">
            <button
              aria-label="Refresh guides"
              className="admin-button admin-button--secondary"
              type="button"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              <IconRefresh aria-hidden="true" stroke={1.75} />
              <span>Refresh</span>
            </button>
            <Link
              aria-label="New guide"
              className="admin-button"
              to="/admin/guides/new"
            >
              <IconPlus aria-hidden="true" stroke={1.75} />
              <span>New guide</span>
            </Link>
          </span>
        }
      />

      <div className="guide-admin-intro">
        <IconBook2 aria-hidden="true" stroke={1.75} />
        <div>
          <strong>One reusable publishing model</strong>
          <p>
            Every server-seeded tool can have its own revisioned guide. Only
            published revisions are visible on public guide URLs.
          </p>
        </div>
      </div>

      {state.status === 'loading' ? (
        <LoadingPanel label="Loading guides" />
      ) : null}
      {state.status === 'unavailable' ? (
        <UnavailablePanel
          title="Guide library unavailable"
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
      {state.status === 'ready' && state.guides.items.length === 0 ? (
        <EmptyPanel
          title="No guide records"
          description="Guide records must be provisioned by the platform before they can be edited here."
        />
      ) : null}

      {state.status === 'ready' && state.guides.items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table guide-admin-table">
            <caption className="sr-only">Managed product guides</caption>
            <thead>
              <tr>
                <th scope="col">Guide</th>
                <th scope="col">Application</th>
                <th scope="col">Status</th>
                <th scope="col">Revision</th>
                <th scope="col">Updated</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {state.guides.items.map((guide) => (
                <tr key={guide.slug}>
                  <td>
                    <strong>{guide.title}</strong>
                    <small>{guide.summary}</small>
                  </td>
                  <td className="admin-mono">{guide.appId}</td>
                  <td>
                    <StatusBadge status={guide.status} />
                  </td>
                  <td className="admin-mono">{guide.revision}</td>
                  <td>{formatDateTime(guide.updatedAt)}</td>
                  <td className="admin-table__action">
                    <span className="guide-admin-actions">
                      {guide.status === 'published' ? (
                        <Link
                          aria-label={`Open published ${guide.title}`}
                          className="admin-row-action"
                          target="_blank"
                          rel="noreferrer noopener"
                          to={`/guide/${guide.slug}`}
                        >
                          <IconExternalLink aria-hidden="true" stroke={1.75} />
                          View
                        </Link>
                      ) : null}
                      <Link
                        aria-label={`Edit ${guide.title}`}
                        className="admin-row-action"
                        to={`/admin/guides/${guide.slug}/edit`}
                      >
                        <IconEdit aria-hidden="true" stroke={1.75} />
                        Edit
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default GuidesPage;
