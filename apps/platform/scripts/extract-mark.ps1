# Extracts the owneX mark from a flattened PNG into a real alpha PNG.
#
# The source was exported without an alpha channel, so its "transparent"
# checkerboard is painted in as neutral grey. Neutral grey has R=G=B, and the mark
# is a saturated green, so greenness (G minus R) separates the two cleanly and also
# gives a sensible alpha for antialiased edge pixels instead of a hard cutout.
#
# The result is trimmed to the artwork bounds and written as white, so it can be
# used as a CSS mask and coloured from a design token.

Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\swadh\Downloads\ownex_logo_dark_green.png'
$out = 'C:\Users\swadh\ownex\apps\platform\public\ownex-mark.png'

$bmp = New-Object System.Drawing.Bitmap $src
$w = $bmp.Width
$h = $bmp.Height

# Read the source in one locked pass; per-pixel GetPixel over a megapixel is slow.
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$bmp.UnlockBits($data)
$stride = $data.Stride

# Greenness at full strength in the source, used to normalise alpha.
$span = 58.0
$alpha = New-Object 'byte[]' ($w * $h)
$minX = $w; $minY = $h; $maxX = -1; $maxY = -1

for ($y = 0; $y -lt $h; $y++) {
  $row = $y * $stride
  for ($x = 0; $x -lt $w; $x++) {
    $i = $row + $x * 4          # BGRA order
    $b = $bytes[$i]
    $g = $bytes[$i + 1]
    $r = $bytes[$i + 2]

    $greenness = $g - $r
    if ($greenness -le 4) { continue }   # neutral grey, so background

    $a = [int](($greenness / $span) * 255)
    if ($a -gt 255) { $a = 255 }
    $alpha[$y * $w + $x] = [byte]$a

    if ($x -lt $minX) { $minX = $x }
    if ($x -gt $maxX) { $maxX = $x }
    if ($y -lt $minY) { $minY = $y }
    if ($y -gt $maxY) { $maxY = $y }
  }
}

if ($maxX -lt 0) { throw "no green pixels found; the key threshold needs revisiting" }

# Trim to the artwork, with a small even margin so the mask is not flush to the edge.
$pad = 8
$minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
$maxX = [Math]::Min($w - 1, $maxX + $pad); $maxY = [Math]::Min($h - 1, $maxY + $pad)
$tw = $maxX - $minX + 1
$th = $maxY - $minY + 1

# Write white pixels carrying the extracted alpha, ready to be used as a mask.
$dst = New-Object System.Drawing.Bitmap $tw, $th, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$ddata = $dst.LockBits(
  (New-Object System.Drawing.Rectangle 0, 0, $tw, $th),
  [System.Drawing.Imaging.ImageLockMode]::WriteOnly,
  [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$dbytes = New-Object byte[] ($ddata.Stride * $th)

for ($y = 0; $y -lt $th; $y++) {
  for ($x = 0; $x -lt $tw; $x++) {
    $a = $alpha[($y + $minY) * $w + ($x + $minX)]
    $i = $y * $ddata.Stride + $x * 4
    $dbytes[$i] = 255      # B
    $dbytes[$i + 1] = 255  # G
    $dbytes[$i + 2] = 255  # R
    $dbytes[$i + 3] = $a   # A
  }
}

[System.Runtime.InteropServices.Marshal]::Copy($dbytes, 0, $ddata.Scan0, $dbytes.Length)
$dst.UnlockBits($ddata)

New-Item -ItemType Directory -Path (Split-Path $out) -Force | Out-Null
$dst.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)

Write-Output "source     : ${w}x${h}"
Write-Output "artwork at : ${minX},${minY} to ${maxX},${maxY}"
Write-Output "written    : ${tw}x${th} -> $out"
Write-Output "size       : $([math]::Round((Get-Item $out).Length/1KB,1)) KB"

$dst.Dispose()
$bmp.Dispose()
