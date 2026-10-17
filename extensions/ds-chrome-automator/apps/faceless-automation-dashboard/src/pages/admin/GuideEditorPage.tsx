import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconDeviceFloppy,
  IconExternalLink,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { useAdmin } from '../../admin/AdminContext';
import {
  AdminPageHeader,
  LoadingPanel,
  UnavailablePanel,
} from '../../admin/AdminUi';
import {
  guideCreateInputSchema,
  guideUpdateInputSchema,
  isApiFailure,
  type GuideAdminDocument,
  type GuideBlock,
  type GuideContent,
  type GuideCreateInput,
  type GuideUpdateInput,
} from '../../admin/api';
import { formatDateTime } from '../../admin/format';

type GuideSection = GuideContent['sections'][number];
type BlockType = GuideBlock['type'];
type PageState =
  | { slug: string; status: 'loading' }
  | { slug: string; status: 'not-found' }
  | { slug: string; status: 'unavailable' }
  | {
      slug: string;
      status: 'ready';
      saved: GuideAdminDocument | null;
      draft: GuideAdminDocument;
    };

const blockLabels: Readonly<Record<BlockType, string>> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  list: 'List',
  callout: 'Callout',
  link: 'Link',
};

function createBlock(type: BlockType): GuideBlock {
  if (type === 'heading') return { type, level: 3, text: '' };
  if (type === 'paragraph') return { type, text: '' };
  if (type === 'list') return { type, style: 'unordered', items: [''] };
  if (type === 'callout') {
    return { type, tone: 'info', title: null, text: '' };
  }
  return { type, label: '', href: '' };
}

function createEmptyGuide(): GuideAdminDocument {
  return {
    schemaVersion: 1,
    slug: '',
    appId: '',
    title: '',
    summary: '',
    status: 'draft',
    content: {
      schemaVersion: 1,
      sections: [
        {
          id: 'overview',
          title: 'Overview',
          blocks: [createBlock('paragraph')],
        },
      ],
    },
    revision: '0',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z',
    publishedAt: null,
    updatedBy: null,
  };
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length || from === to) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function nextSectionId(sections: readonly GuideSection[]): string {
  const existing = new Set(sections.map((section) => section.id));
  for (let index = 1; index <= 24; index += 1) {
    const candidate = `section-${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return 'section';
}

interface GuideBlockEditorProps {
  block: GuideBlock;
  blockIndex: number;
  canAddLink: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  onChange: (block: GuideBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function GuideBlockEditor({
  block,
  blockIndex,
  canAddLink,
  canMoveDown,
  canRemove,
  onChange,
  onMove,
  onRemove,
}: GuideBlockEditorProps) {
  const labelPrefix = `Block ${blockIndex + 1}`;
  return (
    <fieldset className="guide-block-editor">
      <legend>{`${labelPrefix}: ${blockLabels[block.type]}`}</legend>
      <div className="guide-editor-row guide-editor-row--block-controls">
        <label>
          <span>Block type</span>
          <select
            aria-label={`${labelPrefix} type`}
            value={block.type}
            onChange={(event) => {
              const type = event.target.value as BlockType;
              if (type === 'link' && !canAddLink) return;
              onChange(createBlock(type));
            }}
          >
            {Object.entries(blockLabels).map(([value, label]) => (
              <option
                disabled={
                  value === 'link' && block.type !== 'link' && !canAddLink
                }
                key={value}
                value={value}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="guide-editor-icon-actions">
          <button
            aria-label={`Move ${labelPrefix.toLowerCase()} up`}
            className="admin-row-action"
            type="button"
            disabled={blockIndex === 0}
            onClick={() => onMove(-1)}
          >
            <IconArrowUp aria-hidden="true" stroke={1.75} />
          </button>
          <button
            aria-label={`Move ${labelPrefix.toLowerCase()} down`}
            className="admin-row-action"
            type="button"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <IconArrowDown aria-hidden="true" stroke={1.75} />
          </button>
          <button
            aria-label={`Remove ${labelPrefix.toLowerCase()}`}
            className="admin-row-action admin-row-action--danger"
            type="button"
            disabled={!canRemove}
            onClick={onRemove}
          >
            <IconTrash aria-hidden="true" stroke={1.75} />
          </button>
        </div>
      </div>

      {block.type === 'heading' ? (
        <div className="guide-editor-row guide-editor-row--heading">
          <label>
            <span>Heading level</span>
            <select
              aria-label={`${labelPrefix} heading level`}
              value={block.level}
              onChange={(event) =>
                onChange({
                  ...block,
                  level: Number(event.target.value) as 3 | 4,
                })
              }
            >
              <option value={3}>H3</option>
              <option value={4}>H4</option>
            </select>
          </label>
          <label>
            <span>Heading text</span>
            <input
              aria-label={`${labelPrefix} heading text`}
              required
              maxLength={120}
              value={block.text}
              onChange={(event) =>
                onChange({ ...block, text: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}

      {block.type === 'paragraph' ? (
        <label>
          <span>Paragraph text</span>
          <textarea
            aria-label={`${labelPrefix} paragraph text`}
            required
            maxLength={5_000}
            rows={5}
            value={block.text}
            onChange={(event) =>
              onChange({ ...block, text: event.target.value })
            }
          />
        </label>
      ) : null}

      {block.type === 'list' ? (
        <div className="guide-editor-row guide-editor-row--list">
          <label>
            <span>List style</span>
            <select
              aria-label={`${labelPrefix} list style`}
              value={block.style}
              onChange={(event) =>
                onChange({
                  ...block,
                  style: event.target.value as 'ordered' | 'unordered',
                })
              }
            >
              <option value="unordered">Bullet list</option>
              <option value="ordered">Ordered steps</option>
            </select>
          </label>
          <div className="guide-list-items">
            <span>List items</span>
            {block.items.map((item, itemIndex) => (
              <div className="guide-list-item" key={itemIndex}>
                <input
                  aria-label={`${labelPrefix} list item ${itemIndex + 1}`}
                  required
                  maxLength={500}
                  value={item}
                  onChange={(event) => {
                    const items = [...block.items];
                    items[itemIndex] = event.target.value;
                    onChange({ ...block, items });
                  }}
                />
                <button
                  aria-label={`Move ${labelPrefix.toLowerCase()} item ${itemIndex + 1} up`}
                  className="admin-row-action"
                  type="button"
                  disabled={itemIndex === 0}
                  onClick={() =>
                    onChange({
                      ...block,
                      items: moveItem(block.items, itemIndex, itemIndex - 1),
                    })
                  }
                >
                  <IconArrowUp aria-hidden="true" stroke={1.75} />
                </button>
                <button
                  aria-label={`Move ${labelPrefix.toLowerCase()} item ${itemIndex + 1} down`}
                  className="admin-row-action"
                  type="button"
                  disabled={itemIndex === block.items.length - 1}
                  onClick={() =>
                    onChange({
                      ...block,
                      items: moveItem(block.items, itemIndex, itemIndex + 1),
                    })
                  }
                >
                  <IconArrowDown aria-hidden="true" stroke={1.75} />
                </button>
                <button
                  aria-label={`Remove ${labelPrefix.toLowerCase()} item ${itemIndex + 1}`}
                  className="admin-row-action admin-row-action--danger"
                  type="button"
                  disabled={block.items.length === 1}
                  onClick={() => {
                    const items = [...block.items];
                    items.splice(itemIndex, 1);
                    onChange({ ...block, items });
                  }}
                >
                  <IconTrash aria-hidden="true" stroke={1.75} />
                </button>
              </div>
            ))}
            <button
              className="admin-row-action guide-list-items__add"
              type="button"
              disabled={block.items.length >= 50}
              onClick={() =>
                onChange({ ...block, items: [...block.items, ''] })
              }
            >
              <IconPlus aria-hidden="true" stroke={1.75} />
              Add list item
            </button>
            <small>Up to 50 items and 500 characters per item.</small>
          </div>
        </div>
      ) : null}

      {block.type === 'callout' ? (
        <div className="guide-editor-callout-fields">
          <label>
            <span>Tone</span>
            <select
              aria-label={`${labelPrefix} callout tone`}
              value={block.tone}
              onChange={(event) =>
                onChange({
                  ...block,
                  tone: event.target.value as 'info' | 'warning' | 'success',
                })
              }
            >
              <option value="info">Information</option>
              <option value="warning">Warning</option>
              <option value="success">Success</option>
            </select>
          </label>
          <label>
            <span>Optional title</span>
            <input
              aria-label={`${labelPrefix} callout title`}
              maxLength={120}
              value={block.title ?? ''}
              onChange={(event) =>
                onChange({
                  ...block,
                  title:
                    event.target.value.length === 0 ? null : event.target.value,
                })
              }
            />
          </label>
          <label className="guide-editor-callout-fields__text">
            <span>Callout text</span>
            <textarea
              aria-label={`${labelPrefix} callout text`}
              required
              maxLength={3_000}
              rows={4}
              value={block.text}
              onChange={(event) =>
                onChange({ ...block, text: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}

      {block.type === 'link' ? (
        <div className="guide-editor-row guide-editor-row--link">
          <label>
            <span>Link label</span>
            <input
              aria-label={`${labelPrefix} link label`}
              required
              maxLength={120}
              value={block.label}
              onChange={(event) =>
                onChange({ ...block, label: event.target.value })
              }
            />
          </label>
          <label>
            <span>Safe destination</span>
            <input
              aria-label={`${labelPrefix} link destination`}
              required
              maxLength={2_048}
              placeholder="/path or https://"
              value={block.href}
              onChange={(event) =>
                onChange({ ...block, href: event.target.value })
              }
            />
            <small>
              Exact relative paths or credential-free HTTPS only. Scripts,
              protocol-relative URLs, and backslashes are rejected.
            </small>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

export function GuideEditorPage({ create = false }: { create?: boolean }) {
  const route = useParams<{ slug: string }>();
  const slug = route.slug ?? '';
  const { api } = useAdmin();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>(() =>
    create
      ? { slug: '', status: 'ready', saved: null, draft: createEmptyGuide() }
      : { slug, status: 'loading' },
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<'revision' | 'slug' | null>(null);

  const load = useCallback(
    (signal: AbortSignal) => {
      void api
        .getGuide(slug, signal)
        .then((guide) => {
          setMessage(null);
          setConflict(null);
          setState({
            slug,
            status: 'ready',
            saved: structuredClone(guide),
            draft: structuredClone(guide),
          });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError')
            return;
          setState({
            slug,
            status:
              isApiFailure(error) && error.kind === 'not-found'
                ? 'not-found'
                : 'unavailable',
          });
        });
    },
    [api, slug],
  );

  useEffect(() => {
    if (create) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [attempt, create, load, slug]);

  const currentState = useMemo<PageState>(
    () => (create || state.slug === slug ? state : { slug, status: 'loading' }),
    [create, slug, state],
  );
  const hasChanges = useMemo(
    () =>
      currentState.status === 'ready' &&
      (currentState.saved === null ||
        JSON.stringify(currentState.saved) !==
          JSON.stringify(currentState.draft)),
    [currentState],
  );

  const totalBlocks =
    currentState.status === 'ready'
      ? currentState.draft.content.sections.reduce(
          (count, section) => count + section.blocks.length,
          0,
        )
      : 0;
  const totalLinks =
    currentState.status === 'ready'
      ? currentState.draft.content.sections.reduce(
          (count, section) =>
            count +
            section.blocks.filter((block) => block.type === 'link').length,
          0,
        )
      : 0;

  function updateDraft(mutator: (draft: GuideAdminDocument) => void): void {
    setMessage(null);
    setConflict(null);
    setState((current) => {
      if (current.status !== 'ready' || current.slug !== slug) return current;
      const draft = structuredClone(current.draft);
      mutator(draft);
      return { ...current, draft };
    });
  }

  function updateSection(
    sectionIndex: number,
    mutator: (section: GuideSection) => void,
  ): void {
    updateDraft((draft) => {
      const section = draft.content.sections[sectionIndex];
      if (section !== undefined) mutator(section);
    });
  }

  async function save(): Promise<void> {
    if (currentState.status !== 'ready' || saving || !hasChanges) return;
    const sharedInput = {
      appId: currentState.draft.appId,
      title: currentState.draft.title,
      summary: currentState.draft.summary,
      status: currentState.draft.status,
      content: currentState.draft.content,
    };
    const input: GuideCreateInput | GuideUpdateInput = create
      ? { slug: currentState.draft.slug, ...sharedInput }
      : {
          expectedRevision: currentState.saved?.revision ?? '',
          ...sharedInput,
        };
    const parsed = create
      ? guideCreateInputSchema.safeParse(input)
      : guideUpdateInputSchema.safeParse(input);
    if (!parsed.success) {
      setMessage(
        'Review every metadata field, section, block, list item, and link before saving.',
      );
      return;
    }

    setSaving(true);
    setMessage(null);
    setConflict(null);
    try {
      const updated = create
        ? await api.createGuide(parsed.data as GuideCreateInput)
        : await api.updateGuide(slug, parsed.data as GuideUpdateInput);
      setState({
        slug: updated.slug,
        status: 'ready',
        saved: structuredClone(updated),
        draft: structuredClone(updated),
      });
      setMessage(
        updated.status === 'published'
          ? 'Guide revision saved and published.'
          : 'Guide revision saved as a draft.',
      );
      if (create) {
        await navigate(`/admin/guides/${updated.slug}/edit`, { replace: true });
      }
    } catch (error) {
      if (isApiFailure(error) && error.kind === 'conflict') {
        setConflict(create ? 'slug' : 'revision');
        setMessage(
          create
            ? 'That guide slug already exists. Your draft is preserved; choose a different slug.'
            : 'This guide changed on the server. Your draft is preserved; reload the latest revision before saving again.',
        );
      } else {
        setMessage(
          'The platform did not save this guide. Your draft is preserved.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (currentState.status === 'loading') {
    return <LoadingPanel label="Loading guide editor" />;
  }
  if (currentState.status === 'not-found') {
    return (
      <div className="admin-page">
        <AdminPageHeader
          title="Guide not found"
          description="The requested guide record does not exist."
        />
        <Link
          className="admin-button admin-button--secondary guide-editor-back"
          to="/admin/guides"
        >
          <IconArrowLeft aria-hidden="true" stroke={1.75} />
          Return to guides
        </Link>
      </div>
    );
  }
  if (currentState.status === 'unavailable') {
    return (
      <UnavailablePanel
        title="Guide editor unavailable"
        onRetry={() => {
          setState({ slug, status: 'loading' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  const { draft, saved } = currentState;
  return (
    <div className="admin-page guide-editor-page">
      <AdminPageHeader
        title={create ? 'New guide' : 'Guide editor'}
        description={
          create
            ? 'Create a revisioned manual for a new tool from safe content blocks.'
            : 'Compose a validated manual from safe, reusable content blocks.'
        }
        action={
          <Link
            aria-label="All guides"
            className="admin-button admin-button--secondary"
            to="/admin/guides"
          >
            <IconArrowLeft aria-hidden="true" stroke={1.75} />
            <span>All guides</span>
          </Link>
        }
      />

      <form
        className="guide-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <section
          className="guide-editor-card"
          aria-labelledby="guide-metadata-heading"
        >
          <div className="admin-section-heading">
            <div>
              <h2 id="guide-metadata-heading">Document metadata</h2>
              <p>Plain text identity and publication state for this tool.</p>
            </div>
            <span className="admin-mono">
              {saved === null ? 'new document' : `revision ${saved.revision}`}
            </span>
          </div>
          <div className="admin-form-grid guide-editor-metadata">
            <label>
              <span>Immutable slug</span>
              <input
                aria-label="Guide slug"
                readOnly={!create}
                required
                minLength={3}
                maxLength={63}
                pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                placeholder="new-tool"
                value={draft.slug}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.slug = event.target.value;
                  })
                }
              />
            </label>
            <label>
              <span>Application ID</span>
              <input
                aria-label="Application ID"
                required
                minLength={3}
                maxLength={63}
                pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                value={draft.appId}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.appId = event.target.value;
                  })
                }
              />
            </label>
            <label>
              <span>Publication status</span>
              <select
                aria-label="Publication status"
                value={draft.status}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.status = event.target.value as 'draft' | 'published';
                  })
                }
              >
                <option value="draft">Draft — hidden publicly</option>
                <option value="published">
                  Published — public immediately
                </option>
              </select>
            </label>
            <label className="guide-editor-metadata__wide">
              <span>Guide title</span>
              <input
                aria-label="Guide title"
                required
                maxLength={120}
                value={draft.title}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.title = event.target.value;
                  })
                }
              />
            </label>
            <label className="guide-editor-metadata__wide">
              <span>Summary</span>
              <textarea
                aria-label="Guide summary"
                required
                maxLength={320}
                rows={3}
                value={draft.summary}
                onChange={(event) =>
                  updateDraft((next) => {
                    next.summary = event.target.value;
                  })
                }
              />
              <small>{draft.summary.length}/320 characters</small>
            </label>
          </div>
          {saved === null ? (
            <div className="guide-editor-meta-line">
              <span>
                The server will assign revision 0 and record an audit event.
              </span>
            </div>
          ) : (
            <div className="guide-editor-meta-line">
              <span>Updated {formatDateTime(saved.updatedAt)}</span>
              <span>
                Last editor:{' '}
                {saved.updatedBy?.displayName ??
                  saved.updatedBy?.userId ??
                  'System seed'}
              </span>
            </div>
          )}
        </section>

        <section aria-labelledby="guide-content-heading">
          <div className="admin-section-heading">
            <div>
              <h2 id="guide-content-heading">Guide content</h2>
              <p>
                H2 sections build the public table of contents. Blocks render as
                text-only H3/H4 headings, paragraphs, lists, callouts, or safe
                links.
              </p>
            </div>
            <span className="admin-mono">
              {draft.content.sections.length}/24 sections · {totalBlocks}/256
              blocks
            </span>
          </div>

          <div className="guide-section-editors">
            {draft.content.sections.map((section, sectionIndex) => (
              <fieldset className="guide-section-editor" key={sectionIndex}>
                <legend>Section {sectionIndex + 1}</legend>
                <div className="guide-section-editor__header">
                  <div className="guide-editor-row">
                    <label>
                      <span>Anchor ID</span>
                      <input
                        aria-label={`Section ${sectionIndex + 1} anchor ID`}
                        required
                        maxLength={63}
                        pattern="[a-z][a-z0-9]*(?:-[a-z0-9]+)*"
                        value={section.id}
                        onChange={(event) =>
                          updateSection(sectionIndex, (next) => {
                            next.id = event.target.value;
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>Section title (H2)</span>
                      <input
                        aria-label={`Section ${sectionIndex + 1} title`}
                        required
                        maxLength={120}
                        value={section.title}
                        onChange={(event) =>
                          updateSection(sectionIndex, (next) => {
                            next.title = event.target.value;
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="guide-editor-icon-actions">
                    <button
                      aria-label={`Move section ${sectionIndex + 1} up`}
                      className="admin-row-action"
                      type="button"
                      disabled={sectionIndex === 0}
                      onClick={() =>
                        updateDraft((next) => {
                          next.content.sections = moveItem(
                            next.content.sections,
                            sectionIndex,
                            sectionIndex - 1,
                          );
                        })
                      }
                    >
                      <IconArrowUp aria-hidden="true" stroke={1.75} />
                    </button>
                    <button
                      aria-label={`Move section ${sectionIndex + 1} down`}
                      className="admin-row-action"
                      type="button"
                      disabled={
                        sectionIndex === draft.content.sections.length - 1
                      }
                      onClick={() =>
                        updateDraft((next) => {
                          next.content.sections = moveItem(
                            next.content.sections,
                            sectionIndex,
                            sectionIndex + 1,
                          );
                        })
                      }
                    >
                      <IconArrowDown aria-hidden="true" stroke={1.75} />
                    </button>
                    <button
                      aria-label={`Remove section ${sectionIndex + 1}`}
                      className="admin-row-action admin-row-action--danger"
                      type="button"
                      disabled={draft.content.sections.length === 1}
                      onClick={() =>
                        updateDraft((next) => {
                          next.content.sections.splice(sectionIndex, 1);
                        })
                      }
                    >
                      <IconTrash aria-hidden="true" stroke={1.75} />
                    </button>
                  </div>
                </div>

                <div className="guide-block-editors">
                  {section.blocks.map((block, blockIndex) => (
                    <GuideBlockEditor
                      block={block}
                      blockIndex={blockIndex}
                      canAddLink={totalLinks < 64}
                      canMoveDown={blockIndex < section.blocks.length - 1}
                      canRemove={section.blocks.length > 1}
                      key={blockIndex}
                      onChange={(updated) =>
                        updateSection(sectionIndex, (next) => {
                          next.blocks[blockIndex] = updated;
                        })
                      }
                      onMove={(direction) =>
                        updateSection(sectionIndex, (next) => {
                          next.blocks = moveItem(
                            next.blocks,
                            blockIndex,
                            blockIndex + direction,
                          );
                        })
                      }
                      onRemove={() =>
                        updateSection(sectionIndex, (next) => {
                          next.blocks.splice(blockIndex, 1);
                        })
                      }
                    />
                  ))}
                </div>

                <div
                  className="guide-add-blocks"
                  aria-label={`Add block to section ${sectionIndex + 1}`}
                >
                  {(Object.keys(blockLabels) as BlockType[]).map((type) => (
                    <button
                      className="admin-row-action"
                      type="button"
                      disabled={
                        section.blocks.length >= 32 ||
                        totalBlocks >= 256 ||
                        (type === 'link' && totalLinks >= 64)
                      }
                      key={type}
                      onClick={() =>
                        updateSection(sectionIndex, (next) => {
                          next.blocks.push(createBlock(type));
                        })
                      }
                    >
                      <IconPlus aria-hidden="true" stroke={1.75} />
                      {blockLabels[type]}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <button
            className="admin-button admin-button--secondary guide-add-section"
            type="button"
            disabled={draft.content.sections.length >= 24 || totalBlocks >= 256}
            onClick={() =>
              updateDraft((next) => {
                next.content.sections.push({
                  id: nextSectionId(next.content.sections),
                  title: '',
                  blocks: [createBlock('paragraph')],
                });
              })
            }
          >
            <IconPlus aria-hidden="true" stroke={1.75} />
            Add section
          </button>
        </section>

        {draft.status === 'published' && hasChanges ? (
          <p className="guide-publish-notice">
            Saving will replace the public guide immediately after the server
            records the new revision.
          </p>
        ) : null}

        {message !== null ? (
          <div
            className={
              conflict === null
                ? 'guide-editor-message'
                : 'guide-editor-message guide-editor-message--conflict'
            }
          >
            <p role={conflict === null ? 'status' : 'alert'}>{message}</p>
            {conflict === 'revision' ? (
              <button
                className="admin-button admin-button--secondary"
                type="button"
                onClick={() => {
                  setState({ slug, status: 'loading' });
                  setAttempt((value) => value + 1);
                }}
              >
                <IconRefresh aria-hidden="true" stroke={1.75} />
                Discard draft and load latest
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="admin-form-actions">
          {!create && draft.status === 'published' ? (
            <Link
              className="admin-button admin-button--secondary"
              rel="noreferrer noopener"
              target="_blank"
              to={`/guide/${draft.slug}`}
            >
              <IconExternalLink aria-hidden="true" stroke={1.75} />
              Public guide
            </Link>
          ) : null}
          <button
            className="admin-button admin-button--secondary"
            type="button"
            disabled={!hasChanges || saving}
            onClick={() => {
              setMessage(null);
              setConflict(null);
              setState((current) =>
                current.status === 'ready'
                  ? {
                      ...current,
                      draft:
                        current.saved === null
                          ? createEmptyGuide()
                          : structuredClone(current.saved),
                    }
                  : current,
              );
            }}
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
            {saving ? 'Saving…' : 'Save revision'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default GuideEditorPage;
