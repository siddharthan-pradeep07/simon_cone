import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BAUD_RATE,
  parseLine,
  type HardwareEvent,
  type JoystickDirection,
  type Lights,
} from './protocol';

export type ConnectionState =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected';

export interface LogEntry {
  id: number;
  direction: 'in' | 'out' | 'sys';
  text: string;
  at: number;
}

const LOG_LIMIT = 300;

/** How long to wait for READY before assuming the board is up anyway. */
const READY_TIMEOUT_MS = 5000;

export interface Hardware {
  state: ConnectionState;
  error: string | null;
  logs: LogEntry[];
  color: string | null;
  joystick: JoystickDirection | null;
  buttonDown: boolean;
  /** Mirrors the board's own state; null until it reports LIGHTS. */
  lights: Lights | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  send: (line: string) => void;
  clearLogs: () => void;
  /** Feed a synthetic event in, so the UI is buildable with nothing plugged in. */
  emulate: (event: HardwareEvent) => void;
}

export function useHardware(
  onEvent?: (event: HardwareEvent) => void,
): Hardware {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [color, setColor] = useState<string | null>(null);
  const [joystick, setJoystick] = useState<JoystickDirection | null>(null);
  const [buttonDown, setButtonDown] = useState(false);
  const [lights, setLights] = useState<Lights | null>(null);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readyTimerRef = useRef<number | null>(null);
  const logIdRef = useRef(0);

  // Keep the latest callback without making connect() depend on it, otherwise
  // every render of the consumer would tear down the read loop.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!('serial' in navigator)) setState('unsupported');
  }, []);

  const log = useCallback((direction: LogEntry['direction'], text: string) => {
    setLogs((previous) => {
      const next = [
        ...previous,
        { id: logIdRef.current++, direction, text, at: Date.now() },
      ];
      return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next;
    });
  }, []);

  const dispatch = useCallback((event: HardwareEvent) => {
    switch (event.type) {
      case 'ready':
        if (readyTimerRef.current !== null) {
          window.clearTimeout(readyTimerRef.current);
          readyTimerRef.current = null;
        }
        setState('connected');
        break;
      case 'lights':
        setLights(event.lights);
        break;
      case 'color':
        setColor(event.name);
        break;
      case 'joystick':
        setJoystick(event.direction);
        break;
      case 'button':
        setButtonDown(event.pressed);
        break;
    }
    onEventRef.current?.(event);
  }, []);

  const emulate = useCallback(
    (event: HardwareEvent) => {
      log('sys', `emulated ${JSON.stringify(event)}`);
      dispatch(event);
    },
    [dispatch, log],
  );

  const teardown = useCallback(async () => {
    if (readyTimerRef.current !== null) {
      window.clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
    try {
      await readerRef.current?.cancel();
    } catch {
      /* already gone */
    }
    readerRef.current = null;

    try {
      writerRef.current?.releaseLock();
    } catch {
      /* already gone */
    }
    writerRef.current = null;

    try {
      await portRef.current?.close();
    } catch {
      /* already gone */
    }
    portRef.current = null;

    setState('disconnected');
    setLights(null);  // stale toggles are worse than no toggles
  }, []);

  const readLoop = useCallback(
    async (port: SerialPort) => {
      const reader = port.readable!.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // The board can split a line across USB packets, so only consume up
          // to the last newline and keep the remainder for the next chunk.
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).replace(/\r$/, '');
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            log('in', line);
            dispatch(parseLine(line));
          }
        }
      } catch (cause) {
        log('sys', `read failed: ${(cause as Error).message}`);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
      }
    },
    [dispatch, log],
  );

  const connect = useCallback(async () => {
    if (!('serial' in navigator)) {
      setState('unsupported');
      return;
    }
    setError(null);

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: BAUD_RATE });
      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      setState('connecting');
      log('sys', `port opened at ${BAUD_RATE} baud, waiting for READY`);

      // Opening the port toggles DTR, which resets the board. It takes a
      // couple of seconds to come back and announce itself.
      readyTimerRef.current = window.setTimeout(() => {
        readyTimerRef.current = null;
        setState((current) => (current === 'connecting' ? 'connected' : current));
        log('sys', 'no READY received, assuming the board is up');
      }, READY_TIMEOUT_MS);

      void readLoop(port).then(teardown);
    } catch (cause) {
      const message = (cause as Error).message;
      // Dismissing the port picker throws, and that is not worth surfacing.
      if (!/No port selected/i.test(message)) setError(message);
      await teardown();
    }
  }, [log, readLoop, teardown]);

  const send = useCallback(
    (line: string) => {
      const writer = writerRef.current;
      if (!writer) {
        log('sys', `not connected, dropped: ${line}`);
        return;
      }
      log('out', line);
      void writer.write(new TextEncoder().encode(`${line}\n`));
    },
    [log],
  );

  const clearLogs = useCallback(() => setLogs([]), []);

  // Cable yanked out mid-session.
  useEffect(() => {
    if (!('serial' in navigator)) return;
    const handleDisconnect = () => {
      if (portRef.current) {
        log('sys', 'device disconnected');
        void teardown();
      }
    };
    navigator.serial.addEventListener('disconnect', handleDisconnect);
    return () =>
      navigator.serial.removeEventListener('disconnect', handleDisconnect);
  }, [log, teardown]);

  return {
    state,
    error,
    logs,
    color,
    joystick,
    buttonDown,
    lights,
    connect,
    disconnect: teardown,
    send,
    clearLogs,
    emulate,
  };
}
