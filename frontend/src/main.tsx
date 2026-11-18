import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
// Fonts are served by the app itself (no Google Fonts): works offline, strict CSP, no tracking.
import "@fontsource/cairo/arabic-400.css";
import "@fontsource/cairo/latin-400.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/cairo/arabic-500.css";
import "@fontsource/cairo/latin-500.css";
import "@fontsource/instrument-sans/latin-500.css";
import "@fontsource/cairo/arabic-600.css";
import "@fontsource/cairo/latin-600.css";
import "@fontsource/instrument-sans/latin-600.css";
import "@fontsource/cairo/arabic-700.css";
import "@fontsource/cairo/latin-700.css";
import "@fontsource/instrument-sans/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "./i18n";
import "./styles/theme.css";
import "./styles/rtl.css";
import "./styles/app.css";
import "./styles/pos.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* v7 wraps navigation in React.startTransition by default; the app (and its e2e tests) expect v6 timing. */}
        <BrowserRouter useTransitions={false}>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
