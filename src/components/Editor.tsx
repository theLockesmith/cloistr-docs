import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useEffect, useState, useRef } from 'react'
import * as Y from 'yjs'
import { SimplePool } from 'nostr-tools'
import { NostrSyncProvider, useDocumentPersistence } from '@cloistr/collab-common'
import type { SignerInterface } from '@cloistr/auth'

// For development, use VITE_BLOSSOM_URL env var or fall back to public server
// Production uses files.cloistr.xyz with platform auth
const BLOSSOM_URL = import.meta.env.VITE_BLOSSOM_URL || 'https://nostr.download'

interface EditorProps {
  documentId: string
  signer: SignerInterface
  publicKey: string
  relayUrl: string
}

/**
 * Fetch the user's kind:0 profile from the relay to get a human-readable
 * display name for the collaboration cursor. Falls back to the truncated
 * pubkey while the fetch is in flight.
 */
function useDisplayName(publicKey: string, relayUrl: string): string {
  const [displayName, setDisplayName] = useState<string>(() => publicKey.slice(0, 8))

  useEffect(() => {
    if (!publicKey) return
    const pool = new SimplePool()
    let cancelled = false

    const run = async () => {
      try {
        const events = await pool.querySync([relayUrl], {
          kinds: [0],
          authors: [publicKey],
          limit: 1,
        })
        if (cancelled) return
        const event = events[0]
        if (!event) return
        const profile = JSON.parse(event.content) as Record<string, string>
        const name =
          profile.display_name?.trim() ||
          profile.name?.trim() ||
          profile.nip05?.split('@')[0] ||
          null
        if (name) {
          setDisplayName(name)
        }
      } catch {
        // Profile unavailable — truncated pubkey fallback already set
      } finally {
        pool.close([relayUrl])
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [publicKey, relayUrl])

  return displayName
}

export function Editor({ documentId, signer, publicKey, relayUrl }: EditorProps) {
  const [ydoc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<NostrSyncProvider | null>(null)
  const [peerCount, setPeerCount] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const providerRef = useRef<NostrSyncProvider | null>(null)

  const displayName = useDisplayName(publicKey, relayUrl)

  // Initialize NostrSyncProvider
  useEffect(() => {
    const syncProvider = new NostrSyncProvider(ydoc, {
      signer,
      relayUrl,
      docId: documentId,
    })

    syncProvider.onConnect = () => {
      console.log('[Editor] Connected to relay')
      setIsConnected(true)
    }

    syncProvider.onDisconnect = () => {
      console.log('[Editor] Disconnected from relay')
      setIsConnected(false)
    }

    syncProvider.onPeersChange = (count) => {
      console.log(`[Editor] Peer count: ${count}`)
      setPeerCount(count)
    }

    syncProvider.onError = (error) => {
      console.error('[Editor] Sync error:', error)
    }

    // Connect to relay
    syncProvider.connect().catch(console.error)

    providerRef.current = syncProvider
    setProvider(syncProvider)

    return () => {
      syncProvider.destroy()
      providerRef.current = null
    }
  }, [documentId, ydoc, signer, relayUrl])

  // Document persistence via Blossom
  const [persistenceState, persistenceControls] = useDocumentPersistence(
    ydoc,
    {
      documentId,
      blossomUrl: BLOSSOM_URL,
      relayUrl,
      signer,
    },
    {
      autoLoad: true,
      autoSaveInterval: 60000, // Auto-save every 60 seconds
    }
  )

  const handleSave = async () => {
    try {
      await persistenceControls.save()
    } catch (error) {
      console.error('[Editor] Save failed:', error)
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false, // Disable history - Yjs handles undo/redo
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      // CollaborationCursor's addProseMirrorPlugins() dereferences
      // provider.awareness immediately, so only attach it once the provider
      // exists. On first render provider is null (set async in the effect
      // above); including it here throws "Cannot read properties of null
      // (reading 'awareness')" and takes down the authenticated view. The
      // editor re-creates on [provider] change, so the cursor lands on connect.
      ...(provider
        ? [
            CollaborationCursor.configure({
              provider: provider as any, // TipTap expects a y-websocket-like provider
              user: {
                // Use the resolved display name from kind:0 profile. Falls back
                // to first-8-chars of the pubkey while the fetch is in flight.
                name: displayName,
                color: `#${publicKey?.slice(-6) || '000000'}`,
              },
            }),
          ]
        : []),
    ],
    content: '',
  // Deliberately NOT depending on displayName.
  //
  // The kind:0 profile fetch resolves 1-2s after mount, so including it here
  // tore down and recreated the entire TipTap editor on every page load. The
  // Yjs document survives that, but the user sees the editor flash and loses
  // cursor position — a visible regression on every single load, in exchange
  // for a name change that can be applied in place.
  //
  // The effect below pushes the resolved name into awareness instead.
  }, [provider]) // Re-create editor only when the provider changes

  // Publish the resolved display name without rebuilding the editor.
  //
  // CollaborationCursor reads the local user from the Yjs awareness state, so
  // writing the field directly is exactly what recreating the extension would
  // have achieved, minus the teardown.
  useEffect(() => {
    const awareness = (provider as { awareness?: { setLocalStateField: (k: string, v: unknown) => void } } | null)
      ?.awareness
    if (!awareness) return
    awareness.setLocalStateField('user', {
      name: displayName,
      color: `#${publicKey?.slice(-6) || '000000'}`,
    })
  }, [provider, displayName, publicKey])

  return (
    <div className="editor-container">
      <div className="editor-toolbar">
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={editor?.isActive('bold') ? 'active' : ''}
        >
          Bold
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={editor?.isActive('italic') ? 'active' : ''}
        >
          Italic
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          className={editor?.isActive('heading', { level: 1 }) ? 'active' : ''}
        >
          H1
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          className={editor?.isActive('heading', { level: 2 }) ? 'active' : ''}
        >
          H2
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          className={editor?.isActive('bulletList') ? 'active' : ''}
        >
          • List
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          className={editor?.isActive('orderedList') ? 'active' : ''}
        >
          1. List
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          className={editor?.isActive('blockquote') ? 'active' : ''}
        >
          Quote
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {persistenceState.dirty && (
            <span style={{ color: 'var(--cloistr-warning)', fontSize: '0.75rem' }}>Unsaved changes</span>
          )}
          <button
            onClick={handleSave}
            disabled={!persistenceState.initialized || persistenceState.saving || !persistenceState.dirty}
            className={persistenceState.dirty ? 'save-dirty' : 'save-clean'}
          >
            {persistenceState.saving ? 'Saving...' : persistenceState.dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <EditorContent editor={editor} />

      <div className="editor-status">
        <p>Document ID: {documentId}</p>
        <p>
          Sync: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
          {' · '}
          {peerCount + 1} user{peerCount > 0 ? 's' : ''} editing
        </p>
        <p>
          Storage: {persistenceState.loading ? '⏳ Loading...' :
                   persistenceState.saving ? '💾 Saving...' :
                   persistenceState.lastSave ? `✓ Saved ${new Date(persistenceState.lastSave.timestamp).toLocaleTimeString()}` :
                   '○ Not saved yet'}
          {persistenceState.error && <span style={{ color: 'var(--cloistr-error)' }}> · Error: {persistenceState.error.message}</span>}
        </p>
      </div>
    </div>
  )
}
