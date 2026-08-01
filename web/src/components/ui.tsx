import type { ReactNode } from 'react';

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

/**
 * The reader itself. The beam only sweeps while the gate is open, so the
 * animation is load-bearing — it is the difference between "waiting for you"
 * and "not listening".
 */
export function SwipeStage({
  live,
  title,
  detail,
  level,
  present,
}: {
  live: boolean;
  title: string;
  detail: string;
  level: number;
  present: boolean;
}) {
  return (
    <div className={`stage${present ? ' stage--live' : ''}`}>
      <div className="stage__slot">
        {live && <span className="stage__beam" />}
        <span>{present ? 'reading' : live ? 'ready' : 'closed'}</span>
      </div>
      <h2>{title}</h2>
      <p className="muted">{detail}</p>
      <div className="meter">
        <div
          className="meter__fill"
          style={{ width: `${Math.min(100, Math.round(level * 100))}%` }}
        />
      </div>
    </div>
  );
}
