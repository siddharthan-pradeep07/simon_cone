import { useCallback, useEffect, useRef, useState } from 'react';
import { usePassReader, type CapturedPass } from './cards/pass';
import { deleteAccount, loadAccounts, type Account as AccountRecord } from './cards/store';
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
  const [lastPass, setLastPass] = useState<{ pass: CapturedPass; seq: number } | null>(
    null,
  );

  // What the current page wants the hardware doing. Pages declare it; this
  // component is the only thing that talks to the board.
  const [reader, setReader] = useState({ open: false, oled: 'SIMON|CONE' });

  const seq = useRef(0);
  const lastOledAt = useRef(0);

  const onPass = useCallback((pass: CapturedPass) => {
    seq.current++;
    setLastPass({ pass, seq: seq.current });
  }, []);

  const detector = usePassReader(onPass);
  const { feed, reset, state } = detector;

  const handleEvent = useCallback(
    (event: HardwareEvent) => {
      if (event.type === 'sample') feed(event.sample);
    },
    [feed],
  );

  const hardware = useHardware(handleEvent);
  const { state: link, send } = hardware;
  const connected = link === 'connected';

  const onReader = useCallback((open: boolean, oled: string) => {
    setReader((current) =>
      current.open === open && current.oled === oled ? current : { open, oled },
    );
  }, []);

  // `open` means "this page wants to read". Streaming stops elsewhere so the
  // log stays legible and the board is not talking for no reason.
  useEffect(() => {
    if (!connected) return;
    send(command.scan(reader.open));
    if (reader.open) reset();
  }, [connected, reader.open, send, reset]);

  // A redraw is ~25 ms of blocking I2C on the board, which would punch a hole in
  // the sample stream. Harmless while the sensor is clear, ruinous in the middle
  // of a swipe — so updates wait for the gap between them.
  useEffect(() => {
    if (!connected || state.present) return;
    const text = reader.oled.replace(/[\r\n]/g, ' ').slice(0, OLED_LIMIT);
    const wait = Math.max(0, MIN_OLED_MS - (Date.now() - lastOledAt.current));
    const timer = window.setTimeout(() => {
      lastOledAt.current = Date.now();
      send(command.oled(text));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [connected, reader.oled, send, state.present]);

  const go = useCallback((next: Route) => {
    setLastPass(null);
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
          <span className={`pill pill--${link}`}>
            <i /> {STATE_LABEL[link]}
          </span>
          {link === 'connected' || link === 'connecting' ? (
            <button className="btn" onClick={() => void hardware.disconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className="btn btn--primary"
              disabled={link === 'unsupported'}
              onClick={() => void hardware.connect()}
            >
              Connect board
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {link === 'unsupported' && (
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
            onSignIn={() => go({ name: 'login' })}
          />
        )}

        {route.name === 'create' && (
          <CreateAccount
            lastPass={lastPass}
            state={state}
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
            lastPass={lastPass}
            state={state}
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
            <button className="btn" onClick={reset}>
              Re-baseline
            </button>
            <button className="btn" onClick={() => send(command.gain(1))}>
              Gain 4x
            </button>
            <button className="btn" onClick={() => send(command.gain(2))}>
              Gain 16x
            </button>
            <button className="btn" onClick={() => send(command.gain(3))}>
              Gain 60x
            </button>
            <button className="btn" onClick={hardware.clearLogs}>
              Clear log
            </button>
          </div>
          {lastPass && (
            <p className="subtle" style={{ marginTop: 10 }}>
              Last swipe: {lastPass.pass.samples} samples over{' '}
              {Math.round(lastPass.pass.durationMs)} ms —{' '}
              {lastPass.pass.colours.join(' → ') || 'nothing named'}
            </p>
          )}
          <p className="subtle" style={{ marginTop: 6 }}>
            Empty sensor: r {Math.round(state.white.r)} · g {Math.round(state.white.g)} ·
            b {Math.round(state.white.b)} · c {Math.round(state.white.c)}
          </p>
        </details>
      </main>
    </div>
  );
}
