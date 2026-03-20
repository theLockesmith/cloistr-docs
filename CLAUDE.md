# CLAUDE.md - Cloistr Docs

**Collaborative document editor (Google Docs alternative) powered by Nostr and real-time collaboration.**

## Project Information

- **Type:** Frontend Application
- **Technology:** React + TypeScript + TipTap + Yjs
- **Purpose:** Real-time collaborative document editing with Nostr-native sync
- **Domain:** docs.cloistr.xyz (planned)

## Architecture

### Core Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | React 18 + TypeScript | UI framework |
| **Editor** | TipTap + ProseMirror | Rich text editing |
| **Collaboration** | Yjs + y-prosemirror | Real-time sync |
| **Auth** | cloistr-collab-common | Nostr identity |
| **Build** | Vite | Development and bundling |

### Real-Time Collaboration

```
User A ──┐    ┌── Yjs Document ──── Nostr Relay ──── Yjs Document ──┬── User B
         │    │                                                      │
    TipTap ───┼──── y-prosemirror ──── WebSocket ──── y-prosemirror ──┼── TipTap
         │    │                     (via Nostr)                      │
User C ──┘    └── Collaborative Cursors ──────────────────────────────┘
```

**Key Features:**
- Real-time text editing with operational transforms
- Collaborative cursors showing other users
- Conflict-free replicated data type (CRDT) via Yjs
- Nostr-native sync (replaces traditional WebSocket providers)

### Dependencies

```json
{
  "runtime": [
    "@tiptap/react",           // React bindings for TipTap
    "@tiptap/starter-kit",     // Basic editing extensions
    "@tiptap/extension-collaboration", // Yjs integration
    "y-prosemirror",          // ProseMirror ↔ Yjs binding
    "yjs",                    // CRDT library
    "nostr-tools",           // Nostr protocol tools
    "cloistr-collab-common"  // Shared auth/sync logic
  ],
  "local": [
    "../cloistr-collab-common" // Linked via file: reference
  ]
}
```

## Development

### Setup

```bash
cd /home/forgemaster/Development/cloistr-docs
npm install
npm run dev    # Development server on :3000
npm run build  # Production build
```

### Project Structure

```
src/
├── main.tsx              # React entrypoint
├── App.tsx              # Main app with temporary AuthProvider
├── index.css            # Global styles + TipTap styles
├── vite-env.d.ts        # TypeScript declarations for CSS imports
└── components/
    └── Editor.tsx       # TipTap editor with collaboration
```

### Implementation Notes

**Current State:**
- ✅ Basic TipTap editor with rich text features
- ✅ Yjs document setup for collaboration
- ✅ Temporary AuthProvider (until cloistr-collab-common exports ready)
- ✅ Collaborative cursor configuration
- ✅ Builds successfully with TypeScript strict mode
- ⚠️ Mock provider (TODO: implement Nostr sync)

**TODO:**
- [ ] Integrate actual cloistr-collab-common exports when ready
- [ ] Implement WebSocket provider that syncs via Nostr relay
- [ ] Document persistence (save/load from Nostr events)
- [ ] User presence indicators
- [ ] Document sharing and permissions
- [ ] Offline support with sync on reconnect

### Nostr Integration

**Authentication:**
- Temporary AuthProvider implementation in App.tsx
- Uses nostr-tools `generateSecretKey()` for demo keys
- Production will use coldforge-signer via cloistr-collab-common
- User identity displayed as truncated public key

**Collaboration Sync (Planned):**
- Yjs updates published as Nostr events
- Custom WebSocket provider that wraps Nostr relay
- Document state reconstructed from event history
- Real-time updates via relay subscriptions

## Toolbar Features

| Button | Function | TipTap Command |
|--------|----------|---------------|
| **Bold** | Toggle bold text | `toggleBold()` |
| **Italic** | Toggle italic text | `toggleItalic()` |
| **H1** | Level 1 heading | `toggleHeading({ level: 1 })` |
| **H2** | Level 2 heading | `toggleHeading({ level: 2 })` |
| **• List** | Bullet list | `toggleBulletList()` |
| **1. List** | Ordered list | `toggleOrderedList()` |
| **Quote** | Blockquote | `toggleBlockquote()` |

## Configuration

### Vite Config

```typescript
export default defineConfig({
  plugins: [react()],
  server: { port: 3000, host: true },
  build: { outDir: 'dist', sourcemap: true }
})
```

### TypeScript Config

- **Target:** ES2022
- **Module Resolution:** NodeNext
- **Strict Mode:** Enabled with additional safety checks
- **JSX:** react-jsx

## Styling

**Global Styles:** `src/index.css`
- Dark/light mode support
- TipTap editor styling (.ProseMirror)
- Collaboration cursor styles
- Responsive toolbar layout

**Editor Styles:**
- Inline styles in Editor.tsx for toolbar
- Clean, minimal design
- Active state for toolbar buttons
- Status bar with connection info

## Related Projects

| Project | Relationship |
|---------|-------------|
| **cloistr-collab-common** | Shared auth and sync logic |
| **cloistr-chat** | Similar real-time collaboration patterns |
| **cloistr-relay** | Backend relay for document sync |

## References

### External Documentation

- [TipTap Editor](https://tiptap.dev/) - Rich text editor
- [Yjs](https://docs.yjs.dev/) - Shared data types for collaboration
- [y-prosemirror](https://github.com/yjs/y-prosemirror) - ProseMirror bindings
- [Nostr Tools](https://github.com/nbd-wtf/nostr-tools) - Nostr protocol implementation

### Internal Documentation

- [../cloistr-collab-common/CLAUDE.md](../cloistr-collab-common/CLAUDE.md) - Shared collaboration library
- [../../cloistr/architecture/implementation-patterns.md](../../cloistr/architecture/implementation-patterns.md) - Authentication patterns

---

**Last Updated:** 2026-03-20

**Created:** 2026-03-20 - Initial project scaffold with TipTap + Yjs collaboration