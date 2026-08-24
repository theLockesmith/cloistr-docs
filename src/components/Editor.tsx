import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { SimplePool } from 'nostr-tools'
import { NostrSyncProvider, useDocumentPersistence } from '@cloistr/collab-common'
import type { SignerInterface } from '@cloistr/auth'
import { SearchAndReplace, searchPluginKey } from '../extensions/SearchAndReplace.js'
import { CommentMark } from '../extensions/CommentMark.js'
import { editorJsonToDocxBlob, downloadDocx } from '../utils/docxExport.js'
import { uploadToBlossom, BlossomUploadError } from '../utils/blossomUpload.js'
import { MenuBar, WordCountModal, buildMenus, toMenuSections } from './MenuBar.js'
import { AppShell } from '@cloistr/ui/components'
import { withSignerRetry, SignerRecovery } from '@cloistr/ui'

const BLOSSOM_URL = import.meta.env.VITE_BLOSSOM_URL || 'https://nostr.download'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EditorProps {
  documentId: string
  signer: SignerInterface
  publicKey: string
  relayUrl: string
  /** Called when the user navigates back to the document library. */
  onBack?: () => void
}

interface Comment {
  id: string
  text: string
  authorName: string
  createdAt: number
  resolved: boolean
}

interface VersionEntry {
  hash: string
  timestamp: number
  size: number
  title: string | null
}

type RightPanel = 'comments' | 'versions' | null

// ---------------------------------------------------------------------------
// Profile hook
// ---------------------------------------------------------------------------

function useDisplayName(publicKey: string, relayUrl: string): string {
  const [displayName, setDisplayName] = useState<string>(() => publicKey.slice(0, 8))

  useEffect(() => {
    if (!publicKey) return
    const pool = new SimplePool()
    let cancelled = false

    const run = async () => {
      try {
        const events = await pool.querySync([relayUrl], { kinds: [0], authors: [publicKey], limit: 1 })
        if (cancelled) return
        const ev = events[0]
        if (!ev) return
        const p = JSON.parse(ev.content) as Record<string, string>
        const name = p.display_name?.trim() || p.name?.trim() || p.nip05?.split('@')[0] || null
        if (name) setDisplayName(name)
      } catch {
        // fallback already set
      } finally {
        pool.close([relayUrl])
      }
    }

    void run()
    return () => { cancelled = true }
  }, [publicKey, relayUrl])

  return displayName
}

// ---------------------------------------------------------------------------
// Main Editor component
// ---------------------------------------------------------------------------

export function Editor({ documentId, signer, publicKey, relayUrl, onBack }: EditorProps) {
  const [ydoc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<NostrSyncProvider | null>(null)
  const [peerCount, setPeerCount] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const providerRef = useRef<NostrSyncProvider | null>(null)

  const displayName = useDisplayName(publicKey, relayUrl)

  // ---- UI state ----
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  const [showFindReplace, setShowFindReplace] = useState(false)
  const [findTerm, setFindTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const [rightPanel, setRightPanel] = useState<RightPanel>(null)

  // ---- Comments (stored in Y.js shared map for real-time sync) ----
  const [commentsMap] = useState(() => ydoc.getMap<Comment>('comments'))
  const [comments, setComments] = useState<Comment[]>([])
  const [newCommentText, setNewCommentText] = useState('')
  const [pendingCommentRange, setPendingCommentRange] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    const updateComments = () => {
      const arr: Comment[] = []
      commentsMap.forEach((v) => arr.push(v))
      arr.sort((a, b) => a.createdAt - b.createdAt)
      setComments(arr)
    }
    commentsMap.observe(updateComments)
    updateComments()
    return () => commentsMap.unobserve(updateComments)
  }, [commentsMap])

  // ---- Version history ----
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [restoringVersion, setRestoringVersion] = useState(false)

  // ---- Share dialog ----
  const [shareOpen, setShareOpen] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  // ---- Signer recovery ----
  // When a signing call fails in-editor (save or image upload), we surface
  // SignerRecovery instead of silently swallowing the error or misdirecting
  // the user to a login screen. signerFailedOp records which operation hit
  // the error so the recovery panel's Retry button can re-invoke it.
  const [signerError, setSignerError] = useState<unknown>(null)
  const [signerFailedOp, setSignerFailedOp] = useState<'save' | 'upload' | null>(null)
  const [signerRetrying, setSignerRetrying] = useState(false)

  // ---- Export state ----
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null)

  // ---- Document title ----
  const [docTitle, setDocTitle] = useState<string>('')

  // ---- NostrSyncProvider ----
  useEffect(() => {
    const syncProvider = new NostrSyncProvider(ydoc, { signer, relayUrl, docId: documentId })
    syncProvider.onConnect = () => setIsConnected(true)
    syncProvider.onDisconnect = () => setIsConnected(false)
    syncProvider.onPeersChange = (count) => setPeerCount(count)
    syncProvider.onError = (error) => console.error('[Editor] Sync error:', error)
    syncProvider.connect().catch(console.error)
    providerRef.current = syncProvider
    setProvider(syncProvider)
    return () => { syncProvider.destroy(); providerRef.current = null }
  }, [documentId, ydoc, signer, relayUrl])

  // ---- Document persistence ----
  const [persistenceState, persistenceControls] = useDocumentPersistence(
    ydoc,
    { documentId, blossomUrl: BLOSSOM_URL, relayUrl, signer },
    { autoLoad: true, autoSaveInterval: 60000 },
  )

  const handleSave = useCallback(async () => {
    setSignerError(null)
    try {
      // withSignerRetry wraps the save call and re-tries on retryable relay
      // failures (NO_RELAYS, CONNECTION_FAILED, DISCONNECTED). Note: the
      // DocumentPersistence layer wraps signer errors in PersistenceError
      // before rethrowing, which strips the error code. This means the retry
      // policy treats persistence errors as terminal and does not retry them
      // automatically. The practical benefit is that explicit signer denials
      // (CANCELLED, REMOTE_ERROR) are also terminal and are never re-prompted.
      // A future improvement is for DocumentPersistence to propagate the
      // original error code.
      await withSignerRetry(() => persistenceControls.save())
    } catch (error) {
      console.error('[Editor] Save failed:', error)
      setSignerError(error)
      setSignerFailedOp('save')
    }
  }, [persistenceControls])

  // ---- TipTap editor ----
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      SearchAndReplace,
      CommentMark,
      Collaboration.configure({ document: ydoc }),
      ...(provider
        ? [
            CollaborationCursor.configure({
              provider: provider as any,
              user: {
                name: displayName,
                color: `#${publicKey?.slice(-6) || '000000'}`,
              },
            }),
          ]
        : []),
    ],
    content: '',
  }, [provider])

  // Publish resolved display name into awareness without rebuilding the editor.
  useEffect(() => {
    const awareness = (provider as { awareness?: { setLocalStateField: (k: string, v: unknown) => void } } | null)?.awareness
    if (!awareness) return
    awareness.setLocalStateField('user', {
      name: displayName,
      color: `#${publicKey?.slice(-6) || '000000'}`,
    })
  }, [provider, displayName, publicKey])

  // ---- Search/replace live update ----
  useEffect(() => {
    if (!editor) return
    if (!showFindReplace) {
      editor.commands.clearSearch()
      return
    }
    editor.commands.setSearchTerm(findTerm, { caseSensitive })
  }, [editor, findTerm, caseSensitive, showFindReplace])

  // Derive match count from plugin state for display.
  const searchState = editor ? searchPluginKey.getState(editor.state) : null
  const matchCount = searchState?.matches.length ?? 0
  const currentMatchIndex = searchState?.currentIndex ?? -1

  // ---- Link dialog ----
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

  // ---- Image dialog ----
  const openImageDialog = useCallback(() => {
    setImageUrl('')
    setImageFile(null)
    setImageError(null)
    setImageDialogOpen(true)
  }, [])

  const insertImage = useCallback(async () => {
    if (!editor) return

    if (imageFile) {
      setImageUploading(true)
      setImageError(null)
      setSignerError(null)
      try {
        // withSignerRetry retries on retryable relay failures (NO_RELAYS,
        // CONNECTION_FAILED, DISCONNECTED). BlossomUploadError is not a signer
        // error and is treated as terminal immediately. Signer denials
        // (CANCELLED, REMOTE_ERROR) are also terminal -- not retried.
        const url = await withSignerRetry(() => uploadToBlossom(imageFile, BLOSSOM_URL, signer))
        editor.chain().focus().setImage({ src: url }).run()
        setImageDialogOpen(false)
      } catch (err) {
        if (err instanceof BlossomUploadError) {
          // Server-side failure (HTTP error from Blossom) -- show inline.
          setImageError(err.message)
        } else {
          // Signer failure -- close the dialog and show recovery panel so the
          // user is not staring at a frozen image dialog with no explanation.
          setImageDialogOpen(false)
          setSignerError(err)
          setSignerFailedOp('upload')
        }
      } finally {
        setImageUploading(false)
      }
    } else if (imageUrl.trim()) {
      const src = /^https?:\/\//i.test(imageUrl.trim()) ? imageUrl.trim() : `https://${imageUrl.trim()}`
      editor.chain().focus().setImage({ src }).run()
      setImageDialogOpen(false)
    }
  }, [editor, imageFile, imageUrl, signer])

  // ---- Comments ----
  const addComment = useCallback(() => {
    if (!editor || !newCommentText.trim() || !pendingCommentRange) return
    const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const comment: Comment = {
      id,
      text: newCommentText.trim(),
      authorName: displayName,
      createdAt: Date.now(),
      resolved: false,
    }
    commentsMap.set(id, comment)
    editor
      .chain()
      .focus()
      .setTextSelection(pendingCommentRange)
      .setComment(id)
      .run()
    setNewCommentText('')
    setPendingCommentRange(null)
  }, [editor, newCommentText, pendingCommentRange, displayName, commentsMap])

  const startAddComment = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    if (from === to) return // no selection
    setPendingCommentRange({ from, to })
    setRightPanel('comments')
    setNewCommentText('')
  }, [editor])

  const resolveComment = useCallback((id: string) => {
    const existing = commentsMap.get(id)
    if (existing) {
      commentsMap.set(id, { ...existing, resolved: true })
      editor?.commands.removeComment(id)
    }
  }, [commentsMap, editor])

  // ---- Version history ----
  const loadVersions = useCallback(async () => {
    if (!publicKey) return
    setVersionsLoading(true)
    setVersionsError(null)
    const pool = new SimplePool()
    try {
      const events = await pool.querySync([relayUrl], {
        kinds: [30078],
        authors: [publicKey],
        '#d': [documentId],
        limit: 50,
      })
      const seen = new Set<string>()
      const entries: VersionEntry[] = []
      for (const ev of events) {
        let meta: { hash?: string; size?: number; timestamp?: number; title?: string } = {}
        try { meta = JSON.parse(ev.content) as typeof meta } catch { /* ignore */ }
        if (!meta.hash || seen.has(meta.hash)) continue
        seen.add(meta.hash)
        entries.push({
          hash: meta.hash,
          timestamp: (meta.timestamp ?? ev.created_at) * (meta.timestamp ? 1 : 1000),
          size: meta.size ?? 0,
          title: meta.title ?? null,
        })
      }
      entries.sort((a, b) => b.timestamp - a.timestamp)
      setVersions(entries)
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : 'Failed to load versions')
    } finally {
      setVersionsLoading(false)
      pool.close([relayUrl])
    }
  }, [publicKey, relayUrl, documentId])

  useEffect(() => {
    if (rightPanel === 'versions') void loadVersions()
  }, [rightPanel, loadVersions])

  const restoreVersion = useCallback(async (hash: string) => {
    if (restoringVersion) return
    setRestoringVersion(true)
    try {
      const url = `${BLOSSOM_URL.replace(/\/$/, '')}/${hash}`
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
      const buf = await response.arrayBuffer()
      Y.applyUpdate(ydoc, new Uint8Array(buf))
    } catch (err) {
      console.error('[VersionHistory] Restore failed:', err)
      alert('Failed to restore version: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setRestoringVersion(false)
    }
  }, [ydoc, restoringVersion])

  // ---- Export ----
  const exportPdf = useCallback(() => {
    setExporting('pdf')
    // Give React a frame to update the button label before print blocks the thread.
    requestAnimationFrame(() => {
      window.print()
      setExporting(null)
    })
  }, [])

  const exportDocx = useCallback(async () => {
    if (!editor) return
    setExporting('docx')
    try {
      const json = editor.getJSON()
      const blob = await editorJsonToDocxBlob(json)
      const filename = (docTitle.trim() || documentId) + '.docx'
      downloadDocx(blob, filename)
    } catch (err) {
      console.error('[Export] DOCX export failed:', err)
      alert('DOCX export failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setExporting(null)
    }
  }, [editor, docTitle, documentId])

  // ---- Share ----
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?docId=${encodeURIComponent(documentId)}`
    : ''

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2000)
    } catch {
      // Clipboard API unavailable — show the URL for manual copy.
    }
  }, [shareUrl])

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowFindReplace((v) => !v)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        openLinkDialog()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  // ---- Signer recovery retry handler ----
  // Invoked by the SignerRecovery panel's Retry button. Calls the operation
  // that originally failed so the user stays in context. Session state is
  // never touched here or anywhere in this handler.
  const handleSignerRetry = useCallback(async () => {
    setSignerRetrying(true)
    try {
      if (signerFailedOp === 'save') {
        await handleSave()
      } else if (signerFailedOp === 'upload') {
        // Re-open the image dialog so the user can re-submit. We can't replay
        // the upload without the file reference, and the dialog was closed on
        // failure. This is a deliberate user action, not a silent retry.
        setSignerError(null)
        setSignerFailedOp(null)
        setImageDialogOpen(true)
      }
    } finally {
      setSignerRetrying(false)
    }
  }, [signerFailedOp, handleSave])

  // ---- Render ----
  const [wordCountOpen, setWordCountOpen] = useState(false)

  // One definition of the menus, rendered two ways: docs' own bar on desktop,
  // and the shell's drawer on mobile. This is why AppShell takes menu DATA
  // rather than JSX — passing a rendered bar is what forced docs to build a
  // second, mobile-only menu in the first place.
  const menuBarProps = {
    editor,
    ...(onBack ? { onNewDocument: onBack } : {}),
    onShare: () => setShareOpen(true),
    onVersionHistory: () => setRightPanel('versions' as const),
    onExportPdf: exportPdf,
    onExportDocx: exportDocx,
    onFindReplace: () => setShowFindReplace((v: boolean) => !v),
    onInsertImage: openImageDialog,
    onInsertLink: openLinkDialog,
    onInsertComment: startAddComment,
    onSave: handleSave,
    exporting,
    onWordCount: () => setWordCountOpen(true),
  }

  const menuSections = toMenuSections(
    buildMenus(menuBarProps, menuBarProps.onWordCount),
  )

  return (
    <div className={`editor-container ${rightPanel ? 'editor-with-panel' : ''}`}>

      {/* ======== Signer recovery overlay ======== */}
      {/* When a signing call fails inside the editor (save or image upload), we
          show this panel instead of silently dropping the error or redirecting
          the user to a login screen. The session is intact; this is a relay or
          signer reachability problem, not an authentication problem. */}
      {signerError !== null && (
        <div className="editor-signer-recovery-overlay" role="dialog" aria-modal="true" aria-label="Signing error">
          <SignerRecovery
            error={signerError}
            retrying={signerRetrying}
            onRetry={handleSignerRetry}
            onGoBack={() => {
              setSignerError(null)
              setSignerFailedOp(null)
              setSignerRetrying(false)
            }}
          />
        </div>
      )}

      {/* ======== Compact top bar: back + title + status ======== */}
      <div className="editor-topbar" aria-label="Document toolbar">
        {onBack && (
          <button
            className="editor-back-btn"
            onClick={onBack}
            title="Back to documents"
            aria-label="Back to documents"
          >
            ← Back
          </button>
        )}
        <input
          className="editor-title-input"
          placeholder="Untitled document"
          value={docTitle}
          onChange={(e) => setDocTitle(e.target.value)}
          aria-label="Document title"
        />
        <span className="editor-sync-status" title={isConnected ? `${peerCount + 1} editor(s)` : 'Disconnected'}>
          {isConnected ? '🟢' : '🔴'}
          {peerCount > 0 && <span className="editor-peer-count"> +{peerCount}</span>}
        </span>
        <button
          className={persistenceState.dirty ? 'save-dirty' : 'save-clean'}
          onClick={handleSave}
          disabled={!persistenceState.initialized || persistenceState.saving || !persistenceState.dirty}
          title="Save document (Ctrl+S)"
          aria-label="Save document"
        >
          {persistenceState.saving ? 'Saving…' : persistenceState.dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {/* ======== Menu bar ========
          Desktop renders docs' own bar. Mobile renders NOTHING here: the single
          shared hamburger below owns every app command at that size. docs used
          to ship its own `.menubar-hamburger` inside `.menubar-mobile`, which
          put three controls that all read as "menu" on one phone screen — the
          9-dot apps switcher, the shared toggle, and docs' own. */}
      <MenuBar {...menuBarProps} />

      {/* The ONE mobile nav affordance. AppShell renders it only below 768px
          and only because docs has commands to put in it; on desktop it renders
          nothing at all, so the bar above is not duplicated. */}
      <AppShell serviceId="docs" menu={menuSections} />

      {wordCountOpen && editor && (
        <WordCountModal editor={editor} onClose={() => setWordCountOpen(false)} />
      )}

      {/* ======== Formatting toolbar ======== */}
      <div className="editor-toolbar" role="toolbar" aria-label="Formatting">

        {/* Styles dropdown */}
        <select
          className="editor-style-select"
          value={
            editor?.isActive('heading', { level: 1 }) ? 'h1'
            : editor?.isActive('heading', { level: 2 }) ? 'h2'
            : editor?.isActive('heading', { level: 3 }) ? 'h3'
            : editor?.isActive('heading', { level: 4 }) ? 'h4'
            : 'p'
          }
          onChange={(e) => {
            if (!editor) return
            const val = e.target.value
            if (val === 'p') editor.chain().focus().setParagraph().run()
            else editor.chain().focus().setHeading({ level: Number(val.slice(1)) as 1|2|3|4 }).run()
          }}
          aria-label="Paragraph style"
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Heading 4</option>
        </select>

        <span className="toolbar-separator" />

        {/* Text formatting */}
        <button onClick={() => editor?.chain().focus().toggleBold().run()} className={editor?.isActive('bold') ? 'active' : ''} title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={editor?.isActive('bold')}>
          <strong>B</strong>
        </button>
        <button onClick={() => editor?.chain().focus().toggleItalic().run()} className={editor?.isActive('italic') ? 'active' : ''} title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={editor?.isActive('italic')}>
          <em>I</em>
        </button>
        <button onClick={() => editor?.chain().focus().toggleUnderline().run()} className={editor?.isActive('underline') ? 'active' : ''} title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed={editor?.isActive('underline')}>
          <u>U</u>
        </button>
        <button onClick={() => editor?.chain().focus().toggleStrike().run()} className={editor?.isActive('strike') ? 'active' : ''} title="Strikethrough" aria-label="Strikethrough" aria-pressed={editor?.isActive('strike')}>
          <s>S</s>
        </button>
        <button onClick={() => editor?.chain().focus().toggleCode().run()} className={editor?.isActive('code') ? 'active' : ''} title="Inline code" aria-label="Inline code" aria-pressed={editor?.isActive('code')}>
          {'<>'}
        </button>
        <button onClick={openLinkDialog} className={editor?.isActive('link') ? 'active' : ''} title="Insert link" aria-label="Insert link" aria-pressed={editor?.isActive('link')}>
          Link
        </button>

        <span className="toolbar-separator" />

        {/* Block formatting */}
        <button onClick={() => editor?.chain().focus().toggleBulletList().run()} className={editor?.isActive('bulletList') ? 'active' : ''} title="Bullet list" aria-label="Bullet list">
          &#x2022; List
        </button>
        <button onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={editor?.isActive('orderedList') ? 'active' : ''} title="Numbered list" aria-label="Numbered list">
          1. List
        </button>
        <button onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={editor?.isActive('blockquote') ? 'active' : ''} title="Blockquote" aria-label="Blockquote">
          Quote
        </button>

        <span className="toolbar-separator" />

        {/* Table */}
        <button onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table" aria-label="Insert table">
          Table
        </button>
        {editor?.isActive('table') && (
          <>
            <button onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column after" aria-label="Add column after">+Col</button>
            <button onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column" aria-label="Delete column">-Col</button>
            <button onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row after" aria-label="Add row after">+Row</button>
            <button onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row" aria-label="Delete row">-Row</button>
            <button onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table" aria-label="Delete table">Del⌫</button>
          </>
        )}

        <span className="toolbar-separator" />

        {/* Image */}
        <button onClick={openImageDialog} title="Insert image" aria-label="Insert image">
          Image
        </button>

        {/* Find/Replace toggle */}
        <button
          onClick={() => setShowFindReplace((v) => !v)}
          className={showFindReplace ? 'active' : ''}
          title="Find and replace (Ctrl+F)"
          aria-label="Find and replace"
          aria-expanded={showFindReplace}
        >
          Find
        </button>

        <span className="toolbar-separator" />

        {/* Comment */}
        <button onClick={startAddComment} title="Add comment to selection" aria-label="Add comment">
          Comment
        </button>

        {/* Right-side actions */}
        <div className="toolbar-right">
          {/* Version history */}
          <button
            onClick={() => setRightPanel(rightPanel === 'versions' ? null : 'versions')}
            className={rightPanel === 'versions' ? 'active' : ''}
            title="Version history"
            aria-label="Version history"
            aria-expanded={rightPanel === 'versions'}
          >
            History
          </button>

          {/* Share */}
          <button onClick={() => setShareOpen(true)} title="Share document" aria-label="Share document">
            Share
          </button>

          {/* Export */}
          <button onClick={exportPdf} disabled={exporting !== null} title="Export as PDF (uses browser print)" aria-label="Export as PDF">
            {exporting === 'pdf' ? '…' : 'PDF'}
          </button>
          <button onClick={exportDocx} disabled={exporting !== null || !editor} title="Export as DOCX" aria-label="Export as DOCX">
            {exporting === 'docx' ? '…' : 'DOCX'}
          </button>
        </div>
      </div>

      {/* ======== Find & Replace panel ======== */}
      {showFindReplace && (
        <div className="find-replace-panel" role="search" aria-label="Find and replace">
          <div className="find-replace-row">
            <label className="find-replace-label" htmlFor="find-input">Find</label>
            <input
              id="find-input"
              className="find-replace-input"
              placeholder="Search…"
              value={findTerm}
              onChange={(e) => setFindTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') editor?.commands.findNext()
                if (e.key === 'Escape') setShowFindReplace(false)
              }}
              autoFocus
            />
            <span className="find-match-count" aria-live="polite">
              {findTerm ? (matchCount === 0 ? 'No matches' : `${currentMatchIndex + 1}/${matchCount}`) : ''}
            </span>
            <button onClick={() => editor?.commands.findPrevious()} disabled={matchCount === 0} title="Previous match" aria-label="Previous match">↑</button>
            <button onClick={() => editor?.commands.findNext()} disabled={matchCount === 0} title="Next match" aria-label="Next match">↓</button>
            <label className="find-replace-checkbox" title="Case-sensitive search">
              <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
              <span>Aa</span>
            </label>
          </div>
          <div className="find-replace-row">
            <label className="find-replace-label" htmlFor="replace-input">Replace</label>
            <input
              id="replace-input"
              className="find-replace-input"
              placeholder="Replacement…"
              value={replaceTerm}
              onChange={(e) => setReplaceTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') editor?.commands.replaceOne(replaceTerm) }}
            />
            <button onClick={() => editor?.commands.replaceOne(replaceTerm)} disabled={matchCount === 0} aria-label="Replace current match">Replace</button>
            <button onClick={() => editor?.commands.replaceAll(replaceTerm)} disabled={matchCount === 0} aria-label="Replace all matches">All</button>
          </div>
          <button
            className="find-replace-close"
            onClick={() => { setShowFindReplace(false); setFindTerm('') }}
            aria-label="Close find and replace"
            title="Close"
          >
            ✕
          </button>
        </div>
      )}

      {/* ======== Link dialog ======== */}
      {linkDialogOpen && (
        <div className="link-dialog" role="dialog" aria-modal="true" aria-label="Insert link">
          <input
            type="url"
            className="link-dialog-input"
            placeholder="https://example.com"
            value={linkHref}
            onChange={(e) => setLinkHref(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyLink(); if (e.key === 'Escape') { setLinkDialogOpen(false); setLinkHref('') } }}
            autoFocus
          />
          <button onClick={applyLink}>Apply</button>
          <button onClick={() => { setLinkDialogOpen(false); setLinkHref('') }}>Cancel</button>
          {editor?.isActive('link') && (
            <button onClick={() => { editor.chain().focus().unsetLink().run(); setLinkDialogOpen(false) }}>Remove</button>
          )}
        </div>
      )}

      {/* ======== Image dialog ======== */}
      {imageDialogOpen && (
        <div className="modal-backdrop" onClick={() => setImageDialogOpen(false)} role="presentation">
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Insert image"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">Insert image</h3>
            <div className="modal-section">
              <label htmlFor="image-url-input" className="modal-label">Image URL</label>
              <input
                id="image-url-input"
                type="url"
                className="modal-input"
                placeholder="https://example.com/image.jpg"
                value={imageUrl}
                onChange={(e) => { setImageUrl(e.target.value); setImageFile(null) }}
                disabled={imageUploading}
              />
            </div>
            <div className="modal-divider">— or upload a file —</div>
            <div className="modal-section">
              <label htmlFor="image-file-input" className="modal-label">Upload from device</label>
              <input
                id="image-file-input"
                type="file"
                accept="image/*"
                className="modal-file-input"
                onChange={(e) => { setImageFile(e.target.files?.[0] ?? null); setImageUrl('') }}
                disabled={imageUploading}
              />
            </div>
            {imageError && <p className="modal-error" role="alert">{imageError}</p>}
            <div className="modal-actions">
              <button
                onClick={insertImage}
                disabled={imageUploading || (!imageUrl.trim() && !imageFile)}
                className="modal-btn-primary"
              >
                {imageUploading ? 'Uploading…' : 'Insert'}
              </button>
              <button onClick={() => setImageDialogOpen(false)} className="modal-btn-secondary" disabled={imageUploading}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Share dialog ======== */}
      {shareOpen && (
        <div className="modal-backdrop" onClick={() => setShareOpen(false)} role="presentation">
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Share document"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="modal-title">Share document</h3>
            <p className="modal-description">
              Anyone with this link who has access to the Nostr relay can view and edit this document.
              Documents are currently stored unencrypted. End-to-end encrypted sharing (per-recipient
              key wrapping via NIP-44) is planned for a future release.
            </p>
            <div className="modal-section">
              <label className="modal-label">Shareable link</label>
              <div className="share-link-row">
                <input
                  type="url"
                  readOnly
                  className="modal-input share-link-input"
                  value={shareUrl}
                  onFocus={(e) => e.target.select()}
                />
                <button onClick={copyShareLink} className="modal-btn-primary share-copy-btn">
                  {shareCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => setShareOpen(false)} className="modal-btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ======== Main content row: editor + right panel ======== */}
      <div className="editor-main-row">
        {/* Editor surface */}
        <div className="editor-content-area">
          <EditorContent editor={editor} />
        </div>

        {/* Right panel */}
        {rightPanel && (
          <aside className="editor-right-panel" aria-label={rightPanel === 'comments' ? 'Comments' : 'Version history'}>
            <div className="panel-header">
              <div className="panel-tabs">
                <button
                  className={rightPanel === 'comments' ? 'panel-tab active' : 'panel-tab'}
                  onClick={() => setRightPanel('comments')}
                  aria-selected={rightPanel === 'comments'}
                >
                  Comments
                </button>
                <button
                  className={rightPanel === 'versions' ? 'panel-tab active' : 'panel-tab'}
                  onClick={() => setRightPanel('versions')}
                  aria-selected={rightPanel === 'versions'}
                >
                  History
                </button>
              </div>
              <button
                className="panel-close-btn"
                onClick={() => setRightPanel(null)}
                aria-label="Close panel"
                title="Close panel"
              >
                ✕
              </button>
            </div>

            {/* Comments panel */}
            {rightPanel === 'comments' && (
              <div className="panel-body">
                {/* New comment composer */}
                {pendingCommentRange ? (
                  <div className="comment-composer">
                    <p className="comment-composer-hint">Adding comment to selected text:</p>
                    <textarea
                      className="comment-textarea"
                      placeholder="Write a comment…"
                      value={newCommentText}
                      onChange={(e) => setNewCommentText(e.target.value)}
                      rows={3}
                      autoFocus
                    />
                    <div className="comment-composer-actions">
                      <button onClick={addComment} disabled={!newCommentText.trim()} className="modal-btn-primary">
                        Add
                      </button>
                      <button onClick={() => setPendingCommentRange(null)} className="modal-btn-secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="panel-hint">Select text in the document, then click "Comment" to add a comment.</p>
                )}

                {/* Comment list */}
                {comments.length === 0 ? (
                  <p className="panel-empty">No comments yet.</p>
                ) : (
                  <ul className="comment-list">
                    {comments.map((c) => (
                      <li key={c.id} className={`comment-item ${c.resolved ? 'comment-item--resolved' : ''}`}>
                        <div className="comment-item-header">
                          <span className="comment-author">{c.authorName}</span>
                          <span className="comment-time">{new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="comment-text">{c.text}</p>
                        {!c.resolved && (
                          <button
                            className="comment-resolve-btn"
                            onClick={() => resolveComment(c.id)}
                            aria-label="Resolve comment"
                          >
                            Resolve
                          </button>
                        )}
                        {c.resolved && <span className="comment-resolved-label">Resolved</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Version history panel */}
            {rightPanel === 'versions' && (
              <div className="panel-body">
                {versionsLoading && <p className="panel-loading">Loading…</p>}
                {versionsError && <p className="panel-error" role="alert">{versionsError}</p>}
                {!versionsLoading && !versionsError && versions.length === 0 && (
                  <p className="panel-empty">No saved versions yet. Save the document to create the first version.</p>
                )}
                {versions.length > 0 && (
                  <ul className="version-list">
                    {versions.map((v, idx) => (
                      <li key={v.hash} className="version-item">
                        <div className="version-item-info">
                          <span className="version-label">
                            {idx === 0 ? 'Latest' : `Version ${versions.length - idx}`}
                            {v.title ? ` – ${v.title}` : ''}
                          </span>
                          <span className="version-timestamp">
                            {new Date(v.timestamp).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                          <span className="version-size">{Math.round(v.size / 1024) || '<1'} KB</span>
                        </div>
                        {idx > 0 && (
                          <button
                            className="version-restore-btn"
                            onClick={() => void restoreVersion(v.hash)}
                            disabled={restoringVersion}
                            aria-label={`Restore to version from ${new Date(v.timestamp).toLocaleString()}`}
                          >
                            {restoringVersion ? '…' : 'Restore'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  className="version-refresh-btn"
                  onClick={() => void loadVersions()}
                  disabled={versionsLoading}
                >
                  Refresh
                </button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
