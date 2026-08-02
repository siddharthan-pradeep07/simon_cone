import { useEffect, useState } from 'react';
import { Button, Score } from './parts';

/** The "GO!" that fires once when control is handed to the player. */
export function Shout({ text, id }: { text: string; id: number }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 850);
    return () => window.clearTimeout(timer);
  }, [id]);

  if (!visible) return null;
  return (
    <div className="shout" key={id}>
      {text}
    </div>
  );
}

export function Hud({ score }: { score: number }) {
  return (
    <div className="overlay">
      <div className="hud">
        <Score value={score} />
      </div>
    </div>
  );
}

export function GameOver({
  score,
  onPlay,
  onMenu,
}: {
  score: number;
  onPlay: () => void;
  onMenu: () => void;
}) {
  return (
    <div className="overlay">
      <div className="card">
        <div className="card__inner">
          <h2 className="card__title">Run over</h2>
          <Score value={score} centred />
          <div className="card__buttons">
            <Button onClick={onPlay}>Play again</Button>
            <Button tone="quiet" onClick={onMenu}>
              Menu
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
