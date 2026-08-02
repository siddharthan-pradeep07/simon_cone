import { useEffect, useMemo, useRef, useState } from 'react';
import { spread } from '../cards/match';
import type { CapturedPass, ReaderState } from '../cards/pass';
import { newId, saveAccount, type Account } from '../cards/store';
import { ColourList, Dataset, Field, Notice, ReaderStage } from '../components/ui';

/**
 * Swipes that make up the dataset.
 *
 * Each one is an example of how this card reads, and they differ: a band near a
 * hue boundary flips its name, a fast pass loses a thin stripe. Storing several
 * covers that variation by having contained it, which is what lets sign-in be a
 * single swipe held to a tight standard rather than one loose guess.
 */
const REQUIRED = 5;

type Step = 'details' | 'enrol';

export function CreateAccount({
  lastPass,
  state,
  ready,
  onReader,
  onDone,
  onCancel,
}: {
  lastPass: { pass: CapturedPass; seq: number } | null;
  state: ReaderState;
  ready: boolean;
  onReader: (open: boolean, oled: string) => void;
  onDone: (account: Account) => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('1000.00');
  const [recordings, setRecordings] = useState<string[][]>([]);
  const [warning, setWarning] = useState<string | null>(null);

  // Swipes are numbered so a capture is consumed exactly once. Without this the
  // page would re-add the same swipe on every unrelated re-render.
  const consumed = useRef(0);

  useEffect(() => {
    if (step === 'details') {
      onReader(false, 'ACCOUNT|CREATION');
    } else {
      onReader(true, `${recordings.length}/${REQUIRED}|SWIPE`);
    }
  }, [step, recordings.length, onReader]);

  useEffect(() => {
    if (step !== 'enrol' || !lastPass) return;
    if (lastPass.seq <= consumed.current) return;
    consumed.current = lastPass.seq;

    if (lastPass.pass.problem) {
      setWarning(lastPass.pass.problem);
      return;
    }
    setWarning(null);
    setRecordings((previous) =>
      previous.length >= REQUIRED ? previous : [...previous, lastPass.pass.colours],
    );
  }, [lastPass, step]);

  // How much the swipes so far disagree with each other. Shown live because a
  // card that reads inconsistently is worth knowing about now, while it can
  // still be fixed by swiping more carefully, rather than at sign-in.
  const agreement = useMemo(() => {
    if (recordings.length < 3) return null;
    return Math.max(0, Math.min(1, 1 - spread(recordings) / 0.4));
  }, [recordings]);

  const complete = recordings.length >= REQUIRED;
  const amount = Number(balance);
  const detailsValid = name.trim().length > 0 && Number.isFinite(amount) && amount >= 0;

  function finish() {
    const account: Account = {
      id: newId(),
      name: name.trim(),
      balance: amount,
      recordings,
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

  const latest = recordings[recordings.length - 1];

  return (
    <div className="stack">
      <div>
        <h1>Teach your card</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Move your card or picture across the sensor {REQUIRED} times, the same
          way each time. Each swipe records the colours along it, and together
          they become the dataset that recognises it.
        </p>
      </div>

      <ReaderStage
        live={ready}
        state={state}
        title={complete ? 'All done' : `${recordings.length} of ${REQUIRED}`}
        detail={
          complete
            ? 'The reader has enough to work with.'
            : ready
              ? 'Move it across the sensor, printed side down.'
              : 'Waiting for the board…'
        }
      />

      <div className="dots">
        {Array.from({ length: REQUIRED }, (_, index) => (
          <span
            key={index}
            className={`dot${index < recordings.length ? ' dot--done' : ''}`}
          />
        ))}
      </div>

      {latest && (
        <div>
          <h3>Last swipe</h3>
          <ColourList names={latest} />
        </div>
      )}

      {recordings.length > 1 && (
        <div>
          <h3>Dataset so far</h3>
          <Dataset recordings={recordings} />
        </div>
      )}

      {warning && <Notice tone="error">{warning}</Notice>}

      {agreement !== null && agreement < 0.4 && !complete && (
        <Notice>
          These swipes are not agreeing with each other much. Keep the speed and
          direction consistent — the reader is learning the colours along the
          card, so it matters which way round it goes and how fast.
        </Notice>
      )}

      <div className="row row--end">
        <button className="btn btn--ghost" onClick={() => setRecordings([])}>
          Start over
        </button>
        <button className="btn btn--primary" disabled={!complete} onClick={finish}>
          Create account
        </button>
      </div>
    </div>
  );
}
