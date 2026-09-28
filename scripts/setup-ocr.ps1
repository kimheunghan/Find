$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root ".ocr-venv"

if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
  python -m venv $venv
}

$python = Join-Path $venv "Scripts\python.exe"
& $python -m pip install --upgrade pip
& $python -m pip install "paddlepaddle==3.2.0" "paddleocr>=3.3,<4"
Write-Host "FindInside OCR 설치가 완료되었습니다. 다음 색인부터 PNG/JPG 등 이미지 속 글자를 검색할 수 있습니다."
