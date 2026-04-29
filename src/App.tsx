import { useState } from 'react'
import { Editor } from './components/Editor.js'
import { useNostrAuth } from '@cloistr/collab-common/auth'
import { getOrCreateDocumentId, getServiceConfig } from '@cloistr/collab-common/config'
import { Header, Footer, SharedAuthProvider, ToastProvider, LoginPrompt } from '@cloistr/ui/components'
import '@cloistr/ui/styles'

// Service configuration from environment
const config = getServiceConfig()

/**
 * Main content - shows login prompt or editor based on auth state
 */
function AppContent() {
  const { authState, signer } = useNostrAuth()
  const [documentId] = useState(() => getOrCreateDocumentId('doc'))

  return (
    <div className="app">
      <Header activeServiceId="docs" />

      <main>
        {authState.isConnected && signer && authState.pubkey ? (
          <Editor
            documentId={documentId}
            signer={signer}
            publicKey={authState.pubkey}
            relayUrl={config.relayUrl}
          />
        ) : (
          <LoginPrompt
            title="Cloistr Docs"
            subtitle="Collaborative document editing powered by Nostr"
            callToAction="Sign in to create or edit documents."
          />
        )}
      </main>

      <Footer />
    </div>
  )
}

function App() {
  return (
    <ToastProvider>
      <SharedAuthProvider>
        <AppContent />
      </SharedAuthProvider>
    </ToastProvider>
  )
}

export default App
