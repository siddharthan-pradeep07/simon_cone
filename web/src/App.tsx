import { useCallback, useEffect, useRef, useState } from 'react';
import { LANES } from './game/constants';
import { Scene } from './game/Scene';
import { useGame } from './game/store';
import { command, type HardwareEvent } from './serial/protocol';
import { useColourLane } from './serial/useColourLane';
import { useHardware } from './serial/useHardware';
import { GameOver, Hud, Shout } from './ui/Hud';
import { Menu } from './ui/Menu';
import './index.css';

/** Floor on OLED redraws — a full frame is ~25 ms of blocking I2C on the board. */
const MIN_OLED_MS = 350;

/** The firmware's oledText buffer. */
const OLED_LIMIT = 39;

export default function App() {
  const phase = useGame((state) => state.phase);
  const score = useGame((state) => state.score);
  const play = useGame((state) => state.play);
  const toMenu = useGame((state) => state.toMenu);
  const setLane = useGame((state) => state.setLane);
  const setSensorLive = useGame((state) => state.setSensorLive);

  const [shout, setShout] = useState({ id: 0, text: '' });

  const colour = useColourLane(setLane);
  const { feed, reset: resetColour } = colour;

  const handleEvent = useCallback(
    (event: HardwareEvent) => {
      if (event.type === 'sample') feed(event.sample);
    },
    [feed],
  );

  const hardware = useHardware(handleEvent);
  const { state, send } = hardware;
  const connected = state === 'connected';

  useEffect(() => {
    setSensorLive(connected);
  }, [connected, setSensorLive]);

  // The game treats the sensor as a live three-way controller. Firmware v5+
  // exposes that stream as SCAN; it is enabled once on connection and remains
  // enabled so a colour shown during a run is acted on immediately.
  useEffect(() => {
    if (!connected) return;
    resetColour();
    send(command.gain(2));
    send(command.led(true));
    send(command.scan(true));
    return () => send(command.scan(false));
  }, [connected, resetColour, send]);

  const lastOledAt = useRef(0);
  const detected =
    colour.reading.lane === null ? 'NONE' : LANES[colour.reading.lane].oled;
  const oled =
    phase === 'playing'
      ? `${detected}|${score}`
      : phase === 'over'
        ? `OVER|${score}`
        : connected
          ? `SEES|${detected}`
          : 'SIMON|CONE';

  useEffect(() => {
    if (!connected) return;
    const text = oled.replace(/[\r\n]/g, ' ').slice(0, OLED_LIMIT);
    const wait = Math.max(0, MIN_OLED_MS - (Date.now() - lastOledAt.current));
    const timer = window.setTimeout(() => {
      lastOledAt.current = Date.now();
      send(command.oled(text));
    }, wait);
    return () => window.clearTimeout(timer);
  }, [connected, oled, send]);

  useEffect(() => {
    if (phase === 'playing') setShout((current) => ({ id: current.id + 1, text: 'GO!' }));
  }, [phase]);

  // The keyboard is not a fallback for the reader, it is how the game gets
  // tested and how anyone without the board can still play it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const current = useGame.getState();
      const key = event.key.toLowerCase();

      // No mute control on screen any more, but the shortcut stays: it costs
      // nothing and it is the only way to silence the game.
      if (key === 'm') {
        current.toggleMute();
        return;
      }
      if (key === 'escape') {
        if (current.phase === 'playing') current.endRun();
        else if (current.phase === 'over') current.toMenu();
        return;
      }
      if (key === 'enter' || key === ' ') {
        if (current.phase === 'menu' || current.phase === 'over') {
          event.preventDefault();
          current.play();
        }
        return;
      }
      if (current.phase !== 'playing' && current.phase !== 'intro') return;

      if (key === 'arrowleft' || key === 'a') current.setLane(current.lane - 1);
      else if (key === 'arrowright' || key === 'd') current.setLane(current.lane + 1);
      else if (key >= '1' && key <= '3') current.setLane(Number(key) - 1);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Scene />

      {phase === 'menu' && (
        <Menu
          device={{
            state,
            error: hardware.error,
            connect: () => void hardware.connect(),
            disconnect: () => void hardware.disconnect(),
            calibrate: colour.calibrate,
            reading: colour.reading,
          }}
          onPlay={play}
        />
      )}

      {(phase === 'playing' || phase === 'intro') && <Hud score={score} />}

      {phase === 'over' && <GameOver score={score} onPlay={play} onMenu={toMenu} />}

      {shout.text && phase === 'playing' && <Shout text={shout.text} id={shout.id} />}
    </>
  );
}
