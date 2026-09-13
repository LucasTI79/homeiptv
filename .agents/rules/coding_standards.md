# Coding Standards & Architecture Guidelines for ViniPlay

This document defines mandatory architectural, typing, and behavioral standards for all developers and AI coding agents working on the ViniPlay codebase.

## 1. Strict Explicit Typing (Zero `any`, Zero `never`, No Forced Assertions)
- **NO `any`**: The use of `any` is strictly prohibited in both frontend and backend code.
- **NO `never` or untyped `undefined`**: Do not use `never` as a loose fallback or rely on implicit `undefined`.
- **NO Type Assertions (`as <type>` or `as any`)**: Avoid type casting with `as`. Instead:
  - Use TypeScript type guards (e.g. `if (typeof val === 'string')`, `if ('id' in obj)`).
  - Use custom type predicates (e.g. `function isVodChannel(channel: Channel): channel is VodChannel`).
  - Use Zod schemas for runtime boundary parsing and validation.
- All function parameters, return types, component props, and state hooks MUST be explicitly typed.

## 2. Frontend Component Architecture & The Controller Pattern
- **Separation of Concerns**: React components must focus strictly on layout, markup, and rendering (View layer).
- **Controller Hook**: All state, effects, API calls, event listeners, and business logic must reside in a dedicated controller hook (`use<ComponentName>Controller` or modular sub-controllers).
- **Player Modularization**:
  - Do NOT merge VOD, DVR, streaming engines, and transcription into a single monolithic component or hook.
  - Separate media engines (HLS.js, mpegts.js, native HTML5, OPFS offline) into dedicated controllers (`usePlayerEngine`).
  - Keep domain-specific behaviors separated:
    - VOD progress, series episodes, intro/credits skipping -> `useVodPlaybackController`
    - Live TV, recording, timeshift -> `useDvrPlaybackController`
    - Tracks, audio, subtitles, quality -> `usePlayerTracksController`
    - Transcription -> `useTranscriptionController`
    - Keyboard shortcuts and full screen -> `usePlayerShortcuts`

## 3. Asynchronous UX States: Loading, Error, Retry, and Fallback
- Every asynchronous operation (media streaming, downloading, transcoding, transcription, casting) must provide:
  - **Contextual Loading**: Informative indicators describing what is currently happening.
  - **Explicit Error Diagnostics**: Clear human-readable descriptions of failures.
  - **Retry Actions**: Buttons or automated mechanisms to retry failed operations.
  - **Graceful Fallbacks**: If a local or offline resource fails (e.g. corrupted file), automatically provide or fall back to the remote stream.

## 4. Network Resilience & Download Recovery
- Download managers and streaming services must handle network drops (`net::ERR_NETWORK_CHANGED`, transient timeouts).
- Implement exponential backoff auto-retry for interrupted transfers.
- Use HTTP `Range: bytes=${downloadedBytes}-` and file system seek to resume downloads without restarting from zero or losing progress.
- Validate file completeness (`downloadedBytes >= totalBytes`) before marking tasks as completed.

## 5. Immutability Principle
- State, configurations, and objects must NEVER be mutated in-place.
- Always produce new instances when updating objects or arrays:
  - Objects: `{ ...previous, ...changes }`
  - Arrays: `previous.map(...)`, `previous.filter(...)`, `[...previous, newItem]`
- In backend services and maps, create new copies when updating metadata instead of mutating referenced objects.

## 6. Backend Logging & Internationalization
- **All log messages MUST be in English** across all backend modules, routes, and services:
  - Follow the structured prefix format: `[MODULE_NAME] English description of action or event`.
  - Examples:
    - `console.log('[STREAM_AUTH] Allowing unauthenticated access from local network: ...')`
    - `console.error('[DOWNLOADS_API] Failed to store uploaded file: ...')`
    - `console.info('[DVR_RECORDER] Recording started for job ...')`
- Backend API error messages returned to clients should be consistent, standardized, and clean.
