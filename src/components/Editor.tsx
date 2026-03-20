import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { useEffect, useState } from 'react'
import * as Y from 'yjs'
import { useNostrAuth } from '../App.js'

interface EditorProps {
  documentId: string
}

export function Editor({ documentId }: EditorProps) {
  const { publicKey } = useNostrAuth()
  const [ydoc] = useState(() => new Y.Doc())
  const [provider, setProvider] = useState<any>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable the default history extension
        history: false,
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCursor.configure({
        provider: provider,
        user: {
          name: publicKey?.slice(0, 8) || 'Anonymous',
          color: `#${publicKey?.slice(-6) || '000000'}`,
        },
      }),
    ],
    content: '<p>Start writing your collaborative document...</p>',
  })

  useEffect(() => {
    // TODO: Implement WebSocket provider for Yjs sync via Nostr
    // This would connect to a Nostr relay and sync Y.Doc changes
    // For now, we'll just set up the basic structure

    // Placeholder for Nostr-based provider
    const mockProvider = {
      on: () => {},
      off: () => {},
      destroy: () => {},
    }

    setProvider(mockProvider)

    return () => {
      mockProvider.destroy()
    }
  }, [documentId, ydoc])

  return (
    <div className="editor-container">
      <div className="editor-toolbar">
        <button
          onClick={() => editor?.chain().focus().toggleBold().run()}
          className={editor?.isActive('bold') ? 'active' : ''}
        >
          Bold
        </button>
        <button
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          className={editor?.isActive('italic') ? 'active' : ''}
        >
          Italic
        </button>
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
      </div>

      <EditorContent editor={editor} />

      <div className="editor-status">
        <p>Document ID: {documentId}</p>
        <p>Connected users: 1 (you)</p>
      </div>
    </div>
  )
}

// Add styles for the toolbar
const style = document.createElement('style')
style.textContent = `
  .editor-container {
    max-width: 800px;
    margin: 0 auto;
  }

  .editor-toolbar {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.5rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.375rem;
    background-color: #f8fafc;
  }

  .editor-toolbar button {
    padding: 0.25rem 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.25rem;
    background-color: white;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .editor-toolbar button:hover {
    background-color: #f3f4f6;
  }

  .editor-toolbar button.active {
    background-color: #3b82f6;
    color: white;
    border-color: #3b82f6;
  }

  .editor-status {
    margin-top: 1rem;
    padding: 0.5rem;
    background-color: #f8fafc;
    border-radius: 0.375rem;
    font-size: 0.875rem;
    color: #64748b;
  }

  .editor-status p {
    margin: 0.25rem 0;
  }
`
document.head.appendChild(style)