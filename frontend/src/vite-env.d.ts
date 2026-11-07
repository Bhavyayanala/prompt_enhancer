/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** Base URL of the Express backend. Empty = same origin (nginx proxies /api in Docker). */
  readonly VITE_API_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
