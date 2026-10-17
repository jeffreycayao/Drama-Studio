import {
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
  IconRefresh,
  IconShieldLock,
} from '@tabler/icons-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, useParams } from 'react-router-dom';

import {
  createPlatformApi,
  isApiFailure,
  type ExtensionAuthFlow,
  type PlatformApi,
} from '../admin/api';
import { formatDateTime } from '../admin/format';
import { BrandLockup } from '../components/BrandLockup';
import { GoogleIcon } from '../components/GoogleIcon';
import {
  createExtensionGoogleAuthStartUrl,
  platformApiOrigin,
} from '../config/public-env';

type PageState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; flow: ExtensionAuthFlow };

interface ExtensionAuthPageProps {
  api?: PlatformApi;
  apiOrigin?: string | null;
  flowId?: string;
}

export function ExtensionAuthPage({
  api: providedApi,
  apiOrigin = platformApiOrigin,
  flowId: providedFlowId,
}: ExtensionAuthPageProps) {
  const route = useParams<{ flowId: string }>();
  const flowId = providedFlowId ?? route.flowId ?? '';
  const isValidFlowId = /^[A-Za-z0-9_-]{8,128}$/u.test(flowId);
  const api = useMemo(() => providedApi ?? createPlatformApi(), [providedApi]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    if (!isValidFlowId) return;
    const controller = new AbortController();
    void api
      .getExtensionAuthFlow(flowId, controller.signal)
      .then((flow) => setState({ status: 'ready', flow }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setState({ status: 'unavailable' });
      });
    return () => controller.abort();
  }, [api, attempt, flowId, isValidFlowId]);

  if (!isValidFlowId) {
    return (
      <ExtensionAuthFrame>
        <StatusIcon tone="danger" />
        <h1>Invalid sign-in link</h1>
        <p>Start a new connection from the Grok Automator™ extension.</p>
        <Link className="extension-auth__secondary" to="/">
          Return home
        </Link>
      </ExtensionAuthFrame>
    );
  }

  if (
    state.status === 'loading' ||
    (state.status === 'ready' && state.flow.flowId !== flowId)
  ) {
    return (
      <ExtensionAuthFrame live>
        <span className="extension-auth__status-icon extension-auth__status-icon--loading">
          <IconRefresh aria-hidden="true" stroke={1.75} />
        </span>
        <h1>Checking sign-in request</h1>
        <p>The platform is validating this connection request.</p>
      </ExtensionAuthFrame>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <ExtensionAuthFrame live>
        <StatusIcon tone="danger" />
        <h1>Unable to verify sign-in</h1>
        <p>
          The platform could not validate this request. No account or extension
          access has been granted.
        </p>
        <button
          className="extension-auth__primary extension-auth__primary--outline"
          type="button"
          onClick={() => {
            setState({ status: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          <IconRefresh aria-hidden="true" stroke={1.75} />
          Try again
        </button>
      </ExtensionAuthFrame>
    );
  }

  return (
    <VerifiedFlow
      key={state.flow.flowId}
      api={api}
      flow={state.flow}
      apiOrigin={apiOrigin}
      onVerified={() => {
        setState({ status: 'loading' });
        setAttempt((value) => value + 1);
      }}
    />
  );
}

function ExtensionAuthFrame({
  children,
  live = false,
}: {
  children: ReactNode;
  live?: boolean;
}) {
  return (
    <main className="extension-auth-page">
      <BrandLockup centered />
      <section
        className="extension-auth"
        aria-live={live ? 'polite' : undefined}
      >
        {children}
      </section>
    </main>
  );
}

function StatusIcon({ tone }: { tone: 'danger' | 'success' | 'neutral' }) {
  return (
    <span
      className={`extension-auth__status-icon extension-auth__status-icon--${tone}`}
    >
      {tone === 'success' ? (
        <IconCircleCheck aria-hidden="true" stroke={1.75} />
      ) : tone === 'neutral' ? (
        <IconClock aria-hidden="true" stroke={1.75} />
      ) : (
        <IconAlertTriangle aria-hidden="true" stroke={1.75} />
      )}
    </span>
  );
}

function VerifiedFlow({
  api,
  flow,
  apiOrigin,
  onVerified,
}: {
  api: PlatformApi;
  flow: ExtensionAuthFlow;
  apiOrigin: string | null;
  onVerified: () => void;
}) {
  const [userCode, setUserCode] = useState('');
  const [verificationState, setVerificationState] = useState<
    'idle' | 'submitting' | 'error'
  >('idle');
  const [verificationError, setVerificationError] = useState('');
  const [currentFlow, setCurrentFlow] = useState(flow);
  const verificationController = useRef<AbortController | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
      verificationController.current?.abort();
    };
  }, []);

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verificationState === 'submitting') return;
    if (
      currentFlow.schemaVersion !== 2 ||
      currentFlow.status !== 'verification_required' ||
      currentFlow.csrfToken === null
    ) {
      setVerificationState('error');
      setVerificationError(
        'Your verified Google session is unavailable. Start a new request from the extension and complete Google sign-in in this browser.',
      );
      return;
    }

    const controller = new AbortController();
    verificationController.current?.abort();
    verificationController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    setVerificationState('submitting');
    setVerificationError('');

    try {
      await api.verifyExtensionAuthFlow(
        currentFlow.flowId,
        userCode,
        currentFlow.csrfToken,
        controller.signal,
      );
      if (!controller.signal.aborted && isMounted.current) onVerified();
    } catch (error) {
      if (!isMounted.current) return;
      if (controller.signal.aborted) {
        setVerificationError(
          'Verification timed out. Check your connection and try again.',
        );
      } else {
        setVerificationError(
          isApiFailure(error)
            ? error.message
            : 'The code could not be verified. Check it and try again.',
        );
      }
      setVerificationState('error');
      try {
        const refreshed = await api.getExtensionAuthFlow(currentFlow.flowId);
        if (isMounted.current) setCurrentFlow(refreshed);
      } catch {
        // Preserve the verified server error when the follow-up status refresh
        // is temporarily unavailable.
      }
    } finally {
      window.clearTimeout(timeout);
      if (verificationController.current === controller) {
        verificationController.current = null;
      }
    }
  }

  if (currentFlow.status === 'verification_required') {
    const attemptsExhausted = currentFlow.verificationAttemptsRemaining === 0;
    const hasVerifiedSession = currentFlow.csrfToken !== null;
    const isValidCode =
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/u.test(
        userCode,
      );

    return (
      <ExtensionAuthFrame live={verificationState === 'error'}>
        <span className="extension-auth__status-icon">
          <IconShieldLock aria-hidden="true" stroke={1.75} />
        </span>
        <p className="extension-auth__app">{currentFlow.appDisplayName}</p>
        <h1>Verify this request</h1>
        <p>
          Google confirmed your account in this browser. Enter the one-time code
          shown inside Grok Automator™ to approve only the request you started.
        </p>
        <form
          className="extension-auth__verification-form"
          onSubmit={(event) => void submitVerification(event)}
        >
          <label htmlFor="extension-auth-user-code">
            Code shown in extension
          </label>
          <input
            id="extension-auth-user-code"
            name="userCode"
            type="text"
            value={userCode}
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            maxLength={9}
            pattern="[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}"
            placeholder="XXXX-XXXX"
            required
            spellCheck={false}
            disabled={
              !hasVerifiedSession ||
              attemptsExhausted ||
              verificationState === 'submitting'
            }
            onChange={(event) => {
              const characters = event.currentTarget.value
                .toUpperCase()
                .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/gu, '')
                .slice(0, 8);
              setUserCode(
                characters.length > 4
                  ? `${characters.slice(0, 4)}-${characters.slice(4)}`
                  : characters,
              );
              if (verificationState === 'error') {
                setVerificationState('idle');
                setVerificationError('');
              }
            }}
          />
          <button
            className="extension-auth__primary"
            type="submit"
            disabled={
              !hasVerifiedSession ||
              attemptsExhausted ||
              !isValidCode ||
              verificationState === 'submitting'
            }
          >
            {verificationState === 'submitting' ? (
              <>
                <IconRefresh aria-hidden="true" stroke={1.75} />
                Verifying
              </>
            ) : (
              'Verify request'
            )}
          </button>
        </form>
        {verificationError.length > 0 ? (
          <p className="extension-auth__verification-error" role="alert">
            {verificationError}
          </p>
        ) : null}
        {!hasVerifiedSession ? (
          <p className="extension-auth__verification-error" role="alert">
            Your verified Google session is missing or no longer matches this
            request. Start a new request from the extension and complete Google
            sign-in in this browser.
          </p>
        ) : null}
        <p className="extension-auth__expiry">
          {!hasVerifiedSession
            ? 'This request cannot be approved without its matching Google session.'
            : attemptsExhausted
              ? 'No verification attempts remain. Start a new request from the extension.'
              : `${currentFlow.verificationAttemptsRemaining} verification attempts remain.`}
        </p>
        <p className="extension-auth__privacy">
          The verification code is submitted only to the platform API and is
          never added to the sign-in URL.
        </p>
      </ExtensionAuthFrame>
    );
  }

  if (currentFlow.status === 'pending') {
    const googleUrl = createExtensionGoogleAuthStartUrl(
      apiOrigin,
      currentFlow.flowId,
      {
        allowInsecureDevelopment: import.meta.env.DEV,
      },
    );

    return (
      <ExtensionAuthFrame>
        <span className="extension-auth__status-icon">
          <IconShieldLock aria-hidden="true" stroke={1.75} />
        </span>
        <p className="extension-auth__app">{currentFlow.appDisplayName}</p>
        <h1>Connect your account</h1>
        {currentFlow.schemaVersion === 1 ? (
          <p>
            This request uses the temporary compatibility sign-in flow. Continue
            with Google, then update Grok Automator™ to use one-time code
            verification for future connections.
          </p>
        ) : (
          <p>
            Continue with Google first. After Google binds this request to your
            account, verify the one-time code shown in Grok Automator™.
          </p>
        )}
        {googleUrl !== null ? (
          <a className="extension-auth__primary" href={googleUrl}>
            <GoogleIcon />
            Continue with Google
          </a>
        ) : (
          <button className="extension-auth__primary" type="button" disabled>
            <GoogleIcon />
            Continue with Google
          </button>
        )}
        <p className="extension-auth__expiry">
          Request expires {formatDateTime(currentFlow.expiresAt)}
        </p>
        <p className="extension-auth__privacy">
          This page never receives your Google token or extension credentials.
        </p>
      </ExtensionAuthFrame>
    );
  }

  if (currentFlow.status === 'authorized') {
    return (
      <ExtensionAuthFrame live>
        <StatusIcon tone="success" />
        <p className="extension-auth__app">{currentFlow.appDisplayName}</p>
        <h1>Account connected</h1>
        <p>
          You may close this tab and return to the extension. Product access is
          checked separately when you run an automation.
        </p>
      </ExtensionAuthFrame>
    );
  }

  const content = {
    denied: {
      title: 'Connection denied',
      description:
        'Google sign-in was not completed. Start a new request from the extension when you are ready.',
    },
    expired: {
      title: 'Sign-in request expired',
      description:
        'For your security, this request can no longer be used. Start again from the extension.',
    },
    consumed: {
      title: 'Sign-in request already used',
      description:
        'This one-time request has already been completed. Return to the extension to continue.',
    },
  }[currentFlow.status];

  return (
    <ExtensionAuthFrame live>
      <StatusIcon tone="neutral" />
      <p className="extension-auth__app">{currentFlow.appDisplayName}</p>
      <h1>{content.title}</h1>
      <p>{content.description}</p>
    </ExtensionAuthFrame>
  );
}

export default ExtensionAuthPage;
