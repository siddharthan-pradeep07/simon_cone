import type { ConnectionState } from '../serial/useHardware';
import { Button, ConnectButton } from './parts';

export interface DeviceProps {
  state: ConnectionState;
  error: string | null;
  connect: () => void;
  disconnect: () => void;
  calibrate: () => void;
}

export function Menu({ device, onPlay }: { device: DeviceProps; onPlay: () => void }) {
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
              <Button
                tone="quiet"
                size="small"
                onClick={device.calibrate}
                title="Hold plain white under the reader first"
              >
                Calibrate white
              </Button>
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
