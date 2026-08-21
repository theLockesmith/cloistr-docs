import { useState } from 'react'
import { Editor } from './components/Editor.js'
import { DocumentLibrary } from './components/DocumentLibrary.js'
import { useNostrAuth } from '@cloistr/auth'
import { getServiceConfig } from '@cloistr/collab-common/config'
import { Header, Footer, SharedAuthProvider, ToastProvider, LoginPrompt, ThemeProvider } from '@cloistr/ui/components'
import '@cloistr/ui/styles'

// Service configuration from environment
const config = getServiceConfig()

/**
 * Read the docId search parameter from the current URL without using react-router.
 * Returns null if no docId is present.
 */
function getDocIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('docId')
}

/**
 * Push a new docId into the URL (without a full navigation) and return it.
 */
function setDocIdInUrl(docId: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('docId', docId)
  window.history.pushState({}, '', url.toString())
}

/**
 * Main content - shows login prompt, document library, or editor based on
 * auth state and URL parameters.
 */
function AppContent() {
  const { authState, signer } = useNostrAuth()

  // Track the active document ID in state (mirrors the URL param).
  // null = no document chosen → show library
  const [documentId, setDocumentId] = useState<string | null>(() => getDocIdFromUrl())

  const handleOpenDocument = (docId: string) => {
    setDocIdInUrl(docId)
    setDocumentId(docId)
  }

  // Auth flash fix: while the NIP-46 signer is still establishing its
  // connection (isConnecting), show a neutral loading state rather than the
  // sign-in prompt. Without this, the prompt can render for several seconds
  // while the nostrconnect handshake is in progress, then be replaced by the
  // editor — a jarring false-logout flash confirmed by Playwright.
  // Pattern matches the fix applied to cloistr-sheets.
  const showEditor = authState.isConnected && signer && authState.pubkey
  const showLogin = !authState.isConnected && !authState.isConnecting

  return (
    <div className="app">
      <Header activeServiceId="docs" />

      <main>
        {showEditor ? (
          documentId ? (
            <Editor
              documentId={documentId}
              signer={signer}
              publicKey={authState.pubkey!}
              relayUrl={config.relayUrl}
            />
          ) : (
            <DocumentLibrary
              publicKey={authState.pubkey!}
              relayUrl={config.relayUrl}
              onOpen={handleOpenDocument}
            />
          )
        ) : showLogin ? (
          <LoginPrompt
            title="Cloistr Docs"
            subtitle="Collaborative document editing powered by Nostr"
            callToAction="Sign in to create or edit documents."
          />
        ) : (
          // isConnecting=true: the nostrconnect handshake is in progress.
          // Show nothing — the SharedAuthProvider spinner is visible above us
          // in the tree while gateRestore is active, and once that gate lifts
          // this branch prevents the LoginPrompt from flashing before the
          // CONNECTED action settles into React state.
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '40vh',
              color: 'var(--cloistr-text-muted)',
            }}
          >
            <p>Connecting…</p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        {/* signerUrl is routed through the /signer/ nginx proxy (same-origin) so
            that POST /api/v1/nostrconnect/session is not blocked by CORS.
            The proxy forwards requests to https://signer.cloistr.xyz/ transparently,
            including the .cloistr.xyz domain cookies needed for session auth. */}
        <SharedAuthProvider signerUrl="/signer">
          <AppContent />
        </SharedAuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}

export default App
