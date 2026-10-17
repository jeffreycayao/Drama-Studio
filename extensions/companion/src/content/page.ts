import { isHttpsGrokUrl } from '../security/urls';

export function isGrokPage(url: string = window.location.href): boolean {
  return isHttpsGrokUrl(url);
}
