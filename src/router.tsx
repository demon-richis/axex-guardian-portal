import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = async () => {
  const queryClient = new QueryClient();
  const nonce = import.meta.env.SSR
    ? ((await import("@tanstack/start-storage-context")).getStartContext({
        throwIfNotFound: false,
      })?.contextAfterGlobalMiddlewares?.cspNonce as string | undefined)
    : undefined;

  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(nonce ? { ssr: { nonce } } : {}),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
