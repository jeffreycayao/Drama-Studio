import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { AutomationPreview } from '../components/AutomationPreview';
import { BrandLockup } from '../components/BrandLockup';

export default function LandingPage() {
  return (
    <main className="landing-page">
      <header className="site-header">
        <BrandLockup />
        <Link className="sign-in-link" to="/auth">
          Sign in
        </Link>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <h1>
            <span>Paks Tools</span>
            <span>Faceless automations</span>
          </h1>
          <p className="hero-lead">
            Automate the repetitive. Keep the creative decisions.
          </p>
          <p className="hero-support">
            One secure home for focused browser automation tools.
          </p>
          <a className="primary-action" href="#grok-automator">
            <span>Explore Grok Automator™</span>
            <IconArrowRight
              aria-hidden="true"
              className="arrow-icon"
              focusable="false"
              stroke={1.7}
            />
          </a>
        </div>

        <AutomationPreview />
      </section>

      <div className="signal-field" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <svg key={index} viewBox="0 0 1200 130" preserveAspectRatio="none">
            <path
              d={`M0 ${54 + index * 5} C 210 ${35 + index * 4}, 410 ${116 - index * 2}, 610 ${104 - index}, 820 ${92 - index}, 980 ${20 + index * 2}, 1200 ${52 + index * 3}`}
            />
          </svg>
        ))}
        <span />
      </div>
    </main>
  );
}
