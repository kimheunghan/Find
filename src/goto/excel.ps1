# FindInside: 검색 결과의 일치한 곳으로 문서를 연다 (src/openAt.js가 -File로 실행한다).
# 성공하면 마지막에 OK를 출력한다.
param([string]$Path, [int]$Page = 0, [int]$Slide = 0, [string]$Sheet = "", [string]$Cell = "", [string]$Text = "", [string]$Term = "")
$ErrorActionPreference = "Stop"

# 자동화로 연 창은 FindInside 뒤에 깔리기 쉬워 앞으로 가져온다
function Show-Front([string]$title) {
  try { [void](New-Object -ComObject WScript.Shell).AppActivate($title) } catch {}
}

try { $excel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application") } catch { $excel = New-Object -ComObject Excel.Application }
$excel.Visible = $true
$book = $null
foreach ($item in $excel.Workbooks) { if ($item.FullName -eq $Path) { $book = $item } }
# UpdateLinks 0: 외부 연결을 업데이트하지 않고 연다 (업데이트 확인 창이 다른 창 뒤에 숨어 멈추는 것을 막는다)
if (-not $book) { $book = $excel.Workbooks.Open($Path, 0) }
$book.Activate()
if ($Sheet) {
  $target = $book.Worksheets.Item($Sheet)
  $target.Activate()
  if ($Cell) { [void]$target.Range($Cell).Select() }
}
Show-Front $book.Name
"OK"
