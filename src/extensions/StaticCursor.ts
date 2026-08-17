import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const StaticCursor = Extension.create({
  name: 'staticCursor',

  addProseMirrorPlugins() {
    let hasFocus = false

    return [
      new Plugin({
        key: new PluginKey('persistentCursor'),
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, set, oldState, newState) {
            const sel = newState.selection

            if (hasFocus) return DecorationSet.empty

            if (sel.empty) {
              const cursorDeco = Decoration.widget(sel.head, () => {
                const span = document.createElement('span')
                span.className = 'persistent-cursor'
                span.style.cssText = 'display:inline;border-left:2px solid;animation:none;pointer-events:none;margin:0;padding:0;height:1.2em;'
                return span
              }, { side: -1, ignoreSelection: true })
              return DecorationSet.create(newState.doc, [cursorDeco])
            }

            const highlight = Decoration.inline(sel.from, sel.to, {
              class: 'persistent-selection',
              style: 'background-color: rgba(59, 130, 246, 0.15);',
            })
            return DecorationSet.create(newState.doc, [highlight])
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          handleDOMEvents: {
            focus: () => { hasFocus = true; return false },
            blur: () => { hasFocus = false; return false },
          },
        },
      }),
    ]
  },
})
