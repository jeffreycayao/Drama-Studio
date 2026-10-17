import { makeBadge } from 'badge-maker';

import { validateExtensionVersion } from './release-common.mjs';

export const VERSION_BADGE_RELATIVE_PATH = 'badges/version.svg';

export function renderVersionBadge(version) {
  const validatedVersion = validateExtensionVersion(version);
  const shieldsBadge = makeBadge({
    label: 'version',
    message: validatedVersion,
    labelColor: '#1C1C1C',
    color: '#D4AF37',
    style: 'flat-square',
    idSuffix: 'grok-automator-version',
  });

  const withoutDefaultTextColor = shieldsBadge.replace(
    '<g fill="#fff" text-anchor="middle"',
    '<g text-anchor="middle"',
  );
  let textIndex = 0;
  const accessibleBadge = withoutDefaultTextColor.replaceAll(
    '<text ',
    () => `<text fill="${textIndex++ === 0 ? '#fff' : '#0a0a0a'}" `,
  );

  if (textIndex !== 2) {
    throw new Error(
      `Unexpected Shields badge structure: expected 2 text nodes, found ${textIndex}`,
    );
  }

  return `${accessibleBadge}\n`;
}
