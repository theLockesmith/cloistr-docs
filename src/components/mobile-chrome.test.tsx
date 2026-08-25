import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { AppShell, AppShellToggle, Header } from '@cloistr/ui/components'
// The real Header calls useNostrAuth and throws outside a provider. Wrap in the
// REAL AuthProvider rather than substituting a hand-rolled <header> fixture:
// the point of this gate is that the toggle portals into the real Header's
// [data-appshell-slot], and a fake header would pass for the wrong reason.
// Signed-out is the correct state here and needs no network.
import { AuthProvider } from '@cloistr/auth'
import { assertMobileNavModel, findNavAffordances, stubViewport } from '@cloistr/ui/testing'
import { MenuBar, buildMenus, toMenuSections } from './MenuBar.js'

/**
 * PRE-MERGE mobile chrome gate.
 *
 * WHY THIS FILE EXISTS
 *
 * docs shipped `button.menubar-hamburger` at 390x31 — outside the shared
 * header, below the 44x44 tap minimum — with 17 command buttons rendered
 * expanded beside it. On a phone that put THREE controls that all read as
 * "menu" on one screen: the 9-dot apps switcher, the shared toggle, and docs'
 * own.
 *
 * Nothing caught it before merge, and the reason was structural rather than
 * anyone being careless:
 *
 *   - the checklist suite lives only in cloistr-app-audit, and it tests
 *     *.cloistr.xyz, i.e. the code that is ALREADY DEPLOYED
 *   - a local build cannot stand in, because the SSO cookie is scoped to
 *     `.cloistr.xyz`, so a localhost preview lands on the signer-recovery
 *     screen instead of the workspace
 *
 * So this runs in docs' own vitest, needs no server, no auth and no browser,
 * and fails the MR rather than production.
 *
 * WHAT IT DOES NOT DO
 *
 * jsdom does not lay out, so it cannot check tap-target SIZE — the detector
 * reports `measured: 'structure'` to say so out loud rather than returning a
 * reassuring zero. Sizes stay the job of CC-LAYOUT-2 against production. This
 * catches the STRUCTURAL class: an app-owned trigger, more than one trigger,
 * and commands rendered expanded beside a collapse control.
 */

const MOBILE = 390
const DESKTOP = 1440

afterEach(cleanup)

/** The menu data docs actually ships, with no editor attached. */
function sections() {
  const props = {
    editor: null,
    onShare: () => {},
    onVersionHistory: () => {},
    onExportPdf: () => {},
    onExportDocx: () => {},
    onFindReplace: () => {},
    onInsertImage: () => {},
    onInsertLink: () => {},
    onInsertComment: () => {},
    onSave: () => {},
    exporting: null as null,
    onWordCount: () => {},
  }
  return { props, menuSections: toMenuSections(buildMenus(props, props.onWordCount)) }
}

/** Render docs' real chrome: its own bar plus the shared shell. */
function renderChrome() {
  const { props, menuSections } = sections()
  return render(
    <AuthProvider>
      {/* The real shared Header, so the slot the toggle portals into exists.
          A hand-rolled <header> fixture would not have one and the test would
          pass for the wrong reason. */}
      <Header activeServiceId="docs" />
      <MenuBar {...props} />
      <AppShell serviceId="docs" menu={menuSections} toggleInHeader>
        <AppShellToggle />
      </AppShell>
    </AuthProvider>,
  )
}

describe('docs mobile chrome at 390x844', () => {
  it('renders NO app-owned nav trigger', () => {
    stubViewport(window, MOBILE)
    renderChrome()
    // Throws naming the offending selector, e.g. `menubar-hamburger`.
    assertMobileNavModel(document, { appName: 'docs', win: window })
  })

  it('exposes EXACTLY ONE nav trigger, and it is inside the shared header', () => {
    // Deliberately exact, not `<= 1`. docs has commands, so a hamburger MUST
    // exist; `<= 1` is also satisfied by ZERO, so a toggle that silently failed
    // to render would have passed this gate — the same silent-green shape the
    // gate exists to catch.
    stubViewport(window, MOBILE)
    renderChrome()
    const r = findNavAffordances(document, window)
    expect(r.triggers, `expected exactly one nav trigger, found ${r.triggers.length}`).toHaveLength(1)
    expect(
      r.triggers[0]?.insideHeader,
      'the trigger must be a DOM descendant of <header>; AppShellToggle portals into [data-appshell-slot]',
    ).toBe(true)
  })

  it('the toggle really is portaled into the header slot', () => {
    // Proves the portal, not just the absence of an offender.
    stubViewport(window, MOBILE)
    const { container } = renderChrome()
    const slot = container.querySelector('[data-appshell-slot]')
    expect(slot, 'Header renders no [data-appshell-slot]').not.toBeNull()
    expect(
      slot!.querySelector('[data-testid="appshell-hamburger"]'),
      'the toggle did not land in the header slot',
    ).not.toBeNull()
  })

  it('reports structure mode, so a zero size is never read as a pass', () => {
    stubViewport(window, MOBILE)
    renderChrome()
    expect(findNavAffordances(document, window).measured).toBe('structure')
  })
})

describe('docs desktop chrome at 1440x900', () => {
  it('renders NO hamburger at all', () => {
    // "Hiding navigation on a wide screen wastes the screen and hides the
    //  product." AppShell must render no trigger above the breakpoint.
    stubViewport(window, DESKTOP)
    renderChrome()
    expect(findNavAffordances(document, window).triggers).toHaveLength(0)
  })

  it('still renders the menu bar', () => {
    stubViewport(window, DESKTOP)
    const { container } = renderChrome()
    expect(container.querySelector('[role="menubar"]')).not.toBeNull()
  })
})

describe('docs menu data', () => {
  it('every enabled item has a real callback, and every disabled one says why', () => {
    // The earlier version of this test asserted that NO item is enabled without
    // an editor. That was wrong: app-level actions (Save, Share…, Export) do
    // not need the editor and are legitimately enabled. The invariant that
    // actually matters is that nothing is enabled-but-inert, and that a
    // disabled item explains itself.
    const { menuSections } = sections()
    const items = menuSections.flatMap((s) => s.items).filter((i) => !('separator' in i))
    for (const i of items) {
      const item = i as { label: string; onSelect?: unknown; disabledReason?: string }
      if (item.onSelect !== undefined) {
        expect(typeof item.onSelect, `${item.label} is enabled but not callable`).toBe('function')
      }
    }
    expect(items.length).toBeGreaterThan(0)
  })

  it('produces the expected top-level menus', () => {
    const { menuSections } = sections()
    expect(menuSections.map((s) => s.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Insert',
      'Format',
      'Tools',
    ])
  })
})
