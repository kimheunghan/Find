# Windows 내장 OCR(Windows.Media.Ocr) 상주 작업자.
# 표준 입력으로 한 줄에 JSON 하나를 받아, 표준 출력으로 한 줄에 JSON 하나를 돌려준다.
# - 일반 판독: {"id":1,"path":"C:\\a.png"}
#   → {"id":1,"ok":true,"scale":2,"width":800,"height":600,"lines":[{"text":"...","x":0,"y":0,"words":[{"text","x","y","w","h"}]}]}
#     (x·y·w·h는 OCR에 넣은 이미지 기준 좌표, 원본 좌표 = 값 / scale)
# - 세로쓰기 다시 읽기: {"id":2,"path":"C:\\a.png","columns":[{"x":10,"top":20,"width":40,"pitch":38,"count":9}]}
#   → 세로 줄마다 한 글자 칸씩 잘라 가로로 이어 붙인 이미지를 읽어 {"id":2,"ok":true,"texts":["아들홍묵", ...]}
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

# WinRT 비동기 작업을 동기로 기다린다.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await($operation, [Type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  return $task.Result
}

$language = New-Object Windows.Globalization.Language("ko")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
$maxSide = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
$upscale = if ($env:FINDINSIDE_OCR_SCALE) { [double]$env:FINDINSIDE_OCR_SCALE } else { 2.0 }

# 이미지 파일을 읽어 OCR한다. 작은 글씨(10~13px)는 원본 크기로는 잘못 읽으므로(최삼순 → 최상순) 키워서 읽고,
# OCR 엔진이 받는 최대 크기를 넘는 큰 이미지는 비율을 유지해 줄인다.
function Recognize([string]$path) {
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $scale = [Math]::Min($upscale, $maxSide / [Math]::Max($decoder.PixelWidth, $decoder.PixelHeight))
    $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
    $transform.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Cubic
    $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelWidth * $scale))
    $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($decoder.PixelHeight * $scale))
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync(
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
        $transform,
        [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation,
        [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    return @{ result = $result; scale = $scale; width = $decoder.PixelWidth; height = $decoder.PixelHeight }
  } finally {
    $stream.Dispose()
  }
}

# 세로 줄마다 한 글자 칸(width × pitch)씩 잘라 가로로 이어 붙인 임시 이미지를 만들어 읽는다.
# 칸 안에 글자(배경과 다른 어두운 점)가 있는지 대략 본다. 빈 칸이 이어지면 세로 줄이 끝난 것으로 본다.
function HasInk($bitmap, [System.Drawing.Rectangle]$rect) {
  $step = [Math]::Max(1, [int]($rect.Width / 12))
  $dark = 0
  $total = 0
  for ($y = $rect.Top; $y -lt [Math]::Min($rect.Bottom, $bitmap.Height); $y += $step) {
    for ($x = $rect.Left; $x -lt [Math]::Min($rect.Right, $bitmap.Width); $x += $step) {
      $c = $bitmap.GetPixel($x, $y)
      if (($c.R + $c.G + $c.B) / 3 -lt 150) { $dark++ }
      $total++
    }
  }
  return ($total -gt 0) -and ($dark / $total -gt 0.02)
}

function ReadColumns([string]$path, $columns) {
  $source = [System.Drawing.Bitmap]::new($path)
  $texts = @()
  try {
    foreach ($column in $columns) {
      $cellWidth = [int][Math]::Max(1, $column.width)
      $cellHeight = [int][Math]::Max(1, $column.pitch)
      # 글자가 있는 칸까지만 쓴다 (빈 칸이 두 번 이어지면 줄 끝). 빈 칸이 뒤에 많이 붙으면 인식이 흔들린다.
      $count = 0
      $blank = 0
      for ($k = 0; $k -lt [int][Math]::Max(1, $column.count); $k++) {
        $probe = [System.Drawing.Rectangle]::new([int]$column.x, [int]($column.top + $k * $column.pitch), $cellWidth, $cellHeight)
        if (HasInk $source $probe) { $count = $k + 1; $blank = 0 } else { $blank++; if ($blank -ge 2) { break } }
      }
      if ($count -eq 0) { $texts += ""; continue }
      $gap = [int][Math]::Ceiling($cellWidth * 0.25)
      # PowerShell은 쉼표를 덧셈보다 먼저 묶으므로 크기를 먼저 계산해 둔다.
      $stripWidth = [int](($cellWidth + $gap) * $count + $gap)
      $stripHeight = [int]($cellHeight + 2 * $gap)
      $strip = [System.Drawing.Bitmap]::new($stripWidth, $stripHeight)
      $graphics = [System.Drawing.Graphics]::FromImage($strip)
      $temp = Join-Path ([System.IO.Path]::GetTempPath()) ("findinside-ocr-" + [guid]::NewGuid().ToString("N") + ".png")
      try {
        $graphics.Clear([System.Drawing.Color]::White)
        for ($k = 0; $k -lt $count; $k++) {
          $sourceTop = [int]($column.top + $k * $column.pitch)
          $targetLeft = [int]($gap + $k * ($cellWidth + $gap))
          $sourceRect = [System.Drawing.Rectangle]::new([int]$column.x, $sourceTop, $cellWidth, $cellHeight)
          $targetRect = [System.Drawing.Rectangle]::new($targetLeft, $gap, $cellWidth, $cellHeight)
          $graphics.DrawImage($source, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
        }
        $strip.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
        $read = Recognize $temp
        $texts += (($read.result.Lines | ForEach-Object { $_.Text }) -join "") -replace "\s+", ""
      } finally {
        $graphics.Dispose()
        $strip.Dispose()
        Remove-Item -LiteralPath $temp -ErrorAction SilentlyContinue
      }
    }
  } finally {
    $source.Dispose()
  }
  return $texts
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    if ($request.columns) {
      $texts = @(ReadColumns $request.path $request.columns)
      [Console]::Out.WriteLine((@{ id = $request.id; ok = $true; texts = $texts } | ConvertTo-Json -Compress -Depth 3))
    } else {
      $read = Recognize $request.path
      $lines = @()
      foreach ($ocrLine in $read.result.Lines) {
        $first = $ocrLine.Words | Select-Object -First 1
        # 단어마다 위치·크기도 보낸다. 세로쓰기는 글자가 가로 줄로 잘못 묶여 나오므로(아 권 2 최 / 들 지 1 삼 …)
        # 같은 세로 줄의 글자를 찾아 다시 읽는 데 쓴다 (ocr.js).
        $words = @()
        foreach ($word in $ocrLine.Words) {
          $r = $word.BoundingRect
          $words += [pscustomobject]@{ text = $word.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
        }
        $lines += [pscustomobject]@{ text = $ocrLine.Text; x = [int]$first.BoundingRect.X; y = [int]$first.BoundingRect.Y; words = $words }
      }
      [Console]::Out.WriteLine((@{ id = $request.id; ok = $true; scale = $read.scale; width = $read.width; height = $read.height; lines = $lines } | ConvertTo-Json -Compress -Depth 4))
    }
  } catch {
    $id = if ($request) { $request.id } else { $null }
    [Console]::Out.WriteLine((@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
