import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTemplate, swatches } from '../cards/signature';
import { newId, saveAccount, type Account } from '../cards/store';
import { Field, Notice, SwipeStage } from '../components/ui';
import type { CapturedSwipe, SwipeMeter } from '../cards/useSwipe';

/**
 * Ten swipes. Each one is a sample of how this card reads, and the template is
 * their average — so the count is doing two jobs. It smooths out the variation
 * between swipes, and the amount they disagree by *is* the tolerance the
 * matcher later uses for this card. One swipe would give an average with no
 * measure of its own reliability.
 */
const REQUIRED = 10;

type Step = 'details' | 'enrol';

export function CreateAccount({
  lastSwipe,
  meter,
  ready,
  onReader,
  onDone,
  onCancel,
}: {
  lastSwipe: CapturedSwipe | null;
  meter: SwipeMeter;
  ready: boolean;
  onReader: (open: boolean, oled: string) => void;
  onDone: (account: Account) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('1000.00');
  const [swipes, setSwipes] = useState<number[][]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  // Swipes are numbered so a capture is consumed exactly once. Without this the
  // page would re-add the same swipe on every unrelated re-render.
  const consumed = useRef(0);

  useEffect(() => {
    if (step === 'details') {
      onReader(false, 'Account|Creation');
    } else {
      onReader(true, `Swipe|${swipes.length} / ${REQUIRED}`);
    }
  }, [step, swipes.length, onReader]);

  useEffect(() => {
    if (step !== 'enrol' || !lastSwipe) return;
    if (lastSwipe.seq <= consumed.current) return;
    consumed.current = lastSwipe.seq;

    if (!lastSwipe.signature) {
      setWarning('That went past too fast to read. Try a slower, steadier pass.');
      return;
    }
    setWarning(null);
    setSwipes((previous) =>
      previous.length >= REQUIRED ? previous : [...previous, lastSwipe.signature!],
    );
  }, [lastSwipe, step]);

  // How much the swipes so far agree with each other. Shown live because a
  // card that reads inconsistently is worth knowing about now, while it can
  // still be fixed by swiping more carefully, rather than at sign-in.
  const agreement = useMemo(() => {
    if (swipes.length < 3) return null;
    // Spread is the mean distance from the average swipe. 0.06 is roughly where
    // a card stops being reliably separable from a different one.
    return Math.max(0, Math.min(1, 1 - buildTemplate(swipes).spread / 0.06));
  }, [swipes]);

  const preview = swipes.length > 0 ? swatches(buildTemplate(swipes).mean) : null;

  const complete = swipes.length >= REQUIRED;
  const amount = Number(balance);
  const detailsValid = name.trim().length > 0 && Number.isFinite(amount) && amount >= 0;

  function finish() {
    const account: Account = {
      id: newId(),
      name: name.trim(),
      balance: amount,
      template: buildTemplate(swipes),
      swipes: swipes.length,
      createdAt: Date.now(),
    };
    saveAccount(account);
    onDone(account);
  }

  if (step === 'details') {
    return (
      <div className="stack">
        <div>
          <h1>Create account</h1>
          <p className="muted" style={{ marginTop: 8 }}>
            Your details first, then we teach the reader your card.
          </p>
        </div>

        <div className="card stack">
          <Field label="Name">
            <input
              className="input"
              value={name}
              placeholder="Alex Whitfield"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && detailsValid) setStep('enrol');
              }}
            />
          </Field>

          <Field label="Opening balance">
            <div className="field__wrap">
              <span className="field__prefix">$</span>
              <input
                className="input input--prefixed"
                value={balance}
                inputMode="decimal"
                onChange={(event) => setBalance(event.target.value)}
              />
            </div>
          </Field>
        </div>

        <div className="row row--end">
          <button className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={!detailsValid}
            onClick={() => setStep('enrol')}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div>
        <h1>Teach your card</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          The gate is open. Pass any card through the slot {REQUIRED} times, the
          same way each time.
        </p>
      </div>

      <SwipeStage
        live={ready}
        present={meter.present}
        level={Math.min(1, meter.level / 700)}
        title={complete ? 'All done' : `${swipes.length} of ${REQUIRED}`}
        detail={
          complete
            ? 'The reader has enough to work with.'
            : ready
              ? 'Slide the card through, front face down.'
              : 'Waiting for the board…'
        }
      />

      <div className="dots">
        {Array.from({ length: REQUIRED }, (_, index) => (
          <span key={index} className={`dot${index < swipes.length ? ' dot--done' : ''}`} />
        ))}
      </div>

      {preview && (
        <div>
          <h3>What the reader sees</h3>
          <div className="swatches">
            {preview.map((colour, index) => (
              <i key={index} style={{ background: colour }} />
            ))}
          </div>
        </div>
      )}

      {warning && <Notice tone="error">{warning}</Notice>}

      {agreement !== null && agreement < 0.35 && !complete && (
        <Notice>
          These swipes are not agreeing with each other much. Keep the speed and
          direction consistent — the reader is learning the colours along the
          card, so it matters which way round it goes.
        </Notice>
      )}

      {meter.clipped && (
        <Notice>
          The sensor is saturating on that card. It will still work, but a
          slightly higher pass, or lower gain in the debug panel, reads better.
        </Notice>
      )}

      <div className="row row--end">
        <button className="btn btn--ghost" onClick={() => setSwipes([])}>
          Start over
        </button>
        <button className="btn btn--primary" disabled={!complete} onClick={finish}>
          Create account
        </button>
      </div>
    </div>
  );
}
