import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { AuthPage } from '../src/pages/AuthPage';

function renderAuthPage(authUrl: string | null) {
  return render(
    <MemoryRouter>
      <AuthPage authUrl={authUrl} />
    </MemoryRouter>,
  );
}

describe('AuthPage', () => {
  it('fails closed when the backend origin is not configured', () => {
    renderAuthPage(null);

    expect(
      screen.getByRole('heading', { name: 'Welcome back' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeDisabled();
    expect(
      screen.getByText('Google is the only sign-in method.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Google sign-in requires backend setup.',
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('exposes only the configured Google authorization link', () => {
    renderAuthPage(
      'https://auth.example.com/v1/auth/google/start?client=dashboard',
    );

    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute(
      'href',
      'https://auth.example.com/v1/auth/google/start?client=dashboard',
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/iu)).not.toBeInTheDocument();
  });

  it('links back to the landing page', () => {
    renderAuthPage(null);

    const backLink = screen.getByRole('link', { name: 'Back to home' });
    expect(backLink).toHaveAttribute('href', '/');

    const backIcon = backLink.querySelector('svg');
    expect(backIcon).toHaveClass('tabler-icon', 'arrow-icon');
    expect(backIcon).toHaveAttribute('aria-hidden', 'true');
    expect(backIcon).toHaveAttribute('focusable', 'false');
  });

  it('preserves only a local admin return path for Google sign-in', () => {
    render(
      <MemoryRouter initialEntries={['/auth?returnTo=%2Fadmin%2Fusers']}>
        <AuthPage authUrl="https://api.example.com/v1/auth/google/start?client=dashboard" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute(
      'href',
      'https://api.example.com/v1/auth/google/start?client=dashboard&returnTo=%2Fadmin%2Fusers',
    );
  });

  it('drops an external return path', () => {
    render(
      <MemoryRouter
        initialEntries={['/auth?returnTo=https%3A%2F%2Fevil.example']}
      >
        <AuthPage authUrl="https://api.example.com/v1/auth/google/start?client=dashboard" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute(
      'href',
      'https://api.example.com/v1/auth/google/start?client=dashboard',
    );
  });
});
