#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_TCS34725.h>
#include <Servo.h>

// ---------------------------------------------------------------------------
// simon_cone firmware -- "dumb I/O" mode.
//
// The board owns no game logic. It reports its inputs over USB serial and
// executes whatever the web app tells it to do. Everything here is
// non-blocking so input is never dropped while a command is running.
//
// Protocol: newline-delimited text, 115200 baud.
//
//   in    PING              -> PONG
//         OLED <text>       -> OK OLED        (text is wrapped, auto-sized)
//         CLEAR             -> OK CLEAR
//         LED <0|1>         -> OK LED         (pin 13 / onboard "L")
//         SENSORLED <0|1>   -> OK SENSORLED   (TCS34725 white illuminator)
//         DISPLAY <0|1>     -> OK DISPLAY     (OLED panel power)
//         ALLOFF / ALLON    -> OK ALLOFF      (every light at once)
//         SERVO <1-3> <deg> -> OK SERVO
//         RAW <0|1>         -> OK RAW         (toggle raw sensor streaming)
//
//   out   READY <version>                     (sent once after boot)
//         LIGHTS <led> <sensor> <display>     (after boot and every change)
//         COLOR <name>                        (only when the reading changes)
//         RAW <r> <g> <b> <c>                 (when streaming is on)
//         JOY <UP|DOWN|LEFT|RIGHT>            (one per flick)
//         BTN <DOWN|UP>
//         ERR <reason>
// ---------------------------------------------------------------------------

#define FW_VERSION "1"

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SCREEN_ADDRESS 0x3C

// Flip to 1 once the joystick module is actually wired up. A floating analog
// pin drifts across the thresholds and spits out phantom JOY events.
#define JOYSTICK_ENABLED 0

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_50MS, TCS34725_GAIN_4X);

Servo servo1;
Servo servo2;
Servo servo3;
const int servo1Pin = 9;
const int servo2Pin = 10;
const int servo3Pin = 2;

const int ledPin = 13;

const unsigned long COLOR_POLL_MS = 120;
const unsigned long RAW_STREAM_MS = 250;

bool tcsOk = false;
bool rawStreaming = false;
unsigned long lastColorPoll = 0;
unsigned long lastRawStream = 0;
const char* lastColor = "";

char cmdBuf[72];
uint8_t cmdLen = 0;

char oledText[64] = "";
bool oledDirty = true;

// The board is the single source of truth for light state -- it announces
// LIGHTS after every change, so the web app never has to guess (it would
// otherwise drift every time connecting resets the board).
bool ledOn = false;
bool sensorLedOn = true;
bool displayOn = true;

#if JOYSTICK_ENABLED
const uint8_t joyXPin = A1;
const uint8_t joyYPin = A2;
const uint8_t joyBtnPin = 4;

// The stick idles near 512. A flick only counts once it crosses a threshold,
// and it does not count again until the stick has returned to the deadzone --
// otherwise one physical flick would scroll a menu by forty items.
const int JOY_LOW = 300;
const int JOY_HIGH = 723;
const unsigned long BTN_DEBOUNCE_MS = 30;

int8_t joyXState = 0;
int8_t joyYState = 0;
bool btnDown = false;
unsigned long btnChangedAt = 0;
#endif

// --- color sensor ----------------------------------------------------------

// Adafruit's getRawData() sleeps for a full integration period (~50 ms) on
// every call, which would make the whole loop stutter. The sensor is already
// free-running after begin(), so we read the data registers ourselves instead.
//
// Register map straight from the TCS3472 datasheet. 0x80 is the command bit,
// 0x20 selects auto-increment, so one transaction returns low byte then high.
const uint8_t TCS_ADDR       = 0x29;
const uint8_t TCS_CMD_AUTOINC = 0xA0;
const uint8_t TCS_REG_CDATAL = 0x14;
const uint8_t TCS_REG_RDATAL = 0x16;
const uint8_t TCS_REG_GDATAL = 0x18;
const uint8_t TCS_REG_BDATAL = 0x1A;

static uint16_t tcsRead16(uint8_t reg) {
  Wire.beginTransmission(TCS_ADDR);
  Wire.write(TCS_CMD_AUTOINC | reg);
  if (Wire.endTransmission() != 0) return 0;
  if (Wire.requestFrom(TCS_ADDR, (uint8_t)2) != 2) return 0;
  uint16_t lo = Wire.read();
  uint16_t hi = Wire.read();
  return (hi << 8) | lo;
}

const char* rgbToColorName(uint16_t r, uint16_t g, uint16_t b, uint16_t c) {
  if (c < 15) return "None";

  float rf = r / 255.0;
  float gf = g / 255.0;
  float bf = b / 255.0;

  float maxRaw = max(r, max(g, b));
  if (maxRaw > 255) {
    rf = r / maxRaw;
    gf = g / maxRaw;
    bf = b / maxRaw;
  }

  float maxVal = max(rf, max(gf, bf));
  float minVal = min(rf, min(gf, bf));
  float delta = maxVal - minVal;

  float hue = 0;
  float sat = (maxVal == 0) ? 0 : (delta / maxVal);
  float val = maxVal;

  if (delta > 0.0001) {
    if (maxVal == rf) {
      hue = 60.0 * fmod(((gf - bf) / delta), 6.0);
    } else if (maxVal == gf) {
      hue = 60.0 * (((bf - rf) / delta) + 2.0);
    } else {
      hue = 60.0 * (((rf - gf) / delta) + 4.0);
    }
  }
  if (hue < 0) hue += 360;

  if (sat < 0.15) {
    if (val < 0.25) return "Black";
    if (val > 0.75) return "White";
    return "Gray";
  }

  if (val < 0.15) return "Black";

  if (hue < 15 || hue >= 345) return "Red";
  if (hue < 78)  return "Yellow";
  if (hue < 170) return "Green";
  if (hue < 210) return "Blue";
  if (hue < 320) return "Purple";
  return "Pink";
}

void pumpColor(unsigned long now) {
  if (!tcsOk) return;

  uint16_t c = tcsRead16(TCS_REG_CDATAL);
  uint16_t r = tcsRead16(TCS_REG_RDATAL);
  uint16_t g = tcsRead16(TCS_REG_GDATAL);
  uint16_t b = tcsRead16(TCS_REG_BDATAL);

  const char* name = rgbToColorName(r, g, b, c);
  if (strcmp(name, lastColor) != 0) {
    lastColor = name;
    Serial.print(F("COLOR "));
    Serial.println(name);
  }

  if (rawStreaming && now - lastRawStream >= RAW_STREAM_MS) {
    lastRawStream = now;
    Serial.print(F("RAW "));
    Serial.print(r); Serial.print(' ');
    Serial.print(g); Serial.print(' ');
    Serial.print(b); Serial.print(' ');
    Serial.println(c);
  }
}

// --- display ---------------------------------------------------------------

void renderOled() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(true);
  // Size 2 fits 10 chars x 4 lines, size 1 fits 21 x 8. Pick whichever the
  // message actually fits into so short prompts stay readable across a room.
  display.setTextSize(strlen(oledText) <= 20 ? 2 : 1);
  display.setCursor(0, 0);
  display.print(oledText);
  display.display();
}

// --- lights ----------------------------------------------------------------

void reportLights() {
  Serial.print(F("LIGHTS "));
  Serial.print(ledOn ? 1 : 0);
  Serial.print(' ');
  Serial.print(sensorLedOn ? 1 : 0);
  Serial.print(' ');
  Serial.println(displayOn ? 1 : 0);
}

void setLed(bool on) {
  ledOn = on;
  digitalWrite(ledPin, on ? HIGH : LOW);
}

void setSensorLed(bool on) {
  if (!tcsOk) return;
  sensorLedOn = on;
  // On the Adafruit breakout the illuminator is wired to the interrupt pin,
  // so asserting the interrupt is what pulls the LED off. Inverted on purpose.
  tcs.setInterrupt(!on);
}

void setDisplay(bool on) {
  displayOn = on;
  display.ssd1306_command(on ? SSD1306_DISPLAYON : SSD1306_DISPLAYOFF);
}

// --- commands --------------------------------------------------------------

void handleCommand(char* line) {
  char* arg = strchr(line, ' ');
  if (arg) {
    *arg = '\0';
    arg++;
  }

  if (strcmp(line, "PING") == 0) {
    Serial.println(F("PONG"));
    return;
  }

  if (strcmp(line, "OLED") == 0) {
    strncpy(oledText, arg ? arg : "", sizeof(oledText) - 1);
    oledText[sizeof(oledText) - 1] = '\0';
    oledDirty = true;
    Serial.println(F("OK OLED"));
    return;
  }

  if (strcmp(line, "CLEAR") == 0) {
    oledText[0] = '\0';
    oledDirty = true;
    Serial.println(F("OK CLEAR"));
    return;
  }

  if (strcmp(line, "LED") == 0) {
    setLed(arg && atoi(arg));
    Serial.println(F("OK LED"));
    reportLights();
    return;
  }

  if (strcmp(line, "SENSORLED") == 0) {
    if (!tcsOk) {
      Serial.println(F("ERR no colour sensor"));
      return;
    }
    setSensorLed(arg && atoi(arg));
    Serial.println(F("OK SENSORLED"));
    reportLights();
    return;
  }

  if (strcmp(line, "DISPLAY") == 0) {
    setDisplay(arg && atoi(arg));
    Serial.println(F("OK DISPLAY"));
    reportLights();
    return;
  }

  if (strcmp(line, "ALLOFF") == 0 || strcmp(line, "ALLON") == 0) {
    bool on = strcmp(line, "ALLON") == 0;
    setLed(on);
    setSensorLed(on);
    setDisplay(on);
    Serial.print(F("OK "));
    Serial.println(line);
    reportLights();
    return;
  }

  if (strcmp(line, "RAW") == 0) {
    rawStreaming = arg && atoi(arg);
    Serial.println(F("OK RAW"));
    return;
  }

  if (strcmp(line, "SERVO") == 0) {
    int index = arg ? atoi(arg) : 0;
    char* second = arg ? strchr(arg, ' ') : nullptr;
    if (!second) {
      Serial.println(F("ERR SERVO needs index and angle"));
      return;
    }
    int angle = constrain(atoi(second + 1), 0, 180);
    if (index == 1)      servo1.write(angle);
    else if (index == 2) servo2.write(angle);
    else if (index == 3) servo3.write(angle);
    else {
      Serial.println(F("ERR SERVO index must be 1-3"));
      return;
    }
    Serial.println(F("OK SERVO"));
    return;
  }

  Serial.print(F("ERR unknown command "));
  Serial.println(line);
}

void pumpSerial() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      cmdBuf[cmdLen] = '\0';
      if (cmdLen > 0) handleCommand(cmdBuf);
      cmdLen = 0;
      continue;
    }
    if (cmdLen < sizeof(cmdBuf) - 1) cmdBuf[cmdLen++] = ch;
  }
}

// --- joystick --------------------------------------------------------------

#if JOYSTICK_ENABLED
void pumpJoystick(unsigned long now) {
  int x = analogRead(joyXPin);
  int8_t nx = (x < JOY_LOW) ? -1 : (x > JOY_HIGH ? 1 : 0);
  if (nx != joyXState) {
    joyXState = nx;
    // Swap LEFT/RIGHT here if the module is mounted the other way round.
    if (nx == -1)     Serial.println(F("JOY LEFT"));
    else if (nx == 1) Serial.println(F("JOY RIGHT"));
  }

  int y = analogRead(joyYPin);
  int8_t ny = (y < JOY_LOW) ? -1 : (y > JOY_HIGH ? 1 : 0);
  if (ny != joyYState) {
    joyYState = ny;
    if (ny == -1)     Serial.println(F("JOY UP"));
    else if (ny == 1) Serial.println(F("JOY DOWN"));
  }

  bool pressed = digitalRead(joyBtnPin) == LOW;  // INPUT_PULLUP, active low
  if (pressed != btnDown && now - btnChangedAt >= BTN_DEBOUNCE_MS) {
    btnDown = pressed;
    btnChangedAt = now;
    Serial.println(pressed ? F("BTN DOWN") : F("BTN UP"));
  }
}
#endif

// --- lifecycle -------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(ledPin, OUTPUT);
  digitalWrite(ledPin, LOW);

#if JOYSTICK_ENABLED
  pinMode(joyBtnPin, INPUT_PULLUP);
#endif

  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("ERR SSD1306 allocation failed"));
    while (true);
  }

  tcsOk = tcs.begin();
  if (!tcsOk) {
    // Not fatal on purpose: the serial link stays up so the web app can show
    // the fault instead of the board just going silent.
    Serial.println(F("ERR TCS34725 not found"));
  }

  // Last, because both begin() calls above set the bus speed themselves.
  // A full-screen redraw drops from ~100 ms to ~25 ms at 400 kHz.
  Wire.setClock(400000);

  servo1.attach(servo1Pin);
  servo2.attach(servo2Pin);
  servo3.attach(servo3Pin);
  servo1.write(90);
  servo2.write(90);
  servo3.write(90);

  strncpy(oledText, "Waiting for browser...", sizeof(oledText) - 1);
  renderOled();
  oledDirty = false;

  Serial.println(F("READY " FW_VERSION));
  reportLights();
}

void loop() {
  unsigned long now = millis();

  pumpSerial();

  if (oledDirty) {
    renderOled();
    oledDirty = false;
  }

  if (now - lastColorPoll >= COLOR_POLL_MS) {
    lastColorPoll = now;
    pumpColor(now);
  }

#if JOYSTICK_ENABLED
  pumpJoystick(now);
#endif
}
