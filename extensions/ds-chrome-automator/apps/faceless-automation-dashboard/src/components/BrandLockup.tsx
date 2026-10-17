import { Link } from 'react-router-dom';

interface BrandLockupProps {
  centered?: boolean;
}

export function BrandLockup({ centered = false }: BrandLockupProps) {
  return (
    <Link
      className={
        centered ? 'brand-lockup brand-lockup--centered' : 'brand-lockup'
      }
      to="/"
      aria-label="Paks Tools Faceless automations"
    >
      <span className="brand-monogram" aria-hidden="true">
        <span>P</span>
        <span>T</span>
      </span>
      <span className="brand-name">Paks Tools Faceless automations</span>
    </Link>
  );
}
