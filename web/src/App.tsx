import { useCallback, useEffect, useMemo, useState } from 'react';
import { OledPreview } from './components/OledPreview';
import { command, type HardwareEvent } from './serial/protocol';
import { useHardware } from './serial/useHardware';
import './index.css';

const PRESETS = [
  'Simon says: Red',
  'Find: Blue',
  'Correct!',
  "Time's up!",
  'Hello from the browser',
];

const LIGHTS = [
  {
    key: 'led',
    label: 'Board LED',
    detail: 'pin 13 — the onboard "L"',
    toggle: command.led,
  },
  {
    key: 'sensor',
    label: 'Sensor illuminator',
    detail: 'white LED on the TCS34725',
    toggle: command.sensorLed,
  },
  {
    key: 'display',
    label: 'OLED panel',
    detail: 'display power, text is retained',
    toggle: command.display,
  },
] as const;

const STATE_LABEL: Record<string, string> = {
  unsupported: 'Web Serial unsupported',
  disconnected: 'Disconnected',
  connecting: 'Booting board…',
  connected: 'Connected',
};

export default function App() {
  const [draft, setDraft] = useState('Hello from the browser');
  // What we last told the board to display, as opposed to what is being typed.
  const [onScreen, setOnScreen] = useState('Waiting for browser...');
  const [servoAngles, setServoAngles] = useState<[number, number, number]>([90, 90, 90]);
  const [choice, setChoice] = useState(0);

  const handleEvent = useCallback((event: HardwareEvent) => {
    if (event.type === 'joystick') {
      if (event.direction === 'UP' || event.direction === 'LEFT') {
        setChoice((current) => (current - 1 + PRESETS.length) % PRESETS.length);
      } else {
        setChoice((current) => (current + 1) % PRESETS.length);
      }
    }
  }, []);

  const hardware = useHardware(handleEvent);
  const { state, send, emulate, lights } = hardware;
  const connected = state === 'connected' || state === 'connecting';

  const pushText = useCallback(
    (text: string) => {
      setOnScreen(text);
      send(command.oled(text));
    },
    [send],
  );

  // Keyboard stands in for the joystick so the UI is fully testable with
  // nothing plugged in — and doubles as a fallback if the cable misbehaves.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      const map: Record<string, HardwareEvent> = {
        ArrowUp: { type: 'joystick', direction: 'UP' },
        ArrowDown: { type: 'joystick', direction: 'DOWN' },
        ArrowLeft: { type: 'joystick', direction: 'LEFT' },
        ArrowRight: { type: 'joystick', direction: 'RIGHT' },
        Enter: { type: 'button', pressed: true },
      };
      const synthetic = map[event.key];
      if (!synthetic) return;
      event.preventDefault();
      emulate(synthetic);
      if (synthetic.type === 'button') {
        window.setTimeout(() => emulate({ type: 'button', pressed: false }), 120);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [emulate]);

  const setServo = (index: 0 | 1 | 2, angle: number) => {
    setServoAngles((current) => {
      const next = [...current] as [number, number, number];
      next[index] = angle;
      return next;
    });
    send(command.servo((index + 1) as 1 | 2 | 3, angle));
  };

  const logs = useMemo(() => hardware.logs.slice(-120).reverse(), [hardware.logs]);

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>simon_cone</h1>
          <p className="topbar__sub">hardware bridge · dev console</p>
        </div>
        <div className="topbar__right">
          <span className={`status status--${state}`}>
            <i /> {STATE_LABEL[state]}
          </span>
          {connected ? (
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

      {state === 'unsupported' && (
        <p className="banner">
          This browser has no Web Serial API. Use Chrome, Edge or Opera on desktop.
        </p>
      )}
      {hardware.error && <p className="banner banner--error">{hardware.error}</p>}

      <main className="grid">
        <section className="card">
          <h2>Display</h2>
          <OledPreview text={onScreen} />

          <div className="row">
            <input
              className="input"
              value={draft}
              placeholder="Text to show on the OLED"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && pushText(draft)}
            />
            <button className="btn btn--primary" onClick={() => pushText(draft)}>
              Send
            </button>
            <button
              className="btn"
              onClick={() => {
                setOnScreen('');
                send(command.clear());
              }}
            >
              Clear
            </button>
          </div>

          <h3>Presets — arrow keys or the joystick move the selection</h3>
          <ul className="choices">
            {PRESETS.map((preset, index) => (
              <li key={preset}>
                <button
                  className={`choice ${index === choice ? 'choice--active' : ''}`}
                  onClick={() => {
                    setChoice(index);
                    setDraft(preset);
                    pushText(preset);
                  }}
                >
                  {preset}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>Inputs</h2>
          <dl className="readouts">
            <div>
              <dt>Colour sensor</dt>
              <dd className="readout__value">{hardware.color ?? '—'}</dd>
            </div>
            <div>
              <dt>Last joystick</dt>
              <dd className="readout__value">{hardware.joystick ?? '—'}</dd>
            </div>
            <div>
              <dt>Button</dt>
              <dd className="readout__value">{hardware.buttonDown ? 'DOWN' : 'up'}</dd>
            </div>
          </dl>

          <h2>Lights</h2>
          {lights === null ? (
            <p className="hint">Connect the board to see its light state.</p>
          ) : (
            <ul className="lights">
              {LIGHTS.map(({ key, label, detail, toggle }) => (
                <li key={key}>
                  <button
                    className={`light ${lights[key] ? 'light--on' : ''}`}
                    onClick={() => send(toggle(!lights[key]))}
                  >
                    <span className="light__dot" />
                    <span className="light__text">
                      <b>{label}</b>
                      <small>{detail}</small>
                    </span>
                    <span className="light__state">{lights[key] ? 'ON' : 'OFF'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <button className="btn" onClick={() => send(command.allLights(false))}>
              All off
            </button>
            <button className="btn" onClick={() => send(command.allLights(true))}>
              All on
            </button>
          </div>

          <h2>Diagnostics</h2>
          <div className="row">
            <button className="btn" onClick={() => send(command.ping())}>
              Ping
            </button>
            <button className="btn" onClick={() => send(command.rawStream(true))}>
              Stream raw
            </button>
            <button className="btn" onClick={() => send(command.rawStream(false))}>
              Stop raw
            </button>
          </div>

          {servoAngles.map((angle, index) => (
            <label className="slider" key={index}>
              <span>
                Servo {index + 1}
                <b>{angle}°</b>
              </span>
              <input
                type="range"
                min={0}
                max={180}
                value={angle}
                onChange={(event) =>
                  setServo(index as 0 | 1 | 2, Number(event.target.value))
                }
              />
            </label>
          ))}
        </section>

        <section className="card card--wide">
          <div className="card__head">
            <h2>Serial log</h2>
            <button className="btn btn--small" onClick={hardware.clearLogs}>
              Clear
            </button>
          </div>
          <ol className="log">
            {logs.length === 0 && <li className="log__empty">Nothing yet.</li>}
            {logs.map((entry) => (
              <li key={entry.id} className={`log__line log__line--${entry.direction}`}>
                <span className="log__dir">
                  {entry.direction === 'in' ? '<-' : entry.direction === 'out' ? '->' : '**'}
                </span>
                <span>{entry.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
