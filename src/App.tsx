import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { Editor } from './components/Editor.js'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

// Temporary Auth Context until cloistr-collab-common exports are ready
interface AuthContextType {
  privateKey: Uint8Array
  publicKey: string
  relayUrl: string
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
  relayUrl: string
  privateKey: Uint8Array
}

function AuthProvider({ children, relayUrl, privateKey }: AuthProviderProps) {
  const publicKey = getPublicKey(privateKey)

  return (
    <AuthContext.Provider value={{ privateKey, publicKey, relayUrl }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useNostrAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useNostrAuth must be used within AuthProvider')
  }
  return context
}

function App() {
  const [authConfig, setAuthConfig] = useState<{
    relayUrl: string
    privateKey: Uint8Array
    publicKey: string
  } | null>(null)

  useEffect(() => {
    // For demo purposes, generate a temporary key pair
    // In production, this would use coldforge-signer
    const privateKey = generateSecretKey()
    const publicKey = getPublicKey(privateKey)

    setAuthConfig({
      relayUrl: 'wss://relay.cloistr.xyz', // Placeholder relay URL
      privateKey,
      publicKey
    })
  }, [])

  if (!authConfig) {
    return <div>Loading...</div>
  }

  return (
    <AuthProvider
      relayUrl={authConfig.relayUrl}
      privateKey={authConfig.privateKey}
    >
      <div className="app">
        <header>
          <h1>Cloistr Docs</h1>
          <p>Collaborative document editing powered by Nostr</p>
          <p>
            <small>
              Public Key: {nip19.npubEncode(authConfig.publicKey)}
            </small>
          </p>
        </header>

        <main>
          <Editor documentId="demo-document" />
        </main>
      </div>
    </AuthProvider>
  )
}

export default App