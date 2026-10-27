interface Props {
  elevated: boolean;
  canElevate: boolean;
  busy: boolean;
  onClick: () => void;
  className?: string;
}

export function ShieldButton({ elevated, canElevate, busy, onClick, className = '' }: Props) {
  const disabled = elevated || !canElevate || busy;
  const title = elevated
    ? 'macterm is running as administrator'
    : !canElevate
      ? 'Run as administrator is available in the installed app'
      : busy
        ? 'Waiting for the Windows permission prompt...'
        : 'Restart macterm as administrator';

  return (
    <button
      type="button"
      className={`${className} shield ${elevated ? 'shield-on' : ''}`.trim()}
      aria-label="Run as administrator"
      aria-pressed={elevated}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.7l5.1 2v3.5c0 3.1-2.1 5.7-5.1 7.1-3-1.4-5.1-4-5.1-7.1V3.7l5.1-2z" />
        {elevated ? <path d="M5.6 7.9l1.6 1.6 3.2-3.3" /> : <path d="M8 5.2v3.4M6.3 6.9h3.4" />}
      </svg>
      {busy && <span className="shield-busy" aria-hidden="true" />}
    </button>
  );
}
