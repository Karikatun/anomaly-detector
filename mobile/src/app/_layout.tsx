import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';

import { AuthProvider } from '@/lib/auth';
import { IapProvider } from '@/lib/iap';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 30_000,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <IapProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </IapProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
