/**
 * On-screen mirror of the physical SSD1306.
 *
 * The wrapping rules here deliberately match renderOled() in src/main.cpp:
 * Adafruit_GFX wraps on character boundaries at 6*size pixels per glyph and
 * 8*size pixels per row, and the firmware picks size 2 for short messages.
 * If the preview and the panel ever disagree, one of the two is wrong.
 */

const WIDTH = 128;
const HEIGHT = 64;
const SCALE = 3;

function layout(text: string) {
  const size = text.length <= 20 ? 2 : 1;
  const columns = Math.floor(WIDTH / (6 * size));
  const rows = Math.floor(HEIGHT / (8 * size));

  const lines: string[] = [];
  for (let index = 0; index < text.length; index += columns) {
    lines.push(text.slice(index, index + columns));
  }
  return { size, lines: lines.slice(0, rows) };
}

export function OledPreview({ text }: { text: string }) {
  const { size, lines } = layout(text);
  const overflowed = lines.join('').length < text.length;

  return (
    <div className="oled">
      <div
        className="oled__screen"
        style={{ width: WIDTH * SCALE, height: HEIGHT * SCALE }}
      >
        {lines.map((line, index) => (
          <div
            key={index}
            className="oled__line"
            style={{
              fontSize: 8 * size * SCALE * 0.98,
              lineHeight: `${8 * size * SCALE}px`,
              letterSpacing: `${size * SCALE * 0.55}px`,
            }}
          >
            {line}
          </div>
        ))}
      </div>
      <p className="oled__meta">
        128×64 · text size {size} · {text.length} chars
        {overflowed && <span className="oled__warn"> · truncated on device</span>}
      </p>
    </div>
  );
}
