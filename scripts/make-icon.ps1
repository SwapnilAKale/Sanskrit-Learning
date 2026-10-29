# Draws the SanskritLearning icon: the speaking cursor, a text cursor whose stem vibrates like a plucked string, in amber to
# coral on a night-blue tile with a warm glow. Writes assets\app.ico (16 to 256 px) and assets\app.png (256 px).
# Developer tool: run it after changing the design, then commit both files.
#   powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assets = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets'

function New-RoundRect([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = 2 * $r
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure(); return $p
}
function New-Point([single]$x, [single]$y) { New-Object System.Drawing.PointF $x, $y }

function New-IconImage([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 256.0; $tiny = $size -le 24
    $amber = [System.Drawing.Color]::FromArgb(255, 255, 190, 60); $coral = [System.Drawing.Color]::FromArgb(255, 255, 94, 98)
    # Tile: night blue, lighter at the top left.
    $tile = New-RoundRect 0 0 $size $size (56 * $s)
    $night = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Point 0 0), (New-Point $size $size), ([System.Drawing.Color]::FromArgb(255, 30, 36, 64)), ([System.Drawing.Color]::FromArgb(255, 12, 14, 28)))
    $g.FillPath($night, $tile)
    # A warm light behind the cursor (left out at tray sizes, where it would only muddy the tile).
    if ($size -ge 32) {
        $glow = New-Object System.Drawing.Drawing2D.GraphicsPath; $r = 120 * $s
        $glow.AddEllipse((128 * $s - $r), (128 * $s - $r), 2 * $r, 2 * $r)
        $light = New-Object System.Drawing.Drawing2D.PathGradientBrush $glow
        $light.CenterColor = [System.Drawing.Color]::FromArgb(70, 255, 150, 70); $light.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, 255, 150, 70))
        $g.SetClip($tile); $g.FillPath($light, $glow); $g.ResetClip()
    }
    # The cursor, amber at the top to coral at the bottom.
    # Three levels of detail: fine ripples when large, fewer and bolder ones as the icon shrinks, so they never blur.
    $small = $size -le 64
    $w = if ($tiny) { 26 } elseif ($small) { 20 } else { 15 }
    $ink = New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Point 0 (52 * $s)), (New-Point 0 (204 * $s)), $amber, $coral)
    $pen = New-Object System.Drawing.Pen $ink, ($w * $s); $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
    $g.DrawLine($pen, (New-Point (98 * $s) (58 * $s)), (New-Point (158 * $s) (58 * $s)))
    $g.DrawLine($pen, (New-Point (98 * $s) (198 * $s)), (New-Point (158 * $s) (198 * $s)))
    # The stem: a plucked string, still at the caps and vibrating in the middle.
    $amp = if ($tiny) { 12 } elseif ($small) { 16 } else { 17 }; $turns = if ($tiny) { 1.5 } elseif ($small) { 2.5 } else { 4.5 }
    $points = New-Object System.Collections.Generic.List[System.Drawing.PointF]
    for ($i = 0; $i -le 240; $i++) {
        $t = $i / 240.0
        $x = 128 + $amp * [Math]::Pow([Math]::Sin([Math]::PI * $t), 2) * [Math]::Sin(2 * [Math]::PI * $turns * $t)
        $points.Add((New-Point ($x * $s) ((66 + $t * 124) * $s)))
    }
    $g.DrawCurve($pen, $points.ToArray())
    $g.Dispose(); return $bmp
}

# One icon entry: PNG at 256 px, a classic 32-bit bitmap (with alpha, and an empty AND mask) below that, which every
# Windows API reads, including the tray and System.Drawing.
function Get-IconEntry([int]$size) {
    $img = New-IconImage $size
    if ($size -ge 256) { $ms = New-Object IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose(); return , $ms.ToArray() }
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $data = $img.LockBits($rect, 'ReadOnly', ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
    $pixels = New-Object byte[] ($size * $size * 4)
    for ($row = 0; $row -lt $size; $row++) {
        # Bottom-up rows, BGRA (the in-memory order of Format32bppArgb).
        [Runtime.InteropServices.Marshal]::Copy([IntPtr]($data.Scan0.ToInt64() + $row * $data.Stride), $pixels, ($size - 1 - $row) * $size * 4, $size * 4)
    }
    $img.UnlockBits($data); $img.Dispose()
    $maskRow = [int]([Math]::Ceiling($size / 32.0) * 4)
    $ms = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $ms
    $w.Write([uint32]40); $w.Write([int32]$size); $w.Write([int32]($size * 2)); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]0); $w.Write([uint32]($pixels.Length + $maskRow * $size)); $w.Write([int32]0); $w.Write([int32]0); $w.Write([uint32]0); $w.Write([uint32]0)
    $w.Write($pixels); $w.Write((New-Object byte[] ($maskRow * $size))); $w.Flush()
    return , $ms.ToArray()
}

$sizes = 16, 20, 24, 32, 40, 48, 64, 128, 256
$pngs = foreach ($size in $sizes) { , (Get-IconEntry $size) }
(New-IconImage 256).Save((Join-Path $assets 'app.png'), [System.Drawing.Imaging.ImageFormat]::Png)

# ICO container: header, one 16-byte entry per size, then the PNG data.
$out = New-Object IO.MemoryStream; $w = New-Object IO.BinaryWriter $out
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $w.Write($png) }
$w.Flush(); [IO.File]::WriteAllBytes((Join-Path $assets 'app.ico'), $out.ToArray())
'Wrote assets\app.ico (' + $sizes.Count + ' sizes) and assets\app.png'
