import React from 'react';

interface EmptyStateProps {
  icon?: string | React.ReactNode;
  title: string;
  description: string;
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  instructions?: string[];
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  primaryAction,
  secondaryAction,
  instructions,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 md:p-12 text-center max-w-lg mx-auto bg-gray-800/40 border border-gray-700/60 rounded-2xl shadow-xl my-8 space-y-4">
      {icon && (
        <div className="w-16 h-16 flex items-center justify-center rounded-2xl bg-gray-800 border border-gray-700 text-3xl shadow-inner mb-1">
          {icon}
        </div>
      )}

      <h3 className="text-xl font-bold text-white tracking-tight">{title}</h3>
      <p className="text-sm text-gray-400 max-w-md leading-relaxed">{description}</p>

      {instructions && instructions.length > 0 && (
        <div className="w-full bg-gray-900/60 border border-gray-800 rounded-xl p-4 text-left my-3 space-y-2">
          <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">How to resolve this:</p>
          <ul className="text-xs text-gray-300 space-y-1.5 list-disc list-inside">
            {instructions.map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap gap-3 justify-center pt-2">
          {primaryAction && (
            <button
              type="button"
              onClick={primaryAction.onClick}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow-lg shadow-blue-600/20 transition"
            >
              {primaryAction.label}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              onClick={secondaryAction.onClick}
              className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm font-semibold rounded-lg transition border border-gray-600"
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
