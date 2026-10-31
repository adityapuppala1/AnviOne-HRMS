import { useState, type ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/public-sans";
import { PreferencesProvider } from "./lib/preferences";
import { Ambient } from "./components/ambient";
import "@anvi/ui/theme.css";
import "./styles.css";
import "./loom.css";
import "./wow.css";
import "./responsive.css";
export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="color-scheme" content="light dark" />
        <title>AnviOne · Your people workspace</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
export default function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15000,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <PreferencesProvider>
        <Ambient />
        <Outlet />
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
export function ErrorBoundary() {
  return (
    <main className="standalone">
      <h1>Something interrupted your workspace</h1>
      <p>Refresh to try again. Your saved work is safe.</p>
      <a className="button button-primary" href="/">
        Return home
      </a>
    </main>
  );
}
