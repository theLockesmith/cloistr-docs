/**
 * SearchAndReplace TipTap extension.
 *
 * Implements find/replace using a ProseMirror plugin that:
 *  - Tracks {term, caseSensitive, currentIndex, matches} in plugin state.
 *  - Rebuilds DecorationSet on every relevant transaction.
 *  - Exposes TipTap commands for setSearchTerm, findNext, findPrevious,
 *    replaceOne, replaceAll, and clearSearch.
 *
 * Decorations:
 *  - All matches: class "search-match" (yellow background).
 *  - Active match: class "search-match search-match--active" (orange).
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface SearchPluginState {
  term: string
  caseSensitive: boolean
  /** All text ranges in the document matching the current term */
  matches: Array<{ from: number; to: number }>
  /** Index into `matches` currently highlighted as "active" */
  currentIndex: number
  decorations: DecorationSet
}

export const searchPluginKey = new PluginKey<SearchPluginState>('searchAndReplace')

/** Metadata key written on transactions that carry a search-term update. */
const SEARCH_META = 'searchAndReplace'

interface SearchMeta {
  term?: string
  caseSensitive?: boolean
  /** Ask the plugin to advance to the next/prev match (signed int). */
  advance?: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMatches(
  doc: ProseMirrorNode,
  term: string,
  caseSensitive: boolean,
): Array<{ from: number; to: number }> {
  if (!term) return []
  const results: Array<{ from: number; to: number }> = []
  const needle = caseSensitive ? term : term.toLowerCase()

  doc.descendants((node, pos) => {
    if (!node.isText) return
    const haystack = caseSensitive ? node.text! : node.text!.toLowerCase()
    let offset = 0
    while (offset < haystack.length) {
      const idx = haystack.indexOf(needle, offset)
      if (idx === -1) break
      results.push({ from: pos + idx, to: pos + idx + needle.length })
      offset = idx + needle.length
    }
  })

  return results
}

function buildDecorations(
  doc: ProseMirrorNode,
  matches: Array<{ from: number; to: number }>,
  currentIndex: number,
): DecorationSet {
  if (!matches.length) return DecorationSet.empty

  const decorations = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === currentIndex ? 'search-match search-match--active' : 'search-match',
    }),
  )

  return DecorationSet.create(doc, decorations)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const searchPlugin = new Plugin<SearchPluginState>({
  key: searchPluginKey,

  state: {
    init(_config, state): SearchPluginState {
      return {
        term: '',
        caseSensitive: false,
        matches: [],
        currentIndex: -1,
        decorations: DecorationSet.empty,
      }
    },

    apply(tr: Transaction, prev: SearchPluginState, _oldState: EditorState, newState: EditorState): SearchPluginState {
      const meta = tr.getMeta(SEARCH_META) as SearchMeta | undefined

      let { term, caseSensitive, matches, currentIndex } = prev

      if (meta) {
        if (meta.term !== undefined) term = meta.term
        if (meta.caseSensitive !== undefined) caseSensitive = meta.caseSensitive
      }

      // Rebuild matches when doc changes or term changes.
      const termChanged = meta?.term !== undefined || meta?.caseSensitive !== undefined
      const docChanged = tr.docChanged

      if (termChanged || docChanged) {
        matches = findMatches(newState.doc, term, caseSensitive)
        // Keep currentIndex in bounds; reset to 0 if we have matches.
        currentIndex = matches.length > 0 ? 0 : -1
      }

      // Advance (findNext / findPrevious).
      if (meta?.advance !== undefined && matches.length > 0) {
        currentIndex = ((currentIndex + meta.advance) % matches.length + matches.length) % matches.length
      }

      const decorations = buildDecorations(newState.doc, matches, currentIndex)

      return { term, caseSensitive, matches, currentIndex, decorations }
    },
  },

  props: {
    decorations(state: EditorState): DecorationSet | null {
      return this.getState(state)?.decorations ?? DecorationSet.empty
    },
  },
})

// ---------------------------------------------------------------------------
// TipTap extension
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchAndReplace: {
      /** Set the search term (empty string clears the search). */
      setSearchTerm: (term: string, opts?: { caseSensitive?: boolean }) => ReturnType
      /** Clear the search term and all highlights. */
      clearSearch: () => ReturnType
      /** Move to the next match. */
      findNext: () => ReturnType
      /** Move to the previous match. */
      findPrevious: () => ReturnType
      /** Replace the current (active) match with `replacement`. */
      replaceOne: (replacement: string) => ReturnType
      /** Replace every match in the document with `replacement`. */
      replaceAll: (replacement: string) => ReturnType
    }
  }
}

export const SearchAndReplace = Extension.create({
  name: 'searchAndReplace',

  addProseMirrorPlugins() {
    return [searchPlugin]
  },

  addCommands() {
    return {
      setSearchTerm:
        (term: string, opts?: { caseSensitive?: boolean }) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SEARCH_META, { term, caseSensitive: opts?.caseSensitive ?? false })
            dispatch(tr)
          }
          return true
        },

      clearSearch:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(SEARCH_META, { term: '' })
            dispatch(tr)
          }
          return true
        },

      findNext:
        () =>
        ({ tr, dispatch, state }) => {
          const pluginState = searchPluginKey.getState(state)
          if (!pluginState?.matches.length) return false
          if (dispatch) {
            tr.setMeta(SEARCH_META, { advance: 1 })
            dispatch(tr)
          }
          return true
        },

      findPrevious:
        () =>
        ({ tr, dispatch, state }) => {
          const pluginState = searchPluginKey.getState(state)
          if (!pluginState?.matches.length) return false
          if (dispatch) {
            tr.setMeta(SEARCH_META, { advance: -1 })
            dispatch(tr)
          }
          return true
        },

      replaceOne:
        (replacement: string) =>
        ({ tr, dispatch, state }) => {
          const pluginState = searchPluginKey.getState(state)
          if (!pluginState || pluginState.currentIndex < 0 || !pluginState.matches.length) return false
          const match = pluginState.matches[pluginState.currentIndex]
          if (!match) return false
          if (dispatch) {
            tr.replaceWith(match.from, match.to, state.schema.text(replacement))
            dispatch(tr)
          }
          return true
        },

      replaceAll:
        (replacement: string) =>
        ({ tr, dispatch, state }) => {
          const pluginState = searchPluginKey.getState(state)
          if (!pluginState?.matches.length) return false
          if (dispatch) {
            // Replace in reverse so positions remain valid.
            const sorted = [...pluginState.matches].sort((a, b) => b.from - a.from)
            for (const m of sorted) {
              tr.replaceWith(m.from, m.to, state.schema.text(replacement))
            }
            dispatch(tr)
          }
          return true
        },
    }
  },
})
