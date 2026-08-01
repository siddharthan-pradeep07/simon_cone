import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BAUD_RATE,
  DEFAULT_CONFIG,
  parseLine,
  type Config,
  type HardwareEvent,
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
}

const LOG_LIMIT = 200;

/** How long to wait for READY before assuming the board is up anyway. */
const READY_TIMEOUT_MS = 5000;

export function useHardware(onEvent?: (event: HardwareEvent) => void) {
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);

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
      const next = [...previous, { id: logIdRef.current++, direction, text }];
      return next.length > LOG_LIMIT ? next.slice(-LOG_LIMIT) : next;
    });
  }, []);

  const dispatch = useCallback((event: HardwareEvent) => {
    if (event.type === 'ready') {
      if (readyTimerRef.current !== null) {
        window.clearTimeout(readyTimerRef.current);
        readyTimerRef.current = null;
      }
      setState('connected');
    }
    if (event.type === 'config') setConfig(event.config);
    onEventRef.current?.(event);
  }, []);

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
    setConfig(DEFAULT_CONFIG);
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
            const event = parseLine(line);
            // Samples arrive 125 times a second. Appending each to React state
            // would spend the frame budget re-rendering a log nobody can read
            // at that speed.
            if (event.type !== 'sample') log('in', line);
            dispatch(event);
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

      // Opening the port toggles DTR, which resets the board. It takes a
      // couple of seconds to come back and announce itself.
      readyTimerRef.current = window.setTimeout(() => {
        readyTimerRef.current = null;
        setState((current) => (current === 'connecting' ? 'connected' : current));
      }, READY_TIMEOUT_MS);

      void readLoop(port).then(teardown);
    } catch (cause) {
      const message = (cause as Error).message;
      // Dismissing the port picker throws, and that is not worth surfacing.
      if (!/No port selected/i.test(message)) setError(message);
      await teardown();
    }
  }, [readLoop, teardown]);

  const send = useCallback(
    (line: string) => {
      const writer = writerRef.current;
      if (!writer) return;
      log('out', line);
      void writer.write(new TextEncoder().encode(`${line}\n`));
    },
    [log],
  );

  // Cable yanked out mid-session.
  useEffect(() => {
    if (!('serial' in navigator)) return;
    const handleDisconnect = () => {
      if (portRef.current) void teardown();
    };
    navigator.serial.addEventListener('disconnect', handleDisconnect);
    return () =>
      navigator.serial.removeEventListener('disconnect', handleDisconnect);
  }, [teardown]);

  return {
    state,
    error,
    logs,
    config,
    connect,
    disconnect: teardown,
    send,
    clearLogs: useCallback(() => setLogs([]), []),
  };
}
