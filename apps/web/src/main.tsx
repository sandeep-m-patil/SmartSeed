import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { AuthProvider, useAuth } from './auth';
import { ToastProvider } from './components/Toast';
import { LoginPage } from './LoginPage';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

function Root() {
  const { accessToken } = useAuth();
  // Drop every cached response (including the previous user's profile) whenever the session ends.
  useEffect(() => {
    if (!accessToken) queryClient.clear();
  }, [accessToken]);
  return accessToken ? <App /> : <LoginPage />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
