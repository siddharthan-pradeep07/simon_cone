import { useCallback, useEffect, useRef, useState } from 'react';
import { extractSignature } from './cards/signature';
import { deleteAccount, loadAccounts, type Account as AccountRecord } from './cards/store';
import { useSwipe, type CapturedSwipe } from './cards/useSwipe';
import { Cone } from './components/ui';
import { Account } from './pages/Account';
import { CreateAccount } from './pages/CreateAccount';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { command, type HardwareEvent } from './serial/protocol';
import { useHardware } from './serial/useHardware';
import './index.css';

type Route =
  | { name: 'landing' }
  | { name: 'create' }
  | { name: 'login' }
  | { name: 'account'; id: string };

const STATE_LABEL: Record<string, string> = {
  unsupported: 'Web Serial unsupported',
  disconnected: 'Board offline',
  connecting: 'Starting board…',
  connected: 'Board ready',
};

/** Floor on OLED redraws — a full frame is ~25 ms of blocking I2C. */
const MIN_OLED_MS = 350;

/** The firmware's oledText buffer. */
const OLED_LIMIT = 39;

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'landing' });
  const [accounts, setAccounts] = useState<AccountRecord[]>(() => loadAccounts());
  const [lastSwipe, setLastSwipe] = useState<CapturedSwipe | null>(null);

  // What the current page wants the hardware doing. Pages declare it; this
  // component is the only thing that talks to the board.
  const [reader, setReader] = useState({ open: false, oled: 'SIMON|CONE' });

  const seq = useRef(0);
  const lastOledAt = useRef(0);

  const onSwipe = useCallback((samples: Parameters<typeof extractSignature>[0]) => {
    seq.current++;
    const first = samples[0];
    const last = samples[samples.length - 1];
    setLastSwipe({
      seq: seq.current,
      signature: extractSignature(samples),
      samples: samples.length,
      durationMs: first && last ? last.t - first.t : 0,
    });
  }, []);

  const swipe = useSwipe(onSwipe);
  const { feed } = swipe;

  const handleEvent = useCallback(
    (event: HardwareEvent) => {
      if (event.type === 'sample') feed(event.sample);
    },
    [feed],
  );

  const hardware = useHardware(handleEvent);
  const { state, send } = hardware;
  const connected = state === 'connected';

  const onReader = useCallback((open: boolean, oled: string) => {
    setReader((current) =>
      current.open === open && current.oled === oled ? current : { open, oled },
    );
  }, []);

  // Opening the gate and starting the stream are one action as far as the app
  // is concerned: there is no reason to read while the shutter is shut, and no
  // reason to shut it while a page is waiting for a card.
  useEffect(() => {
    if (!connected) return;
    send(command.gate(reader.open));
    send(command.swipe(reader.open));
    if (reader.open) swipe.reset();
  }, [connected, reader.open, send, swipe]);

  useEffect(() => {
    if (!connected) return;
    const text = reader.oled.replace(/[\r\n]/g, ' ').slice(0, OLED_LIMIT);
    const wait = Math.max(0, MIN_OLED_MS - (Date.now() - lastOledAt.current));
    const timer = window.setTimeout(() => {
      lastOledAt.current = Date.now();
      send(command.oled(text));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [connected, reader.oled, send]);

  const go = useCallback((next: Route) => {
    setLastSwipe(null);
    setRoute(next);
  }, []);

  const account =
    route.name === 'account'
      ? (accounts.find((entry) => entry.id === route.id) ?? null)
      : null;

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => go({ name: 'landing' })}>
          <Cone className="cone-mark" />
          Simon Cone
        </button>
        <div className="topbar__right">
          <span className={`pill pill--${state}`}>
            <i /> {STATE_LABEL[state]}
          </span>
          {state === 'connected' || state === 'connecting' ? (
            <button className="btn" onClick={() => void hardware.disconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className="btn btn--primary"
              disabled={state === 'unsupported'}
              onClick={() => void hardware.connect()}
            >
              Connect board
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {state === 'unsupported' && (
          <p className="notice notice--error" style={{ marginBottom: 20 }}>
            This browser has no Web Serial API. Use Chrome, Edge or Opera on desktop.
          </p>
        )}
        {hardware.error && (
          <p className="notice notice--error" style={{ marginBottom: 20 }}>
            {hardware.error}
          </p>
        )}

        {route.name === 'landing' && (
          <Landing
            accounts={accounts.length}
            onCreate={() => go({ name: 'create' })}
            onSwipe={() => go({ name: 'login' })}
          />
        )}

        {route.name === 'create' && (
          <CreateAccount
            lastSwipe={lastSwipe}
            meter={swipe.meter}
            ready={connected && reader.open}
            onReader={onReader}
            onCancel={() => go({ name: 'landing' })}
            onDone={(created) => {
              setAccounts(loadAccounts());
              go({ name: 'account', id: created.id });
            }}
          />
        )}

        {route.name === 'login' && (
          <Login
            accounts={accounts}
            lastSwipe={lastSwipe}
            meter={swipe.meter}
            ready={connected && reader.open}
            onReader={onReader}
            onCancel={() => go({ name: 'landing' })}
            onMatch={(matched) => go({ name: 'account', id: matched.id })}
          />
        )}

        {route.name === 'account' &&
          (account ? (
            <Account
              account={account}
              onReader={onReader}
              onSignOut={() => go({ name: 'landing' })}
              onDelete={(id) => {
                setAccounts(deleteAccount(id));
                go({ name: 'landing' });
              }}
            />
          ) : (
            <p className="notice">That account no longer exists.</p>
          ))}

        <details className="debug">
          <summary>Board log</summary>
          <ol className="log">
            {hardware.logs.length === 0 && <li>Nothing yet.</li>}
            {hardware.logs
              .slice(-60)
              .reverse()
              .map((entry) => (
                <li key={entry.id} className={`log__line--${entry.direction}`}>
                  <span className="log__dir">
                    {entry.direction === 'in' ? '<-' : entry.direction === 'out' ? '->' : '**'}
                  </span>
                  <span>{entry.text}</span>
                </li>
              ))}
          </ol>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => send(command.gate(!reader.open))}>
              Toggle gate
            </button>
            <button className="btn" onClick={() => send(command.gain(1))}>
              Gain 4x
            </button>
            <button className="btn" onClick={() => send(command.gain(2))}>
              Gain 16x
            </button>
            <button className="btn" onClick={hardware.clearLogs}>
              Clear log
            </button>
          </div>
          {lastSwipe && (
            <p className="subtle" style={{ marginTop: 10 }}>
              Last swipe: {lastSwipe.samples} samples over {lastSwipe.durationMs} ms
              {lastSwipe.signature ? '' : ' — too short to use'}
            </p>
          )}
        </details>
      </main>
    </div>
  );
}
