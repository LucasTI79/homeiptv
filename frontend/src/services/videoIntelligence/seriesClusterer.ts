export interface ParsedMediaItem {
  rawTitle: string;
  url: string;
  clusterId: string;       // Normalized series slug, e.g. "the-boys"
  seasonClusterId: string; // Series + Season identifier, e.g. "the-boys-s04"
  canonicalTitle: string;  // Human readable clean title, e.g. "The Boys"
  season: number;
  episode: number;
}

const NOISE_PATTERNS = [
  /\[.*?\]|\(.*?\)/g,                                         // [FHD], (Dublado), etc.
  /\b(fhd|hd|4k|uhd|sd|1080p|720p|480p|2160p)\b/gi,
  /\b(dublado|legendado|dual|nacional|legendas?|leg|audio)\b/gi,
  /\b(x264|x265|hevc|h264|avc|10bit|aac|mp3|web-?dl|bluray|hdtv|remux)\b/gi,
  /\.(mkv|mp4|avi|ts|m3u8|flv|mov|webm)$/gi,                  // Extensões de vídeo
  /\b(epis[oó]dio|temporada|season|temp|cap[ií]tulo)\s*\d*\b/gi, // "Episódio 1" ou "Temporada 2"
  /[._-]/g                                                   // Substitui pontos, underscores e traços por espaço
];

const EPISODE_PATTERNS = [
  /[Ss](\d{1,2})[.\s-_]*[Ee](\d{1,3})/i,                     // S01E02, S1E2, s01.e02
  /(\d{1,2})[xX](\d{1,3})/i,                                 // 1x02, 01x02
  /[Tt](\d{1,2})[.\s-_]*[Ee][Pp]?\s*(\d{1,3})/i,             // T01EP02, T1E02, T1 Ep 02
  /\b[Ee][Pp]?\s*(\d{1,3})\b/i,                              // Ep 02, E02 (defaults to Season 1)
];

/**
 * Parses raw playlist/channel title to extract canonical series info, season and episode.
 */
export function parseAndClusterMedia(rawTitle: string, url: string = ''): ParsedMediaItem {
  let cleaned = rawTitle.trim();
  let season = 1;
  let episode = 1;

  // 1. Extract Season & Episode before stripping out numbers
  for (const pattern of EPISODE_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      if (match.length >= 3 && match[1] && match[2]) {
        season = parseInt(match[1], 10);
        episode = parseInt(match[2], 10);
      } else if (match[1]) {
        season = 1;
        episode = parseInt(match[1], 10);
      }
      cleaned = cleaned.replace(match[0], ' ');
      break;
    }
  }

  // 2. Clean out typical noise tags
  for (const regex of NOISE_PATTERNS) {
    cleaned = cleaned.replace(regex, ' ');
  }

  // 3. Normalize into slug
  const canonicalTitle = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-zA-Z0-9\s]/g, '')  // keep alphanumeric and spaces
    .replace(/\s+/g, ' ')
    .trim();

  const baseSlug = canonicalTitle.toLowerCase().replace(/\s+/g, '-');
  const clusterId = baseSlug || 'unknown-series';
  const sStr = String(season).padStart(2, '0');
  const seasonClusterId = `${clusterId}-s${sStr}`;

  return {
    rawTitle,
    url,
    clusterId,
    seasonClusterId,
    canonicalTitle: canonicalTitle || rawTitle,
    season,
    episode
  };
}

/**
 * Finds the next sequential episode in the playlist.
 */
export function getNextEpisode(
  current: ParsedMediaItem,
  playlist: ParsedMediaItem[]
): ParsedMediaItem | null {
  if (!playlist || playlist.length === 0) return null;

  // 1. Same season, next episode index
  const nextSameSeason = playlist.find(
    (item) => item.seasonClusterId === current.seasonClusterId && item.episode === current.episode + 1
  );
  if (nextSameSeason) return nextSameSeason;

  // 2. Next season, episode 1
  const nextSeasonFirst = playlist.find(
    (item) => item.clusterId === current.clusterId && item.season === current.season + 1 && item.episode === 1
  );
  if (nextSeasonFirst) return nextSeasonFirst;

  return null;
}
