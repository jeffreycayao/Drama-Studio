import {
  IconAlertCircle,
  IconDatabaseOff,
  IconLoader2,
  IconSearch,
  IconX,
} from '@tabler/icons-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

export function AdminPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="admin-page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function LoadingPanel({
  label = 'Loading verified data',
}: {
  label?: string;
}) {
  return (
    <div className="admin-state" role="status">
      <IconLoader2
        aria-hidden="true"
        className="admin-state__spinner"
        stroke={1.75}
      />
      <strong>{label}</strong>
      <span>The console will remain read-only until validation completes.</span>
    </div>
  );
}

export function UnavailablePanel({
  onRetry,
  title = 'Platform data unavailable',
}: {
  onRetry: () => void;
  title?: string;
}) {
  return (
    <div className="admin-state admin-state--danger" role="alert">
      <IconDatabaseOff aria-hidden="true" stroke={1.75} />
      <strong>{title}</strong>
      <span>
        The API did not return a valid response. Controls are disabled and no
        cached administrative data is shown.
      </span>
      <button
        className="admin-button admin-button--secondary"
        type="button"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

export function EmptyPanel({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="admin-state">
      <IconAlertCircle aria-hidden="true" stroke={1.75} />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

export function SearchControl({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <label className="admin-search">
      <span className="sr-only">{label}</span>
      <IconSearch aria-hidden="true" stroke={1.75} />
      <input
        type="search"
        value={value}
        placeholder={label}
        maxLength={160}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function StatusBadge({
  status,
}: {
  status: 'active' | 'banned' | 'revoked' | 'expired' | 'draft' | 'published';
}) {
  return (
    <span className={`admin-status admin-status--${status}`}>{status}</span>
  );
}

export interface ConfirmAction {
  title: string;
  description: string;
  confirmLabel: string;
  tone: 'danger' | 'neutral';
}

export function ConfirmActionDialog({
  action,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  if (action === null) return null;

  return (
    <ConfirmActionDialogContent
      action={action}
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function ConfirmActionDialogContent({
  action,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (reason.trim().length < 5 || busy) return;
    void onConfirm(reason.trim());
  }

  return (
    <div className="admin-dialog-backdrop" role="presentation">
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="admin-dialog"
        role="dialog"
      >
        <button
          aria-label="Close confirmation"
          className="admin-dialog__close"
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          <IconX aria-hidden="true" stroke={1.75} />
        </button>
        <h2 id={titleId}>{action.title}</h2>
        <p id={descriptionId}>{action.description}</p>
        <form onSubmit={submit}>
          <label>
            <span>Audit reason</span>
            <textarea
              aria-label="Audit reason"
              autoFocus
              required
              minLength={5}
              maxLength={300}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
            <small>Required. This reason is recorded in the audit log.</small>
          </label>
          {error !== null ? (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="admin-dialog__actions">
            <button
              className="admin-button admin-button--secondary"
              type="button"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              className={`admin-button${action.tone === 'danger' ? ' admin-button--danger' : ''}`}
              type="submit"
              disabled={busy || reason.trim().length < 5}
            >
              {busy ? 'Applying…' : action.confirmLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
