# Windows 내장 OCR(Windows.Media.Ocr) 상주 작업자.
# 표준 입력으로 한 줄에 JSON 하나({"id":1,"path":"C:\\a.png"})를 받아, 표준 출력으로 한 줄에 JSON 하나를 돌려준다.
# 결과: {"id":1,"ok":true,"lines":[{"text":"...","x":0,"y":0}]} 또는 {"id":1,"ok":false,"error":"..."}
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
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

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($request.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      # 작은 글씨(10~13px)는 원본 크기로는 잘못 읽는다 (예: 최삼순 → 최상순). 작은 이미지는 키워서 읽고,
      # OCR 엔진이 받는 최대 크기를 넘는 큰 이미지는 비율을 유지해 줄인다.
      $upscale = if ($env:FINDINSIDE_OCR_SCALE) { [double]$env:FINDINSIDE_OCR_SCALE } else { 2.0 }
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
      $lines = @()
      foreach ($ocrLine in $result.Lines) {
        $first = $ocrLine.Words | Select-Object -First 1
        $lines += [pscustomobject]@{ text = $ocrLine.Text; x = [int]$first.BoundingRect.X; y = [int]$first.BoundingRect.Y }
      }
      [Console]::Out.WriteLine((@{ id = $request.id; ok = $true; lines = $lines } | ConvertTo-Json -Compress -Depth 4))
    } finally {
      $stream.Dispose()
    }
  } catch {
    $id = if ($request) { $request.id } else { $null }
    [Console]::Out.WriteLine((@{ id = $id; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
