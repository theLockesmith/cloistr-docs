import { useEffect, useState } from 'react'
import { SimplePool } from 'nostr-tools'
import { generateDocumentId } from '@cloistr/collab-common/config'

interface DocumentEntry {
  id: string
  title: string
  updatedAt: number
}

interface DocumentLibraryProps {
  publicKey: string
  relayUrl: string
  /** Called when the user selects a document or creates a new one */
  onOpen: (docId: string) => void
}

/**
 * Parse a human-readable title out of a documentId or its snapshot event.
 * Falls back gracefully to the raw ID.
 */
function formatTitle(docId: string): string {
  // Format: doc-{timestamp}-{random8}
  const match = docId.match(/^doc-(\d+)-/)
  if (match) {
    const ts = parseInt(match[1] ?? '0', 10)
    const date = new Date(ts)
    return `Document – ${date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`
  }
  return docId
}

/**
 * Document library: queries the relay for all kind:30078 events the user has
 * authored with a `d` tag beginning with "doc-", and presents them as an
 * openable list with a "New document" button.
 *
 * Kind 30078 is the addressable event type used by the persistence layer to
 * store document snapshots. Filtering by "doc-" prefix client-side is
 * necessary because relay REQ filters do not support prefix matching on `#d`.
 */
export function DocumentLibrary({ publicKey, relayUrl, onOpen }: DocumentLibraryProps) {
  const [documents, setDocuments] = useState<DocumentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!publicKey) return

    const pool = new SimplePool()
    let cancelled = false

    const run = async () => {
      try {
        setLoading(true)
        setError(null)

        const events = await pool.querySync([relayUrl], {
          kinds: [30078],
          authors: [publicKey],
          limit: 200,
        })

        if (cancelled) return

        // Filter to documents from this app (d tag starts with "doc-")
        // and deduplicate by d tag (keep newest created_at per d).
        const byId = new Map<string, { created_at: number }>()
        for (const ev of events) {
          const dTag = (ev.tags as string[][]).find((t) => t[0] === 'd')?.[1] as string | undefined
          if (!dTag?.startsWith('doc-')) continue
          const existing = byId.get(dTag)
          if (!existing || ev.created_at > existing.created_at) {
            byId.set(dTag, { created_at: ev.created_at })
          }
        }

        const entries: DocumentEntry[] = Array.from(byId.entries())
          .map(([id, { created_at }]) => ({
            id,
            title: formatTitle(id),
            updatedAt: created_at * 1000,
          }))
          .sort((a, b) => b.updatedAt - a.updatedAt)

        setDocuments(entries)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load documents')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
        pool.close([relayUrl])
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [publicKey, relayUrl])

  const handleNew = () => {
    const newId = generateDocumentId('doc')
    onOpen(newId)
  }

  return (
    <div className="doc-library">
      <h2>My Documents</h2>

      <div className="doc-library-actions">
        <button onClick={handleNew}>
          + New Document
        </button>
      </div>

      {loading && (
        <div className="doc-library-loading">Loading documents…</div>
      )}

      {error && (
        <div className="doc-library-loading" style={{ color: 'var(--cloistr-error)' }}>
          Error: {error}
        </div>
      )}

      {!loading && !error && documents.length === 0 && (
        <div className="doc-library-empty">
          <p>No documents yet. Create your first one above.</p>
        </div>
      )}

      {!loading && documents.length > 0 && (
        <ul className="doc-library-list">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="doc-library-item"
              onClick={() => onOpen(doc.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(doc.id)}
            >
              <span className="doc-library-item-title">{doc.title}</span>
              <span className="doc-library-item-meta">
                {new Date(doc.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
