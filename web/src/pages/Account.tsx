import { useEffect } from 'react';
import { money, type Account as AccountRecord } from '../cards/store';
import { spread } from '../cards/match';
import { Dataset, Kv } from '../components/ui';

export function Account({
  account,
  onReader,
  onSignOut,
  onDelete,
}: {
  account: AccountRecord;
  onReader: (open: boolean, oled: string) => void;
  onSignOut: () => void;
  onDelete: (id: string) => void;
}) {
  useEffect(() => {
    // Nothing to read on this page, so the sample stream is stopped: it keeps
    // the board log legible and stops the reader talking for no reason.
    const short = account.name.split(' ')[0].slice(0, 10);
    onReader(false, `${short}|$${Math.round(account.balance)}`);
  }, [account, onReader]);

  return (
    <div className="stack">
      <div className="account-card">
        <p className="account-card__label">Balance</p>
        <p className="account-card__balance">${money.format(account.balance)}</p>
        <p className="account-card__name">{account.name}</p>
      </div>

      <div className="card">
        <h3>Card on file</h3>
        <Dataset recordings={account.recordings} />
        <div style={{ marginTop: 16 }}>
          <Kv label="Enrolment swipes" value={account.recordings.length} />
          <Kv
            label="Card consistency"
            value={`±${spread(account.recordings).toFixed(2)}`}
          />
          <Kv
            label="Enrolled"
            value={new Date(account.createdAt).toLocaleDateString()}
          />
        </div>
        <p className="subtle" style={{ marginTop: 12 }}>
          This reads what anyone can see by looking at the card. It identifies an
          account; it does not secure one.
        </p>
      </div>

      <div className="row row--end">
        <button className="btn btn--danger" onClick={() => onDelete(account.id)}>
          Delete account
        </button>
        <button className="btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
