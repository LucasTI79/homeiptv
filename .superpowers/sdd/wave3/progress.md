# SDD ledger — plan: /home/lalvesdev/.claude/plans/logical-enchanting-stonebraker.md (Wave 3)

Working directly on main (user-approved, matches existing Wave 1-2 precedent, big-bang plan has no branch strategy).

## Scope: Wave 3 remaining screens
1. TV Guide (guide.js, 1104 lines) — most complex, do first
2. Player (player.js 735 + player_direct.js 643)
3. VOD (vod.js, 529 lines)
4. DVR (dvr.js, 669 lines)
5. Admin (admin.js, 492 lines)
6. Settings (settings.js, 2205 lines) — largest, do last

Auth/Login/Setup already done (frontend/src/pages/LoginPage.tsx, SetupPage.tsx).
Backend routes all exist (backend/src/routes/*.ts) — Wave 2 complete.
