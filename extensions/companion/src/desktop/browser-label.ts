/**
 * Short browser name for the desktop link's `hello` ("Chrome 141",
 * "Edge 141"). Drama Studio shows it in the "Allow this browser…?" prompt
 * and in Settings › Browser. The wire format allows 64 characters, so the
 * full user-agent string is never sent.
 */

interface BrandVersion {
  brand: string;
  version: string;
}

export interface BrowserIdentitySource {
  userAgent: string;
  userAgentData?: { brands?: readonly BrandVersion[] };
}

const BRANDS: ReadonlyArray<readonly [brand: string, label: string]> = [
  ['Microsoft Edge', 'Edge'],
  ['Brave', 'Brave'],
  ['Opera', 'Opera'],
  ['Vivaldi', 'Vivaldi'],
  ['Google Chrome', 'Chrome'],
  ['Chromium', 'Chromium'],
];

const USER_AGENT_TOKENS: ReadonlyArray<
  readonly [pattern: RegExp, label: string]
> = [
  [/\bEdg\/(\d+)/u, 'Edge'],
  [/\bOPR\/(\d+)/u, 'Opera'],
  [/\bVivaldi\/(\d+)/u, 'Vivaldi'],
  [/\bChrome\/(\d+)/u, 'Chrome'],
];

const MAX_LABEL_LENGTH = 64;

const withVersion = (label: string, version: string | undefined): string => {
  const major = /^\d+/u.exec(version ?? '')?.[0];
  return (major ? `${label} ${major}` : label).slice(0, MAX_LABEL_LENGTH);
};

export function browserLabel(source: BrowserIdentitySource): string {
  const brands = source.userAgentData?.brands ?? [];
  for (const [brand, label] of BRANDS) {
    const match = brands.find((entry) => entry.brand === brand);
    if (match) return withVersion(label, match.version);
  }
  for (const [pattern, label] of USER_AGENT_TOKENS) {
    const match = pattern.exec(source.userAgent);
    if (match) return withVersion(label, match[1]);
  }
  return 'Browser';
}
