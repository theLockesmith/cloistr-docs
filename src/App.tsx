import { useState, useEffect, createContext, useContext, type ReactNode } from 'react'
import { Editor } from './components/Editor.js'
import { generateSecretKey, getPublicKey, finalizeEvent, nip19 } from 'nostr-tools'
import type { SignerInterface } from '@cloistr/collab-common'
import type { Event, UnsignedEvent } from 'nostr-tools'

// Auth context providing signer and relay config
interface AuthContextType {
  signer: SignerInterface
  publicKey: string
  relayUrl: string
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
  children: ReactNode
  relayUrl: string
  signer: SignerInterface
  publicKey: string
}

function AuthProvider({ children, relayUrl, signer, publicKey }: AuthProviderProps) {
  return (
    <AuthContext.Provider value={{ signer, publicKey, relayUrl }}>
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

/**
 * Create a SignerInterface from a private key
 * In production, this would be replaced with NIP-46 or NIP-07 signer
 */
function createLocalSigner(privateKey: Uint8Array): SignerInterface {
  const pubkey = getPublicKey(privateKey)

  return {
    async getPublicKey(): Promise<string> {
      return pubkey
    },
    async signEvent(event: UnsignedEvent): Promise<Event> {
      return finalizeEvent(event, privateKey)
    },
    async encrypt(_pubkey: string, _plaintext: string): Promise<string> {
      throw new Error('Encryption not implemented for local signer')
    },
    async decrypt(_pubkey: string, _ciphertext: string): Promise<string> {
      throw new Error('Decryption not implemented for local signer')
    },
  }
}

function App() {
  const [authConfig, setAuthConfig] = useState<{
    relayUrl: string
    signer: SignerInterface
    publicKey: string
  } | null>(null)

  useEffect(() => {
    // Generate a session key for demo purposes
    // In production, this would connect to coldforge-signer via NIP-46
    const privateKey = generateSecretKey()
    const publicKey = getPublicKey(privateKey)
    const signer = createLocalSigner(privateKey)

    setAuthConfig({
      relayUrl: 'wss://nos.lol', // Public relay for demo
      signer,
      publicKey
    })
  }, [])

  if (!authConfig) {
    return <div>Loading...</div>
  }

  return (
    <AuthProvider
      relayUrl={authConfig.relayUrl}
      signer={authConfig.signer}
      publicKey={authConfig.publicKey}
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
