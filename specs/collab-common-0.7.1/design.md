# collab-common 0.7.1 load gate in docs — design

`src/lib/persistenceGate.ts` decides, from the hook's state, the view
(`loading` / `ready` / `failed`) and whether a save may run
(`saveBlockedReason`). It reads `loadStatus`, not `error`: collab-common also
copies load failures into `error`, so `saveFailure` only treats `error` as a
save failure once loaded.

`Editor.tsx`: `handleSave` (the single save path) checks `saveBlockedReason`
through a ref so the Ctrl+S listener never reads stale state; the header button
is disabled unless `canSave` and labelled Loading… / Not loaded; an effect sets
the TipTap editor editable only when `ready`; `failed` renders an alert panel
with Retry (`persistenceControls.load()`) instead of `EditorContent`.

Live checks use Playwright's WebSocket routing to drop only the kind 30078
snapshot query (REQ) on the relay socket, so sign-in (NIP-46 over the same
relay) still works while the document load meets a silent relay.
