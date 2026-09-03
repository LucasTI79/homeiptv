import type { Channel } from '@homeiptv/shared-types';

// Ported verbatim (logic-for-logic) from public/js/modules/utils.js's parseM3U,
// typed for TS. Extracts channels from #EXTINF lines followed by a stream URL.
const m3uCache = new Map<string, Channel[]>();

export function parseM3U(data: string | null | undefined): Channel[] {
  if (!data) return [];

  // Instant memoized return if data hasn't changed
  const cached = m3uCache.get(data);
  if (cached) return cached;

  const lines = data.split('\n');
  const channels: Channel[] = [];
  const seenIds = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim() ?? '';
    if (line.startsWith('#EXTINF:')) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine && (nextLine.startsWith('http') || nextLine.startsWith('rtp') || nextLine.startsWith('/'))) {
        const idMatch = line.match(/tvg-id="([^"]*)"/);
        const logoMatch = line.match(/tvg-logo="([^"]*)"/);
        const nameMatch = line.match(/tvg-name="([^"]*)"/);
        const groupMatch = line.match(/group-title="([^"]*)"/);
        const chnoMatch = line.match(/tvg-chno="([^"]*)"/);
        const sourceMatch = line.match(/vini-source="([^"]*)"/);
        const commaIndex = line.lastIndexOf(',');
        const displayName = commaIndex !== -1 ? line.substring(commaIndex + 1).trim() : 'Unknown';
        const rawId = idMatch ? idMatch[1] : `unknown-${channels.length}`;

        const count = seenIds.get(rawId) || 0;
        seenIds.set(rawId, count + 1);
        const uniqueId = count > 0 ? `${rawId}_dup${count}` : rawId;

        channels.push({
          id: uniqueId,
          tvgId: rawId,
          logo: logoMatch ? logoMatch[1] : '',
          name: nameMatch ? nameMatch[1] : displayName,
          group: groupMatch ? groupMatch[1] : 'Uncategorized',
          chno: chnoMatch ? chnoMatch[1] : undefined,
          source: sourceMatch ? sourceMatch[1] : 'Default',
          displayName,
          url: nextLine,
        });
        i++;
      }
    }
  }

  // Keep cache small (max 5 items)
  if (m3uCache.size > 5) {
    const firstKey = m3uCache.keys().next().value;
    if (firstKey) m3uCache.delete(firstKey);
  }
  m3uCache.set(data, channels);

  return channels;
}
