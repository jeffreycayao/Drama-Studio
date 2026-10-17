import {
  IconAlertTriangle,
  IconArrowLeft,
  IconLock,
  IconRefresh,
} from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

import { BrandLockup } from '../components/BrandLockup';
import { AdminContext } from './AdminContext';
import {
  createAuthorizedPlatformApi,
  createPlatformApi,
  isApiFailure,
  type AdminSession,
  type PlatformApi,
} from './api';

type GateState =
  | { status: 'checking' }
  | { status: 'authorized'; session: AdminSession }
  | { status: 'signed-out' }
  | { status: 'forbidden' }
  | { status: 'unavailable'; requestId: string | null };

interface AdminGateProps {
  bootstrapApi?: PlatformApi;
  createAuthorizedApi?: (session: AdminSession) => PlatformApi;
}

export function AdminGate({
  bootstrapApi,
  createAuthorizedApi = createAuthorizedPlatformApi,
}: AdminGateProps) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GateState>({ status: 'checking' });
  const location = useLocation();
  const initialApi = useMemo(
    () => bootstrapApi ?? createPlatformApi(),
    [bootstrapApi],
  );
  const authorizedApi = useMemo(
    () =>
      state.status === 'authorized' ? createAuthorizedApi(state.session) : null,
    [createAuthorizedApi, state],
  );

  useEffect(() => {
    const controller = new AbortController();

    void initialApi
      .getAdminSession(controller.signal)
      .then((session) => setState({ status: 'authorized', session }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        if (isApiFailure(error) && error.kind === 'unauthorized') {
          setState({ status: 'signed-out' });
          return;
        }
        if (isApiFailure(error) && error.kind === 'forbidden') {
          setState({ status: 'forbidden' });
          return;
        }
        setState({
          status: 'unavailable',
          requestId: isApiFailure(error) ? error.requestId : null,
        });
      });

    return () => controller.abort();
  }, [attempt, initialApi]);

  if (state.status === 'authorized' && authorizedApi !== null) {
    return (
      <AdminContext.Provider
        value={{
          api: authorizedApi,
          session: state.session,
        }}
      >
        <Outlet />
      </AdminContext.Provider>
    );
  }

  const signInTarget = `/auth?returnTo=${encodeURIComponent(location.pathname)}`;

  return (
    <main className="admin-gate">
      <BrandLockup centered />
      <section className="admin-gate__panel" aria-live="polite">
        {state.status === 'checking' ? (
          <>
            <span className="admin-gate__icon admin-gate__icon--loading">
              <IconRefresh aria-hidden="true" stroke={1.75} />
            </span>
            <h1>Verifying admin access</h1>
            <p>
              The console stays locked until the platform confirms your role.
            </p>
          </>
        ) : null}

        {state.status === 'signed-out' ? (
          <>
            <span className="admin-gate__icon">
              <IconLock aria-hidden="true" stroke={1.75} />
            </span>
            <h1>Admin sign-in required</h1>
            <p>
              Continue with the authorized Google account to request access.
            </p>
            <Link className="admin-gate__action" to={signInTarget}>
              Continue with Google
            </Link>
          </>
        ) : null}

        {state.status === 'forbidden' ? (
          <>
            <span className="admin-gate__icon admin-gate__icon--danger">
              <IconLock aria-hidden="true" stroke={1.75} />
            </span>
            <h1>Administrator access required</h1>
            <p>
              Your Google account is signed in, but it is not an administrator.
            </p>
            <Link className="admin-gate__secondary" to="/">
              <IconArrowLeft aria-hidden="true" stroke={1.75} />
              Return home
            </Link>
          </>
        ) : null}

        {state.status === 'unavailable' ? (
          <>
            <span className="admin-gate__icon admin-gate__icon--danger">
              <IconAlertTriangle aria-hidden="true" stroke={1.75} />
            </span>
            <h1>Admin console unavailable</h1>
            <p>
              The platform API could not verify your role. No administrative
              data or controls have been loaded.
            </p>
            {state.requestId !== null ? (
              <p className="admin-gate__request">Request {state.requestId}</p>
            ) : null}
            <button
              className="admin-gate__action"
              type="button"
              onClick={() => {
                setState({ status: 'checking' });
                setAttempt((value) => value + 1);
              }}
            >
              <IconRefresh aria-hidden="true" stroke={1.75} />
              Retry verification
            </button>
            <Link className="admin-gate__secondary" to="/">
              <IconArrowLeft aria-hidden="true" stroke={1.75} />
              Return home
            </Link>
          </>
        ) : null}
      </section>
    </main>
  );
}

export default AdminGate;
