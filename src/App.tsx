import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { RouterProvider, createBrowserRouter } from 'react-router';
import { Provider } from 'react-redux';
import { QueryClientProvider } from '@tanstack/react-query';
import { appQueryClient } from '@/lib/queryClient';
import { store } from './redux/store';
import { ToastContainer } from 'react-toastify';
import "react-toastify/dist/ReactToastify.css"
import './App.css'
import Routes from './routes';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { TooltipProvider } from './components/ui/tooltip';
import { SocketProvider } from './context/SocketContext';
import { PersistentCacheBootstrap } from './components/PersistentCacheBootstrap';

// Inner component that can access theme context
function AppContent() {
  const router = useMemo(() => createBrowserRouter(Routes), []);
  const { resolvedTheme } = useTheme();

  const toastContainer = (
    <ToastContainer
      position="top-right"
      autoClose={4000}
      draggable
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      style={{ zIndex: 10200 }}
    />
  );

  return (
    <>
      <RouterProvider router={router} />
      {typeof document !== 'undefined'
        ? createPortal(toastContainer, document.body)
        : toastContainer}
    </>
  );
}

function App() {
  return (
    <Provider store={store}>
      <QueryClientProvider client={appQueryClient}>
        <ThemeProvider>
          <SocketProvider>
            <TooltipProvider>
              <PersistentCacheBootstrap />
              <AppContent />
            </TooltipProvider>
          </SocketProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  )
}

export default App
