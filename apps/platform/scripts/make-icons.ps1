# Generates the app icons from the extracted owneX mark.
#
# The mark is thin linework, so at 16 to 32px a dark mark on a light field loses
# definition. Light mark on a deep green field holds up far better at favicon
# sizes, which is why the icon inverts the site's light theme rather than matching
# it.
#
# The extracted mark is white with alpha, so a colour matrix scales its RGB to the
# lime tone while leaving the alpha untouched.

Add-Type -AssemblyName System.Drawing

$root = 'C:\Users\swadh\ownex\apps\platform'
$mark = Join-Path $root 'public\ownex-mark.png'

# Deep green field, lime mark.
$bg = [System.Drawing.Color]::FromArgb(255, 10, 58, 44)
$tint = @{ R = 222 / 255; G = 246 / 255; B = 198 / 255 }

$matrix = New-Object System.Drawing.Imaging.ColorMatrix
$matrix.Matrix00 = $tint.R
$matrix.Matrix11 = $tint.G
$matrix.Matrix22 = $tint.B
$matrix.Matrix33 = 1.0   # preserve alpha
$attrs = New-Object System.Drawing.Imaging.ImageAttributes
$attrs.SetColorMatrix($matrix)

$source = New-Object System.Drawing.Bitmap $mark

function Write-Icon {
  param([int]$Size, [string]$Path, [double]$Inset)

  $canvas = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.Clear($script:bg)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Fit the mark's proportions inside the inset box.
  $box = $Size * (1 - 2 * $Inset)
  $ratio = $script:source.Width / $script:source.Height
  if ($ratio -ge 1) { $w = $box; $h = $box / $ratio } else { $h = $box; $w = $box * $ratio }
  $x = ($Size - $w) / 2
  $y = ($Size - $h) / 2

  $dest = New-Object System.Drawing.Rectangle ([int]$x), ([int]$y), ([int]$w), ([int]$h)
  $g.DrawImage($script:source, $dest, 0, 0, $script:source.Width, $script:source.Height,
    [System.Drawing.GraphicsUnit]::Pixel, $script:attrs)
  $g.Dispose()

  $canvas.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $canvas.Dispose()
  Write-Output ("  {0,-28} {1}x{1}  {2} KB" -f (Split-Path $Path -Leaf), $Size,
    [math]::Round((Get-Item $Path).Length / 1KB, 1))
}

Write-Output "generated:"
# Next.js App Router picks these up automatically from app/.
Write-Icon -Size 512 -Path (Join-Path $root 'app\icon.png') -Inset 0.14
# Apple applies its own rounding and never shows transparency, so it gets a
# slightly tighter inset and the same solid field.
Write-Icon -Size 180 -Path (Join-Path $root 'app\apple-icon.png') -Inset 0.12

$source.Dispose()
$attrs.Dispose()
