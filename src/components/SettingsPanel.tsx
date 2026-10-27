import { useEffect, useState } from 'react';
import { chordLabel, type ActionName, type ThemeSpec } from '../../shared/config.ts';
import { chordFromEvent, hasCommandModifier } from '../lib/keymap.ts';
import { ACTION_LABELS, SHORTCUT_GROUPS } from '../lib/shortcutGroups.ts';

export interface SettingsDraft {
  theme: string;
  fontSize: number;
  keymap: Record<ActionName, string>;
}

interface Props {
  open: boolean;
  themes: Record<string, ThemeSpec>;
  theme: string;
  fontSize: number;
  keymap: Record<ActionName, string>;
  defaults: SettingsDraft;
  onClose: () => void;
  onSave: (settings: SettingsDraft) => void;
}

export function SettingsPanel({
  open,
  themes,
  theme,
  fontSize,
  keymap,
  defaults,
  onClose,
  onSave,
}: Props) {
  const [themeDraft, setThemeDraft] = useState(theme);
  const [fontDraft, setFontDraft] = useState(String(fontSize));
  const [keymapDraft, setKeymapDraft] = useState<Record<ActionName, string>>(keymap);
  const [recording, setRecording] = useState<ActionName | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!open) return;
    setThemeDraft(theme);
    setFontDraft(String(fontSize));
    setKeymapDraft({ ...keymap });
    setRecording(null);
    setNotice('');
  }, [open, theme, fontSize, keymap]);

  useEffect(() => {
    if (!open || recording === null) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        setNotice('');
        return;
      }
      const chord = chordFromEvent(event);
      if (!chord) return;
      if (!hasCommandModifier(chord)) {
        setNotice('Add Ctrl or Alt, otherwise the shortcut would block normal typing.');
        return;
      }
      const duplicate = (Object.keys(keymapDraft) as ActionName[]).find(
        (action) => action !== recording && keymapDraft[action]?.toLowerCase() === chord,
      );
      if (duplicate) {
        setNotice(`${chordLabel(chord)} is already used by “${ACTION_LABELS[duplicate]}”.`);
        return;
      }
      setKeymapDraft((previous) => ({ ...previous, [recording]: chord }));
      setRecording(null);
      setNotice('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, recording, keymapDraft]);

  useEffect(() => {
    if (!open || recording !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, recording, onClose]);

  if (!open) return null;

  const save = () => {
    const size = Number(fontDraft);
    if (!Number.isFinite(size) || size < 9 || size > 28) {
      setNotice('Font size must be between 9 and 28.');
      return;
    }
    const seen = new Map<string, ActionName>();
    for (const [action, chord] of Object.entries(keymapDraft) as [ActionName, string][]) {
      if (!chord) continue;
      if (!hasCommandModifier(chord)) {
        setNotice(`“${ACTION_LABELS[action]}” needs Ctrl or Alt.`);
        return;
      }
      const duplicate = seen.get(chord.toLowerCase());
      if (duplicate) {
        setNotice(`“${ACTION_LABELS[action]}” duplicates “${ACTION_LABELS[duplicate]}”.`);
        return;
      }
      seen.set(chord.toLowerCase(), action);
    }
    onSave({ theme: themeDraft, fontSize: size, keymap: keymapDraft });
  };

  const reset = () => {
    setThemeDraft(defaults.theme);
    setFontDraft(String(defaults.fontSize));
    setKeymapDraft({ ...defaults.keymap });
    setRecording(null);
    setNotice('Defaults restored. Press Save to apply them.');
  };

  const exportConfig = () => {
    const payload = {
      theme: themeDraft,
      font: { size: Number(fontDraft) || fontSize },
      keymap: keymapDraft,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'macterm-config.json';
    link.click();
    URL.revokeObjectURL(url);
    setNotice('Config template downloaded.');
  };

  const clearChord = (action: ActionName) => {
    setKeymapDraft((previous) => ({ ...previous, [action]: '' }));
    setRecording(null);
  };

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div
        className="sheet settings"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="sheet-head">
          <h2>Settings</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="sheet-note">
          Saved on this PC. Export produces a <code>config/user.json</code> template for defaults.
        </p>

        <div className="settings-grid">
          <label className="settings-field">
            <span>Theme</span>
            <select value={themeDraft} onChange={(event) => setThemeDraft(event.target.value)}>
              {Object.entries(themes).map(([name, spec]) => (
                <option key={name} value={name}>
                  {spec.label} ({name})
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Font size</span>
            <input
              type="number"
              min="9"
              max="28"
              step="0.5"
              value={fontDraft}
              onChange={(event) => setFontDraft(event.target.value)}
            />
          </label>
        </div>

        <h3 className="settings-heading">Keyboard shortcuts</h3>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="sheet-group">
            <h3>{group.title}</h3>
            <dl>
              {group.actions.map(({ action, label }) => (
                <div key={action} className="sheet-row">
                  <dt>{label}</dt>
                  <dd className="chord-cell">
                    <button
                      type="button"
                      className={`chord ${recording === action ? 'chord-recording' : ''}`}
                      onClick={() => {
                        setRecording(action);
                        setNotice('');
                      }}
                    >
                      {recording === action
                        ? 'Press keys…'
                        : keymapDraft[action]
                          ? chordLabel(keymapDraft[action])
                          : 'Unbound'}
                    </button>
                    {keymapDraft[action] && (
                      <button
                        type="button"
                        className="chord-clear"
                        aria-label={`Clear ${label}`}
                        title="Remove shortcut"
                        onClick={() => clearChord(action)}
                      >
                        ×
                      </button>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {notice && (
          <p className="settings-notice" role="status">
            {notice}
          </p>
        )}

        <footer className="settings-actions">
          <button type="button" className="btn" onClick={reset}>
            Reset defaults
          </button>
          <button type="button" className="btn" onClick={exportConfig}>
            Export config
          </button>
          <span className="settings-spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
