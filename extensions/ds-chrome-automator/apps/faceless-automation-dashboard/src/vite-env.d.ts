/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLATFORM_API_ORIGIN?: string;
  /** @deprecated Use VITE_PLATFORM_API_ORIGIN. */
  readonly VITE_AUTH_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
