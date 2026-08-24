/**
 * DOCX export utility for Cloistr Docs.
 *
 * Converts the TipTap / ProseMirror JSON representation of a document into a
 * Word-compatible .docx file using the `docx` npm package (v9.x).
 *
 * Supported node types:
 *  - paragraph        → Paragraph
 *  - heading (1-4)    → Paragraph with HeadingLevel
 *  - bulletList       → unordered list items
 *  - orderedList      → numbered list items
 *  - listItem         → recursively rendered
 *  - blockquote       → indented paragraph
 *  - table / tableRow / tableCell / tableHeader  → Table
 *  - image            → placeholder paragraph (images require binary data; noted inline)
 *  - hardBreak        → CarriageReturn
 *
 * Supported marks on text:
 *  - bold, italic, underline, strike, code
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  ShadingType,
  convertInchesToTwip,
  LevelFormat,
  UnderlineType,
} from 'docx'
import type { JSONContent } from '@tiptap/core'

// ---------------------------------------------------------------------------
// Text-level conversion
// ---------------------------------------------------------------------------

function textNodeToRun(node: JSONContent): TextRun {
  const marks = new Set((node.marks ?? []).map((m) => (typeof m === 'string' ? m : m.type)))
  const isCode = marks.has('code')

  // Build options object without undefined values to satisfy exactOptionalPropertyTypes.
  const opts: Record<string, unknown> = { text: node.text ?? '' }
  if (marks.has('bold')) opts.bold = true
  if (marks.has('italic')) opts.italics = true
  if (marks.has('underline')) opts.underline = { type: UnderlineType.SINGLE }
  if (marks.has('strike')) opts.strike = true
  if (isCode) {
    opts.font = 'Courier New'
    opts.shading = { type: ShadingType.SOLID, color: 'EEEEEE', fill: 'EEEEEE' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new TextRun(opts as any)
}

function hardBreakToRun(): TextRun {
  return new TextRun({ break: 1 })
}

function inlineChildrenToRuns(node: JSONContent): TextRun[] {
  const runs: TextRun[] = []
  for (const child of node.content ?? []) {
    if (child.type === 'text') {
      runs.push(textNodeToRun(child))
    } else if (child.type === 'hardBreak') {
      runs.push(hardBreakToRun())
    }
  }
  return runs
}

// ---------------------------------------------------------------------------
// Block-level conversion
// ---------------------------------------------------------------------------

const HEADING_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
}

interface RenderContext {
  inBulletList: boolean
  inOrderedList: boolean
  listLevel: number
}

const defaultCtx: RenderContext = { inBulletList: false, inOrderedList: false, listLevel: 0 }

function nodeToBlocks(node: JSONContent, ctx: RenderContext = defaultCtx): Array<Paragraph | Table> {
  switch (node.type) {
    case 'paragraph': {
      const indent = ctx.listLevel > 0
        ? { left: convertInchesToTwip(0.5 * ctx.listLevel) }
        : undefined
      return [
        new Paragraph({
          children: inlineChildrenToRuns(node),
          alignment: AlignmentType.LEFT,
          ...(indent ? { indent } : {}),
        }),
      ]
    }

    case 'heading': {
      const level = (node.attrs?.level as number) ?? 1
      return [
        new Paragraph({
          heading: HEADING_MAP[level] ?? HeadingLevel.HEADING_1,
          children: inlineChildrenToRuns(node),
        }),
      ]
    }

    case 'blockquote': {
      const childCtx: RenderContext = { ...ctx, listLevel: ctx.listLevel + 1 }
      return (node.content ?? []).flatMap((child) => nodeToBlocks(child, childCtx))
    }

    case 'bulletList': {
      const childCtx: RenderContext = {
        ...ctx,
        inBulletList: true,
        inOrderedList: false,
        listLevel: ctx.listLevel + 1,
      }
      return (node.content ?? []).flatMap((child) => nodeToBlocks(child, childCtx))
    }

    case 'orderedList': {
      const childCtx: RenderContext = {
        ...ctx,
        inBulletList: false,
        inOrderedList: true,
        listLevel: ctx.listLevel + 1,
      }
      return (node.content ?? []).flatMap((child) => nodeToBlocks(child, childCtx))
    }

    case 'listItem': {
      const blocks: Array<Paragraph | Table> = []
      for (const child of node.content ?? []) {
        if (child.type === 'paragraph') {
          const bullet = ctx.inBulletList
          const numbered = ctx.inOrderedList
          const numbering = bullet
            ? { reference: 'bullet-list', level: Math.max(0, ctx.listLevel - 1) }
            : numbered
              ? { reference: 'ordered-list', level: Math.max(0, ctx.listLevel - 1) }
              : undefined
          blocks.push(
            new Paragraph({
              children: inlineChildrenToRuns(child),
              ...(numbering ? { numbering } : {}),
            }),
          )
        } else {
          blocks.push(...nodeToBlocks(child, ctx))
        }
      }
      return blocks
    }

    case 'codeBlock': {
      const text = (node.content ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n')
      return [
        new Paragraph({
          children: [
            new TextRun({
              text,
              font: 'Courier New',
              shading: { type: ShadingType.SOLID, color: 'F5F5F5', fill: 'F5F5F5' },
            }),
          ],
        }),
      ]
    }

    case 'horizontalRule': {
      return [new Paragraph({ children: [new TextRun('───────────────────────────────────')] })]
    }

    case 'image': {
      const src = (node.attrs?.src as string) ?? ''
      return [
        new Paragraph({
          children: [
            new TextRun({
              text: `[Image: ${src}]`,
              italics: true,
              color: '888888',
            }),
          ],
        }),
      ]
    }

    case 'table': {
      return [nodeToTable(node)]
    }

    default: {
      const runs = inlineChildrenToRuns(node)
      return runs.length ? [new Paragraph({ children: runs })] : []
    }
  }
}

// ---------------------------------------------------------------------------
// Table conversion
// ---------------------------------------------------------------------------

function nodeToTable(tableNode: JSONContent): Table {
  const rows = (tableNode.content ?? [])
    .filter((r) => r.type === 'tableRow')
    .map(
      (row) =>
        new TableRow({
          children: (row.content ?? [])
            .filter((c) => c.type === 'tableCell' || c.type === 'tableHeader')
            .map((cell) => {
              const isHeader = cell.type === 'tableHeader'
              const cellChildren = (cell.content ?? []).flatMap((child) => {
                const blocks = nodeToBlocks(child)
                return blocks.filter((b): b is Paragraph => b instanceof Paragraph)
              })
              return isHeader
                ? new TableCell({
                    children: cellChildren,
                    shading: { type: ShadingType.SOLID, color: 'EEEEEE', fill: 'EEEEEE' },
                  })
                : new TableCell({ children: cellChildren })
            }),
        }),
    )

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

// ---------------------------------------------------------------------------
// Top-level export
// ---------------------------------------------------------------------------

export async function editorJsonToDocxBlob(content: JSONContent): Promise<Blob> {
  const rootNodes = content.type === 'doc' ? (content.content ?? []) : [content]
  const children = rootNodes.flatMap((node) => nodeToBlocks(node))

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.5 * (level + 1)),
                  hanging: convertInchesToTwip(0.25),
                },
              },
            },
          })),
        },
        {
          reference: 'ordered-list',
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.5 * (level + 1)),
                  hanging: convertInchesToTwip(0.25),
                },
              },
            },
          })),
        },
      ],
    },
    sections: [{ children }],
  })

  return Packer.toBlob(doc)
}

export function downloadDocx(blob: Blob, filename: string = 'document.docx'): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
