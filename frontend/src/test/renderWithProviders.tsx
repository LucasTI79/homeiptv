import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '../components/ui/Tooltip';
import { CastProvider } from '../components/cast/CastProvider';

// Shared wrapper for page-level component tests: every page can call
// useNavigate (Router), useCast (CastProvider), or an unmocked useQuery
// (QueryClientProvider) somewhere in its tree, so tests render through all
// three rather than each test file reinventing its own subset.
export function renderWithProviders(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <CastProvider>{ui}</CastProvider>
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
