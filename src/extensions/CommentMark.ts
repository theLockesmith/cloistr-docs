/**
 * CommentMark TipTap extension.
 *
 * Represents a comment annotation on a text range. Each comment has a unique
 * ID that ties the mark to a comment entry in the shared Y.js map.
 *
 * Rendering: <mark data-comment-id="..." class="comment-mark">text</mark>
 *
 * Commands:
 *  - setComment(commentId)   – apply the mark to the current selection.
 *  - removeComment(commentId) – remove all marks with the given ID in the doc.
 */

import { Mark, mergeAttributes } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentMark: {
      /** Apply a comment mark to the current selection. */
      setComment: (commentId: string) => ReturnType
      /** Remove all occurrences of a comment mark by ID. */
      removeComment: (commentId: string) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'commentMark',
  excludes: '',
  spanning: true,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) => ({
          'data-comment-id': attributes.commentId,
        }),
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'mark[data-comment-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(HTMLAttributes, { class: 'comment-mark' }),
      0,
    ]
  },

  addCommands() {
    return {
      setComment:
        (commentId: string) =>
        ({ commands }) => {
          return commands.setMark(this.name, { commentId })
        },

      removeComment:
        (commentId: string) =>
        ({ tr, state, dispatch }) => {
          // Walk through the document and remove every mark where commentId matches.
          state.doc.descendants((node, pos) => {
            if (!node.isInline) return
            node.marks.forEach((mark) => {
              if (mark.type === state.schema.marks.commentMark && mark.attrs.commentId === commentId) {
                tr.removeMark(pos, pos + node.nodeSize, mark.type)
              }
            })
          })
          if (dispatch) dispatch(tr)
          return true
        },
    }
  },
})
