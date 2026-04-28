import { useState } from 'react'
import { Editor } from './components/Editor.js'
import { useNostrAuth } from '@cloistr/collab-common/auth'
import { Header, Footer, SharedAuthProvider } from '@cloistr/ui/components'
import '@cloistr/ui/styles'

// Default relay for Yjs sync
const DEFAULT_RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://relay.cloistr.xyz'

/**
 * Get or generate document ID.
 * Uses URL parameter if provided, otherwise generates a new one.
 * Format: {type}-{timestamp}-{random} (e.g., doc-1711392000-a1b2c3)
 */
function getDocumentId(): string {
  const params = new URLSearchParams(window.location.search)
  const urlDocId = params.get('docId')

  if (urlDocId) {
    return urlDocId
  }

  // Generate a new document ID and update URL
  const newDocId = `doc-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
  const newUrl = new URL(window.location.href)
  newUrl.searchParams.set('docId', newDocId)
  window.history.replaceState({}, '', newUrl.toString())

  return newDocId
}

/**
 * Main content - shows login prompt or editor based on auth state
 */
function AppContent() {
  const { authState, signer } = useNostrAuth()
  const [documentId] = useState(getDocumentId)

  return (
    <div className="app">
      <Header activeServiceId="docs" />

      <main>
        {authState.isConnected && signer && authState.pubkey ? (
          <Editor
            documentId={documentId}
            signer={signer}
            publicKey={authState.pubkey}
            relayUrl={DEFAULT_RELAY_URL}
          />
        ) : (
          <div className="login-prompt">
            <h2>Welcome to Cloistr Docs</h2>
            <p>Collaborative document editing powered by Nostr</p>
            <p>Sign in to create or edit documents.</p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}

function App() {
  return (
    <SharedAuthProvider>
      <AppContent />
    </SharedAuthProvider>
  )
}

export default App
