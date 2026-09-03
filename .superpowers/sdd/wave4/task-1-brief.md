# Wave 4: Complex State Flows (Cast, Multiview, Notifications)

## Objective
Port the final set of complex feature flows from the vanilla JS architecture to the new React/Vite architecture.

## Scope
1. **Google Cast (`cast.js`)**: Implement a React Context (`CastProvider`) to handle the Google Cast SDK initialization and casting states. Integrate with the existing Video Player.
2. **Multiview (`multiview.js`)**: Create a new route `/multiview`. Implement a draggable/resizable grid of players (using `react-grid-layout`).
3. **Notifications (`notification.js`)**: Port the Push Notifications service worker (`sw.js`) and UI into a new route `/notifications` using React hooks for state management.

## Deliverables
- `sw.js` moved to the Vite public folder.
- `usePushNotifications.ts` hook.
- `NotificationPage.tsx` and route.
- `CastProvider.tsx` context and `useCast` hook.
- Updates to `PlayerPage.tsx` for casting UI.
- `MultiviewPage.tsx` and route, utilizing `react-grid-layout`.

## References
- `.superpowers/sdd/wave4/progress.md`
- `PLAN.md` (Wave 4)
