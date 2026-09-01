import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

interface GuideSearchProps {
  onSearchDebounced: (term: string) => void;
}

export function GuideSearch({ onSearchDebounced }: GuideSearchProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [inputValue, setInputValue] = useState(initialQuery);

  // Inform parent immediately on mount if there's an initial query
  useEffect(() => {
    if (initialQuery) {
      onSearchDebounced(initialQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearchDebounced(inputValue);
      
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev);
          if (inputValue) {
            newParams.set('q', inputValue);
          } else {
            newParams.delete('q');
          }
          return newParams;
        },
        { replace: true }
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, onSearchDebounced, setSearchParams]);

  return (
    <div className="relative flex-grow max-w-sm">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        placeholder="Search channels..."
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        className="bg-gray-800 text-white border border-gray-700 rounded-md py-1.5 pl-9 pr-3 text-sm outline-none focus:border-blue-500 w-full"
      />
    </div>
  );
}
