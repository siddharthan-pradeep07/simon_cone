#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_TCS34725.h>
#include <Servo.h>

// ---------------------------------------------------------------------------
// simon_cone firmware -- optical card reader.
//
// The board is dumb I/O. It streams raw sensor samples and draws whatever text
// the web app sends it. All the interesting work -- deciding where a card's
// pass over the sensor starts and ends, turning it into a signature, matching
// it against enrolled cards, tracking swipe/account-creation progress --
// happens in the browser, where it can be changed without a reflash.
//
// The servo is optional and stateless from the board's point of view: it just
// moves to whatever angle it's told. The browser decides *when* that happens
// (e.g. on account-creation selection, or once 5/5 swipes are done) and sends
// a SERVO command at that moment.
//
// Protocol: newline-delimited text, 115200 baud.
//
//   in    PING                    -> PONG
//         OLED <text>             -> OK OLED   ('|' is a line break)
//         CLEAR                   -> OK CLEAR
//         SCAN <0|1>              -> OK SCAN   (start/stop the sample stream)
//         LED <0|1>               -> OK LED    (sensor illuminator)
//         GAIN <0-3>              -> OK GAIN   (1x, 4x, 16x, 60x)
//         SERVO <degrees>         -> OK SERVO  (0-180, absolute angle)
//
//   out   READY <version>
//         CFG <scan> <led> <gain> <servo>
//         FREERAM <bytes>
//         S <ms> <r> <g> <b> <c>  (~125 Hz while scanning)
//         ERR <reason>
// ---------------------------------------------------------------------------

// Bumped for SERVO: an older board silently answers "ERR unknown command
// SERVO" rather than moving anything, worth being able to spot in the log.
#define FW_VERSION "6"

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SCREEN_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_2_4MS,
                                          TCS34725_GAIN_16X);

const unsigned long SCAN_STREAM_MS = 8;

bool tcsOk = false;
bool displayOk = false;
bool scanning = false;
bool ledOn = true;
uint8_t gainIndex = 2;  // 0=1x 1=4x 2=16x 3=60x

const uint8_t SERVO_PIN = 10;
const uint8_t SERVO_HOME = 90;   // initial/rest position
Servo servo;
uint8_t servoAngle = SERVO_HOME;

unsigned long lastSample = 0;

char cmdBuf[48];
uint8_t cmdLen = 0;
char oledText[40] = "";
bool oledDirty = true;

// --- sensor ----------------------------------------------------------------

const uint8_t TCS_ADDR        = 0x29;
const uint8_t TCS_CMD_AUTOINC = 0xA0;
const uint8_t TCS_REG_CDATAL  = 0x14;

static bool tcsReadAll(uint16_t& c, uint16_t& r, uint16_t& g, uint16_t& b) {
  Wire.beginTransmission(TCS_ADDR);
  Wire.write(TCS_CMD_AUTOINC | TCS_REG_CDATAL);
  if (Wire.endTransmission() != 0) return false;
  if (Wire.requestFrom(TCS_ADDR, (uint8_t)8) != 8) return false;

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

void setLed(bool on) {
  if (!tcsOk) return;
  ledOn = on;
  tcs.setInterrupt(!on);
}

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

// --- servo -------------------------------------------------------------

// Stateless on purpose: the board doesn't know what a "swipe" or an "account"
// is, it just moves to the angle it's told. The browser is what decides that
// selecting account creation means +45 from home, and that 5/5 swipes means
// back to home -- it sends two SERVO commands, at whatever moments its own
// state machine reaches those points.
void setServoAngle(uint8_t degrees) {
  servoAngle = constrain(degrees, 0, 180);
  servo.write(servoAngle);
}

// --- display ---------------------------------------------------------------

void renderOled() {
  if (!displayOk) return;
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
  Serial.print(gainIndex);       Serial.print(' ');
  Serial.println(servoAngle);
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

  if (strcmp(line, "SERVO") == 0) {
    if (arg) {
      setServoAngle((uint8_t)atoi(arg));
    }
    Serial.println(F("OK SERVO"));
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
    Serial.println(F("ERR SSD1306 init failed - out of RAM?"));
  }

  tcsOk = tcs.begin();
  if (!tcsOk) {
    Serial.println(F("ERR TCS34725 not found"));
  } else {
    applyGain();
  }

  Wire.setClock(400000);

  servo.attach(SERVO_PIN);
  servo.write(SERVO_HOME);
  servoAngle = SERVO_HOME;

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

  if (oledDirty) {
    renderOled();
    oledDirty = false;
  }

  pumpScan(now);
}