import { sound } from '../game/audio';
import type { ConnectionState } from '../serial/useHardware';

/** Every button in the game. Clicking one is always audible. */
export function Button({
  children,
  onClick,
  tone = 'orange',
  size,
  disabled,
  title,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'orange' | 'blue' | 'quiet';
  size?: 'huge' | 'icon' | 'small';
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      className={`btn btn--${tone}${size ? ` btn--${size}` : ''}`}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      onClick={() => {
        sound.click();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

const CONNECT_LABEL: Record<ConnectionState, string> = {
  unsupported: 'Reader unsupported',
  disconnected: 'Connect device',
  connecting: 'Waking reader…',
  connected: 'Reader connected',
};

/**
 * Connection state lives inside the button that changes it, rather than beside
 * it. A separate status pill saying "Reader offline" next to a button saying
 * "Connect device" is the same fact written twice.
 */
export function ConnectButton({
  state,
  onConnect,
  onDisconnect,
}: {
  state: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const live = state === 'connected' || state === 'connecting';

  return (
    <Button
      tone={live ? 'quiet' : 'blue'}
      disabled={state === 'unsupported'}
      onClick={live ? onDisconnect : onConnect}
      title={state === 'connected' ? 'Click to disconnect' : undefined}
    >
      <i className={`plug plug--${state}`} />
      {CONNECT_LABEL[state]}
    </Button>
  );
}

/** Padded so the number never changes width and nothing beside it shifts. */
export function Score({ value, centred }: { value: number; centred?: boolean }) {
  return (
    <div className={`score${centred ? ' score--centred' : ''}`}>
      <span className="score__label">Score</span>
      <span className="score__value">{String(value).padStart(3, '0')}</span>
    </div>
  );
}
