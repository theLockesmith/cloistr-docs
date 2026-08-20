import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useEffect, useState, useRef } from 'react'
import * as Y from 'yjs'
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

export function Editor({ documentId, signer, publicKey, relayUrl }: EditorProps) {
  const [ydoc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<NostrSyncProvider | null>(null)
  const [peerCount, setPeerCount] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const providerRef = useRef<NostrSyncProvider | null>(null)

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
                name: publicKey?.slice(0, 8) || 'Anonymous',
                color: `#${publicKey?.slice(-6) || '000000'}`,
              },
            }),
          ]
        : []),
    ],
    content: '',
  }, [provider]) // Re-create editor when provider changes

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

// Styles
const style = document.createElement('style')
style.textContent = `
  .editor-container {
    max-width: 800px;
    margin: 0 auto;
  }

  .editor-toolbar {
    display: flex;
    /* Wrap on narrow screens. Measured at 375x667: the toolbar ran 62px past
       the right edge, pushing the save button off-screen — this app has no
       width breakpoints at all, only prefers-color-scheme. */
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem;
    border: 1px solid var(--cloistr-border);
    border-radius: 0.375rem;
    background-color: var(--cloistr-bg-hover);
  }

  .editor-toolbar button {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--cloistr-border);
    border-radius: 0.25rem;
    background-color: var(--cloistr-bg-elevated);
    color: var(--cloistr-text);
    cursor: pointer;
    font-size: 0.875rem;
  }

  .editor-toolbar button:hover {
    background-color: var(--cloistr-bg-hover);
  }

  .editor-toolbar button.active {
    background-color: var(--cloistr-info);
    color: white;
    border-color: var(--cloistr-info);
  }

  .ProseMirror {
    min-height: 400px;
    padding: 1rem;
    border: 1px solid var(--cloistr-border);
    border-radius: 0.375rem;
    outline: none;
  }

  .ProseMirror:focus {
    border-color: var(--cloistr-info);
  }

  .editor-status {
    margin-top: 1rem;
    padding: 0.5rem;
    background-color: var(--cloistr-bg-hover);
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: var(--cloistr-text-muted);
  }

  .editor-status p {
    margin: 0.25rem 0;
  }

  .editor-toolbar button.save-dirty {
    background-color: var(--cloistr-info);
    color: white;
    border-color: var(--cloistr-info);
  }

  .editor-toolbar button.save-clean {
    background-color: var(--cloistr-success);
    color: white;
    border-color: var(--cloistr-success);
  }

  .editor-toolbar button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Mobile. This app previously had NO width breakpoints, so the fixed
     800px-centred container and the non-wrapping toolbar simply overflowed a
     phone — measured at 62px past the right edge. */
  @media (max-width: 768px) {
    .editor-container {
      max-width: 100%;
      padding: 0 0.5rem;
    }

    .editor-toolbar {
      padding: 0.4rem;
      row-gap: 0.4rem;
    }

    .editor-toolbar button {
      /* Comfortable tap target; the default padding gives ~24px rows. */
      min-height: 40px;
    }
  }
`
document.head.appendChild(style)
