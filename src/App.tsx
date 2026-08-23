import { useState, useEffect, useRef } from 'react'
import { Editor } from './components/Editor.js'
import { DocumentLibrary } from './components/DocumentLibrary.js'
import { useNostrAuth } from '@cloistr/auth'
import { getServiceConfig } from '@cloistr/collab-common/config'
import {
  Header,
  Footer,
  SharedAuthProvider,
  ToastProvider,
  LoginPrompt,
  ThemeProvider,
  SignerRecovery,
  useSharedSession,
} from '@cloistr/ui/components'
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
  const { isResolving } = useSharedSession()

  // Track the active document ID in state (mirrors the URL param).
  // null = no document chosen -> show library
  const [documentId, setDocumentId] = useState<string | null>(() => getDocIdFromUrl())

  // Auth has THREE states, not two. Treating every "not yet connected" frame as
  // "needs login" is the root cause of the false-logout problem: the NIP-46
  // handshake runs after SharedAuthProvider's silent SSO restore lifts its gate,
  // so there is a window where isConnecting is true but isConnected is false,
  // and a second window (for a shared-session restore) where isResolving is true.
  // Both windows must stay silent so the user never sees the login screen during
  // a valid session.
  const isConnecting = !!authState.isConnecting || !!authState.isSwitching || isResolving

  // Detect a connection attempt that STARTED (isConnecting went true) and then
  // ENDED without succeeding (isConnected is still false). That is a signer or
  // relay failure -- NOT an authentication failure -- and must be surfaced as
  // SignerRecovery, never as a login screen.
  //
  // Pattern from cloistr-stash: track whether we were ever in connecting state
  // via a ref, then detect the transition to "stopped connecting but not
  // connected" and set connectFailed.
  const [connectFailed, setConnectFailed] = useState(false)
  const wasConnecting = useRef(false)

  useEffect(() => {
    if (isConnecting) {
      wasConnecting.current = true
      setConnectFailed(false)
      return
    }
    if (wasConnecting.current && !authState.isConnected) {
      wasConnecting.current = false
      setConnectFailed(true)
    }
  }, [isConnecting, authState.isConnected])

  const handleOpenDocument = (docId: string) => {
    setDocIdInUrl(docId)
    setDocumentId(docId)
  }

  const handleBack = () => {
    const url = new URL(window.location.href)
    url.searchParams.delete('docId')
    window.history.pushState({}, '', url.toString())
    setDocumentId(null)
  }

  const showEditor = authState.isConnected && signer && authState.pubkey
  // Show login only when we are definitively not connected and no connection
  // attempt is in progress and there was no failed attempt outstanding.
  const showLogin = !authState.isConnected && !isConnecting && !connectFailed

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
              onBack={handleBack}
            />
          ) : (
            <DocumentLibrary
              publicKey={authState.pubkey!}
              relayUrl={config.relayUrl}
              onOpen={handleOpenDocument}
            />
          )
        ) : isConnecting ? (
          // isConnecting=true: the nostrconnect handshake is in progress (or
          // the shared session restore is running). Show nothing visible --
          // the SharedAuthProvider spinner is visible in the tree while
          // gateRestore is active, and once that gate lifts this branch
          // prevents LoginPrompt from flashing before the CONNECTED action
          // settles into React state. Pattern confirmed by Playwright on
          // cloistr-sheets.
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '40vh',
              color: 'var(--cloistr-text-muted)',
            }}
          >
            <p>Connecting&hellip;</p>
          </div>
        ) : connectFailed ? (
          // The connection attempt started but did not succeed -- relay
          // unreachable, socket dropped, approval timed out. The session is
          // still valid. Show the "uh-oh" panel that offers Retry and Go back,
          // and NEVER a credential prompt.
          <SignerRecovery
            error={{ code: 'CONNECTION_FAILED' }}
            retrying={isConnecting}
            onRetry={() => {
              setConnectFailed(false)
              window.location.reload()
            }}
            onGoBack={() => setConnectFailed(false)}
          />
        ) : showLogin ? (
          <LoginPrompt
            title="Cloistr Docs"
            subtitle="Collaborative document editing powered by Nostr"
            callToAction="Sign in to create or edit documents."
          />
        ) : (
          // Should not be reached in normal flow, but guard against any edge
          // state where all three conditions above are false.
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '40vh',
              color: 'var(--cloistr-text-muted)',
            }}
          >
            <p>Connecting&hellip;</p>
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
