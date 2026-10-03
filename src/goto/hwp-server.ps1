# FindInside 한글 도우미: 앱이 켜져 있는 동안 계속 돌며, 숨겨 둔 한글을 미리 준비해 두었다가 요청이 오면 그 한글로 문서를 연다.
# 한글을 새로 띄우는 데 5초 이상 걸리므로 미리 띄워 두면 누르고 나서 열릴 때까지가 짧아진다.
# 보안 모듈 등록(RegisterModule)을 부르지 않으면 한글의 "접근 허용" 확인 창이 뜨지 않는다.
# 입력(한 줄에 JSON 하나): {"id":1,"type":"warm"} | {"id":2,"type":"open","path":"...","page":3,"text":"...","term":"..."}
# 출력: "OK <id>" 또는 "ERR <id> <메시지>"
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$warm = $null

function Test-Alive($hwp) {
  if (-not $hwp) { return $false }
  try { [void]$hwp.XHwpDocuments.Count; return $true } catch { return $false }
}

# 숨긴 한글을 띄우고 빈 문서를 한 번 열어 둔다 (첫 열기에 드는 준비 시간을 미리 쓴다)
function New-Warm {
  $hwp = New-Object -ComObject HWPFrame.HwpObject
  $blank = Join-Path $env:TEMP "FindInside-blank.hwp"
  if (-not (Test-Path $blank)) { [void]$hwp.SaveAs($blank, "HWP", "") }
  [void]$hwp.Open($blank, "HWP", "forceopen:true")
  return $hwp
}

function Find-Text($hwp, [string]$value) {
  $f = $hwp.HParameterSet.HFindReplace
  [void]$hwp.HAction.GetDefault("RepeatFind", $f.HSet)
  $f.FindString = $value; $f.IgnoreMessage = 1; $f.Direction = 0; $f.FindType = 1
  return $hwp.HAction.Execute("RepeatFind", $f.HSet)
}

function Open-At($request) {
  $hwp = $script:warm
  $script:warm = $null
  if (-not (Test-Alive $hwp)) { $hwp = New-Warm }
  $format = if ($request.path -match "\.hwpx$") { "HWPX" } else { "HWP" }
  # 창을 먼저 보이게 하고 연다. 한글이 확인 창(예: 다른 곳에서 열린 문서)을 띄워도 사용자가 보고 답할 수 있어 멈추지 않는다.
  $hwp.XHwpWindows.Item(0).Visible = $true
  if (-not $hwp.Open($request.path, $format, "forceopen:true")) { throw "open failed" }
  if ($request.page -gt 0) {
    $g = $hwp.HParameterSet.HGotoE
    [void]$hwp.HAction.GetDefault("Goto", $g.HSet)
    $g.HSet.SetItem("DialogResult", [int]$request.page)
    $g.SetSelectionIndex = 1
    [void]$hwp.HAction.Execute("Goto", $g.HSet)
  }
  # 그 쪽부터 일치한 문구를 찾아 선택한다. 없으면 검색어로, 그래도 없으면 문서 처음부터 찾는다.
  if ($request.text) {
    $found = Find-Text $hwp $request.text
    if (-not $found -and $request.term -and $request.term -ne $request.text) { $found = Find-Text $hwp $request.term }
    if (-not $found) { $hwp.Run("MoveDocBegin"); if (-not (Find-Text $hwp $request.text) -and $request.term) { [void](Find-Text $hwp $request.term) } }
  }
  try { [void](New-Object -ComObject WScript.Shell).AppActivate([IO.Path]::GetFileName($request.path)) } catch {}
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if (-not $line.Trim()) { continue }
  $request = $line | ConvertFrom-Json
  try {
    if ($request.type -eq "open") { Open-At $request }
    elseif (-not (Test-Alive $warm)) { $warm = New-Warm }
    [Console]::Out.WriteLine("OK $($request.id)")
  } catch {
    [Console]::Out.WriteLine("ERR $($request.id) $($_.Exception.Message -replace "\s+", " ")")
  }
  [Console]::Out.Flush()
  # 문서를 연 뒤에는 다음 요청을 위해 숨긴 한글을 다시 준비한다
  if ($request.type -eq "open" -and -not (Test-Alive $warm)) { try { $warm = New-Warm } catch { $warm = $null } }
}

# 앱이 끝나면(입력이 닫히면) 숨겨 둔 한글을 닫는다
if (Test-Alive $warm) { try { $warm.Clear(1); $warm.Quit() } catch {} }
