import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AudioPlayerProvider } from "@/contexts/AudioPlayerContext";
import { ThemeProvider } from "@/components/theme-provider";
import { routeTree } from "./routeTree.gen";

const router = createRouter({ routeTree, scrollRestoration: true });
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 1,
    },
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="teak-ui-theme">
      <QueryClientProvider client={queryClient}>
        <AudioPlayerProvider>
          <RouterProvider router={router} />
        </AudioPlayerProvider>
        <ReactQueryDevtools initialIsOpen={false} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
