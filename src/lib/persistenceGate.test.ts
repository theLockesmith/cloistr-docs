import { describe, it, expect } from 'vitest'
import { documentView, canSave, saveBlockedReason, saveFailure, type GateState } from './persistenceGate.js'

/**
 * Why this exists.
 *
 * collab-common 0.7.1 refuses to save until the document has loaded, and
 * reports a load that failed (including a relay that connects but never
 * answers) as loadStatus 'failed' instead of pretending it found a new, empty
 * document. Before that, a slow or silent relay looked like "no document", the
 * editor came up blank, and the next save replaced the real document with the
 * blank one.
 *
 * This module is the app's half: it decides what the editor shows and whether
 * a save may be attempted, from the hook's state, in one place every save path
 * (button, menu, Ctrl+S) goes through.
 */

function state(over: Partial<GateState> = {}): GateState {
  return { loadStatus: 'idle', loadError: null, saving: false, error: null, ...over }
}

describe('documentView', () => {
  it('shows loading until the load settles', () => {
    expect(documentView(state({ loadStatus: 'idle' }))).toBe('loading')
    expect(documentView(state({ loadStatus: 'loading' }))).toBe('loading')
  })

  it('shows the editor only once loaded', () => {
    expect(documentView(state({ loadStatus: 'loaded' }))).toBe('ready')
  })

  it('shows an error, never a blank editor, when the load failed', () => {
    expect(documentView(state({ loadStatus: 'failed', loadError: new Error('timed out') }))).toBe('failed')
  })
})

describe('save gate', () => {
  it('refuses to save before the document has loaded', () => {
    for (const loadStatus of ['idle', 'loading'] as const) {
      expect(canSave(state({ loadStatus }))).toBe(false)
      expect(saveBlockedReason(state({ loadStatus }))).toMatch(/still loading/i)
    }
  })

  it('refuses to save a document that failed to load', () => {
    const s = state({ loadStatus: 'failed', loadError: new Error('timed out') })
    expect(canSave(s)).toBe(false)
    expect(saveBlockedReason(s)).toMatch(/could not be opened/i)
  })

  it('refuses a second save while one is in flight', () => {
    const s = state({ loadStatus: 'loaded', saving: true })
    expect(canSave(s)).toBe(false)
    expect(saveBlockedReason(s)).toMatch(/already saving/i)
  })

  it('allows a save once loaded', () => {
    const s = state({ loadStatus: 'loaded' })
    expect(canSave(s)).toBe(true)
    expect(saveBlockedReason(s)).toBeNull()
  })
})

describe('saveFailure', () => {
  it('reports a save error once the document is loaded', () => {
    const err = new Error('blossom down')
    expect(saveFailure(state({ loadStatus: 'loaded', error: err }))).toBe(err)
  })

  it('does not report a load failure as a save failure', () => {
    // collab-common copies load failures into `error` too; the load-failed
    // view owns those, so they must not also surface as "could not save".
    const err = new Error('timed out')
    expect(saveFailure(state({ loadStatus: 'failed', loadError: err, error: err }))).toBeNull()
  })
})
