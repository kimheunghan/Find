# FindInside: 검색 결과의 일치한 곳으로 문서를 연다 (src/openAt.js가 -File로 실행한다).
# 성공하면 마지막에 OK를 출력한다.
param([string]$Path, [int]$Page = 0, [int]$Slide = 0, [string]$Sheet = "", [string]$Cell = "", [string]$Text = "", [string]$Term = "")
$ErrorActionPreference = "Stop"

# 자동화로 연 창은 FindInside 뒤에 깔리기 쉬워 앞으로 가져온다
function Show-Front([string]$title) {
  try { [void](New-Object -ComObject WScript.Shell).AppActivate($title) } catch {}
}

try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application") } catch { $word = New-Object -ComObject Word.Application }
$word.Visible = $true
$doc = $word.Documents.Open($Path, $false)  # ConfirmConversions 끔: 형식 변환 확인 창 없이 연다
$doc.Activate()
$sel = $word.Selection
if ($Page -gt 0) { [void]$sel.GoTo(1, 1, $Page) }  # wdGoToPage, wdGoToAbsolute
function Find-Text([string]$value) {
  $find = $sel.Find
  $find.ClearFormatting()
  $find.Text = $value; $find.Forward = $true; $find.Wrap = 1; $find.MatchCase = $false
  return $find.Execute()
}
if ($Text) { if (-not (Find-Text $Text) -and $Term) { [void](Find-Text $Term) } }
$word.Activate()
Show-Front $doc.Name
"OK"
