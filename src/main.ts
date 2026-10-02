import { createApp } from "vue";
import "@fontsource-variable/inter";
import "./styles.css";
import App from "./App.vue";

const start = () => createApp(App).mount("#app");

// Fork rehearsal: ?mock=0x... stands in for a browser wallet (see dev/mockWallet.ts).
const mockAccount = import.meta.env.DEV
  ? new URLSearchParams(location.search).get("mock")
  : null;
if (import.meta.env.DEV && mockAccount && import.meta.env.VITE_RPC_URL) {
  const rpcUrl = import.meta.env.VITE_RPC_URL;
  void import("./dev/mockWallet").then(({ announceMockWallet }) => {
    announceMockWallet(mockAccount, rpcUrl);
    start();
  });
} else {
  start();
}
