import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR } from '../config/paths';
import { getSettings, saveSettings } from './settings';
import type { LocalMediaFolder } from '@homeiptv/shared-types';

export const LOCAL_MEDIA_INDEX_PATH = path.join(DATA_DIR, 'local_media_index.json');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts', '.wmv']);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const POSTER_NAMES = new Set(['poster', 'cover', 'folder', 'front', 'thumb']);

export interface LocalMovie {
  id: string;
  folderId: string;
  name: string;
  filePath: string;
  relativePath: string;
  year: number | null;
  category: string;
  logo: string | null;
  size: number;
  extension: string;
}

export interface LocalEpisode {
  id: string;
  seriesId: string;
  folderId: string;
  name: string;
  filePath: string;
  relativePath: string;
  season: number;
  episode: number;
  logo: string | null;
  size: number;
  extension: string;
}

export interface LocalSeries {
  id: string;
  folderId: string;
  name: string;
  folderPath: string;
  year: number | null;
  category: string;
  logo: string | null;
  episodesCount: number;
  seasonsCount: number;
}

export interface LocalMediaIndex {
  movies: LocalMovie[];
  series: LocalSeries[];
  episodes: LocalEpisode[];
  lastScanned: string;
}

export interface FolderScanPreview {
  isValid: boolean;
  exists: boolean;
  path: string;
  totalFiles: number;
  videoFilesCount: number;
  moviesFound: Array<{ name: string; year: number | null; category: string; relativePath: string }>;
  seriesFound: Array<{ name: string; seasons: number; episodes: number; category: string }>;
  warnings: string[];
  recommendations: string[];
}

function cleanTitle(raw: string): string {
  let cleaned = raw
    .replace(/\.[^/.]+$/, '') // remove extension
    .replace(/\b(1080p|720p|480p|2160p|4k|uhd)\b/gi, '')
    .replace(/\b(bluray|bdrip|web-?dl|webrip|hdrip|dvdrip|cam|ts)\b/gi, '')
    .replace(/\b(x264|x265|h264|h265|hevc|avc|xvid|divx|10bit)\b/gi, '')
    .replace(/\b(aac|ac3|dts|ddp|flac|mp3|5\.1|7\.1)\b/gi, '')
    .replace(/\b(dual|dublado|legendado|multi|sub)\b/gi, '')
    .replace(/[._]/g, ' ')
    .trim();

  // If there's an year like (2023) or 2023, clean around it
  cleaned = cleaned.replace(/\s*\(\d{4}\)\s*/g, ' ').trim();
  return cleaned.replace(/\s{2,}/g, ' ');
}

function extractYear(text: string): number | null {
  const matchParentheses = text.match(/\((\d{4})\)/);
  if (matchParentheses) {
    const year = parseInt(matchParentheses[1], 10);
    if (year >= 1900 && year <= 2100) return year;
  }
  const matchDelimiter = text.match(/[ ._-](\d{4})[ ._-]/);
  if (matchDelimiter) {
    const year = parseInt(matchDelimiter[1], 10);
    if (year >= 1900 && year <= 2100) return year;
  }
  return null;
}

function findPosterForMovie(videoFilePath: string, _rootFolder: string): string | null {
  const dirPath = path.dirname(videoFilePath);
  const baseWithoutExt = path.basename(videoFilePath, path.extname(videoFilePath));

  // 1. Same base name as the movie file (e.g. "Matrix (1999).mp4" -> "Matrix (1999).jpg")
  for (const ext of IMAGE_EXTENSIONS) {
    const candidate = path.join(dirPath, `${baseWithoutExt}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 2. If movie is in its own dedicated subfolder, look for poster.jpg / cover.jpg
  try {
    const entries = fs.readdirSync(dirPath);
    const videoCount = entries.filter((e) => VIDEO_EXTENSIONS.has(path.extname(e).toLowerCase())).length;
    if (videoCount === 1) {
      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const base = path.basename(entry, ext).toLowerCase();
          if (POSTER_NAMES.has(base)) {
            return path.join(dirPath, entry);
          }
        }
      }
    }
  } catch {
    // Ignore read errors
  }

  return null;
}

function findPosterInDir(dirPath: string): string | null {
  try {
    if (!fs.existsSync(dirPath)) return null;
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        const baseName = path.basename(entry, ext).toLowerCase();
        if (POSTER_NAMES.has(baseName)) {
          return path.join(dirPath, entry);
        }
      }
    }
    // Fallback: first image found in directory
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        return path.join(dirPath, entry);
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

interface DetectedEpisodeInfo {
  season: number;
  episode: number;
  title: string;
  seriesName: string;
}

function detectEpisodeInfo(filePath: string, rootFolder: string): DetectedEpisodeInfo | null {
  const fileName = path.basename(filePath);
  const relative = path.relative(rootFolder, filePath);
  const parts = relative.split(path.sep);

  // Pattern 1: S01E02 or s1e2
  const sPattern = fileName.match(/[Ss](\d{1,2})[Ee](\d{1,3})/i);
  if (sPattern) {
    const season = parseInt(sPattern[1], 10);
    const episode = parseInt(sPattern[2], 10);
    let seriesName = '';
    if (parts.length > 1) {
      const parentDir = parts[parts.length - 2];
      if (/^(season|temporada|temp|s)\s*\d+/i.test(parentDir) && parts.length > 2) {
        seriesName = parts[parts.length - 3];
      } else if (!/^(series|séries|filmes|movies)$/i.test(parentDir)) {
        seriesName = parentDir;
      }
    }
    if (!seriesName) {
      const prefix = fileName.substring(0, sPattern.index).replace(/[._-]+$/, '').trim();
      seriesName = cleanTitle(prefix) || 'Série';
    }

    let title = fileName.replace(/\.[^/.]+$/, '').trim();
    const afterMatch = fileName.substring((sPattern.index || 0) + sPattern[0].length);
    const cleanAfter = cleanTitle(afterMatch);
    if (cleanAfter) {
      title = `${cleanTitle(seriesName)} - T${season}:E${episode} - ${cleanAfter}`;
    } else {
      title = `${cleanTitle(seriesName)} - T${season}:E${episode}`;
    }

    return { season, episode, title, seriesName: cleanTitle(seriesName) };
  }

  // Pattern 2: 1x02 or 01x02
  const xPattern = fileName.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (xPattern) {
    const season = parseInt(xPattern[1], 10);
    const episode = parseInt(xPattern[2], 10);
    let seriesName = '';
    if (parts.length > 1) {
      const parentDir = parts[parts.length - 2];
      if (/^(season|temporada|temp|s)\s*\d+/i.test(parentDir) && parts.length > 2) {
        seriesName = parts[parts.length - 3];
      } else if (!/^(series|séries|filmes|movies)$/i.test(parentDir)) {
        seriesName = parentDir;
      }
    }
    if (!seriesName) {
      const prefix = fileName.substring(0, xPattern.index).replace(/[._-]+$/, '').trim();
      seriesName = cleanTitle(prefix) || 'Série';
    }
    return {
      season,
      episode,
      title: `${cleanTitle(seriesName)} - T${season}:E${episode}`,
      seriesName: cleanTitle(seriesName),
    };
  }

  // Pattern 3: inside Season/Temporada directory, e.g. "Season 01/01.mp4" or "Temporada 1/Episodio 2.mkv"
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const seasonMatch = part.match(/^(?:season|temporada|temp|s)\s*(\d{1,2})$/i);
    if (seasonMatch) {
      const season = parseInt(seasonMatch[1], 10);
      const epMatch = fileName.match(/(?:ep|episodio|episode|e)?\s*(\d{1,3})/i);
      if (epMatch) {
        const episode = parseInt(epMatch[1], 10);
        let seriesName = i > 0 ? parts[i - 1] : 'Série';
        return {
          season,
          episode,
          title: `${cleanTitle(seriesName)} - T${season}:E${episode}`,
          seriesName: cleanTitle(seriesName),
        };
      }
    }
  }

  return null;
}

function determineCategory(filePath: string, rootFolder: string, defaultCategory = 'Mídia Local'): string {
  const relative = path.relative(rootFolder, filePath);
  const parts = relative.split(path.sep);

  if (parts.length > 1) {
    const firstLevel = parts[0];
    if (/^(filmes|movies)$/i.test(firstLevel) && parts.length > 2) {
      return parts[1];
    }
    if (/^(series|séries)$/i.test(firstLevel) && parts.length > 3) {
      return parts[1];
    }
    if (!/^(filmes|movies|series|séries)$/i.test(firstLevel)) {
      return firstLevel;
    }
  }
  return defaultCategory;
}

function generateHash(str: string): string {
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
}

function getAllFilesRecursive(dir: string, fileList: string[] = []): string[] {
  try {
    if (!fs.existsSync(dir)) return fileList;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        getAllFilesRecursive(fullPath, fileList);
      } else if (entry.isFile()) {
        fileList.push(fullPath);
      }
    }
  } catch {
    // Ignore unreadable dirs
  }
  return fileList;
}

/**
 * Reads the cached local media index from disk.
 */
export function getLocalMediaIndex(): LocalMediaIndex {
  try {
    if (fs.existsSync(LOCAL_MEDIA_INDEX_PATH)) {
      const data = JSON.parse(fs.readFileSync(LOCAL_MEDIA_INDEX_PATH, 'utf-8'));
      return data;
    }
  } catch (err) {
    console.warn('[LOCAL_MEDIA] Failed to parse local_media_index.json, creating empty:', err);
  }
  return { movies: [], series: [], episodes: [], lastScanned: new Date().toISOString() };
}

/**
 * Saves the local media index to disk.
 */
export function saveLocalMediaIndex(index: LocalMediaIndex): void {
  try {
    fs.mkdirSync(path.dirname(LOCAL_MEDIA_INDEX_PATH), { recursive: true });
    fs.writeFileSync(LOCAL_MEDIA_INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (err) {
    console.error('[LOCAL_MEDIA] Failed to save local_media_index.json:', err);
  }
}

/**
 * Creates recommended folder structure and a helpful README inside the given folder path.
 */
export function prepareFolderStructure(targetPath: string): { success: boolean; createdPaths: string[]; message: string } {
  try {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    const structure = [
      path.join(targetPath, 'Filmes', 'Ação'),
      path.join(targetPath, 'Filmes', 'Comédia'),
      path.join(targetPath, 'Filmes', 'Ficção Científica'),
      path.join(targetPath, 'Series', 'Geral', 'Exemplo de Série', 'Season 01'),
    ];

    const created: string[] = [];
    for (const dir of structure) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
      }
    }

    const readmePath = path.join(targetPath, 'COMO_ORGANIZAR_SEUS_VIDEOS.txt');
    const readmeContent = `=== GUIA DE ORGANIZAÇÃO DE VÍDEOS - VINIPLAY ===

O ViniPlay organiza e sincroniza automaticamente seus filmes e séries a partir desta pasta!

1. FILMES:
   - Coloque seus filmes na pasta "Filmes/<Categoria>/".
   - Exemplo:
     Filmes/Ação/John Wick (2014).mp4
     Filmes/Ficção Científica/Matrix (1999).mkv
   - A subpasta (ex: Ação, Drama, Comédia) vira automaticamente a Categoria no catálogo VOD.
   - O ano entre parênteses (ex: (2020)) é identificado automaticamente.
   - Opcional: Se você colocar uma imagem "poster.jpg" na mesma pasta, ela será usada como a capa do filme!

2. SÉRIES E ANIMES:
   - Coloque na pasta "Series/<Categoria>/<Nome da Série>/<Temporada>/".
   - Exemplo:
     Series/Ficção/Stranger Things/Season 01/Stranger Things - S01E01.mp4
     Series/Ficção/Stranger Things/Season 01/Stranger Things - S01E02.mp4
     Series/Animes/Attack on Titan/Season 01/Attack on Titan - S01E01.mkv
   - Use a sigla S01E01 (ou 1x01) para que o sistema identifique os episódios em ordem.
   - Opcional: Uma imagem "poster.jpg" dentro da pasta da série será a capa oficial da série no catálogo!

Extensões suportadas: .mp4, .mkv, .webm, .avi, .mov, .m4v, .ts
`;

    fs.writeFileSync(readmePath, readmeContent, 'utf-8');
    created.push(readmePath);

    return {
      success: true,
      createdPaths: created,
      message: 'Estrutura de pastas e guia de organização criados com sucesso!',
    };
  } catch (err) {
    console.error('[LOCAL_MEDIA] Error creating folder structure:', err);
    return {
      success: false,
      createdPaths: [],
      message: `Erro ao criar estrutura: ${(err as Error).message}`,
    };
  }
}

/**
 * Previews what would be scanned from a directory without committing it to the index.
 */
export function previewFolderScan(folderPath: string): FolderScanPreview {
  if (!fs.existsSync(folderPath)) {
    return {
      isValid: false,
      exists: false,
      path: folderPath,
      totalFiles: 0,
      videoFilesCount: 0,
      moviesFound: [],
      seriesFound: [],
      warnings: ['O caminho especificado não existe no servidor.'],
      recommendations: ['Verifique se o caminho digitado está correto ou use o botão para criar a estrutura.'],
    };
  }

  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) {
    return {
      isValid: false,
      exists: true,
      path: folderPath,
      totalFiles: 0,
      videoFilesCount: 0,
      moviesFound: [],
      seriesFound: [],
      warnings: ['O caminho informado aponta para um arquivo, não para um diretório.'],
      recommendations: ['Informe uma pasta de diretório.'],
    };
  }

  const allFiles = getAllFilesRecursive(folderPath);
  const videoFiles = allFiles.filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));

  const movies: Array<{ name: string; year: number | null; category: string; relativePath: string }> = [];
  const seriesMap = new Map<string, { seasons: Set<number>; episodes: number; category: string }>();
  const warnings: string[] = [];
  const recommendations: string[] = [];

  for (const file of videoFiles) {
    const relative = path.relative(folderPath, file);
    const epInfo = detectEpisodeInfo(file, folderPath);

    if (epInfo) {
      const seriesKey = epInfo.seriesName;
      const cat = determineCategory(file, folderPath, 'Séries Locais');
      if (!seriesMap.has(seriesKey)) {
        seriesMap.set(seriesKey, { seasons: new Set(), episodes: 0, category: cat });
      }
      const sData = seriesMap.get(seriesKey)!;
      sData.seasons.add(epInfo.season);
      sData.episodes++;
    } else {
      const fileName = path.basename(file);
      const rawTitle = fileName.replace(/\.[^/.]+$/, '');
      const year = extractYear(rawTitle);
      const cleaned = cleanTitle(rawTitle);
      const cat = determineCategory(file, folderPath, 'Filmes Locais');

      if (!year && !relative.toLowerCase().includes('filme') && !relative.toLowerCase().includes('movie')) {
        warnings.push(`Arquivo "${fileName}" não possui ano detectado. Será catalogado como "${cleaned}".`);
      }

      movies.push({
        name: cleaned || fileName,
        year,
        category: cat,
        relativePath: relative,
      });
    }
  }

  if (videoFiles.length === 0) {
    warnings.push('Nenhum arquivo de vídeo (.mp4, .mkv, .webm, etc.) foi encontrado nesta pasta.');
    recommendations.push('Você pode clicar em "Preparar Estrutura" para gerar os diretórios modelo e o guia.');
  } else {
    recommendations.push('A pasta possui arquivos compatíveis e está pronta para ser adicionada à sua biblioteca!');
  }

  const seriesFound = Array.from(seriesMap.entries()).map(([name, data]) => ({
    name,
    seasons: data.seasons.size,
    episodes: data.episodes,
    category: data.category,
  }));

  return {
    isValid: true,
    exists: true,
    path: folderPath,
    totalFiles: allFiles.length,
    videoFilesCount: videoFiles.length,
    moviesFound: movies.slice(0, 50),
    seriesFound,
    warnings: warnings.slice(0, 10),
    recommendations,
  };
}

/**
 * Scans a registered LocalMediaFolder and returns the indexed media items.
 */
export function scanFolder(folder: LocalMediaFolder): { movies: LocalMovie[]; series: LocalSeries[]; episodes: LocalEpisode[] } {
  if (!fs.existsSync(folder.path)) {
    console.warn(`[LOCAL_MEDIA] Folder ${folder.path} does not exist. Skipping.`);
    return { movies: [], series: [], episodes: [] };
  }

  const allFiles = getAllFilesRecursive(folder.path);
  const videoFiles = allFiles.filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));

  const movies: LocalMovie[] = [];
  const episodes: LocalEpisode[] = [];
  const seriesMap = new Map<string, {
    name: string;
    folderPath: string;
    year: number | null;
    category: string;
    logo: string | null;
    seasons: Set<number>;
    episodesCount: number;
  }>();

  const folderCategory = folder.category || folder.name || 'Mídia Local';

  for (const file of videoFiles) {
    try {
      const stat = fs.statSync(file);
      const relative = path.relative(folder.path, file);
      const ext = path.extname(file).replace('.', '').toLowerCase();
      const epInfo = detectEpisodeInfo(file, folder.path);

      if (epInfo) {
        // Series Episode
        const seriesKey = `${folder.id}_${generateHash(epInfo.seriesName)}`;
        const seriesDir = path.dirname(path.dirname(file));
        const posterFile = findPosterInDir(path.dirname(file)) || findPosterInDir(seriesDir);
        const posterUrl = posterFile ? `/api/local-media/poster?file=${encodeURIComponent(posterFile)}` : null;
        const category = determineCategory(file, folder.path, folderCategory);

        if (!seriesMap.has(seriesKey)) {
          seriesMap.set(seriesKey, {
            name: epInfo.seriesName,
            folderPath: seriesDir,
            year: extractYear(epInfo.seriesName),
            category,
            logo: posterUrl,
            seasons: new Set(),
            episodesCount: 0,
          });
        }

        const sData = seriesMap.get(seriesKey)!;
        sData.seasons.add(epInfo.season);
        sData.episodesCount++;

        const epId = `local_ep_${folder.id}_${generateHash(relative)}`;
        episodes.push({
          id: epId,
          seriesId: seriesKey,
          folderId: folder.id,
          name: epInfo.title,
          filePath: file,
          relativePath: relative,
          season: epInfo.season,
          episode: epInfo.episode,
          logo: posterUrl,
          size: stat.size,
          extension: ext,
        });
      } else {
        // Movie
        const fileName = path.basename(file);
        const rawTitle = fileName.replace(/\.[^/.]+$/, '');
        const year = extractYear(rawTitle);
        const name = cleanTitle(rawTitle) || fileName;
        const category = determineCategory(file, folder.path, folderCategory);
        const posterFile = findPosterForMovie(file, folder.path);
        const posterUrl = posterFile ? `/api/local-media/poster?file=${encodeURIComponent(posterFile)}` : null;

        const movieId = `local_movie_${folder.id}_${generateHash(relative)}`;
        movies.push({
          id: movieId,
          folderId: folder.id,
          name,
          filePath: file,
          relativePath: relative,
          year,
          category,
          logo: posterUrl,
          size: stat.size,
          extension: ext,
        });
      }
    } catch (e) {
      console.warn(`[LOCAL_MEDIA] Error processing file ${file}:`, e);
    }
  }

  const series: LocalSeries[] = Array.from(seriesMap.entries()).map(([id, sData]) => ({
    id,
    folderId: folder.id,
    name: sData.name,
    folderPath: sData.folderPath,
    year: sData.year,
    category: sData.category,
    logo: sData.logo,
    episodesCount: sData.episodesCount,
    seasonsCount: sData.seasons.size,
  }));

  return { movies, series, episodes };
}

/**
 * Scans all active LocalMediaFolders configured in settings and updates local_media_index.json.
 */
export function scanAllFolders(): LocalMediaIndex {
  const settings = getSettings();
  const folders = (settings.localMediaFolders || []).filter((f) => f.isActive);

  let allMovies: LocalMovie[] = [];
  let allSeries: LocalSeries[] = [];
  let allEpisodes: LocalEpisode[] = [];

  for (const folder of folders) {
    const result = scanFolder(folder);
    allMovies = allMovies.concat(result.movies);
    allSeries = allSeries.concat(result.series);
    allEpisodes = allEpisodes.concat(result.episodes);

    // Update folder item counts in settings
    folder.lastScanned = new Date().toISOString();
    folder.itemCount = {
      movies: result.movies.length,
      series: result.series.length,
      episodes: result.episodes.length,
    };
  }

  saveSettings(settings);

  const index: LocalMediaIndex = {
    movies: allMovies,
    series: allSeries,
    episodes: allEpisodes,
    lastScanned: new Date().toISOString(),
  };

  saveLocalMediaIndex(index);
  console.log(`[LOCAL_MEDIA] Scan completed. Total: ${allMovies.length} movies, ${allSeries.length} series (${allEpisodes.length} episodes).`);
  return index;
}
