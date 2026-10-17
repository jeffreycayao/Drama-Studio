import { IconArrowLeft } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';

import { BrandLockup } from '../components/BrandLockup';
import { GoogleIcon } from '../components/GoogleIcon';
import { googleAuthStartUrl } from '../config/public-env';

interface AuthPageProps {
  authUrl?: string | null;
}

export function AuthPage({ authUrl = googleAuthStartUrl }: AuthPageProps) {
  const [searchParams] = useSearchParams();
  const requestedReturnTo = searchParams.get('returnTo');
  const safeReturnTo =
    requestedReturnTo !== null && /^\/admin(?:\/|$)/u.test(requestedReturnTo)
      ? requestedReturnTo
      : null;
  const resolvedAuthUrl = (() => {
    if (authUrl === null) return null;
    if (safeReturnTo === null) return authUrl;
    const url = new URL(authUrl);
    url.searchParams.set('returnTo', safeReturnTo);
    return url.toString();
  })();
  const isConfigured = resolvedAuthUrl !== null;

  return (
    <main className="auth-page">
      <BrandLockup centered />

      <section className="auth-card" aria-labelledby="auth-heading">
        <h1 id="auth-heading">Welcome back</h1>

        {isConfigured ? (
          <a className="google-action" href={resolvedAuthUrl ?? undefined}>
            <GoogleIcon />
            <span>Continue with Google</span>
          </a>
        ) : (
          <button className="google-action" type="button" disabled>
            <GoogleIcon />
            <span>Continue with Google</span>
          </button>
        )}

        <p>Google is the only sign-in method.</p>
        {!isConfigured ? (
          <p className="auth-status" role="status">
            Google sign-in requires backend setup.
          </p>
        ) : null}

        <Link className="back-link" to="/">
          <IconArrowLeft
            aria-hidden="true"
            className="arrow-icon"
            focusable="false"
            stroke={1.7}
          />
          <span>Back to home</span>
        </Link>
      </section>
    </main>
  );
}

export default AuthPage;
