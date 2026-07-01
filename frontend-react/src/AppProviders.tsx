/* App-wide providers: TanStack Query + Auth. Wrap the whole app once. */
import { useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { AuthProvider } from '@/context/AuthProvider'
import { ToastProvider } from '@/components/feedback/ToastProvider'
import { ConfirmProvider } from '@/components/modals/ConfirmProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Don't retry auth/permission failures; they won't fix themselves.
        retry: (count, err) =>
          !(err instanceof ApiError && (err.isUnauthorized || err.isForbidden)) && count < 2,
      },
    },
  })
}

export function AppProviders({ children }: { children: ReactNode }) {
  // One client per app instance, stable across re-renders.
  const [queryClient] = useState(createQueryClient)

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <ConfirmProvider>
            <AuthProvider>{children}</AuthProvider>
          </ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
