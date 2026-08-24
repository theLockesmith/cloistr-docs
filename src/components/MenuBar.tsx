/**
 * MenuBar — persistent Google Docs-style menu bar for Cloistr Docs.
 *
 * Desktop (>= 641px): horizontal bar with File, Edit, View, Insert, Format, Tools.
 *   Keyboard contract (WAI-ARIA 1.2 menubar / menu patterns):
 *     - Tab: focus enters / leaves the menubar.
 *     - Left / Right: move between top-level triggers (wraps).
 *     - Enter / Space / ArrowDown on trigger: open menu, focus first enabled item.
 *     - Up / Down in open menu: navigate items (wraps).
 *     - Home / End: jump to first / last enabled item.
 *     - Left / Right in open menu: close this menu, open prev / next.
 *     - Enter on item: activate item, close menu.
 *     - Escape: close menu, return focus to its trigger.
 *     - Tab in open menu: close menu (natural tab flow continues).
 *
 * Mobile (<= 640px): a single "Menu" button opens a full-width accordion panel
 *   where each of the six menus is a collapsible section.  This avoids a
 *   horizontal bar that truncates at 390 px.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/react'
import type { MenuSection, MenuEntry } from '@cloistr/ui/components'

// ---------------------------------------------------------------------------
// Prop types
// ---------------------------------------------------------------------------

export interface MenuBarProps {
  editor: TipTapEditor | null
  /** Return to the document library (creates a new document context). */
  onNewDocument?: () => void
  onShare: () => void
  onVersionHistory: () => void
  onExportPdf: () => void
  onExportDocx: () => void
  /** Toggle the find-and-replace panel. */
  onFindReplace: () => void
  onInsertImage: () => void
  onInsertLink: () => void
  /** Add a comment on the current text selection. */
  onInsertComment: () => void
  onSave: () => void
  exporting: 'pdf' | 'docx' | null
  /**
   * Opens the word-count modal. Lifted out of MenuBar so the SAME callback
   * reaches the shell's mobile drawer. When it lived as MenuBar-local state the
   * mobile menu could only be handed a no-op, which would have made "Word
   * count" an enabled item that does nothing — the exact shape the navigation
   * model forbids, and worse than omitting it.
   */
  onWordCount: () => void
}

// ---------------------------------------------------------------------------
// Menu data model
// ---------------------------------------------------------------------------

interface ActionItem {
  id: string
  label: string
  shortcut?: string
  /** null = rendered as disabled; undefined = enabled but editor not ready */
  action: (() => void) | null
  tooltip?: string
  /** Show a checkmark — used for toggle-style format items. */
  active?: boolean
}

interface SeparatorItem {
  id: string
  separator: true
}

type MenuItem = ActionItem | SeparatorItem

interface Menu {
  id: string
  label: string
  items: MenuItem[]
}

function isSep(item: MenuItem): item is SeparatorItem {
  return 'separator' in item && item.separator === true
}

const sep = (id: string): SeparatorItem => ({ id, separator: true })

// ---------------------------------------------------------------------------
// Build menu structure
// ---------------------------------------------------------------------------

export function buildMenus(
  props: MenuBarProps,
  onWordCount: () => void,
): Menu[] {
  const {
    editor,
    onNewDocument,
    onShare,
    onVersionHistory,
    onExportPdf,
    onExportDocx,
    onFindReplace,
    onInsertImage,
    onInsertLink,
    onInsertComment,
    onSave,
    exporting,
  } = props

  // editor.can().undo/redo returns false when the Y.js undo stack is empty.
  const canUndo = editor ? (editor.can().undo() as boolean) : false
  const canRedo = editor ? (editor.can().redo() as boolean) : false
  const busy = exporting !== null

  return [
    // ---- File ----
    {
      id: 'file',
      label: 'File',
      items: [
        ...(onNewDocument
          ? [
              {
                id: 'new',
                label: 'New document',
                action: onNewDocument,
              } satisfies ActionItem,
              sep('sep-new'),
            ]
          : []),
        { id: 'save', label: 'Save', shortcut: 'Ctrl+S', action: () => onSave() },
        { id: 'share', label: 'Share…', action: () => onShare() },
        { id: 'version-history', label: 'Version history', action: () => onVersionHistory() },
        sep('sep-export'),
        {
          id: 'export-pdf',
          label: 'Download as PDF',
          action: busy ? null : () => onExportPdf(),
          tooltip: busy ? 'Export in progress' : undefined,
        },
        {
          id: 'export-docx',
          label: 'Download as DOCX',
          action: busy || !editor ? null : () => onExportDocx(),
          tooltip: busy ? 'Export in progress' : undefined,
        },
        sep('sep-print'),
        { id: 'print', label: 'Print', shortcut: 'Ctrl+P', action: () => window.print() },
      ] as MenuItem[],
    },

    // ---- Edit ----
    {
      id: 'edit',
      label: 'Edit',
      items: [
        {
          id: 'undo',
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: canUndo && editor ? () => editor.commands.undo() : null,
        },
        {
          id: 'redo',
          label: 'Redo',
          shortcut: 'Ctrl+Shift+Z',
          action: canRedo && editor ? () => editor.commands.redo() : null,
        },
        sep('sep-find'),
        {
          id: 'find-replace',
          label: 'Find and replace',
          shortcut: 'Ctrl+F',
          action: () => onFindReplace(),
        },
      ] as MenuItem[],
    },

    // ---- View ----
    {
      id: 'view',
      label: 'View',
      items: [
        {
          id: 'fullscreen',
          label: document.fullscreenElement ? 'Exit full screen' : 'Full screen',
          shortcut: 'F11',
          action: () => {
            if (document.fullscreenElement) {
              void document.exitFullscreen()
            } else {
              void document.documentElement.requestFullscreen()
            }
          },
        },
        sep('sep-layout'),
        {
          id: 'print-layout',
          label: 'Print layout',
          action: null,
          tooltip: 'Coming soon',
        },
        {
          id: 'outline',
          label: 'Outline',
          action: null,
          tooltip: 'Coming soon',
        },
      ] as MenuItem[],
    },

    // ---- Insert ----
    {
      id: 'insert',
      label: 'Insert',
      items: [
        { id: 'image', label: 'Image…', action: () => onInsertImage() },
        {
          id: 'table',
          label: 'Table',
          action: editor
            ? () =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
            : null,
        },
        { id: 'link', label: 'Link…', shortcut: 'Ctrl+K', action: () => onInsertLink() },
        sep('sep-comment'),
        {
          id: 'comment',
          label: 'Comment',
          action: () => onInsertComment(),
          tooltip: 'Select text first, then insert a comment',
        },
        sep('sep-pagebreak'),
        {
          id: 'page-break',
          label: 'Page break',
          action: null,
          tooltip: 'Coming soon',
        },
      ] as MenuItem[],
    },

    // ---- Format ----
    {
      id: 'format',
      label: 'Format',
      items: [
        {
          id: 'paragraph',
          label: 'Paragraph',
          action: editor ? () => editor.chain().focus().setParagraph().run() : null,
          active: editor?.isActive('paragraph') && !editor?.isActive('heading'),
        },
        {
          id: 'heading1',
          label: 'Heading 1',
          action: editor
            ? () => editor.chain().focus().setHeading({ level: 1 }).run()
            : null,
          active: editor?.isActive('heading', { level: 1 }),
        },
        {
          id: 'heading2',
          label: 'Heading 2',
          action: editor
            ? () => editor.chain().focus().setHeading({ level: 2 }).run()
            : null,
          active: editor?.isActive('heading', { level: 2 }),
        },
        {
          id: 'heading3',
          label: 'Heading 3',
          action: editor
            ? () => editor.chain().focus().setHeading({ level: 3 }).run()
            : null,
          active: editor?.isActive('heading', { level: 3 }),
        },
        sep('sep-marks'),
        {
          id: 'bold',
          label: 'Bold',
          shortcut: 'Ctrl+B',
          action: editor ? () => editor.chain().focus().toggleBold().run() : null,
          active: editor?.isActive('bold'),
        },
        {
          id: 'italic',
          label: 'Italic',
          shortcut: 'Ctrl+I',
          action: editor ? () => editor.chain().focus().toggleItalic().run() : null,
          active: editor?.isActive('italic'),
        },
        {
          id: 'underline',
          label: 'Underline',
          shortcut: 'Ctrl+U',
          action: editor ? () => editor.chain().focus().toggleUnderline().run() : null,
          active: editor?.isActive('underline'),
        },
        {
          id: 'strikethrough',
          label: 'Strikethrough',
          action: editor ? () => editor.chain().focus().toggleStrike().run() : null,
          active: editor?.isActive('strike'),
        },
        {
          id: 'inline-code',
          label: 'Inline code',
          action: editor ? () => editor.chain().focus().toggleCode().run() : null,
          active: editor?.isActive('code'),
        },
        sep('sep-lists'),
        {
          id: 'bullet-list',
          label: 'Bullet list',
          action: editor ? () => editor.chain().focus().toggleBulletList().run() : null,
          active: editor?.isActive('bulletList'),
        },
        {
          id: 'numbered-list',
          label: 'Numbered list',
          action: editor ? () => editor.chain().focus().toggleOrderedList().run() : null,
          active: editor?.isActive('orderedList'),
        },
        sep('sep-clear'),
        {
          id: 'clear-formatting',
          label: 'Clear formatting',
          action: editor
            ? () => editor.chain().focus().unsetAllMarks().clearNodes().run()
            : null,
        },
      ] as MenuItem[],
    },

    // ---- Tools ----
    {
      id: 'tools',
      label: 'Tools',
      items: [
        {
          id: 'word-count',
          label: 'Word count',
          action: editor ? onWordCount : null,
        },
        sep('sep-spell'),
        {
          id: 'spelling',
          label: 'Spelling and grammar',
          action: null,
          tooltip: 'Coming soon',
        },
      ] as MenuItem[],
    },
  ]
}

/**
 * Convert docs' internal menu model to the shared @cloistr/ui model.
 *
 * The shell renders the SAME data as a horizontal bar on desktop and as drawer
 * sections on mobile, which is what makes docs' second, mobile-only menu
 * implementation unnecessary. `action: null` means "deliberately disabled" and
 * maps to an absent onSelect plus the tooltip as the reason, so a disabled item
 * still explains itself instead of being an enabled no-op.
 */
export function toMenuSections(menus: Menu[]): MenuSection[] {
  return menus.map((menu) => ({
    label: menu.label,
    items: menu.items.map((item): MenuEntry => {
      if (isSep(item)) return { separator: true }
      const a = item as ActionItem
      return {
        label: a.label,
        ...(a.action ? { onSelect: a.action } : {}),
        ...(a.shortcut ? { shortcut: a.shortcut } : {}),
        ...(a.tooltip ? { disabledReason: a.tooltip } : {}),
        ...(a.active === undefined ? {} : { active: a.active }),
      }
    }),
  }))
}

// ---------------------------------------------------------------------------
// Word-count modal
// ---------------------------------------------------------------------------

export function WordCountModal({
  editor,
  onClose,
}: {
  editor: TipTapEditor
  onClose: () => void
}) {
  const text = editor.getText()
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  const chars = text.length
  const charsNoSpaces = text.replace(/\s/g, '').length

  useEffect(() => {
    document.getElementById('word-count-close')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Word count"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="modal-title">Word count</h3>
        <table className="word-count-table">
          <tbody>
            <tr>
              <td>Words</td>
              <td className="word-count-value">{words.toLocaleString()}</td>
            </tr>
            <tr>
              <td>Characters</td>
              <td className="word-count-value">{chars.toLocaleString()}</td>
            </tr>
            <tr>
              <td>Characters (no spaces)</td>
              <td className="word-count-value">{charsNoSpaces.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
        <div className="modal-actions">
          <button id="word-count-close" className="modal-btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main MenuBar component
// ---------------------------------------------------------------------------

export function MenuBar(props: MenuBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)

  // Rebuild the menu structure on every render so closures stay fresh
  // (exporting state, editor marks, undo stack, etc. change frequently).
  const menus = buildMenus(props, props.onWordCount)
  const menuIds = menus.map((m) => m.id)

  const menubarRef = useRef<HTMLDivElement>(null)
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // ---- Close on outside click ----
  useEffect(() => {
    if (!openMenuId) return
    const handler = (e: MouseEvent) => {
      if (!menubarRef.current?.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenuId])

  // ---- Escape closes open desktop menu ----
  useEffect(() => {
    if (!openMenuId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null)
        triggerRefs.current.get(openMenuId)?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [openMenuId])

  // ---- Helpers ----
  const focusFirstItemIn = useCallback(
    (menuId: string, allMenus: Menu[]) => {
      const menu = allMenus.find((m) => m.id === menuId)
      if (!menu) return
      const first = menu.items.find(
        (item) => !isSep(item) && (item as ActionItem).action !== null,
      ) as ActionItem | undefined
      if (first) {
        setTimeout(
          () => document.getElementById(`mi-${menuId}-${first.id}`)?.focus(),
          0,
        )
      }
    },
    [],
  )

  const openMenuAndFocus = useCallback(
    (menuId: string) => {
      setOpenMenuId(menuId)
      focusFirstItemIn(menuId, menus)
    },
    [menus, focusFirstItemIn],
  )

  const activateItem = useCallback((item: ActionItem) => {
    if (!item.action) return
    item.action()
    setOpenMenuId(null)
  }, [])

  // ---- Trigger keyboard handler ----
  const handleTriggerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, menuId: string) => {
      const currentIdx = menuIds.indexOf(menuId)

      switch (e.key) {
        case 'ArrowRight': {
          e.preventDefault()
          // Non-null: menuIds is always non-empty and the modulo keeps index in range.
          const nextId = menuIds[(currentIdx + 1) % menuIds.length]!
          triggerRefs.current.get(nextId)?.focus()
          if (openMenuId) openMenuAndFocus(nextId)
          break
        }
        case 'ArrowLeft': {
          e.preventDefault()
          const prevId =
            menuIds[(currentIdx - 1 + menuIds.length) % menuIds.length]!
          triggerRefs.current.get(prevId)?.focus()
          if (openMenuId) openMenuAndFocus(prevId)
          break
        }
        case 'ArrowDown':
        case 'Enter':
        case ' ':
          e.preventDefault()
          openMenuAndFocus(menuId)
          break
        case 'Escape':
          e.preventDefault()
          setOpenMenuId(null)
          break
      }
    },
    [menuIds, openMenuId, openMenuAndFocus],
  )

  // ---- Dropdown keyboard handler ----
  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, menuId: string) => {
      const menu = menus.find((m) => m.id === menuId)
      if (!menu) return

      const enabled = menu.items.filter(
        (item) => !isSep(item) && (item as ActionItem).action !== null,
      ) as ActionItem[]

      const currentEl = document.activeElement
      const currentIdx = enabled.findIndex(
        (item) =>
          document.getElementById(`mi-${menuId}-${item.id}`) === currentEl,
      )

      // Non-null: arrays are non-empty and modulo keeps index in range.
      const focusIdx = (idx: number) => {
        const item = enabled[idx]
        if (item) document.getElementById(`mi-${menuId}-${item.id}`)?.focus()
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          focusIdx((currentIdx + 1) % enabled.length)
          break
        case 'ArrowUp':
          e.preventDefault()
          focusIdx((currentIdx - 1 + enabled.length) % enabled.length)
          break
        case 'Home':
          e.preventDefault()
          focusIdx(0)
          break
        case 'End':
          e.preventDefault()
          focusIdx(enabled.length - 1)
          break
        case 'ArrowLeft': {
          e.preventDefault()
          const menuIdx = menuIds.indexOf(menuId)
          const prevId =
            menuIds[(menuIdx - 1 + menuIds.length) % menuIds.length]!
          setOpenMenuId(null)
          setTimeout(() => {
            triggerRefs.current.get(prevId)?.focus()
            openMenuAndFocus(prevId)
          }, 0)
          break
        }
        case 'ArrowRight': {
          e.preventDefault()
          const menuIdx = menuIds.indexOf(menuId)
          const nextId = menuIds[(menuIdx + 1) % menuIds.length]!
          setOpenMenuId(null)
          setTimeout(() => {
            triggerRefs.current.get(nextId)?.focus()
            openMenuAndFocus(nextId)
          }, 0)
          break
        }
        case 'Escape':
          e.preventDefault()
          setOpenMenuId(null)
          triggerRefs.current.get(menuId)?.focus()
          break
        case 'Tab':
          setOpenMenuId(null)
          break
      }
    },
    [menus, menuIds, openMenuAndFocus],
  )

  // ---- Render ----
  return (
    <>
      <div ref={menubarRef} className="menubar" aria-label="Menu bar">

        {/* ==== Desktop menubar ==== */}
        <div className="menubar-desktop" role="menubar" aria-label="Application menu">
          {menus.map((menu) => (
            <div key={menu.id} className="menubar-item-wrapper">
              <button
                ref={(el) => {
                  if (el) triggerRefs.current.set(menu.id, el)
                  else triggerRefs.current.delete(menu.id)
                }}
                className={`menubar-trigger${openMenuId === menu.id ? ' menubar-trigger--open' : ''}`}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openMenuId === menu.id}
                tabIndex={0}
                onClick={() =>
                  setOpenMenuId(openMenuId === menu.id ? null : menu.id)
                }
                onKeyDown={(e) => handleTriggerKeyDown(e, menu.id)}
              >
                {menu.label}
              </button>

              {openMenuId === menu.id && (
                <div
                  className="menubar-dropdown"
                  role="menu"
                  aria-label={menu.label}
                  onKeyDown={(e) => handleMenuKeyDown(e, menu.id)}
                >
                  {menu.items.map((item) => {
                    if (isSep(item)) {
                      return (
                        <div
                          key={item.id}
                          className="menubar-sep"
                          role="separator"
                        />
                      )
                    }
                    const disabled = item.action === null
                    return (
                      <button
                        key={item.id}
                        id={`mi-${menu.id}-${item.id}`}
                        className={[
                          'menubar-entry',
                          disabled ? 'menubar-entry--disabled' : '',
                          item.active ? 'menubar-entry--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        role="menuitem"
                        tabIndex={-1}
                        disabled={disabled}
                        aria-disabled={disabled}
                        title={item.tooltip}
                        onClick={() => !disabled && activateItem(item)}
                      >
                        <span className="menubar-entry-check" aria-hidden="true">
                          {item.active ? '✓' : ''}
                        </span>
                        <span className="menubar-entry-label">{item.label}</span>
                        {item.shortcut && (
                          <span className="menubar-entry-shortcut">
                            {item.shortcut}
                          </span>
                        )}
                        {disabled && item.tooltip && (
                          <span className="menubar-entry-soon" aria-hidden="true">
                            soon
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

      </div>

    </>
  )
}
