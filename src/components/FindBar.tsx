import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onFind: (needle: string, backwards: boolean) => void;
}

export function FindBar({ open, onClose, onFind }: Props) {
  const [needle, setNeedle] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="findbar" role="search">
      <input
        ref={inputRef}
        className="findbar-input"
        value={needle}
        placeholder="Find"
        spellCheck={false}
        onChange={(event) => {
          setNeedle(event.target.value);
          if (event.target.value) onFind(event.target.value, false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (needle) onFind(needle, event.shiftKey);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <button type="button" className="findbar-btn" aria-label="Previous match" onClick={() => needle && onFind(needle, true)}>
        ↑
      </button>
      <button type="button" className="findbar-btn" aria-label="Next match" onClick={() => needle && onFind(needle, false)}>
        ↓
      </button>
      <button type="button" className="findbar-btn" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
