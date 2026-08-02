# Reads the board directly, with no browser involved, and prints the series of
# colours the sensor saw. Use it to answer "is the hardware detecting colours at
# all?" without the web app, the account flow or Web Serial in the way.
#
#   powershell -File tools\colourcheck.ps1 -Port COM10 -Seconds 8
#
# Close the web app's connection first (hit Disconnect) and shut the PlatformIO
# serial monitor -- only one process can hold the port.
#
# The naming here mirrors web/src/cards/colourName.ts. It is a second copy on
# purpose: the point of this script is to be believable when the web app is the
# thing under suspicion, which it cannot be if it imports from it.

param(
  [string]$Port = 'COM10',
  [int]$Seconds = 8,
  # 0=1x 1=4x 2=16x 3=60x. Omit to leave the board's current setting alone.
  [int]$Gain = -1
)

$script:Hues = @(
  @{ name = 'Red'; hue = 0 }, @{ name = 'Orange'; hue = 25 }, @{ name = 'Amber'; hue = 45 },
  @{ name = 'Yellow'; hue = 60 }, @{ name = 'Lime'; hue = 85 }, @{ name = 'Green'; hue = 120 },
  @{ name = 'Mint'; hue = 155 }, @{ name = 'Cyan'; hue = 180 }, @{ name = 'Azure'; hue = 205 },
  @{ name = 'Blue'; hue = 235 }, @{ name = 'Indigo'; hue = 262 }, @{ name = 'Violet'; hue = 285 },
  @{ name = 'Purple'; hue = 305 }, @{ name = 'Magenta'; hue = 325 }, @{ name = 'Pink'; hue = 345 }
)

function Get-DeIr($r, $g, $b, $c) {
  # TCS34725 has no IR filter and IR lands mostly in red; c sees colour+IR while
  # r+g+b sees colour twice, so their difference estimates the IR to subtract.
  $sum = $r + $g + $b
  $ir = if ($sum -gt $c) { ($sum - $c) / 2 } else { 0 }
  return @([Math]::Max(0, $r - $ir), [Math]::Max(0, $g - $ir), [Math]::Max(0, $b - $ir))
}

function Get-ColourName($r, $g, $b, $c, $White) {
  if ($c -lt 20) { return 'Dark' }
  $d = Get-DeIr $r $g $b $c
  $cr = $d[0]; $cg = $d[1]; $cb = $d[2]

  # White balance. The illuminator LED is not spectrally flat and the sensor's
  # channels are not calibrated against each other, so an empty slot reads
  # distinctly warm -- measured on this board, r=34 g=28 b=24, which survives
  # the infrared correction as a solid 30 degree hue and names as Orange.
  # Rescaling so the background comes out neutral is what makes the names mean
  # anything.
  if ($White) {
    $w = Get-DeIr $White[0] $White[1] $White[2] $White[3]
    if ($w[0] -ge 6 -and $w[1] -ge 6 -and $w[2] -ge 6) {
      $mean = ($w[0] + $w[1] + $w[2]) / 3
      $cr = $cr * ($mean / $w[0]); $cg = $cg * ($mean / $w[1]); $cb = $cb * ($mean / $w[2])
    }
  }

  $peak = [Math]::Max($cr, [Math]::Max($cg, $cb))
  $floor = [Math]::Min($cr, [Math]::Min($cg, $cb))
  if ($peak -le 0) { return 'Dark' }
  if (($peak - $floor) / $peak -lt 0.14) {
    if ($c -gt 600) { return 'White' }
    if ($c -gt 120) { return 'Grey' }
    return 'Black'
  }

  $delta = $peak - $floor
  if ($peak -eq $cr) { $h = (60 * ($cg - $cb)) / $delta }
  elseif ($peak -eq $cg) { $h = (60 * ($cb - $cr)) / $delta + 120 }
  else { $h = (60 * ($cr - $cg)) / $delta + 240 }
  if ($h -lt 0) { $h += 360 }

  # Nearest hue centre, mirroring HUES in web/src/cards/colourName.ts.
  $best = $null; $bestGap = 360
  foreach ($entry in $script:Hues) {
    $raw = [Math]::Abs($h - $entry.hue) % 360
    $gap = if ($raw -gt 180) { 360 - $raw } else { $raw }
    if ($gap -lt $bestGap) { $bestGap = $gap; $best = $entry.name }
  }
  return $best
}

$sp = New-Object System.IO.Ports.SerialPort $Port, 115200, None, 8, one
$sp.DtrEnable = $true
$sp.ReadTimeout = 400
try { $sp.Open() } catch {
  Write-Output "CANNOT OPEN $Port -- $($_.Exception.Message)"
  Write-Output "If the web app is connected, hit Disconnect first; only one process can hold the port."
  exit 1
}

# Opening the port toggles DTR, which resets the Uno. Discard immediately: the
# driver buffer still holds samples from whatever last had the port open, and
# those would otherwise be read as this boot's banner. Then wait out the
# bootloader and setup() -- nothing sent before that finishes will be heard.
$sp.DiscardInBuffer()
Start-Sleep -Milliseconds 2200

$banner = @()
while ($true) { try { $banner += $sp.ReadLine().Trim() } catch { break } }
Write-Output '--- board said on boot ---'
$banner | ForEach-Object { Write-Output $_ }

$ready = $banner | Where-Object { $_ -match '^READY\s+(\S+)' } | Select-Object -First 1
if (-not $ready) {
  Write-Output 'WARNING: no READY line. Could not confirm which firmware is running.'
} elseif ($ready -notmatch '^READY\s+5$') {
  Write-Output "WARNING: this is '$ready'. Builds before 5 do not know SCAN and will never stream."
  Write-Output '         Reflash with: pio run -t upload'
}

if ($Gain -ge 0) {
  Write-Output "--- sending GAIN $Gain ---"
  $sp.WriteLine("GAIN $Gain")
  Start-Sleep -Milliseconds 300
  while ($true) { try { Write-Output $sp.ReadLine().Trim() } catch { break } }
}

Write-Output "--- streaming for $Seconds s: leave the sensor clear for a moment, then show it some colours ---"
$sp.WriteLine('SCAN 1')

$samples = @()
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  try { $line = $sp.ReadLine().Trim() } catch { continue }
  if ($line -like 'ERR*' -or $line -like 'OK*' -or $line -like 'CFG*') { Write-Output $line; continue }
  $f = $line -split ' '
  if ($f[0] -eq 'S' -and $f.Count -eq 6) {
    $samples += , @([int]$f[2], [int]$f[3], [int]$f[4], [int]$f[5])
  }
}
$sp.WriteLine('SCAN 0')
$sp.Close()

Write-Output "--- $($samples.Count) samples in $Seconds s ---"
if ($samples.Count -eq 0) {
  Write-Output 'NO SAMPLES. The board accepted SCAN but sent nothing -- suspect the TCS34725 wiring.'
  exit 1
}

# The opening half-second is the empty slot: whatever is under the sensor before
# you start moving something is by definition the background.
$head = $samples | Select-Object -First 60
$white = @(
  ($head | ForEach-Object { $_[0] } | Measure-Object -Average).Average,
  ($head | ForEach-Object { $_[1] } | Measure-Object -Average).Average,
  ($head | ForEach-Object { $_[2] } | Measure-Object -Average).Average,
  ($head | ForEach-Object { $_[3] } | Measure-Object -Average).Average
)
Write-Output ('white point (empty slot): r={0:n0} g={1:n0} b={2:n0} c={3:n0}' -f $white[0], $white[1], $white[2], $white[3])
if ($white[3] -lt 40) {
  Write-Output '  that is very dim -- try -Gain 3, or check the illuminator LED is on.'
}

# Collapsed into runs, so the output is the series of colours rather than a
# thousand near-identical lines.
$runs = @(); $last = $null; $n = 0
foreach ($s in $samples) {
  $name = Get-ColourName $s[0] $s[1] $s[2] $s[3] $white
  if ($name -eq $last) { $n++ } else {
    if ($last) { $runs += "$last x$n" }
    $last = $name; $n = 1
  }
}
if ($last) { $runs += "$last x$n" }

Write-Output ''
Write-Output 'colours seen, in order:'
Write-Output ($runs -join '  ->  ')
if ($runs.Count -le 1) {
  Write-Output ''
  Write-Output 'Only one colour for the whole run -- nothing was shown to the sensor, or it is too far away to register.'
}
