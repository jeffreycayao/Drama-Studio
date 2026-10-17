/// <reference types="chrome" />

declare module '*.css';

interface ImportMetaEnv {
  readonly WXT_PLATFORM_API_ORIGIN?: string;
  readonly WXT_PLATFORM_WEB_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
