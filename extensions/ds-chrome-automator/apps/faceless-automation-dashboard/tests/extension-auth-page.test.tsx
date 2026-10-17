import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { ApiFailure } from '../src/admin/api';
import { ExtensionAuthPage } from '../src/pages/ExtensionAuthPage';
import { createAdminApiStub } from './admin-fixtures';

const flowId = 'extension_flow_0001';
const flowCsrfToken = 'c'.repeat(32);
type FlowStatus =
  | 'verification_required'
  | 'pending'
  | 'authorized'
  | 'denied'
  | 'expired'
  | 'consumed';

function createFlow(status: FlowStatus) {
  return {
    schemaVersion: 2 as const,
    flowId,
    appId: 'grok-automator' as const,
    appDisplayName: 'Grok Automator™' as const,
    status,
    verificationAttemptsRemaining: 5,
    csrfToken: status === 'verification_required' ? flowCsrfToken : null,
    expiresAt: '2026-08-16T10:00:00.000Z',
  };
}

function createLegacyFlow(
  status: Exclude<FlowStatus, 'verification_required'> = 'pending',
) {
  return {
    schemaVersion: 1 as const,
    flowId,
    appId: 'grok-automator' as const,
    appDisplayName: 'Grok Automator™' as const,
    status,
    expiresAt: '2026-08-16T10:00:00.000Z',
  };
}

function renderPage(status: FlowStatus) {
  const api = createAdminApiStub({
    getExtensionAuthFlow: vi.fn().mockResolvedValue(createFlow(status)),
  });
  return render(
    <MemoryRouter>
      <ExtensionAuthPage
        api={api}
        apiOrigin="https://paks-tools.vercel.app"
        flowId={flowId}
      />
    </MemoryRouter>,
  );
}

describe('ExtensionAuthPage', () => {
  it('offers Google first so v2 can bind the request to a verified account', async () => {
    renderPage('pending');

    const link = await screen.findByRole('link', {
      name: 'Continue with Google',
    });
    expect(link).toHaveAttribute(
      'href',
      `https://paks-tools.vercel.app/v1/auth/google/start?client=extension&flowId=${flowId}`,
    );
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('chrome-extension://');
    expect(document.body.textContent).not.toContain('code_challenge');
    expect(document.body.textContent).not.toMatch(/\b[a-p]{32}\b/u);
    expect(
      screen.getByText(/never receives your Google token/iu),
    ).toBeInTheDocument();
  });

  it('requires the independent extension code after Google binds the request', async () => {
    const getExtensionAuthFlow = vi
      .fn()
      .mockResolvedValueOnce(createFlow('verification_required'))
      .mockResolvedValueOnce(createFlow('authorized'));
    const verifyExtensionAuthFlow = vi.fn().mockResolvedValue({
      schemaVersion: 2,
      flowId,
      status: 'verified',
      attemptsRemaining: 5,
    });
    const api = createAdminApiStub({
      getExtensionAuthFlow,
      verifyExtensionAuthFlow,
    });
    render(
      <MemoryRouter>
        <ExtensionAuthPage
          api={api}
          apiOrigin="https://paks-tools.vercel.app"
          flowId={flowId}
        />
      </MemoryRouter>,
    );

    const code = await screen.findByRole('textbox', {
      name: 'Code shown in extension',
    });
    expect(
      screen.queryByRole('link', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument();

    await userEvent.type(code, 'abcdefgh');
    expect(code).toHaveValue('ABCD-EFGH');
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify request' }),
    );

    expect(verifyExtensionAuthFlow).toHaveBeenCalledWith(
      flowId,
      'ABCD-EFGH',
      flowCsrfToken,
      expect.any(AbortSignal),
    );
    expect(
      await screen.findByRole('heading', { name: 'Account connected' }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ABCD-EFGH');
  });

  it('fails closed when the matching Google session is unavailable', async () => {
    const verifyExtensionAuthFlow = vi.fn();
    const api = createAdminApiStub({
      getExtensionAuthFlow: vi.fn().mockResolvedValue({
        ...createFlow('verification_required'),
        csrfToken: null,
      }),
      verifyExtensionAuthFlow,
    });
    render(
      <MemoryRouter>
        <ExtensionAuthPage api={api} flowId={flowId} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/verified Google session is missing/iu),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: 'Code shown in extension' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Verify request' }),
    ).toBeDisabled();
    expect(verifyExtensionAuthFlow).not.toHaveBeenCalled();
  });

  it('keeps a released v1 extension usable while identifying the compatibility flow', async () => {
    const api = createAdminApiStub({
      getExtensionAuthFlow: vi.fn().mockResolvedValue(createLegacyFlow()),
    });
    render(
      <MemoryRouter>
        <ExtensionAuthPage
          api={api}
          apiOrigin="https://paks-tools.vercel.app"
          flowId={flowId}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/temporary compatibility sign-in flow/iu),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: 'Code shown in extension' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute(
      'href',
      `https://paks-tools.vercel.app/v1/auth/google/start?client=extension&flowId=${flowId}`,
    );
  });

  it('fails closed when the extension code is rejected', async () => {
    const verifyExtensionAuthFlow = vi
      .fn()
      .mockRejectedValue(
        new ApiFailure('forbidden', 'The verification code did not match.'),
      );
    const api = createAdminApiStub({
      getExtensionAuthFlow: vi
        .fn()
        .mockResolvedValue(createFlow('verification_required')),
      verifyExtensionAuthFlow,
    });
    render(
      <MemoryRouter>
        <ExtensionAuthPage
          api={api}
          apiOrigin="https://paks-tools.vercel.app"
          flowId={flowId}
        />
      </MemoryRouter>,
    );

    await userEvent.type(
      await screen.findByRole('textbox', {
        name: 'Code shown in extension',
      }),
      'ABCD-EFGH',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify request' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The verification code did not match.',
    );
    expect(
      screen.queryByRole('link', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument();
  });

  it('refreshes the authoritative flow after a failed code reaches terminal lockout', async () => {
    const getExtensionAuthFlow = vi
      .fn()
      .mockResolvedValueOnce({
        ...createFlow('verification_required'),
        verificationAttemptsRemaining: 1,
      })
      .mockResolvedValueOnce(createFlow('denied'));
    const api = createAdminApiStub({
      getExtensionAuthFlow,
      verifyExtensionAuthFlow: vi
        .fn()
        .mockRejectedValue(
          new ApiFailure('forbidden', 'The verification code did not match.'),
        ),
    });
    render(
      <MemoryRouter>
        <ExtensionAuthPage api={api} flowId={flowId} />
      </MemoryRouter>,
    );

    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Code shown in extension' }),
      'abcdefgh',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Verify request' }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Connection denied' }),
    ).toBeInTheDocument();
    expect(getExtensionAuthFlow).toHaveBeenCalledTimes(2);
  });

  it('shows connection success without claiming a product entitlement', async () => {
    renderPage('authorized');

    expect(
      await screen.findByRole('heading', { name: 'Account connected' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Product access is checked separately/iu),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['denied', 'Connection denied'],
    ['expired', 'Sign-in request expired'],
    ['consumed', 'Sign-in request already used'],
  ] as const)(
    'renders the verified %s terminal state',
    async (status, heading) => {
      renderPage(status);
      expect(
        await screen.findByRole('heading', { name: heading }),
      ).toBeInTheDocument();
    },
  );

  it('hides an old flow while client-side navigation loads a different flow', async () => {
    const nextFlowId = 'extension_flow_0002';
    const nextFlow = { ...createFlow('pending'), flowId: nextFlowId };
    let resolveNextFlow: ((flow: typeof nextFlow) => void) | undefined;
    const pendingNextFlow = new Promise<typeof nextFlow>((resolve) => {
      resolveNextFlow = resolve;
    });
    const getExtensionAuthFlow = vi
      .fn()
      .mockResolvedValueOnce(createFlow('pending'))
      .mockReturnValueOnce(pendingNextFlow);
    const api = createAdminApiStub({ getExtensionAuthFlow });
    const { rerender } = render(
      <MemoryRouter>
        <ExtensionAuthPage
          api={api}
          apiOrigin="https://paks-tools.vercel.app"
          flowId={flowId}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute(
      'href',
      `https://paks-tools.vercel.app/v1/auth/google/start?client=extension&flowId=${flowId}`,
    );

    rerender(
      <MemoryRouter>
        <ExtensionAuthPage
          api={api}
          apiOrigin="https://paks-tools.vercel.app"
          flowId={nextFlowId}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: 'Checking sign-in request' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Continue with Google' }),
    ).not.toBeInTheDocument();

    resolveNextFlow?.(nextFlow);
    expect(
      await screen.findByRole('link', { name: 'Continue with Google' }),
    ).toHaveAttribute(
      'href',
      `https://paks-tools.vercel.app/v1/auth/google/start?client=extension&flowId=${nextFlowId}`,
    );
  });

  it('rejects an invalid flow identifier before making an API request', () => {
    const getExtensionAuthFlow = vi.fn();
    const api = createAdminApiStub({ getExtensionAuthFlow });
    render(
      <MemoryRouter>
        <ExtensionAuthPage api={api} flowId="../redirect" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', { name: 'Invalid sign-in link' }),
    ).toBeInTheDocument();
    expect(getExtensionAuthFlow).not.toHaveBeenCalled();
  });
});
