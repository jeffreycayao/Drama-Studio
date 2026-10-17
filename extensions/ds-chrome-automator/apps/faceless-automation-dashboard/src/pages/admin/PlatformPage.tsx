import { IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAdmin } from '../../admin/AdminContext';
import {
  AdminPageHeader,
  LoadingPanel,
  UnavailablePanel,
} from '../../admin/AdminUi';
import {
  platformSettingsSchema,
  type LocalFontFamily,
  type PlatformSettings,
} from '../../admin/api';

const fontFamilies: readonly LocalFontFamily[] = [
  'Instrument Serif',
  'Manrope',
  'IBM Plex Mono',
];

const colorFields = [
  ['canvas', 'Canvas', 'Page background'],
  ['surface', 'Surface', 'Raised surfaces'],
  ['ink', 'Ink', 'Primary text and icons'],
  ['mutedInk', 'Muted ink', 'Secondary text'],
  ['border', 'Border', 'Dividers and outlines'],
  ['gold', 'Gold accent', 'Focus and primary actions'],
] as const;

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; saved: PlatformSettings; draft: PlatformSettings };

export default function PlatformPage() {
  const { api } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => {
      void api
        .getPlatformSettings(signal)
        .then((settings) =>
          setState({
            status: 'ready',
            saved: structuredClone(settings),
            draft: structuredClone(settings),
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
    return () => controller.abort();
  }, [attempt, load]);

  const hasChanges = useMemo(
    () =>
      state.status === 'ready' &&
      JSON.stringify(state.saved) !== JSON.stringify(state.draft),
    [state],
  );

  function updateDraft(mutator: (draft: PlatformSettings) => void): void {
    setMessage(null);
    setState((current) => {
      if (current.status !== 'ready') return current;
      const draft = structuredClone(current.draft);
      mutator(draft);
      return { ...current, draft };
    });
  }

  async function save(): Promise<void> {
    if (state.status !== 'ready' || saving) return;
    const parsed = platformSettingsSchema.safeParse(state.draft);
    if (!parsed.success) {
      setMessage(
        'Review the highlighted metadata and color values before saving.',
      );
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const updated = await api.updatePlatformSettings(parsed.data);
      setState({
        status: 'ready',
        saved: structuredClone(updated),
        draft: structuredClone(updated),
      });
      setMessage('Platform settings saved and audited.');
    } catch {
      setMessage(
        'The platform API did not save these changes. Your draft is preserved.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <AdminPageHeader
        title="Platform"
        description="Manage public metadata and approved brand presentation."
      />

      {state.status === 'loading' ? (
        <LoadingPanel label="Loading platform settings" />
      ) : null}
      {state.status === 'unavailable' ? (
        <UnavailablePanel
          title="Platform settings unavailable"
          onRetry={() => {
            setState({ status: 'loading' });
            setMessage(null);
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}

      {state.status === 'ready' ? (
        <div className="platform-editor">
          <form
            className="platform-editor__form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <section aria-labelledby="metadata-heading">
              <div className="admin-section-heading">
                <div>
                  <h2 id="metadata-heading">Public metadata</h2>
                  <p>
                    Search and share metadata. No executable markup is accepted.
                  </p>
                </div>
              </div>
              <div className="admin-form-grid">
                <label htmlFor="platform-site-title">
                  <span>Site title</span>
                  <input
                    aria-label="Site title"
                    id="platform-site-title"
                    required
                    maxLength={60}
                    value={state.draft.seo.siteTitle}
                    onChange={(event) =>
                      updateDraft((draft) => {
                        draft.seo.siteTitle = event.target.value;
                      })
                    }
                  />
                  <small>Browser title and primary search-result title.</small>
                </label>
                <label htmlFor="platform-site-description">
                  <span>Site description</span>
                  <textarea
                    aria-label="Site description"
                    id="platform-site-description"
                    required
                    maxLength={160}
                    value={state.draft.seo.siteDescription}
                    onChange={(event) =>
                      updateDraft((draft) => {
                        draft.seo.siteDescription = event.target.value;
                      })
                    }
                  />
                  <small>Maximum 160 characters.</small>
                </label>
                <label htmlFor="platform-og-title">
                  <span>Open Graph title</span>
                  <input
                    aria-label="Open Graph title"
                    id="platform-og-title"
                    required
                    maxLength={60}
                    value={state.draft.seo.openGraphTitle}
                    onChange={(event) =>
                      updateDraft((draft) => {
                        draft.seo.openGraphTitle = event.target.value;
                      })
                    }
                  />
                </label>
                <label htmlFor="platform-og-description">
                  <span>Open Graph description</span>
                  <textarea
                    aria-label="Open Graph description"
                    id="platform-og-description"
                    required
                    maxLength={200}
                    value={state.draft.seo.openGraphDescription}
                    onChange={(event) =>
                      updateDraft((draft) => {
                        draft.seo.openGraphDescription = event.target.value;
                      })
                    }
                  />
                </label>
                <label htmlFor="platform-social-image">
                  <span>Social image URL</span>
                  <input
                    aria-label="Social image URL"
                    id="platform-social-image"
                    type="url"
                    maxLength={2_048}
                    placeholder="https://"
                    value={state.draft.seo.socialImageUrl ?? ''}
                    onChange={(event) =>
                      updateDraft((draft) => {
                        draft.seo.socialImageUrl =
                          event.target.value.trim().length === 0
                            ? null
                            : event.target.value;
                      })
                    }
                  />
                  <small>Public HTTPS image used when a page is shared.</small>
                </label>
              </div>
            </section>

            <section aria-labelledby="colors-heading">
              <div className="admin-section-heading">
                <div>
                  <h2 id="colors-heading">Approved color tokens</h2>
                  <p>Only named platform tokens can be changed.</p>
                </div>
              </div>
              <div className="token-list">
                {colorFields.map(([key, label, description]) => (
                  <div className="token-row" key={key}>
                    <span className="token-row__name">{label}</span>
                    <small>{description}</small>
                    <span className="token-row__control">
                      <input
                        aria-label={`${label} color picker`}
                        type="color"
                        value={state.draft.theme.colors[key]}
                        onChange={(event) =>
                          updateDraft((draft) => {
                            draft.theme.colors[key] = event.target.value;
                          })
                        }
                      />
                      <input
                        aria-label={`${label} hex value`}
                        className="admin-mono"
                        pattern="#[0-9A-Fa-f]{6}"
                        maxLength={7}
                        value={state.draft.theme.colors[key]}
                        onChange={(event) =>
                          updateDraft((draft) => {
                            draft.theme.colors[key] = event.target.value;
                          })
                        }
                      />
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="fonts-heading">
              <div className="admin-section-heading">
                <div>
                  <h2 id="fonts-heading">Bundled typography roles</h2>
                  <p>
                    Selections are limited to licensed fonts shipped with the
                    app.
                  </p>
                </div>
              </div>
              <div className="admin-form-grid admin-form-grid--compact">
                {(
                  [
                    ['display', 'Display and narrative headings'],
                    ['body', 'Body, controls and navigation'],
                    ['metadata', 'Eyebrows, metadata and numbers'],
                  ] as const
                ).map(([key, label]) => (
                  <label htmlFor={`platform-font-${key}`} key={key}>
                    <span>{label}</span>
                    <select
                      aria-label={label}
                      id={`platform-font-${key}`}
                      value={state.draft.theme.fonts[key]}
                      onChange={(event) =>
                        updateDraft((draft) => {
                          draft.theme.fonts[key] = event.target
                            .value as LocalFontFamily;
                        })
                      }
                    >
                      {fontFamilies.map((family) => (
                        <option key={family} value={family}>
                          {family}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </section>

            {message !== null ? (
              <p className="admin-save-message" role="status">
                {message}
              </p>
            ) : null}

            <div className="admin-form-actions">
              <button
                className="admin-button admin-button--secondary"
                type="button"
                disabled={!hasChanges || saving}
                onClick={() =>
                  setState((current) =>
                    current.status === 'ready'
                      ? {
                          ...current,
                          draft: structuredClone(current.saved),
                        }
                      : current,
                  )
                }
              >
                <IconRefresh aria-hidden="true" stroke={1.75} />
                Reset draft
              </button>
              <button
                className="admin-button"
                type="submit"
                disabled={!hasChanges || saving}
              >
                <IconDeviceFloppy aria-hidden="true" stroke={1.75} />
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>

          <aside
            className="platform-preview"
            aria-label="Platform settings preview"
          >
            <div className="platform-preview__bar">
              <span>Live preview</span>
              <small>Approved tokens</small>
            </div>
            <div
              className="platform-preview__canvas"
              style={{
                backgroundColor: state.draft.theme.colors.canvas,
                color: state.draft.theme.colors.ink,
                borderColor: state.draft.theme.colors.border,
              }}
            >
              <h2
                style={{
                  fontFamily: `var(--fa-font-${state.draft.theme.fonts.display === 'Instrument Serif' ? 'display' : state.draft.theme.fonts.display === 'Manrope' ? 'body' : 'mono'})`,
                }}
              >
                {state.draft.seo.siteTitle}
              </h2>
              <p style={{ color: state.draft.theme.colors.mutedInk }}>
                {state.draft.seo.siteDescription}
              </p>
              <button
                type="button"
                style={{
                  backgroundColor: state.draft.theme.colors.gold,
                  borderColor: state.draft.theme.colors.gold,
                  color: state.draft.theme.colors.canvas,
                }}
              >
                Primary action
              </button>
              <div
                className="platform-preview__surface"
                style={{
                  backgroundColor: state.draft.theme.colors.surface,
                  borderColor: state.draft.theme.colors.border,
                }}
              >
                <strong>Surface example</strong>
                <span style={{ color: state.draft.theme.colors.mutedInk }}>
                  The public site uses the saved values only after server
                  validation.
                </span>
                <code>revision: {state.draft.revision}</code>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
