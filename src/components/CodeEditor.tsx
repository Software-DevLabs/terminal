import { useEffect, useRef } from 'react';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  LanguageDescription,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { tags } from '@lezer/highlight';

interface Props {
  fileName: string;
  doc: string;
  readOnly: boolean;
  goto: { line: number; nonce: number } | null;
  onChange: (doc: string) => void;
  onCursor: (line: number, column: number) => void;
  onSave: () => void;
}

const monoHighlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--ws-syn-comment)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--ws-syn-keyword)' },
  { tag: tags.string, color: 'var(--ws-syn-string)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--ws-syn-number)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--ws-syn-property)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--ws-syn-function)' },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], color: 'var(--ws-syn-type)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--ws-syn-punct)' },
  { tag: [tags.variableName, tags.name], color: 'var(--ws-fg)' },
  { tag: tags.invalid, color: 'var(--ws-syn-invalid)' },
]);

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12.5px',
    backgroundColor: 'transparent',
    color: 'var(--ws-fg)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--ws-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    padding: '10px 0 24px',
    caretColor: 'var(--ws-fg)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--ws-fg)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--ws-selection) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--ws-gutter)',
    color: 'var(--ws-muted)',
    border: 'none',
    paddingLeft: '4px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 14px 0 10px',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--ws-active-line)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--ws-active-line)',
    color: 'var(--ws-fg)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--ws-match)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--ws-match)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--ws-match-selected)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--ws-chip)',
    border: '1px solid var(--ws-border)',
    color: 'var(--ws-muted)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--ws-panel)',
    border: '1px solid var(--ws-border)',
    color: 'var(--ws-fg)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--ws-panel)',
    color: 'var(--ws-fg)',
  },
  '.cm-panels-bottom': {
    borderTop: '1px solid var(--ws-border)',
  },
});

function readOnlyExtensions(readOnly: boolean): Extension {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

export function CodeEditor({ fileName, doc, readOnly, goto, onChange, onCursor, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartment = useRef(new Compartment()).current;
  const languageCompartment = useRef(new Compartment()).current;
  const saveRef = useRef(onSave);
  const changeRef = useRef(onChange);
  const cursorRef = useRef(onCursor);
  saveRef.current = onSave;
  changeRef.current = onChange;
  cursorRef.current = onCursor;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off' }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              saveRef.current();
              return true;
            },
          },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
        baseTheme,
        syntaxHighlighting(monoHighlight),
        languageCompartment.of([]),
        readOnlyCompartment.of(readOnlyExtensions(readOnly)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            cursorRef.current(line.number, head - line.from + 1);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    const frame = requestAnimationFrame(() => view.focus());

    return () => {
      cancelAnimationFrame(frame);
      view.destroy();
      viewRef.current = null;
    };
  }, [fileName, languageCompartment, readOnlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)) });
  }, [readOnly, readOnlyCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const description = LanguageDescription.matchFilename(languages, fileName);
    if (!description) return;
    let active = true;
    void description
      .load()
      .then((support) => {
        if (active && viewRef.current === view) {
          view.dispatch({ effects: languageCompartment.reconfigure(support) });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [fileName, languageCompartment]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !goto) return;
    const line = view.state.doc.line(Math.min(Math.max(1, goto.line), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }, [goto]);

  return <div className="ws-code" ref={hostRef} />;
}
