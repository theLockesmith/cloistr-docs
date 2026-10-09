# collab-common 0.7.1 load gate in docs — tasks

- [x] Gate tests first, red (`src/lib/persistenceGate.test.ts`). (verified: suite failed to resolve the module first; 9/9 after)
- [x] `persistenceGate.ts`. (verified: src/lib/persistenceGate.ts)
- [x] Editor: save path, button, read-only until loaded, failed panel with Retry. (verified: Editor.tsx diff; live checks D below)
- [x] collab-common ^0.7.1; one copy of collab-common, ui and auth. (verified: lock holds one each of collab-common 0.7.1, ui, auth, yjs)
- [x] Full suite, typecheck, build, image (under the heavy-job lock). (verified: 67/67, tsc clean, image built)
- [x] Browser check: runtime config unchanged (production / staging). (verified: two-container browser check PASS)
- [x] Browser check, silent relay: error panel, no editor, save disabled. (verified: local build served as docs.cloistr.xyz under real sign-in, live-persist D PASS; control on production FAILS D)
- [ ] Live, after merge: existing document edited after sign-in keeps its content.
- [ ] Live, after merge: silent relay shows the error, not a blank document.
