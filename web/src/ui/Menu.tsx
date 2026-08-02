import { useState } from 'react';
import type { ColourReading } from '../serial/useColourLane';
import type { ConnectionState } from '../serial/useHardware';
import { Button, ConnectButton } from './parts';

export interface DeviceProps {
  state: ConnectionState;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  calibrate: () => boolean;
  reading: ColourReading;
}

export function Menu({ device, onPlay }: { device: DeviceProps; onPlay: () => void }) {
  const [calibration, setCalibration] = useState<string | null>(null);
  const detected = device.reading.lane === null
    ? null
    : ['Red', 'Green', 'Blue'][device.reading.lane];

  const calibrate = () => {
    const ok = device.calibrate();
    setCalibration(
      ok
        ? 'Calibrated — now show red, green, or blue.'
        : 'No reading yet. Hold white over the sensor and try again.',
    );
  };

  return (
    <div className="overlay">
      <div className="menu">
        <div className="menu__panel">
          <h1 className="title">
            <span>Simon</span>
            <span>Cone</span>
          </h1>

          <div className="menu__buttons">
            <Button size="huge" onClick={onPlay}>
              Play
            </Button>

            <ConnectButton
              state={device.state}
              onConnect={device.connect}
              onDisconnect={device.disconnect}
            />

            {device.state === 'connected' && (
              <>
                <div className={`sensor-readout sensor-readout--${detected?.toLowerCase() ?? 'none'}`}>
                  <i />
                  <span>{detected ? `Detecting ${detected}` : 'No colour detected'}</span>
                  <small>
                    R {Math.round(device.reading.chroma.r * 100)} · G{' '}
                    {Math.round(device.reading.chroma.g * 100)} · B{' '}
                    {Math.round(device.reading.chroma.b * 100)} · light{' '}
                    {Math.round(device.reading.clear)}
                  </small>
                </div>
                <Button
                  tone="quiet"
                  size="small"
                  onClick={calibrate}
                  title="Hold plain white over the reader, then click"
                >
                  Calibrate white
                </Button>
                {calibration && (
                  <p className="calibration-message" role="status">
                    {calibration}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {device.error && (
        <div className="corner corner--bottom-left">
          <p className="banner">{device.error}</p>
        </div>
      )}
    </div>
  );
}
