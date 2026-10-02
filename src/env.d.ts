/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  /** Dev only: read chain state from this RPC instead of the public list (a local fork). */
  readonly VITE_RPC_URL?: string;
}
