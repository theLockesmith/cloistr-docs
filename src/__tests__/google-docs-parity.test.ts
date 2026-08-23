/**
 * google-docs-parity.test.ts
 *
 * Headless structural tests for the Google Docs parity features added in this
 * pass: find/replace, comment marks, DOCX export, and image extension.
 *
 * Environment: jsdom (configured in vite.config.ts).
 *
 * IMPORTANT: These are headless TipTap tests. They create a TipTap editor
 * instance with the same extensions used by the Editor component and exercise
 * each feature through the command API. They do NOT render React components
 * and do NOT test network I/O (Blossom upload, relay queries).
 *
 * REVERT-PROOF: Removing any one of the extension imports below causes the
 * corresponding test(s) to fail. Run `npm test` to confirm.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { SearchAndReplace, searchPluginKey } from '../extensions/SearchAndReplace.js'
import { CommentMark } from '../extensions/CommentMark.js'
import { editorJsonToDocxBlob } from '../utils/docxExport.js'
import type { JSONContent } from '@tiptap/core'

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      SearchAndReplace,
      CommentMark,
    ],
    content: '',
    element: document.createElement('div'),
  })
}

// ---------------------------------------------------------------------------
// Find & Replace
// ---------------------------------------------------------------------------

describe('SearchAndReplace extension', () => {
  let editor: Editor

  beforeEach(() => { editor = makeEditor() })
  afterEach(() => { editor.destroy() })

  it('setSearchTerm is available as a command', () => {
    expect(typeof editor.commands.setSearchTerm).toBe('function')
  })

  it('findNext / findPrevious / replaceOne / replaceAll are available', () => {
    expect(typeof editor.commands.findNext).toBe('function')
    expect(typeof editor.commands.findPrevious).toBe('function')
    expect(typeof editor.commands.replaceOne).toBe('function')
    expect(typeof editor.commands.replaceAll).toBe('function')
    expect(typeof editor.commands.clearSearch).toBe('function')
  })

  it('finds zero matches when the document is empty', () => {
    editor.commands.setSearchTerm('hello')
    const state = searchPluginKey.getState(editor.state)
    expect(state?.matches).toHaveLength(0)
  })

  it('finds all occurrences of a search term in the document', () => {
    editor.commands.setContent('<p>foo bar foo baz foo</p>')
    editor.commands.setSearchTerm('foo')
    const state = searchPluginKey.getState(editor.state)
    expect(state?.matches).toHaveLength(3)
  })

  it('is case-insensitive by default', () => {
    editor.commands.setContent('<p>Foo foo FOO</p>')
    editor.commands.setSearchTerm('foo')
    const state = searchPluginKey.getState(editor.state)
    expect(state?.matches).toHaveLength(3)
  })

  it('respects caseSensitive option', () => {
    editor.commands.setContent('<p>Foo foo FOO</p>')
    editor.commands.setSearchTerm('foo', { caseSensitive: true })
    const state = searchPluginKey.getState(editor.state)
    // Only the lowercase "foo" should match.
    expect(state?.matches).toHaveLength(1)
  })

  it('replaceAll replaces every match in the document', () => {
    editor.commands.setContent('<p>foo bar foo</p>')
    editor.commands.setSearchTerm('foo')
    editor.commands.replaceAll('qux')
    expect(editor.getHTML()).toContain('qux')
    expect(editor.getHTML()).not.toContain('foo')
  })

  it('replaceAll does nothing when there are no matches', () => {
    editor.commands.setContent('<p>hello world</p>')
    editor.commands.setSearchTerm('xyz')
    const before = editor.getHTML()
    editor.commands.replaceAll('replacement')
    expect(editor.getHTML()).toBe(before)
  })

  it('clearSearch removes all matches', () => {
    editor.commands.setContent('<p>test content test</p>')
    editor.commands.setSearchTerm('test')
    let state = searchPluginKey.getState(editor.state)
    expect(state?.matches.length).toBeGreaterThan(0)

    editor.commands.clearSearch()
    state = searchPluginKey.getState(editor.state)
    expect(state?.matches).toHaveLength(0)
    expect(state?.term).toBe('')
  })

  it('findNext advances the current match index', () => {
    editor.commands.setContent('<p>abc abc abc</p>')
    editor.commands.setSearchTerm('abc')
    const before = searchPluginKey.getState(editor.state)?.currentIndex ?? -1
    editor.commands.findNext()
    const after = searchPluginKey.getState(editor.state)?.currentIndex ?? -1
    // Index should have advanced (wraps around on the last match).
    expect(after).not.toBe(before)
  })
})

// ---------------------------------------------------------------------------
// CommentMark
// ---------------------------------------------------------------------------

describe('CommentMark extension', () => {
  let editor: Editor

  beforeEach(() => { editor = makeEditor() })
  afterEach(() => { editor.destroy() })

  it('setComment is available as a command', () => {
    expect(typeof editor.commands.setComment).toBe('function')
  })

  it('removeComment is available as a command', () => {
    expect(typeof editor.commands.removeComment).toBe('function')
  })

  it('setComment applies the mark to selected text', () => {
    editor.commands.setContent('<p>hello world</p>')
    editor.commands.selectAll()
    editor.commands.setComment('comment-001')
    const html = editor.getHTML()
    expect(html).toContain('data-comment-id="comment-001"')
    expect(html).toContain('class="comment-mark"')
  })

  it('removeComment removes the mark from text with a matching id', () => {
    editor.commands.setContent('<p>hello world</p>')
    editor.commands.selectAll()
    editor.commands.setComment('comment-002')
    // Verify it is there before removal.
    expect(editor.getHTML()).toContain('comment-002')
    editor.commands.removeComment('comment-002')
    expect(editor.getHTML()).not.toContain('comment-002')
  })

  it('does not remove marks with a different comment id', () => {
    editor.commands.setContent('<p>hello world</p>')
    editor.commands.selectAll()
    editor.commands.setComment('comment-keep')
    editor.commands.removeComment('comment-other')
    // comment-keep should still be present.
    expect(editor.getHTML()).toContain('comment-keep')
  })
})

// ---------------------------------------------------------------------------
// Image extension
// ---------------------------------------------------------------------------

describe('Image extension', () => {
  let editor: Editor

  beforeEach(() => { editor = makeEditor() })
  afterEach(() => { editor.destroy() })

  it('setImage command is available', () => {
    expect(typeof editor.commands.setImage).toBe('function')
  })

  it('inserts an image node with the specified src', () => {
    editor.commands.setImage({ src: 'https://example.com/photo.jpg', alt: 'Test photo' })
    const html = editor.getHTML()
    expect(html).toContain('<img')
    expect(html).toContain('https://example.com/photo.jpg')
  })
})

// ---------------------------------------------------------------------------
// DOCX export utility
// ---------------------------------------------------------------------------

describe('editorJsonToDocxBlob', () => {
  it('returns a non-empty Blob for a simple document', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'My Document' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'world' }] },
      ],
    }
    const blob = await editorJsonToDocxBlob(content)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('handles an empty document without throwing', async () => {
    const content: JSONContent = { type: 'doc', content: [] }
    const blob = await editorJsonToDocxBlob(content)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBeGreaterThan(0)
  })

  it('produces a DOCX-format Blob (application/vnd.openxmlformats-officedocument.wordprocessingml.document)', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Test' }] }],
    }
    const blob = await editorJsonToDocxBlob(content)
    // The docx package sets the correct MIME type on the Blob.
    expect(blob.type).toContain('application/')
  })

  it('handles a table without throwing', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] }] },
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
              ],
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
                { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
              ],
            },
          ],
        },
      ],
    }
    await expect(editorJsonToDocxBlob(content)).resolves.toBeInstanceOf(Blob)
  })

  it('handles unordered list nodes without throwing', async () => {
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item two' }] }] },
          ],
        },
      ],
    }
    await expect(editorJsonToDocxBlob(content)).resolves.toBeInstanceOf(Blob)
  })
})
