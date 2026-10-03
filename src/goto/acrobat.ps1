# FindInside: 검색 결과의 일치한 곳으로 문서를 연다 (src/openAt.js가 -File로 실행한다).
# 성공하면 마지막에 OK를 출력한다.
param([string]$Path, [int]$Page = 0, [int]$Slide = 0, [string]$Sheet = "", [string]$Cell = "", [string]$Text = "", [string]$Term = "")
$ErrorActionPreference = "Stop"

# 자동화로 연 창은 FindInside 뒤에 깔리기 쉬워 앞으로 가져온다
function Show-Front([string]$title) {
  try { [void](New-Object -ComObject WScript.Shell).AppActivate($title) } catch {}
}

# 기본 PDF 프로그램이 Acrobat(Reader)이면 쪽과 검색어를 넘겨 연다. 다른 프로그램은 쪽을 받지 못하므로 실패로 끝낸다.
$choice = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice"
$progId = (Get-ItemProperty $choice -ErrorAction SilentlyContinue).ProgId
if (-not $progId) { $progId = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\.pdf" -ErrorAction SilentlyContinue).'(default)' }
$command = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
if (-not $command -or $command -notmatch '(?i)"?([^"]*(Acrobat|AcroRd32)\.exe)"?') { throw "not acrobat" }
$exe = $Matches[1]
$open = @()
if ($Page -gt 0) { $open += "page=$Page" }
# Acrobat 명령줄 검색은 한글이 깨지므로(예: "설치" → "ġ") 영문·숫자 검색어만 넘긴다
if ($Term -and $Term -match '^[\x20-\x7E]+$') { $open += "search=" + ($Term -replace '[&="]', " ") }
$argList = @()
if ($open.Count) { $argList += "/A"; $argList += '"' + ($open -join "&") + '"' }
$argList += '"' + $Path + '"'
Start-Process -FilePath $exe -ArgumentList $argList
"OK"
