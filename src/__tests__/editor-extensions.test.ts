/**
 * editor-extensions.test.ts
 *
 * Verifies that the rich-text extensions added in this pass are correctly
 * wired into a TipTap editor instance.
 *
 * This is a pure-JS test: no DOM rendering, no auth, no Yjs sync. It creates
 * a headless TipTap editor (JSDOM environment) with the same extension list
 * used by the Editor component and then exercises each new feature via the
 * command API + serialised HTML output.
 *
 * REVERT PROOF: remove any one of the extension imports from this test setup
 * and the corresponding assertion will fail. Run `npm test` to confirm.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'

/** Create a headless TipTap editor with all extensions active. */
function makeEditor(): Editor {
  return new Editor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: '',
    // headless: no DOM element needed for these tests
    element: document.createElement('div'),
  })
}

describe('rich-text extensions', () => {
  let editor: Editor

  beforeEach(() => {
    editor = makeEditor()
  })

  afterEach(() => {
    editor.destroy()
  })

  // ---- Strikethrough (StarterKit, no new dependency) ----

  it('applies and removes strikethrough via toggleStrike', () => {
    editor.commands.setContent('<p>hello</p>')
    editor.commands.selectAll()
    editor.commands.toggleStrike()
    expect(editor.getHTML()).toContain('<s>')
    editor.commands.toggleStrike()
    expect(editor.getHTML()).not.toContain('<s>')
  })

  // ---- Inline code (StarterKit, no new dependency) ----

  it('applies and removes inline code via toggleCode', () => {
    editor.commands.setContent('<p>hello</p>')
    editor.commands.selectAll()
    editor.commands.toggleCode()
    expect(editor.getHTML()).toContain('<code>')
    editor.commands.toggleCode()
    expect(editor.getHTML()).not.toContain('<code>')
  })

  // ---- Underline (@tiptap/extension-underline) ----

  it('applies and removes underline via toggleUnderline', () => {
    editor.commands.setContent('<p>hello</p>')
    editor.commands.selectAll()
    // The command exists only when the extension is registered.
    expect(editor.commands.toggleUnderline).toBeDefined()
    editor.commands.toggleUnderline()
    expect(editor.getHTML()).toContain('<u>')
    editor.commands.toggleUnderline()
    expect(editor.getHTML()).not.toContain('<u>')
  })

  // ---- Link (@tiptap/extension-link) ----

  it('sets and unsets a hyperlink via setLink / unsetLink', () => {
    editor.commands.setContent('<p>click me</p>')
    editor.commands.selectAll()
    expect(editor.commands.setLink).toBeDefined()
    editor.commands.setLink({ href: 'https://cloistr.xyz' })
    const withLink = editor.getHTML()
    expect(withLink).toContain('href="https://cloistr.xyz"')
    editor.commands.unsetLink()
    expect(editor.getHTML()).not.toContain('href=')
  })

  // ---- Tables (@tiptap/extension-table and sub-packages) ----

  it('inserts a table with a header row via insertTable', () => {
    expect(editor.commands.insertTable).toBeDefined()
    editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
    const html = editor.getHTML()
    // Must contain both a header cell and a data cell
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<td')
  })

  it('adds a column after the current one via addColumnAfter', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    // Count <td> before
    const before = (editor.getHTML().match(/<td/g) ?? []).length
    editor.commands.addColumnAfter()
    const after = (editor.getHTML().match(/<td/g) ?? []).length
    // One extra td per data row (1 data row -> +1 td)
    expect(after).toBeGreaterThan(before)
  })

  it('adds a row after the current one via addRowAfter', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    const trBefore = (editor.getHTML().match(/<tr/g) ?? []).length
    editor.commands.addRowAfter()
    const trAfter = (editor.getHTML().match(/<tr/g) ?? []).length
    expect(trAfter).toBe(trBefore + 1)
  })

  it('deletes the table via deleteTable', () => {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    expect(editor.getHTML()).toContain('<table')
    editor.commands.deleteTable()
    expect(editor.getHTML()).not.toContain('<table')
  })
})
