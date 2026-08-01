import { useEffect, useRef, useState } from 'react';
import { confidenceFrom, findMatch, swatches } from '../cards/signature';
import type { Account } from '../cards/store';
import type { CapturedSwipe, SwipeMeter } from '../cards/useSwipe';
import { Notice, SwipeStage } from '../components/ui';

const REASONS: Record<string, string> = {
  'no-accounts': 'No cards are enrolled on this device yet.',
  'too-far': 'That card is not one the reader knows.',
  ambiguous:
    'Two enrolled cards look too alike to tell apart. Re-enrol one of them with a more distinctive card.',
};

export function Login({
  accounts,
  lastSwipe,
  meter,
  ready,
  onReader,
  onMatch,
  onCancel,
}: {
  accounts: Account[];
  lastSwipe: CapturedSwipe | null;
  meter: SwipeMeter;
  ready: boolean;
  onReader: (open: boolean, oled: string) => void;
  onMatch: (account: Account) => void;
  onCancel: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const consumed = useRef(0);

  useEffect(() => {
    onReader(true, 'Swipe|Card');
  }, [onReader]);

  useEffect(() => {
    if (!lastSwipe || lastSwipe.seq <= consumed.current) return;
    consumed.current = lastSwipe.seq;

    if (!lastSwipe.signature) {
      setFailure('That went past too fast to read. Try a slower, steadier pass.');
      return;
    }

    setPreview(swatches(lastSwipe.signature));
    const outcome = findMatch(lastSwipe.signature, accounts);

    if (outcome.best) {
      onMatch(outcome.best);
      return;
    }
    setFailure(REASONS[outcome.reason] ?? 'No match.');
  }, [lastSwipe, accounts, onMatch]);

  const confidence = lastSwipe?.signature
    ? confidenceFrom(findMatch(lastSwipe.signature, accounts).score)
    : 0;

  return (
    <div className="stack">
      <div>
        <h1>Swipe to sign in</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          The gate is open. Pass your card through the slot.
        </p>
      </div>

      <SwipeStage
        live={ready}
        present={meter.present}
        level={Math.min(1, meter.level / 700)}
        title={meter.present ? 'Reading…' : 'Waiting for a card'}
        detail={
          ready
            ? 'Same direction you enrolled with works best, but either way is fine.'
            : 'Waiting for the board…'
        }
      />

      {preview && (
        <div>
          <h3>Last read</h3>
          <div className="swatches">
            {preview.map((colour, index) => (
              <i key={index} style={{ background: colour }} />
            ))}
          </div>
          {accounts.length > 0 && (
            <p className="subtle" style={{ marginTop: 8 }}>
              Closest match confidence: {Math.round(confidence * 100)}%
            </p>
          )}
        </div>
      )}

      {failure && <Notice tone="error">{failure}</Notice>}

      <div className="row row--end">
        <button className="btn btn--ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
