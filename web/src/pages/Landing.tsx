import { Cone } from '../components/ui';

export function Landing({
  accounts,
  onCreate,
  onSignIn,
}: {
  accounts: number;
  onCreate: () => void;
  onSignIn: () => void;
}) {
  return (
    <div className="stack stack--lg">
      <div className="hero">
        <Cone className="hero__cone" />
        <h1>Simon Cone</h1>
        <p>
          Card access by colour. The reader learns the colours along your card,
          then recognises it from a single swipe.
        </p>
      </div>

      <div className="stack stack--sm">
        <button className="btn btn--primary btn--lg" onClick={onCreate}>
          Create account
        </button>
        <button className="btn btn--lg" onClick={onSignIn}>
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
