import { useEffect } from 'react';
import { money, type Account as AccountRecord } from '../cards/store';
import { swatches } from '../cards/signature';
import { Kv } from '../components/ui';

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
    // Gate closed: nothing to read here, and leaving a servo holding an open
    // position just draws current and buzzes.
    const short = account.name.split(' ')[0].slice(0, 10);
    onReader(false, `${short}|$${Math.round(account.balance)}`);
  }, [account, onReader]);

  const card = swatches(account.template.mean);

  return (
    <div className="stack">
      <div className="account-card">
        <p className="account-card__label">Balance</p>
        <p className="account-card__balance">${money.format(account.balance)}</p>
        <p className="account-card__name">{account.name}</p>
      </div>

      <div className="card">
        <h3>Card on file</h3>
        <div className="swatches">
          {card.map((colour, index) => (
            <i key={index} style={{ background: colour }} />
          ))}
        </div>
        <div style={{ marginTop: 16 }}>
          <Kv label="Enrolment swipes" value={account.swipes} />
          <Kv
            label="Card consistency"
            value={`±${account.template.spread.toFixed(4)}`}
          />
          <Kv
            label="Enrolled"
            value={new Date(account.createdAt).toLocaleDateString()}
          />
        </div>
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
