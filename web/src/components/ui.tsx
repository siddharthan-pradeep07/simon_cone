import type { ReactNode } from 'react';
import { cssForName } from '../cards/colourName';
import type { ReaderState } from '../cards/pass';

export function Cone({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4 L50 56 H14 Z" fill="#f97316" />
      <path d="M26.8 19 H37.2 L38.9 24 H25.1 Z" fill="#fff" opacity="0.95" />
      <path d="M23.4 33 H40.6 L42.3 38 H21.7 Z" fill="#fff" opacity="0.95" />
      <rect x="8" y="55" width="48" height="6" rx="3" fill="#ea580c" />
    </svg>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <p className="subtle">{hint}</p>}
    </div>
  );
}

export function Notice({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'error' | 'ok';
  children: ReactNode;
}) {
  const suffix = tone === 'neutral' ? '' : ` notice--${tone}`;
  return <p className={`notice${suffix}`}>{children}</p>;
}

export function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** One swipe's colours, left to right in the order the sensor met them. */
export function ColourList({ names, empty }: { names: string[]; empty?: string }) {
  if (names.length === 0) {
    return <p className="subtle">{empty ?? 'Nothing read yet.'}</p>;
  }
  return (
    <ol className="seq">
      {names.map((name, index) => (
        // Positions are the identity here: the same colour can legitimately
        // appear twice along one card, so the index is the key.
        <li key={index} className="seq__item">
          <span className="seq__chip" style={{ background: cssForName(name) }} />
          <span className="seq__name">{name}</span>
        </li>
      ))}
    </ol>
  );
}

/** A whole dataset — one row per enrolment swipe. */
export function Dataset({ recordings }: { recordings: string[][] }) {
  return (
    <ol className="dataset">
      {recordings.map((recording, index) => (
        <li key={index} className="dataset__row">
          <span className="dataset__index">{index + 1}</span>
          <span className="dataset__strip">
            {recording.map((name, position) => (
              <i key={position} style={{ background: cssForName(name) }} title={name} />
            ))}
          </span>
          <span className="dataset__names">{recording.join(' → ')}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The reader while a swipe is being made.
 *
 * The novelty bar is the one view that separates "nothing happened" from
 * "almost" — a swipe that fails to register is nearly always one that got close
 * to the trigger without reaching it, and no other readout shows the
 * difference.
 */
export function ReaderStage({
  live,
  state,
  title,
  detail,
}: {
  live: boolean;
  state: ReaderState;
  title: string;
  detail: string;
}) {
  const status = !live
    ? 'closed'
    : !state.receiving
      ? 'silent'
      : state.present
        ? 'reading'
        : 'ready';

  const seen = state.live;

  return (
    <div className={`stage stage--${status}`}>
      <div
        className={`stage__chip${state.present ? ' stage__chip--on' : ''}`}
        style={seen ? { background: seen.css } : undefined}
      />

      <h2>{status === 'silent' ? 'Reader not responding' : title}</h2>
      <p className="muted">
        {status === 'silent' ? 'The board is connected but sending no samples.' : detail}
      </p>

      <div className="meter">
        <div
          className="meter__fill"
          style={{ width: `${Math.min(100, Math.round((state.novelty / 1.6) * 100))}%` }}
        />
        <span className="meter__trigger" />
      </div>

      {state.building.length > 0 && (
        <div className="building">
          {state.building.map((name, index) => (
            <i key={index} style={{ background: cssForName(name) }} title={name} />
          ))}
        </div>
      )}

      <p className="live__hint">
        {state.receiving
          ? `${seen ? seen.name : '—'} · change ${(state.novelty * 100).toFixed(
              0,
            )}% of trigger · empty sensor reads ${Math.round(state.white.c)}`
          : 'no samples from the board'}
      </p>
    </div>
  );
}
