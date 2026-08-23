import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useCallback, useEffect, useState, useRef } from 'react'
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
        // Profile unavailable -- truncated pubkey fallback already set
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

  // Link insertion dialog state
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')

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
      // Underline: requires @tiptap/extension-underline (new dependency)
      Underline,
      // Link: requires @tiptap/extension-link (new dependency)
      // openOnClick:false so that clicking a link does not navigate while
      // editing; the user can follow it with Cmd/Ctrl+click.
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
      // Tables: require @tiptap/extension-table and sub-packages (new deps)
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
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
  // cursor position -- a visible regression on every single load, in exchange
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

  // Link dialog handlers

  const openLinkDialog = useCallback(() => {
    if (!editor) return
    const existing = editor.getAttributes('link').href as string | undefined
    setLinkHref(existing ?? '')
    setLinkDialogOpen(true)
  }, [editor])

  const applyLink = useCallback(() => {
    if (!editor) return
    const url = linkHref.trim()
    if (!url) {
      editor.chain().focus().unsetLink().run()
    } else {
      const href = /^https?:\/\//i.test(url) ? url : `https://${url}`
      editor.chain().focus().setLink({ href }).run()
    }
    setLinkDialogOpen(false)
    setLinkHref('')
  }, [editor, linkHref])

  const cancelLink = useCallback(() => {
    setLinkDialogOpen(false)
    setLinkHref('')
  }, [])

  return (
    <div className="editor-container">
      <div className="editor-toolbar">
        {/* ---- Text formatting ---- */}
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={editor?.isActive('bold') ? 'active' : ''}
          title="Bold (Ctrl+B)"
        >
          Bold
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={editor?.isActive('italic') ? 'active' : ''}
          title="Italic (Ctrl+I)"
        >
          Italic
        </button>
        {/* Strike: bundled in StarterKit (extension-strike) -- no new dependency */}
        <button
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          className={editor?.isActive('strike') ? 'active' : ''}
          title="Strikethrough"
        >
          <s>S</s>
        </button>
        {/* Underline: @tiptap/extension-underline (new dependency) */}
        <button
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          className={editor?.isActive('underline') ? 'active' : ''}
          title="Underline (Ctrl+U)"
        >
          <u>U</u>
        </button>
        {/* Inline code: bundled in StarterKit (extension-code) -- no new dependency */}
        <button
          onClick={() => editor?.chain().focus().toggleCode().run()}
          className={editor?.isActive('code') ? 'active' : ''}
          title="Inline code"
        >
          {'</>'}
        </button>
        {/* Link: @tiptap/extension-link (new dependency) */}
        <button
          onClick={openLinkDialog}
          className={editor?.isActive('link') ? 'active' : ''}
          title="Insert link"
        >
          Link
        </button>

        {/* ---- Block formatting ---- */}
        <span className="toolbar-separator" />
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

        {/* ---- Table controls ---- */}
        {/* Table: @tiptap/extension-table + sub-packages (new dependencies) */}
        <span className="toolbar-separator" />
        <button
          onClick={() =>
            editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
          title="Insert 3x3 table"
        >
          Table
        </button>
        {editor?.isActive('table') && (
          <>
            <button
              onClick={() => editor.chain().focus().addColumnBefore().run()}
              title="Insert column before"
            >
              +Col&#x2190;
            </button>
            <button
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              title="Insert column after"
            >
              +Col&#x2192;
            </button>
            <button
              onClick={() => editor.chain().focus().deleteColumn().run()}
              title="Delete column"
            >
              -Col
            </button>
            <button
              onClick={() => editor.chain().focus().addRowBefore().run()}
              title="Insert row before"
            >
              +Row&#x2191;
            </button>
            <button
              onClick={() => editor.chain().focus().addRowAfter().run()}
              title="Insert row after"
            >
              +Row&#x2193;
            </button>
            <button
              onClick={() => editor.chain().focus().deleteRow().run()}
              title="Delete row"
            >
              -Row
            </button>
            <button
              onClick={() => editor.chain().focus().deleteTable().run()}
              title="Delete table"
            >
              Del Table
            </button>
          </>
        )}

        {/* ---- Save ---- */}
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

      {/* Link insertion dialog -- sits between toolbar and editor surface */}
      {linkDialogOpen && (
        <div className="link-dialog" role="dialog" aria-label="Insert link">
          <input
            type="url"
            className="link-dialog-input"
            placeholder="https://example.com"
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink()
              if (e.key === 'Escape') cancelLink()
            }}
            autoFocus
          />
          <button onClick={applyLink}>Apply</button>
          <button onClick={cancelLink}>Cancel</button>
          {editor?.isActive('link') && (
            <button
              onClick={() => {
                editor.chain().focus().unsetLink().run()
                setLinkDialogOpen(false)
              }}
            >
              Remove
            </button>
          )}
        </div>
      )}

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
