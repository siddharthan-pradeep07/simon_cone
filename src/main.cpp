#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_TCS34725.h>

// ---------------------------------------------------------------------------
// simon_cone firmware -- optical card reader.
//
// The board is dumb I/O. It streams raw sensor samples and draws whatever text
// the web app sends it. All the interesting work -- deciding where a card's
// pass over the sensor starts and ends, turning it into a signature, matching
// it against enrolled cards -- happens in the browser, where it can be changed
// without a reflash.
//
// The servo gate is gone for now: nothing needs to move for the sensor to see
// a card pass over it, and an attached servo holding position only adds jitter
// and current draw. It is a dozen lines in the history if it comes back.
//
// Protocol: newline-delimited text, 115200 baud.
//
//   in    PING                    -> PONG
//         OLED <text>             -> OK OLED   ('|' is a line break)
//         CLEAR                   -> OK CLEAR
//         SCAN <0|1>              -> OK SCAN   (start/stop the sample stream)
//         LED <0|1>               -> OK LED    (sensor illuminator)
//         GAIN <0-3>              -> OK GAIN   (1x, 4x, 16x, 60x)
//
//   out   READY <version>
//         CFG <scan> <led> <gain>
//         FREERAM <bytes>
//         S <ms> <r> <g> <b> <c>  (~125 Hz while scanning)
//         ERR <reason>
// ---------------------------------------------------------------------------

// Bumped for the SWIPE -> SCAN rename: an older board silently answers
// "ERR unknown command SCAN" and never streams, which is worth being able to
// spot in the log rather than debugging as a dead sensor.
#define FW_VERSION "5"

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SCREEN_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// 2.4 ms integration. A card crossing the window is over in a few hundred
// milliseconds, so the sampling has to be fast enough to catch its structure
// rather than smear it into one average.
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_2_4MS,
                                          TCS34725_GAIN_16X);

// 8 ms gives ~125 samples a second: about 60 across a normal pass, comfortably
// more than the signature needs, and only a third of the serial link's budget.
// Polling faster would overrun the 32-byte TX buffer and start blocking loop().
const unsigned long SCAN_STREAM_MS = 8;

bool tcsOk = false;
bool displayOk = false;
bool scanning = false;
bool ledOn = true;
uint8_t gainIndex = 2;  // 0=1x 1=4x 2=16x 3=60x

unsigned long lastSample = 0;

char cmdBuf[48];
uint8_t cmdLen = 0;
char oledText[40] = "";
bool oledDirty = true;

// --- sensor ----------------------------------------------------------------

const uint8_t TCS_ADDR        = 0x29;
const uint8_t TCS_CMD_AUTOINC = 0xA0;  // command bit | auto-increment
const uint8_t TCS_REG_CDATAL  = 0x14;  // c, r, g, b follow contiguously

// Adafruit's getRawData() sleeps a full integration period on every call and
// costs four I2C transactions. The data registers are contiguous, so one
// auto-increment burst fetches all four channels in a third of the bus time.
static bool tcsReadAll(uint16_t& c, uint16_t& r, uint16_t& g, uint16_t& b) {
  Wire.beginTransmission(TCS_ADDR);
  Wire.write(TCS_CMD_AUTOINC | TCS_REG_CDATAL);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(TCS_ADDR, (uint8_t)8) != 8) return false;

  // Deliberately not `Wire.read() | (Wire.read() << 8)` -- operand evaluation
  // order is unspecified, and that bug reads the bytes backwards at random.
  uint16_t lo, hi;
  lo = Wire.read(); hi = Wire.read(); c = (hi << 8) | lo;
  lo = Wire.read(); hi = Wire.read(); r = (hi << 8) | lo;
  lo = Wire.read(); hi = Wire.read(); g = (hi << 8) | lo;
  lo = Wire.read(); hi = Wire.read(); b = (hi << 8) | lo;
  return true;
}

void applyGain() {
  switch (gainIndex) {
    case 0: tcs.setGain(TCS34725_GAIN_1X); break;
    case 1: tcs.setGain(TCS34725_GAIN_4X); break;
    case 3: tcs.setGain(TCS34725_GAIN_60X); break;
    default: tcs.setGain(TCS34725_GAIN_16X); break;
  }
}

// On the Adafruit breakout the illuminator is wired to the interrupt pin, so
// asserting the interrupt is what pulls the LED off. Inverted on purpose.
void setLed(bool on) {
  if (!tcsOk) return;
  ledOn = on;
  tcs.setInterrupt(!on);
}

// Raw counts, uncorrected. The browser wants what the photodiodes measured --
// it works in chromaticity, which divides out brightness anyway, and any
// correction applied here would just be one more thing to reverse.
void pumpScan(unsigned long now) {
  if (!scanning || !tcsOk) return;
  if (now - lastSample < SCAN_STREAM_MS) return;
  lastSample = now;

  uint16_t c, r, g, b;
  if (!tcsReadAll(c, r, g, b)) return;

  Serial.print(F("S "));
  Serial.print(now); Serial.print(' ');
  Serial.print(r);   Serial.print(' ');
  Serial.print(g);   Serial.print(' ');
  Serial.print(b);   Serial.print(' ');
  Serial.println(c);
}

// --- display ---------------------------------------------------------------

// '|' is a line break. The command protocol is newline-delimited, so a literal
// newline can never appear inside a command -- this is the escape for it, and
// it is what lets the web app lay the screen out itself.
void renderOled() {
  if (!displayOk) return;  // buffer never allocated; drawing would deref null
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextWrap(true);

  uint8_t lines = 1;
  uint8_t longest = 0;
  uint8_t run = 0;
  for (const char* p = oledText; *p; p++) {
    if (*p == '|') {
      if (run > longest) longest = run;
      run = 0;
      lines++;
    } else {
      run++;
    }
  }
  if (run > longest) longest = run;

  // Largest font the content fits: a glyph is 6*size wide and 8*size tall, so
  // size 4 gives 5 characters across and 2 rows, down to 21 x 8 at size 1.
  // Short values end up filling the panel, which is the point of having a
  // screen on the device rather than only in the browser.
  uint8_t size = 4;
  while (size > 1 && (longest > (uint8_t)(128 / (6 * size)) ||
                      lines > (uint8_t)(64 / (8 * size)))) {
    size--;
  }
  display.setTextSize(size);

  display.setCursor(0, 0);
  for (const char* p = oledText; *p; p++) display.write(*p == '|' ? '\n' : *p);
  display.display();
}

// --- configuration ---------------------------------------------------------

void reportConfig() {
  Serial.print(F("CFG "));
  Serial.print(scanning ? 1 : 0); Serial.print(' ');
  Serial.print(ledOn ? 1 : 0);    Serial.print(' ');
  Serial.println(gainIndex);
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

  if (strcmp(line, "SCAN") == 0) {
    if (!tcsOk) {
      Serial.println(F("ERR no colour sensor"));
      return;
    }
    scanning = arg && atoi(arg);
    Serial.println(F("OK SCAN"));
    reportConfig();
    return;
  }

  if (strcmp(line, "LED") == 0) {
    if (!tcsOk) {
      Serial.println(F("ERR no colour sensor"));
      return;
    }
    setLed(arg && atoi(arg));
    Serial.println(F("OK LED"));
    reportConfig();
    return;
  }

  if (strcmp(line, "GAIN") == 0) {
    if (arg) {
      gainIndex = (uint8_t)constrain(atoi(arg), 0, 3);
      applyGain();
    }
    Serial.println(F("OK GAIN"));
    reportConfig();
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

// --- lifecycle -------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  displayOk = display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS);
  if (!displayOk) {
    // Nearly always a failed malloc of the 1 KB framebuffer, i.e. out of RAM.
    // Deliberately not fatal: a board stuck in while(true) goes silent and is
    // far harder to diagnose than one that keeps talking without a screen.
    Serial.println(F("ERR SSD1306 init failed - out of RAM?"));
  }

  tcsOk = tcs.begin();
  if (!tcsOk) {
    Serial.println(F("ERR TCS34725 not found"));
  } else {
    applyGain();
  }

  // Last, because both begin() calls above set the bus speed themselves.
  // A full-screen redraw drops from ~100 ms to ~25 ms at 400 kHz.
  Wire.setClock(400000);

  strncpy(oledText, "SIMON|CONE", sizeof(oledText) - 1);
  renderOled();
  oledDirty = false;

  Serial.println(F("READY " FW_VERSION));
  reportConfig();

  extern int __heap_start, *__brkval;
  int probe;
  Serial.print(F("FREERAM "));
  Serial.println((int)&probe - (__brkval == 0 ? (int)&__heap_start : (int)__brkval));
}

void loop() {
  unsigned long now = millis();

  pumpSerial();

  // Redrawing takes ~25 ms of blocking I2C, which punches a hole in the sample
  // stream. That is only harmful while a card is actually crossing, and only
  // the browser knows when that is -- it holds updates back until the slot is
  // empty. Refusing them here as well would mean the display could never show
  // anything live, since the stream runs the whole time a reading page is open.
  if (oledDirty) {
    renderOled();
    oledDirty = false;
  }

  pumpScan(now);
}
