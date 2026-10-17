import { createContext, useContext } from 'react';

import type { AdminSession, PlatformApi } from './api';

export interface AdminContextValue {
  api: PlatformApi;
  session: AdminSession;
}

export const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (context === null) {
    throw new Error('useAdmin must be used inside the protected admin route.');
  }
  return context;
}
