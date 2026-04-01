/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_SIGNIN_EMAIL?: string;
  readonly VITE_DEV_SIGNIN_PASSWORD?: string;
  readonly VITE_PROXY_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
