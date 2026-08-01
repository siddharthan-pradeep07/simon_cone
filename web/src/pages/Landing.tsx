import { Cone } from '../components/ui';

export function Landing({
  accounts,
  onCreate,
  onSwipe,
}: {
  accounts: number;
  onCreate: () => void;
  onSwipe: () => void;
}) {
  return (
    <div className="stack stack--lg">
      <div className="hero">
        <Cone className="hero__cone" />
        <h1>Simon Cone</h1>
        <p>
          Card access by colour. The reader looks at your card and remembers what
          it saw.
        </p>
      </div>

      <div className="stack stack--sm">
        <button className="btn btn--primary btn--lg" onClick={onCreate}>
          Create account
        </button>
        <button className="btn btn--lg" onClick={onSwipe}>
          Swipe to sign in
        </button>
      </div>

      <p className="subtle" style={{ textAlign: 'center' }}>
        {accounts === 0
          ? 'No accounts enrolled yet.'
          : `${accounts} account${accounts === 1 ? '' : 's'} enrolled on this device.`}
      </p>
    </div>
  );
}
