import { chordLabel, type ActionName } from '../../shared/config.ts';
import { SHORTCUT_GROUPS } from '../lib/shortcutGroups.ts';

interface Props {
  open: boolean;
  keymap: Partial<Record<ActionName, string>>;
  onClose: () => void;
}

export function ShortcutsPanel({ open, keymap, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="sheet-backdrop" onPointerDown={onClose}>
      <div className="sheet" onPointerDown={(event) => event.stopPropagation()}>
        <header className="sheet-head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="sheet-note">
          Open Settings from the gear button or Ctrl+, to change the theme, font size and these
          shortcuts. Defaults live in <code>config/default.json</code>.
        </p>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="sheet-group">
            <h3>{group.title}</h3>
            <dl>
              {group.actions.map(({ action, label }) => (
                <div key={action} className="sheet-row">
                  <dt>{label}</dt>
                  <dd>{keymap[action] ? chordLabel(keymap[action] as string) : '—'}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
