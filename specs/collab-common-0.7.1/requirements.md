# collab-common 0.7.1 load gate in docs — requirements

Before collab-common 0.7.1, a relay that connected but never answered the
snapshot query looked like "no document": the editor came up blank and the
next save (autosave or manual) replaced the real document with the blank one.
0.7.1 reports that as `loadStatus: 'failed'` and refuses saves until loaded.

- R1 No save path (header button, menu, Ctrl+S, signer-recovery retry) attempts
  a save unless `loadStatus === 'loaded'`; when blocked it says why.
- R2 Until loaded, the editor is read-only and a loading banner is shown.
- R3 A failed load shows an error with Retry (and Back), never the editor.
- R4 After sign-in, opening an existing document and editing it never replaces
  its content (verified live with a throwaway account).
- R5 With a relay that connects but never answers the snapshot query, the app
  shows the load error, not a blank document (verified live).
