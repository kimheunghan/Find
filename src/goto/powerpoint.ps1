# FindInside: 검색 결과의 일치한 곳으로 문서를 연다 (src/openAt.js가 -File로 실행한다).
# 성공하면 마지막에 OK를 출력한다.
param([string]$Path, [int]$Page = 0, [int]$Slide = 0, [string]$Sheet = "", [string]$Cell = "", [string]$Text = "", [string]$Term = "")
$ErrorActionPreference = "Stop"

# 자동화로 연 창은 FindInside 뒤에 깔리기 쉬워 앞으로 가져온다
function Show-Front([string]$title) {
  try { [void](New-Object -ComObject WScript.Shell).AppActivate($title) } catch {}
}

$app = New-Object -ComObject PowerPoint.Application
$pres = $null
foreach ($item in $app.Presentations) { if ($item.FullName -eq $Path) { $pres = $item } }
if (-not $pres) { $pres = $app.Presentations.Open($Path) }
$window = $pres.Windows.Item(1)
$window.Activate()
if ($Slide -gt 0) { $window.View.GotoSlide($Slide) }
Show-Front $pres.Name
"OK"
