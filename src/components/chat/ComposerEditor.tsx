import * as React from 'react'
import type { Editor, JSONContent, NodeViewProps, Range } from '@tiptap/core'
import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention'
import { Fragment, Slice, type Schema } from '@tiptap/pm/model'
import { EditorState, PluginKey, TextSelection } from '@tiptap/pm/state'
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionOptions,
  type SuggestionProps,
} from '@tiptap/suggestion'
import { TbFile, TbFolder, TbSparkles } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ComposerSlashArgumentQuery } from '@/renderer/composer/extension-command-completions'
import {
  COMPOSER_MENTION_NODE_TYPE,
  composerDocumentHasContent,
  composerMentionAttrs,
  composerMentionSuggestionMatches,
  isComposerMentionAttrs,
  plainTextToComposerDocument,
  serializeComposerDocument,
  shouldReplaceComposerMention,
  type ComposerDocumentSnapshot,
  type ComposerMentionAttrs,
  type ComposerMentionCandidate,
  type ComposerMentionSuggestionIdentity,
} from '@/renderer/composer/composer-mentions'
import { composerSlashQuery } from '@/renderer/composer/skill-commands'

const mentionPluginKey = new PluginKey('composerMentionSuggestion')

export type ComposerEditorSuggestion = ComposerMentionSuggestionIdentity

export interface ComposerEditorChange extends ComposerDocumentSnapshot {
  hasContent: boolean
  plainText: string
  plainTextBeforeCursor: string | null
}

export interface ComposerMentionInsertionTarget extends ComposerMentionSuggestionIdentity {}

export interface ComposerEditorHandle {
  capture(): ComposerDocumentSnapshot
  clearIfRevision(revision: number): boolean
  dismissSuggestion(): void
  focus(position?: 'current' | 'end'): void
  insertMention(
    candidate: ComposerMentionCandidate,
    target: ComposerMentionInsertionTarget,
    validateDocument?: (document: JSONContent) => boolean,
  ): boolean
  removeMentions(): boolean
  replaceSlashArgumentCompletion(
    query: ComposerSlashArgumentQuery,
    value: string,
  ): boolean
  replaceLeadingSlashWithMention(candidate: ComposerMentionCandidate): boolean
  replaceWithPlainText(text: string): void
}

interface ComposerEditorProps {
  activeDescendantId?: string
  ariaControlsId?: string
  ariaDescribedBy?: string
  ariaExpanded?: boolean
  ariaInvalid?: boolean
  ariaLabel: string
  disabled: boolean
  placeholder: string
  onChange(change: ComposerEditorChange): void
  onKeyDown(event: KeyboardEvent): boolean
  onMentionKeyDown(event: KeyboardEvent): boolean
  onPasteFiles(files: readonly File[]): void
  onSuggestionChange(suggestion: ComposerEditorSuggestion | null): void
}

function mentionDisplay(attrs: Record<string, unknown>) {
  const label = typeof attrs.label === 'string' ? attrs.label : ''
  if (attrs.kind === 'directory') return `@${label}/`
  return `@${label}`
}

function ComposerMentionNodeView({ node, selected }: NodeViewProps) {
  const t = useT()
  const attrs = node.attrs as Record<string, unknown>
  const label = typeof attrs.label === 'string' ? attrs.label : ''
  const kind = attrs.kind
  const display = mentionDisplay(attrs)
  const ariaLabel = kind === 'skill'
    ? t('composer.mentions.aria.skill', { label })
    : kind === 'directory'
      ? t('composer.mentions.aria.directory', { label })
      : t('composer.mentions.aria.file', { label })

  return (
    <NodeViewWrapper
      as="span"
      contentEditable={false}
      aria-label={ariaLabel}
      className={cn(
        'mx-0.5 inline-flex max-w-[min(34rem,80vw)] cursor-default select-none items-center gap-1 rounded border border-border bg-muted/70 px-1 py-0.5 align-baseline font-mono text-caption text-foreground',
        selected && 'border-ring bg-accent ring-1 ring-ring',
      )}
      data-composer-mention-kind={typeof kind === 'string' ? kind : 'unknown'}
    >
      {kind === 'skill'
        ? <TbSparkles className="size-3.5 shrink-0" aria-hidden />
        : kind === 'directory'
          ? <TbFolder className="size-3.5 shrink-0" aria-hidden />
          : <TbFile className="size-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0 truncate">{display}</span>
    </NodeViewWrapper>
  )
}

function documentFromSlice(slice: Slice): JSONContent {
  const content = slice.content.toJSON() as JSONContent[]
  const blocks = content.every((node) => node.type === 'paragraph')
    ? content
    : [{ type: 'paragraph', content }]
  const lastBlock = blocks[blocks.length - 1]
  const lastInlineNodes = lastBlock?.type === 'paragraph'
    ? lastBlock.content
    : undefined
  const finalNode = lastInlineNodes?.[lastInlineNodes.length - 1]
  const precedingNode = lastInlineNodes?.[lastInlineNodes.length - 2]

  // A terminal atom gets one editor-only caret separator; clipboard text should
  // expose the selected reference rather than that implementation detail.
  if (
    finalNode?.type === 'text' &&
    finalNode.text === ' ' &&
    precedingNode?.type === COMPOSER_MENTION_NODE_TYPE
  ) {
    lastInlineNodes?.pop()
  }
  return {
    type: 'doc',
    content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
  }
}

function serializeSlice(slice: Slice) {
  return serializeComposerDocument({
    revision: 0,
    document: documentFromSlice(slice),
  })
}

function plainTextSlice(schema: Schema, text: string) {
  const normalized = text.replace(/\r\n?/gu, '\n')
  const paragraphs = normalized.split('\n').map((line) =>
    schema.nodes.paragraph.create(
      null,
      line ? schema.text(line) : undefined,
    ))
  return Slice.maxOpen(Fragment.from(paragraphs), false)
}

function syncCollapsedDomSelection(view: Editor['view']) {
  const domSelection = view.dom.ownerDocument.getSelection()
  if (!domSelection?.isCollapsed || !domSelection.anchorNode) return false
  try {
    const position = view.posAtDOM(domSelection.anchorNode, domSelection.anchorOffset)
    if (position < 0 || position > view.state.doc.content.size) return false
    if (!view.state.selection.empty) {
      view.dispatch(view.state.tr.setSelection(
        TextSelection.near(view.state.doc.resolve(position)),
      ))
    }
    return true
  } catch {
    return false
  }
}

function separatorEnd(document: Editor['state']['doc'], position: number) {
  const next = document.resolve(position).nodeAfter
  return next?.isText && next.text?.startsWith(' ') ? position + 1 : position
}

function replaceableMentionRanges(
  editor: Editor,
  attrs: ComposerMentionAttrs,
) {
  const ranges: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== COMPOSER_MENTION_NODE_TYPE) return
    if (!isComposerMentionAttrs(node.attrs)) return
    if (!shouldReplaceComposerMention(node.attrs, attrs)) return
    const end = position + node.nodeSize
    ranges.push({ from: position, to: separatorEnd(editor.state.doc, end) })
  })
  return ranges.sort((left, right) => right.from - left.from)
}

function insertTrustedMention(
  editor: Editor,
  range: Range,
  candidate: ComposerMentionCandidate,
  trigger: '@' | '/',
  validateDocument?: (document: JSONContent) => boolean,
) {
  const attrs = composerMentionAttrs(candidate)
  return editor.commands.command(({ dispatch, state, tr }) => {
    if (range.from < 1 || range.to < range.from || range.to > state.doc.content.size) {
      return false
    }
    const selectedText = state.doc.textBetween(range.from, range.to, '\n', '\uFFFC')
    if (!selectedText.startsWith(trigger)) return false

    for (const current of replaceableMentionRanges(editor, attrs)) {
      tr.delete(tr.mapping.map(current.from), tr.mapping.map(current.to))
    }

    const from = tr.mapping.map(range.from)
    const to = tr.mapping.map(range.to)
    tr.delete(from, to)
    const mentionType = state.schema.nodes[COMPOSER_MENTION_NODE_TYPE]
    if (!mentionType) {
      tr.setMeta('preventDispatch', true)
      return false
    }
    const mention = mentionType.create(attrs)
    tr.insert(from, mention)

    let caret = from + mention.nodeSize
    const next = tr.doc.resolve(caret).nodeAfter
    const nextIsWhitespace = next?.type.name === 'hardBreak' || (
      next?.isText === true && /^\s/u.test(next.text ?? '')
    )
    if (!nextIsWhitespace) {
      tr.insertText(' ', caret)
      caret += 1
    } else if (next?.isText && next.text?.startsWith(' ')) {
      caret += 1
    }
    if (validateDocument && !validateDocument(tr.doc.toJSON())) {
      tr.setMeta('preventDispatch', true)
      return false
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(caret), 1))
    dispatch?.(tr.scrollIntoView())
    return true
  })
}

function removeAllMentions(editor: Editor) {
  const ranges: Array<{ from: number; to: number }> = []
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== COMPOSER_MENTION_NODE_TYPE) return
    const end = position + node.nodeSize
    ranges.push({ from: position, to: separatorEnd(editor.state.doc, end) })
  })
  if (ranges.length === 0) return false
  ranges.sort((left, right) => right.from - left.from)
  return editor.commands.command(({ dispatch, tr }) => {
    for (const range of ranges) tr.delete(range.from, range.to)
    tr.setMeta('addToHistory', false)
    dispatch?.(tr)
    return true
  })
}

function resetEditorPluginState(editor: Editor) {
  const state = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
    schema: editor.state.schema,
    selection: editor.state.selection,
  })
  editor.view.updateState(state)
}

function plainTextBeforeCursor(editor: Editor): string | null {
  const { selection } = editor.state
  if (!selection.empty) return null
  return editor.state.doc.textBetween(0, selection.from, '\n', '\uFFFC')
}

export const ComposerEditor = React.forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor({
    activeDescendantId,
    ariaControlsId,
    ariaDescribedBy,
    ariaExpanded = false,
    ariaInvalid = false,
    ariaLabel,
    disabled,
    placeholder,
    onChange,
    onKeyDown,
    onMentionKeyDown,
    onPasteFiles,
    onSuggestionChange,
  }, forwardedRef) {
    const callbacks = React.useRef({
      onChange,
      onKeyDown,
      onMentionKeyDown,
      onPasteFiles,
      onSuggestionChange,
    })
    callbacks.current = {
      onChange,
      onKeyDown,
      onMentionKeyDown,
      onPasteFiles,
      onSuggestionChange,
    }
    const revision = React.useRef(0)
    const activeSuggestion = React.useRef<ComposerEditorSuggestion | null>(null)

    const extensions = React.useMemo(() => {
      const suggestion: Omit<SuggestionOptions<unknown, MentionNodeAttrs>, 'editor'> = {
        allowSpaces: true,
        allowedPrefixes: null,
        char: '@',
        debounce: 0,
        dismissOnOutsideClick: true,
        items: () => [],
        offset: { mainAxis: 8 },
        placement: 'top-start',
        pluginKey: mentionPluginKey,
        allow: ({ editor, range }) => {
          if (editor.view.composing) return false
          const position = editor.state.doc.resolve(range.from)
          if (position.parentOffset === 0) return true
          if (position.nodeBefore?.type.name === 'hardBreak') return true
          return /^\s$/u.test(editor.state.doc.textBetween(range.from - 1, range.from))
        },
        shouldShow: ({ editor }) => !editor.view.composing,
        command: () => undefined,
        render: () => {
          const publish = (props: SuggestionProps<unknown, MentionNodeAttrs>) => {
            const next: ComposerEditorSuggestion = {
              documentRevision: revision.current,
              from: props.range.from,
              query: props.query,
              to: props.range.to,
            }
            activeSuggestion.current = next
            callbacks.current.onSuggestionChange(next)
          }

          return {
            onStart(props: SuggestionProps<unknown, MentionNodeAttrs>) {
              publish(props)
            },
            onUpdate(props: SuggestionProps<unknown, MentionNodeAttrs>) {
              publish(props)
            },
            onKeyDown({ event }: SuggestionKeyDownProps) {
              if (event.isComposing || event.keyCode === 229) return false
              return callbacks.current.onMentionKeyDown(event)
            },
            onExit() {
              activeSuggestion.current = null
              callbacks.current.onSuggestionChange(null)
            },
          }
        },
      }

      return [
        StarterKit.configure({
          blockquote: false,
          bold: false,
          bulletList: false,
          code: false,
          codeBlock: false,
          dropcursor: false,
          gapcursor: false,
          heading: false,
          horizontalRule: false,
          italic: false,
          link: false,
          listItem: false,
          listKeymap: false,
          orderedList: false,
          strike: false,
          trailingNode: false,
          underline: false,
        }),
        Mention.extend({
          name: COMPOSER_MENTION_NODE_TYPE,
          selectable: true,
          addAttributes() {
            return {
              commandName: { default: null, rendered: false },
              kind: { default: null, rendered: false },
              label: { default: null, rendered: false },
              path: { default: null, rendered: false },
            }
          },
          parseHTML() {
            return []
          },
          addNodeView() {
            return ReactNodeViewRenderer(ComposerMentionNodeView)
          },
        }).configure({
          deleteTriggerWithBackspace: true,
          renderHTML: ({ node }) => ['span', {}, mentionDisplay(node.attrs)],
          renderText: ({ node }) => mentionDisplay(node.attrs),
          suggestion,
        }),
      ]
    }, [])

    const emitChange = React.useCallback((editor: Editor) => {
      const document = editor.getJSON()
      callbacks.current.onChange({
        revision: revision.current,
        document,
        hasContent: composerDocumentHasContent(document),
        plainText: editor.getText({ blockSeparator: '\n' }),
        plainTextBeforeCursor: plainTextBeforeCursor(editor),
      })
    }, [])

    const editor = useEditor({
      content: plainTextToComposerDocument(''),
      editable: !disabled,
      enableContentCheck: true,
      enableInputRules: false,
      enablePasteRules: false,
      extensions,
      injectCSS: false,
      editorProps: {
        attributes: {
          'aria-invalid': String(ariaInvalid),
          'aria-label': ariaLabel,
          'aria-multiline': 'true',
          class: 'scroll-slim min-h-12 max-h-40 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-2 pt-3 text-app text-foreground outline-none',
          id: 'composer-input',
          role: 'textbox',
          spellcheck: 'true',
        },
        handleDOMEvents: {
          copy(view, event) {
            if (view.state.selection.empty || syncCollapsedDomSelection(view)) return false
            const clipboardEvent = event as ClipboardEvent
            const text = serializeSlice(view.state.selection.content())
            if (text === null || !clipboardEvent.clipboardData) return false
            clipboardEvent.preventDefault()
            clipboardEvent.clipboardData.setData('text/plain', text)
            return true
          },
          cut(view, event) {
            if (view.state.selection.empty || syncCollapsedDomSelection(view)) return false
            const clipboardEvent = event as ClipboardEvent
            const text = serializeSlice(view.state.selection.content())
            if (text === null || !clipboardEvent.clipboardData) return false
            clipboardEvent.preventDefault()
            clipboardEvent.clipboardData.setData('text/plain', text)
            if (!view.state.selection.empty) {
              view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
            }
            return true
          },
        },
        handleKeyDown(view, event) {
          if (event.isComposing || event.keyCode === 229 || view.composing) return false
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            return callbacks.current.onKeyDown(event)
          }
          if (activeSuggestion.current) return false
          return callbacks.current.onKeyDown(event)
        },
        handlePaste(view, event) {
          const files = [...(event.clipboardData?.files ?? [])]
          if (files.length > 0) {
            event.preventDefault()
            callbacks.current.onPasteFiles(files)
            return true
          }
          const text = event.clipboardData?.getData('text/plain')
          if (text === undefined) return false
          event.preventDefault()
          view.dispatch(view.state.tr.replaceSelection(plainTextSlice(view.state.schema, text)))
          return true
        },
      },
      onCreate({ editor }) {
        emitChange(editor)
      },
      onTransaction({ editor, transaction }) {
        if (transaction.docChanged) {
          revision.current += 1
          const suggestion = activeSuggestion.current
          if (suggestion) {
            const updatedSuggestion = {
              ...suggestion,
              documentRevision: revision.current,
            }
            activeSuggestion.current = updatedSuggestion
            callbacks.current.onSuggestionChange(updatedSuggestion)
          }
        }
        if (!transaction.docChanged && !transaction.selectionSet) return
        emitChange(editor)
      },
    }, [emitChange, extensions])

    React.useEffect(() => {
      editor.setEditable(!disabled)
      const element = editor.view.dom
      element.setAttribute('aria-disabled', String(disabled))
    }, [disabled, editor])

    React.useEffect(() => {
      const element = editor.view.dom
      if (activeDescendantId) {
        element.setAttribute('aria-activedescendant', activeDescendantId)
      } else {
        element.removeAttribute('aria-activedescendant')
      }
      element.setAttribute('aria-haspopup', 'listbox')
      element.setAttribute('aria-expanded', String(ariaExpanded))
      if (ariaExpanded && ariaControlsId) {
        element.setAttribute('aria-controls', ariaControlsId)
      } else {
        element.removeAttribute('aria-controls')
      }
    }, [activeDescendantId, ariaControlsId, ariaExpanded, editor])

    React.useEffect(() => {
      const element = editor.view.dom
      element.setAttribute('aria-label', ariaLabel)
      element.setAttribute('aria-invalid', String(ariaInvalid))
      if (ariaDescribedBy) {
        element.setAttribute('aria-describedby', ariaDescribedBy)
      } else {
        element.removeAttribute('aria-describedby')
      }
    }, [ariaDescribedBy, ariaInvalid, ariaLabel, editor])

    React.useImperativeHandle(forwardedRef, (): ComposerEditorHandle => ({
      capture() {
        return { revision: revision.current, document: editor.getJSON() }
      },
      clearIfRevision(expectedRevision) {
        if (revision.current !== expectedRevision) return false
        editor.commands.setContent(plainTextToComposerDocument(''))
        return true
      },
      dismissSuggestion() {
        if (!activeSuggestion.current) return
        exitSuggestion(editor.view, mentionPluginKey)
      },
      focus(position = 'current') {
        editor.commands.focus(position === 'end' ? 'end' : undefined)
      },
      insertMention(candidate, target, validateDocument) {
        const suggestion = activeSuggestion.current
        if (
          !suggestion ||
          revision.current !== target.documentRevision ||
          !composerMentionSuggestionMatches(suggestion, target)
        ) {
          return false
        }
        return insertTrustedMention(editor, target, candidate, '@', validateDocument)
      },
      removeMentions() {
        exitSuggestion(editor.view, mentionPluginKey)
        const removed = removeAllMentions(editor)
        resetEditorPluginState(editor)
        return removed
      },
      replaceSlashArgumentCompletion(query, value) {
        if (revision.current !== query.documentRevision) return false
        if (plainTextBeforeCursor(editor) !== query.textBeforeCursor) return false
        const { selection } = editor.state
        if (!selection.empty || selection.from < query.argumentPrefix.length) return false
        const from = selection.from - query.argumentPrefix.length
        return editor.commands.command(({ dispatch, tr }) => {
          tr.insertText(value, from, selection.from)
          tr.setSelection(TextSelection.near(tr.doc.resolve(from + value.length), 1))
          dispatch?.(tr.scrollIntoView())
          return true
        })
      },
      replaceLeadingSlashWithMention(candidate) {
        const text = editor.getText({ blockSeparator: '\n' })
        if (composerSlashQuery(text) === null) return false
        return insertTrustedMention(editor, { from: 1, to: 1 + text.length }, candidate, '/')
      },
      replaceWithPlainText(text) {
        exitSuggestion(editor.view, mentionPluginKey)
        editor.commands.setContent(plainTextToComposerDocument(text))
        editor.commands.focus('end')
      },
    }), [editor])

    const empty = !composerDocumentHasContent(editor.getJSON())

    return (
      <div className="relative">
        {empty ? (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 text-app text-muted-foreground/60"
          >
            {placeholder}
          </span>
        ) : null}
        <EditorContent editor={editor} />
      </div>
    )
  },
)
