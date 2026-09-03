# SDD ledger — plan: /home/lalvesdev/.claude/plans/logical-enchanting-stonebraker.md (Wave 3)

Working directly on main (user-approved, matches existing Wave 1-2 precedent, big-bang plan has no branch strategy).

## Status
- **Current Phase:** Review / Completed
- **Completed Tasks:**
  - `App.tsx` router setup with layout
  - Guide/EPG component and API hooks
  - Player logic port to React
  - VOD & DVR grids and hooks
  - Admin & Settings UI migration with React Hook Form & Zod
  - Vitest configuration and basic component testing

Auth/Login/Setup already done (frontend/src/pages/LoginPage.tsx, SetupPage.tsx).
Backend routes all exist (backend/src/routes/*.ts) — Wave 2 complete.

## Checkpoint
Wave 1-2 committed as 9e6b74a (was fully done, uncommitted). Wave 3 tasks build on top of this, BASE for Task 1 = 9e6b74a.

## Task 1: TV Guide — dispatched
