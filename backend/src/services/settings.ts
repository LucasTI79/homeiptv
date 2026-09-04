import fs from 'fs';
import path from 'path';
import type { Settings, FfmpegLogLevel } from '@homeiptv/shared-types';
import { env } from '../config/env';

// Settings live in a JSON file, not a DB table (ported as-is from server.js:76-90,
// 701-920) -- same file path as the legacy app, so both can read/write it during
// the Wave 2/3 transition without duplicating data.
export const SETTINGS_PATH = path.join(env.dataDir, 'settings.json');

const VALID_FFMPEG_LOG_LEVELS: FfmpegLogLevel[] = ['debug', 'verbose', 'info', 'warning', 'error'];

export const defaultSettings: Settings = {
  m3uSources: [],
  epgSources: [],
  localMediaFolders: [],
  userAgents: [{ id: 'default-ua-1724778434000', name: 'ViniPlay Default', value: 'VLC/3.0.20 (Linux; x86_64)', isDefault: true }],
  streamProfiles: [
    { id: 'redirect', name: 'Redirect (No Transcoding)', command: 'redirect', isDefault: true },
    { id: 'ffmpeg-default', name: 'ffmpeg (Built in)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: false },
    { id: 'ffmpeg-fmp4', name: 'ffmpeg fMP4 (CPU)', command: '-user_agent "{userAgent}" -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "{streamUrl}" -c:v libx264 -preset ultrafast -c:a aac -b:a 192k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: false },
    { id: 'ffmpeg-fmp4-nvidia', name: 'ffmpeg fMP4 (NVIDIA)', command: '-user_agent "{userAgent}" -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a aac -b:a 192k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: false },
    { id: 'ffmpeg-nvidia', name: 'ffmpeg (NVIDIA NVENC)', command: '-user_agent "{userAgent}" -re -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a copy -f mpegts pipe:1', isDefault: false },
    { id: 'ffmpeg-nvidia-reconnect', name: 'ffmpeg (NVIDIA reconnect)', command: '-user_agent "{userAgent}" -re -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a copy -f mpegts pipe:1', isDefault: false },
    { id: 'ffmpeg-intel', name: 'ffmpeg (Intel QSV)', command: '-hwaccel qsv -c:v h264_qsv -i "{streamUrl}" -c:v h264_qsv -preset medium -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: false },
    { id: 'ffmpeg-vaapi', name: 'ffmpeg (VA-API) Intel', command: '-hwaccel vaapi -hwaccel_output_format vaapi -i "{streamUrl}" -vf "format=nv12|vaapi,hwupload" -c:v h264_vaapi -preset medium -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: false },
    { id: 'ffmpeg-vaapi-amd', name: 'ffmpeg (VA-API) Radeon/AMD', command: '-vaapi_device /dev/dri/renderD128 -hwaccel vaapi -hwaccel_output_format vaapi -i "{streamUrl}" -c:v h264_vaapi -c:a aac -b:a 128k -f mpegts pipe:1', isDefault: false },
  ],
  dvr: {
    preBufferMinutes: 1,
    postBufferMinutes: 2,
    maxConcurrentRecordings: 1,
    autoDeleteDays: 0,
    activeRecordingProfileId: 'dvr-ts-default',
    recordingProfiles: [
      { id: 'dvr-ts-default', name: 'Default TS (Stream Copy, Timeshiftable)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c copy -f mpegts "{filePath}"', isDefault: true },
      { id: 'dvr-ts-nvidia', name: 'NVIDIA NVENC TS (Timeshiftable)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a copy -f mpegts "{filePath}"', isDefault: false },
      { id: 'dvr-ts-nvidia-reconnect', name: 'NVIDIA NVENC TS reconnect', command: '-user_agent "{userAgent}" -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a copy -f mpegts "{filePath}"', isDefault: false },
      { id: 'dvr-mp4-default', name: 'Legacy MP4 (H.264/AAC)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags +faststart -f mp4 "{filePath}"', isDefault: false },
      { id: 'dvr-mp4-nvidia', name: 'NVIDIA NVENC MP4 (H.264/AAC)', command: '-user_agent "{userAgent}" -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a aac -b:a 128k -movflags +faststart -f mp4 "{filePath}"', isDefault: false },
      { id: 'dvr-mp4-intel', name: 'Intel QSV MP4 (H.264/AAC)', command: '-hwaccel qsv -hwaccel_output_format qsv -i "{streamUrl}" -c:v h264_qsv -preset medium -vf scale_qsv=format=nv12 -c:a aac -ac 2 -b:a 128k -movflags +faststart -f mp4 "{filePath}"', isDefault: false },
      { id: 'dvr-mp4-vaapi', name: 'VA-API MP4 (H.264/AAC)', command: "-hwaccel vaapi -hwaccel_output_format vaapi -i \"{streamUrl}\" -vf 'format=nv12,hwupload' -c:v h264_vaapi -preset medium -c:a aac -b:a 128k -movflags +faststart -f mp4 \"{filePath}\"", isDefault: false },
      { id: 'dvr-mp4-radeon-vaapi', name: 'Radeon/AMD VA-API MP4 (H.264/AAC)', command: '-vaapi_device /dev/dri/renderD128 -hwaccel vaapi -hwaccel_output_format vaapi -i "{streamUrl}" -c:v h264_vaapi -preset medium -vf scale_vaapi=format=nv12 -c:a aac -ac 2 -b:a 128k -movflags +faststart -f mp4 "{filePath}"', isDefault: false },
    ],
  },
  castProfiles: [
    { id: 'cast-default', name: 'Cast Default (CPU)', command: '-user_agent "{userAgent}" -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "{streamUrl}" -c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 128k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: true },
    { id: 'cast-nvidia', name: 'Cast (NVIDIA NVENC)', command: '-user_agent "{userAgent}" -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -i "{streamUrl}" -c:v h264_nvenc -preset p6 -tune hq -c:a aac -b:a 128k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: false },
    { id: 'cast-intel', name: 'Cast (Intel QSV)', command: '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -hwaccel qsv -c:v h264_qsv -i "{streamUrl}" -c:v h264_qsv -preset medium -c:a aac -b:a 128k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: false },
    { id: 'cast-vaapi', name: 'Cast (VA-API Intel)', command: '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -hwaccel vaapi -hwaccel_output_format vaapi -i "{streamUrl}" -vf "format=nv12|vaapi,hwupload" -c:v h264_vaapi -c:a aac -b:a 128k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: false },
    { id: 'cast-vaapi-amd', name: 'Cast (VA-API Radeon/AMD)', command: '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -vaapi_device /dev/dri/renderD128 -hwaccel vaapi -hwaccel_output_format vaapi -i "{streamUrl}" -c:v h264_vaapi -c:a aac -b:a 128k -movflags frag_keyframe+empty_moov+default_base_moof -f mp4 pipe:1', isDefault: false },
  ],
  activeCastProfileId: 'cast-default',
  activeUserAgentId: 'default-ua-1724778434000',
  activeStreamProfileId: 'redirect',
  playerLogLevel: 'warning',
  dvrLogLevel: 'warning',
  searchScope: 'all_channels_unfiltered',
  notificationLeadTime: 10,
  sourcesLastUpdated: null,
  logs: {
    maxFiles: 5,
    maxFileSizeBytes: 5 * 1024 * 1024,
    autoDeleteDays: 7,
  },
  vodPlaybackEngine: 'native',
};

// Ports getSettings()'s migration logic verbatim from server.js:701-920: fills
// in anything missing from a settings.json written by an older version, and
// force-updates the *command* of profiles still flagged isDefault so bug fixes
// to the built-in ffmpeg commands reach existing installs.
function migrate(settings: Settings): { settings: Settings; needsSave: boolean } {
  let needsSave = false;

  defaultSettings.streamProfiles.forEach((defaultProfile) => {
    const existing = settings.streamProfiles.find((p) => p.id === defaultProfile.id);
    if (!existing) {
      settings.streamProfiles.push(defaultProfile);
      needsSave = true;
    } else if (existing.isDefault && existing.command !== defaultProfile.command) {
      existing.command = defaultProfile.command;
      needsSave = true;
    }
  });

  if (!settings.dvr) {
    settings.dvr = defaultSettings.dvr;
    needsSave = true;
  } else {
    defaultSettings.dvr.recordingProfiles.forEach((defaultProfile) => {
      const existing = settings.dvr.recordingProfiles.find((p) => p.id === defaultProfile.id);
      if (!existing) {
        settings.dvr.recordingProfiles.push(defaultProfile);
        needsSave = true;
      } else if (existing.isDefault && existing.command !== defaultProfile.command) {
        existing.command = defaultProfile.command;
        needsSave = true;
      }
    });
  }

  if (!settings.castProfiles) {
    settings.castProfiles = defaultSettings.castProfiles;
    needsSave = true;
  } else {
    defaultSettings.castProfiles.forEach((defaultProfile) => {
      const existing = settings.castProfiles.find((p) => p.id === defaultProfile.id);
      if (!existing) {
        settings.castProfiles.push(defaultProfile);
        needsSave = true;
      } else if (existing.command !== defaultProfile.command) {
        existing.command = defaultProfile.command;
        needsSave = true;
      }
    });
  }

  if (!settings.activeCastProfileId) {
    settings.activeCastProfileId = defaultSettings.activeCastProfileId;
    needsSave = true;
  }

  if (!settings.playerLogLevel || !VALID_FFMPEG_LOG_LEVELS.includes(settings.playerLogLevel)) {
    settings.playerLogLevel = defaultSettings.playerLogLevel;
    needsSave = true;
  }

  if (!settings.dvrLogLevel || !VALID_FFMPEG_LOG_LEVELS.includes(settings.dvrLogLevel)) {
    settings.dvrLogLevel = defaultSettings.dvrLogLevel;
    needsSave = true;
  }

  if (!settings.logs) {
    settings.logs = defaultSettings.logs;
    needsSave = true;
  } else {
    if (settings.logs.maxFiles === undefined) {
      settings.logs.maxFiles = defaultSettings.logs.maxFiles;
      needsSave = true;
    }
    if (settings.logs.maxFileSizeBytes === undefined) {
      settings.logs.maxFileSizeBytes = defaultSettings.logs.maxFileSizeBytes;
      needsSave = true;
    }
    if (settings.logs.autoDeleteDays === undefined) {
      settings.logs.autoDeleteDays = defaultSettings.logs.autoDeleteDays;
      needsSave = true;
    }
  }

  if (!settings.vodPlaybackEngine) {
    settings.vodPlaybackEngine = defaultSettings.vodPlaybackEngine;
    needsSave = true;
  }

  if (!settings.localMediaFolders) {
    settings.localMediaFolders = [];
    needsSave = true;
  }

  return { settings, needsSave };
}

export function getSettings(): Settings {
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaultSettings, null, 2));
    return defaultSettings;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8')) as Settings;
    const { settings, needsSave } = migrate(raw);
    if (needsSave) {
      fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    }
    return settings;
  } catch (err) {
    console.error('[SETTINGS] Could not parse settings.json, returning default. Error:', (err as Error).message);
    return defaultSettings;
  }
}

export function saveSettings(settings: Settings): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  // TODO(sources domain, task #11): call updateAndScheduleSourceRefreshes()
  // (server.js:312-357) once the sources scheduler is ported.
}
