import {
  IconAlertTriangle,
  IconArrowRight,
  IconArrowLeft,
  IconBook2,
  IconCircleCheck,
  IconExternalLink,
  IconInfoCircle,
  IconRefresh,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  createPlatformApi,
  isApiFailure,
  type GuideBlock,
  type GuidePublicDocument,
  type PlatformApi,
} from '../admin/api';
import { formatDateTime } from '../admin/format';
import { BrandLockup } from '../components/BrandLockup';

type GuideState =
  | { slug: string; status: 'loading' }
  | { slug: string; status: 'not-found' }
  | { slug: string; status: 'unavailable' }
  | { slug: string; status: 'ready'; guide: GuidePublicDocument };

interface GuidePageProps {
  api?: PlatformApi;
  slug?: string;
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  if (block.type === 'heading') {
    return block.level === 3 ? (
      <h3 className="guide-block guide-block--heading">{block.text}</h3>
    ) : (
      <h4 className="guide-block guide-block--heading">{block.text}</h4>
    );
  }

  if (block.type === 'paragraph') {
    return <p className="guide-block guide-block--paragraph">{block.text}</p>;
  }

  if (block.type === 'list') {
    const items = block.items.map((item, index) => (
      <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
    ));
    return block.style === 'ordered' ? (
      <ol className="guide-block guide-block--list">{items}</ol>
    ) : (
      <ul className="guide-block guide-block--list">{items}</ul>
    );
  }

  if (block.type === 'link') {
    const external = !block.href.startsWith('/');
    return (
      <p className="guide-block guide-block--link">
        <a
          href={block.href}
          rel={external ? 'noreferrer noopener' : undefined}
          target={external ? '_blank' : undefined}
        >
          <span>{block.label}</span>
          {external ? (
            <IconExternalLink aria-hidden="true" stroke={1.75} />
          ) : (
            <IconArrowRight aria-hidden="true" stroke={1.75} />
          )}
        </a>
      </p>
    );
  }

  const CalloutIcon =
    block.tone === 'success'
      ? IconCircleCheck
      : block.tone === 'warning'
        ? IconAlertTriangle
        : IconInfoCircle;
  return (
    <aside className={`guide-callout guide-callout--${block.tone}`}>
      <CalloutIcon aria-hidden="true" stroke={1.75} />
      <div>
        {block.title === null ? null : <strong>{block.title}</strong>}
        <p>{block.text}</p>
      </div>
    </aside>
  );
}

function GuideUnavailable({
  missing,
  onRetry,
}: {
  missing: boolean;
  onRetry: () => void;
}) {
  return (
    <main className="guide-status-page">
      <BrandLockup centered />
      <section className="guide-status" role={missing ? undefined : 'alert'}>
        <span className="guide-status__icon">
          {missing ? (
            <IconBook2 aria-hidden="true" stroke={1.75} />
          ) : (
            <IconAlertTriangle aria-hidden="true" stroke={1.75} />
          )}
        </span>
        <p className="guide-eyebrow">Product guide</p>
        <h1>{missing ? 'Guide not found' : 'Guide temporarily unavailable'}</h1>
        <p>
          {missing
            ? 'This guide does not exist or has not been published.'
            : 'The platform could not load a verified guide. No cached or unvalidated content is being shown.'}
        </p>
        {missing ? null : (
          <button
            className="guide-status__action"
            type="button"
            onClick={onRetry}
          >
            <IconRefresh aria-hidden="true" stroke={1.75} />
            Try again
          </button>
        )}
        <Link className="guide-status__back" to="/">
          <IconArrowLeft aria-hidden="true" stroke={1.75} />
          Return to Paks Tools
        </Link>
      </section>
    </main>
  );
}

export function GuidePage({
  api: providedApi,
  slug: providedSlug,
}: GuidePageProps) {
  const route = useParams<{ slug: string }>();
  const slug = providedSlug ?? route.slug ?? '';
  const api = useMemo(() => providedApi ?? createPlatformApi(), [providedApi]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GuideState>({ slug, status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void api
      .getPublicGuide(slug, controller.signal)
      .then((guide) => setState({ slug, status: 'ready', guide }))
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
    return () => controller.abort();
  }, [api, attempt, slug]);

  const currentState = useMemo<GuideState>(
    () => (state.slug === slug ? state : { slug, status: 'loading' }),
    [slug, state],
  );

  useEffect(() => {
    if (currentState.status !== 'ready') return;
    const previousTitle = document.title;
    document.title = `${currentState.guide.title} | Paks Tools`;
    return () => {
      document.title = previousTitle;
    };
  }, [currentState]);

  if (currentState.status === 'not-found') {
    return <GuideUnavailable missing onRetry={() => undefined} />;
  }
  if (currentState.status === 'unavailable') {
    return (
      <GuideUnavailable
        missing={false}
        onRetry={() => {
          setState({ slug, status: 'loading' });
          setAttempt((value) => value + 1);
        }}
      />
    );
  }

  if (currentState.status === 'loading') {
    return (
      <main className="guide-status-page">
        <BrandLockup centered />
        <section className="guide-status" role="status">
          <span className="guide-status__icon guide-status__icon--loading">
            <IconRefresh aria-hidden="true" stroke={1.75} />
          </span>
          <p className="guide-eyebrow">Product guide</p>
          <h1>Loading verified guide</h1>
          <p>The document will appear after the platform validates it.</p>
        </section>
      </main>
    );
  }

  const { guide } = currentState;
  return (
    <div className="guide-page">
      <a className="skip-link" href="#guide-content">
        Skip to guide
      </a>
      <header className="guide-header">
        <BrandLockup />
        <Link className="guide-header__back" to="/">
          <IconArrowLeft aria-hidden="true" stroke={1.75} />
          All tools
        </Link>
      </header>

      <div className="guide-layout">
        <nav className="guide-toc" aria-label="On this page">
          <p>On this page</p>
          <ol>
            {guide.content.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
          <div className="guide-toc__meta">
            <span>Revision {guide.revision}</span>
            <span>Updated {formatDateTime(guide.updatedAt)}</span>
          </div>
        </nav>

        <main id="guide-content" className="guide-document" tabIndex={-1}>
          <article>
            <header className="guide-document__header">
              <p className="guide-eyebrow">
                {guide.appId.replaceAll('-', ' ')}
              </p>
              <h1>{guide.title}</h1>
              <p>{guide.summary}</p>
            </header>

            <div className="guide-document__sections">
              {guide.content.sections.map((section, sectionIndex) => (
                <section id={section.id} key={section.id}>
                  <span className="guide-section-number" aria-hidden="true">
                    {String(sectionIndex + 1).padStart(2, '0')}
                  </span>
                  <h2>{section.title}</h2>
                  <div className="guide-section__blocks">
                    {section.blocks.map((block, blockIndex) => (
                      <GuideBlockView block={block} key={blockIndex} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </main>
      </div>
    </div>
  );
}

export default GuidePage;
