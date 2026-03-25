import { useState } from 'react'
import { Editor } from './components/Editor.js'
import { nip19 } from 'nostr-tools'
import {
  AuthProvider,
  useNostrAuth,
  useAuthHelpers,
  isValidBunkerUrl,
} from '@cloistr/collab-common/auth'

// Default relay for Yjs sync
const DEFAULT_RELAY_URL = import.meta.env.VITE_RELAY_URL || 'wss://relay.cloistr.xyz'
// Default bunker URL for NIP-46
const DEFAULT_BUNKER_URL = import.meta.env.VITE_BUNKER_URL || ''

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
 * Login component - shown when user is not authenticated
 */
function LoginScreen() {
  const { connectNip07, connectNip46, authState } = useNostrAuth()
  const { isNip07Available, isNip46Available, isAuthAvailable } = useAuthHelpers()
  const [bunkerUrl, setBunkerUrl] = useState(DEFAULT_BUNKER_URL)
  const [loading, setLoading] = useState(false)

  const handleNip07Connect = async () => {
    setLoading(true)
    try {
      await connectNip07()
    } catch (error) {
      console.error('NIP-07 connection failed:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNip46Connect = async () => {
    if (!bunkerUrl || !isValidBunkerUrl(bunkerUrl)) {
      alert('Please enter a valid bunker URL (bunker://...)')
      return
    }
    setLoading(true)
    try {
      await connectNip46({ bunkerUrl, timeout: 30000 })
    } catch (error) {
      console.error('NIP-46 connection failed:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-container">
        <h1>Cloistr Docs</h1>
        <p>Collaborative document editing powered by Nostr</p>

        {authState.error && (
          <div className="error-message">{authState.error}</div>
        )}

        {!isAuthAvailable ? (
          <div className="no-auth">
            <p>No authentication methods available.</p>
            <p>Install a Nostr browser extension (NIP-07) or use a remote signer (NIP-46).</p>
          </div>
        ) : (
          <div className="auth-options">
            {isNip07Available && (
              <button
                onClick={handleNip07Connect}
                disabled={loading || authState.isConnecting}
                className="auth-button nip07"
              >
                {loading ? 'Connecting...' : 'Connect with Extension'}
              </button>
            )}

            {isNip46Available && (
              <div className="nip46-section">
                <input
                  type="text"
                  placeholder="bunker://pubkey?relay=wss://..."
                  value={bunkerUrl}
                  onChange={(e) => setBunkerUrl(e.target.value)}
                  className="bunker-input"
                />
                <button
                  onClick={handleNip46Connect}
                  disabled={loading || authState.isConnecting || !bunkerUrl}
                  className="auth-button nip46"
                >
                  {loading ? 'Connecting...' : 'Connect with Remote Signer'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Main editor view - shown when authenticated
 */
function EditorView() {
  const { authState, signer, disconnect } = useNostrAuth()
  const [documentId] = useState(getDocumentId)

  if (!signer || !authState.pubkey) {
    return <div>Loading...</div>
  }

  return (
    <div className="app">
      <header>
        <div className="header-content">
          <h1>Cloistr Docs</h1>
          <div className="user-info">
            <span className="pubkey">{nip19.npubEncode(authState.pubkey).slice(0, 16)}...</span>
            <span className="auth-method">({authState.method})</span>
            <button onClick={disconnect} className="disconnect-button">
              Disconnect
            </button>
          </div>
        </div>
      </header>

      <main>
        <Editor
          documentId={documentId}
          signer={signer}
          publicKey={authState.pubkey}
          relayUrl={DEFAULT_RELAY_URL}
        />
      </main>
    </div>
  )
}

/**
 * Root component with auth routing
 */
function AppContent() {
  const { authState, signer } = useNostrAuth()

  if (authState.isConnected && signer) {
    return <EditorView />
  }

  return <LoginScreen />
}

function App() {
  return (
    <AuthProvider autoRestore={true}>
      <AppContent />
    </AuthProvider>
  )
}

export default App
