import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import LandingPage from '../src/pages/LandingPage';

describe('LandingPage', () => {
  it('renders the approved first-viewport copy and navigation', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('heading', {
        name: 'Paks Tools Faceless automations',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Automate the repetitive. Keep the creative decisions.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('One secure home for focused browser automation tools.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Explore Grok Automator™' }),
    ).toHaveAttribute('href', '#grok-automator');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/auth',
    );
  });

  it('provides a single named product-preview destination', () => {
    const { container } = render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

    expect(container.querySelectorAll('#grok-automator')).toHaveLength(1);
    expect(
      container.querySelectorAll('.flow-node svg.tabler-icon'),
    ).toHaveLength(5);
    for (const icon of container.querySelectorAll(
      '.flow-node svg.tabler-icon',
    )) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
      expect(icon).toHaveAttribute('focusable', 'false');
    }

    const actionIcon = screen
      .getByRole('link', { name: 'Explore Grok Automator™' })
      .querySelector('svg');
    expect(actionIcon).toHaveClass('tabler-icon', 'arrow-icon');
    expect(actionIcon).toHaveAttribute('aria-hidden', 'true');
  });
});
