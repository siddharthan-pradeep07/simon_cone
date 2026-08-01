#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_TCS34725.h>
#include <Servo.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
#define SCREEN_ADDRESS 0x3C

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
Adafruit_TCS34725 tcs = Adafruit_TCS34725(TCS34725_INTEGRATIONTIME_50MS, TCS34725_GAIN_4X);

Servo servo1;
Servo servo2;
Servo servo3;
const int servo1Pin = 9;
const int servo2Pin = 10;
const int servo3Pin = 2;

const int ledPin = 13;

const char* colorList[] = { "Red", "Yellow", "Green", "Blue", "Purple", "Pink" };
const int numGameColors = 6;

const int TIMER_SECONDS = 10;

const char* rgbToColorName(uint16_t r, uint16_t g, uint16_t b, uint16_t c) {
  if (c < 15) return "No object";

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

const char* readColorNow() {
  uint16_t r, g, b, c;
  tcs.getRawData(&r, &g, &b, &c);
  return rgbToColorName(r, g, b, c);
}

void showTitleWithCount(const char* countText) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(5, 5);
  display.println("SIMON SAYS");

  if (countText != nullptr) {
    display.setTextSize(3);
    display.setCursor(55, 35);
    display.println(countText);
  }

  display.display();
}

void showSimonSays(const char* color) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(5, 10);
  display.println("Simon says:");

  display.setTextSize(2);
  display.setCursor(5, 40);
  display.println(color);

  display.display();
}

void showTimer(int secondsLeft, const char* color) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.print("Find: ");
  display.println(color);

  display.setTextSize(3);
  display.setCursor(50, 25);
  display.println(secondsLeft);

  display.display();
}

void showResult(bool success) {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(2);
  display.setCursor(20, 25);
  display.println(success ? "Correct!" : "Time's up!");
  display.display();
}

void blinkLed(int onTime, int offTime, int repeats) {
  for (int i = 0; i < repeats; i++) {
    digitalWrite(ledPin, HIGH);
    delay(onTime);
    digitalWrite(ledPin, LOW);
    delay(offTime);
  }
}

void successAction() {
  blinkLed(150, 100, 3);
  for (int i = 0; i < 2; i++) {
    servo1.write(0);
    servo2.write(180);
    delay(300);
    servo1.write(180);
    servo2.write(0);
    delay(300);
  }
  servo1.write(90);
  servo2.write(90);
}

void failAction() {
  blinkLed(80, 80, 5);
  for (int i = 0; i < 3; i++) {
    servo1.write(60);
    servo2.write(60);
    delay(250);
    servo1.write(120);
    servo2.write(120);
    delay(250);
  }
  servo1.write(90);
  servo2.write(90);
}

void setup() {
  Serial.begin(9600);
  randomSeed(analogRead(A0));
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);

  if (ledPin != -1) {
    pinMode(ledPin, OUTPUT);
    digitalWrite(ledPin, HIGH);
  }

  if (!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    Serial.println(F("SSD1306 allocation failed"));
    while (true);
  }

  if (!tcs.begin()) {
    Serial.println(F("TCS34725 not found"));
    display.clearDisplay();
    display.setTextSize(1);
    display.setCursor(0, 0);
    display.println("Color sensor");
    display.println("not found!");
    display.display();
    while (true);
  }

  servo1.attach(servo1Pin);
  servo2.attach(servo2Pin);
  servo3.attach(servo3Pin);
  servo1.write(90);
  servo2.write(90);
  servo3.write(90);

  int servo3Start = servo3.read();
  servo3.write(servo3Start + 10);
  delay(400);
  servo3.write(servo3Start);
}

void loop() {
  showTitleWithCount(nullptr);
  delay(2000);

  showTitleWithCount("3");
  delay(1000);
  showTitleWithCount("2");
  delay(1000);
  showTitleWithCount("1");
  delay(1000);

  const char* targetColor = colorList[random(numGameColors)];
  showSimonSays(targetColor);
  delay(2000);

  bool found = false;

  int servo3TimerStart = servo3.read();
  servo3.write(servo3TimerStart + 70);

  for (int secondsLeft = TIMER_SECONDS; secondsLeft > 0; secondsLeft--) {
    showTimer(secondsLeft, targetColor);

    unsigned long windowStart = millis();
    while (millis() - windowStart < 1000) {
      const char* detected = readColorNow();

      Serial.print("Detected: ");
      Serial.println(detected);

      if (strcmp(detected, targetColor) == 0) {
        found = true;
        break;
      }
      delay(100);
    }

    if (found) break;
  }

  servo3.write(servo3TimerStart);

  showResult(found);
  delay(1500);

  if (found) {
    successAction();
  } else {
    failAction();
  }

  delay(2000);
}