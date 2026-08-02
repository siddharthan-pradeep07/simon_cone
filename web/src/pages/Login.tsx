import { useEffect, useRef, useState } from 'react';
import { confidenceFrom, findMatch } from '../cards/match';
import type { CapturedPass, ReaderState } from '../cards/pass';
import type { Account } from '../cards/store';
import { ColourList, Notice, ReaderStage } from '../components/ui';

const REASONS: Record<string, string> = {
  'no-accounts': 'No cards are enrolled on this device yet.',
  'too-far': 'That card is not one the reader knows. Swipe again to retry.',
  ambiguous:
    'Two enrolled cards look too alike to tell apart. Swipe again, or re-enrol one of them with a more distinctive card.',
};

export function Login({
  accounts,
  lastPass,
  state,
  ready,
  onReader,
  onMatch,
  onCancel,
}: {
  accounts: Account[];
  lastPass: { pass: CapturedPass; seq: number } | null;
  state: ReaderState;
  ready: boolean;
  onReader: (open: boolean, oled: string) => void;
  onMatch: (account: Account) => void;
  onCancel: () => void;
}) {
  const [attempt, setAttempt] = useState<{
    message: string;
    colours: string[];
    confidence: number;
  } | null>(null);
  const [tries, setTries] = useState(0);
  const consumed = useRef(0);

  useEffect(() => {
    onReader(true, 'SWIPE|TO SIGN IN');
  }, [onReader]);

  useEffect(() => {
    if (!lastPass || lastPass.seq <= consumed.current) return;
    consumed.current = lastPass.seq;

    const { pass } = lastPass;
    if (pass.problem) {
      setAttempt({ message: pass.problem, colours: pass.colours, confidence: 0 });
      return;
    }

    const outcome = findMatch(pass.colours, accounts);
    if (outcome.best) {
      onMatch(outcome.best);
      return;
    }

    setTries((count) => count + 1);
    setAttempt({
      message: REASONS[outcome.reason] ?? 'No match.',
      colours: pass.colours,
      confidence: confidenceFrom(outcome.score),
    });
  }, [lastPass, accounts, onMatch]);

  return (
    <div className="stack">
      <div>
        <h1>Swipe to sign in</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          One swipe. If the reader cannot tell which account it is, just swipe
          again.
        </p>
      </div>

      <ReaderStage
        live={ready}
        state={state}
        title={state.present ? 'Reading…' : 'Waiting for a card'}
        detail={
          ready
            ? 'Same direction you enrolled with works best, but either way is fine.'
            : 'Waiting for the board…'
        }
      />

      {attempt && (
        <div>
          <Notice tone="error">{attempt.message}</Notice>
          <h3 style={{ marginTop: 16 }}>What the reader saw</h3>
          <ColourList
            names={attempt.colours}
            empty="Nothing held steady long enough to name."
          />
          {accounts.length > 0 && attempt.colours.length > 0 && (
            <p className="subtle" style={{ marginTop: 10 }}>
              Closest match confidence: {Math.round(attempt.confidence * 100)}%
              {tries > 2 && ' · if this keeps failing, the card may need re-enrolling'}
            </p>
          )}
        </div>
      )}

      <div className="row row--end">
        <button className="btn btn--ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
