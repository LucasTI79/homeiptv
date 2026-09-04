import fs from 'fs';
import path from 'path';
import os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  prepareFolderStructure,
  previewFolderScan,
  scanFolder,
} from '../localMediaScanner';

describe('localMediaScanner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'viniplay-test-media-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  it('should prepare recommended folder structure and README guide', () => {
    const result = prepareFolderStructure(tempDir);
    expect(result.success).toBe(true);

    expect(fs.existsSync(path.join(tempDir, 'Filmes', 'Ação'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'Filmes', 'Comédia'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'Series', 'Geral'))).toBe(true);

    const readme = path.join(tempDir, 'COMO_ORGANIZAR_SEUS_VIDEOS.txt');
    expect(fs.existsSync(readme)).toBe(true);
    const content = fs.readFileSync(readme, 'utf-8');
    expect(content).toContain('GUIA DE ORGANIZAÇÃO');
  });

  it('should detect movies and series accurately from folder structure', () => {
    // 1. Setup mock movie: Filmes/Ficção Científica/Matrix (1999).mp4
    const movieDir = path.join(tempDir, 'Filmes', 'Ficção Científica');
    fs.mkdirSync(movieDir, { recursive: true });
    fs.writeFileSync(path.join(movieDir, 'Matrix (1999).mp4'), 'dummy-video-data');

    // 2. Setup mock series: Series/Animes/Attack on Titan/Season 01/Attack on Titan - S01E02.mkv
    const seriesDir = path.join(tempDir, 'Series', 'Animes', 'Attack on Titan', 'Season 01');
    fs.mkdirSync(seriesDir, { recursive: true });
    fs.writeFileSync(path.join(seriesDir, 'Attack on Titan - S01E02.mkv'), 'dummy-video-data');

    // Test preview
    const preview = previewFolderScan(tempDir);
    expect(preview.isValid).toBe(true);
    expect(preview.videoFilesCount).toBe(2);
    expect(preview.moviesFound.length).toBe(1);
    expect(preview.moviesFound[0].name).toContain('Matrix');
    expect(preview.moviesFound[0].year).toBe(1999);
    expect(preview.moviesFound[0].category).toBe('Ficção Científica');

    expect(preview.seriesFound.length).toBe(1);
    expect(preview.seriesFound[0].name).toBe('Attack on Titan');
    expect(preview.seriesFound[0].episodes).toBe(1);

    // Test actual scan
    const scanResult = scanFolder({
      id: 'test-folder',
      name: 'Minha Pasta',
      path: tempDir,
      isActive: true,
    });

    expect(scanResult.movies.length).toBe(1);
    expect(scanResult.movies[0].name).toContain('Matrix');
    expect(scanResult.movies[0].year).toBe(1999);
    expect(scanResult.movies[0].category).toBe('Ficção Científica');

    expect(scanResult.series.length).toBe(1);
    expect(scanResult.series[0].name).toBe('Attack on Titan');

    expect(scanResult.episodes.length).toBe(1);
    expect(scanResult.episodes[0].season).toBe(1);
    expect(scanResult.episodes[0].episode).toBe(2);
  });
});
