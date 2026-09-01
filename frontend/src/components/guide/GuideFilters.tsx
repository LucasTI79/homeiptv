import { type ChangeEvent } from 'react';

interface GuideFiltersProps {
  groups: string[];
  sources: string[];
  activeGroupFilter: string;
  activeSourceFilter: string;
  onChangeGroup: (group: string) => void;
  onChangeSource: (source: string) => void;
}

export function GuideFilters({
  groups,
  sources,
  activeGroupFilter,
  activeSourceFilter,
  onChangeGroup,
  onChangeSource,
}: GuideFiltersProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 items-center">
      <select
        value={activeGroupFilter}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChangeGroup(e.target.value)}
        className="bg-gray-800 text-white border border-gray-700 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
      >
        <option value="all">All Groups</option>
        <option value="favorites">Favorites</option>
        <option value="recents">Recent Channels</option>
        {groups.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>

      {sources.length > 1 && (
        <select
          value={activeSourceFilter}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => onChangeSource(e.target.value)}
          className="bg-gray-800 text-white border border-gray-700 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
        >
          <option value="all">All Sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
