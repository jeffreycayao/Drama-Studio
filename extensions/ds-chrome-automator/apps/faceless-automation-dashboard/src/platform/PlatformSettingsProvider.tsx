import { useEffect, type PropsWithChildren } from 'react';

import { createPlatformApi } from '../admin/api';
import { applyPlatformSettings } from './apply-settings';

export function PlatformSettingsProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    const controller = new AbortController();
    const api = createPlatformApi();

    void api
      .getPublicPlatformSettings(controller.signal)
      .then(applyPlatformSettings)
      .catch(() => {
        // Local bundled defaults remain authoritative when the API is absent.
      });

    return () => controller.abort();
  }, []);

  return children;
}
