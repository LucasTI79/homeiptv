import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => {
  return (
    <div className={`animate-pulse bg-gray-800/80 rounded ${className}`} />
  );
};

export const GuideSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col h-full bg-gray-950 p-4 space-y-4">
      {/* Filters skeleton */}
      <div className="flex gap-3 items-center justify-between pb-4 border-b border-gray-800">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-48 rounded-md" />
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-3 h-20 items-center bg-gray-900/40 p-2 rounded-lg border border-gray-800/50">
            <Skeleton className="w-12 h-12 rounded-md shrink-0" />
            <div className="w-36 space-y-2 shrink-0">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="flex-1 flex gap-2 overflow-hidden">
              <Skeleton className="h-16 flex-1 rounded" />
              <Skeleton className="h-16 flex-1 rounded" />
              <Skeleton className="h-16 flex-1 rounded hidden sm:block" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export const VodSkeleton: React.FC = () => {
  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex gap-3 items-center justify-between pb-4 border-b border-gray-800">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded" />
          <Skeleton className="h-9 w-20 rounded" />
          <Skeleton className="h-9 w-20 rounded" />
        </div>
        <Skeleton className="h-9 w-64 rounded" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="bg-gray-800/50 rounded-lg overflow-hidden border border-gray-800 space-y-2 p-2">
            <Skeleton className="aspect-[2/3] w-full rounded" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
};
