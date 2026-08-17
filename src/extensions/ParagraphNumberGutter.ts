import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { enumerateChapterBlocks, isChapterDocEmpty } from '@/lib/chapterParagraph'

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  if (isChapterDocEmpty(doc)) return DecorationSet.empty

  const decos: Decoration[] = []
  enumerateChapterBlocks(doc, ({ index, offset, node }) => {
    decos.push(
      Decoration.node(offset, offset + node.nodeSize, { class: 'para-gutter-host' }),
      Decoration.widget(offset + 1, () => {
        const span = document.createElement('span')
        span.className = 'para-gutter-num'
        span.textContent = String(index)
        span.setAttribute('aria-hidden', 'true')
        return span
      }, { side: -1, key: `para-num-${index}` }),
    )
  })
  return DecorationSet.create(doc, decos)
}

export const ParagraphNumberGutter = Extension.create({
  name: 'paragraphNumberGutter',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('paragraphNumberGutter'),
        state: {
          init(_, { doc }) {
            return buildDecorations(doc)
          },
          apply(_tr, _set, _oldState, newState) {
            return buildDecorations(newState.doc)
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})
