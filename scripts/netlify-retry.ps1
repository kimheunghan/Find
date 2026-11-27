# Netlify 홈페이지 다시 올리기 (작업 스케줄러 "FindInside-Netlify-Retry"가 매일 부른다)
#
# 2026-11-25 뒤로 Netlify 배포가 멈췄다 (월 한도 초과로 추정). 한도가 다시 채워지면
# 저장소에 이미 올라가 있는 홈페이지 수정분을 한꺼번에 반영하려고 만든 것이다.
#
# 하는 일:
#   1. findinside.netlify.app/latest.json의 판 번호가 저장소 site/latest.json과 같으면
#      반영된 것이므로 기록을 남기고 이 예약 작업을 지운다.
#   2. 다르면 빈 커밋을 하나 만들어 main에 푸시한다. Netlify가 이것을 보고 다시 빌드한다.
#      (main이 아니거나, 커밋 대기 중인 변경이 있거나, 받아오기가 안 되면 그날은 건너뛴다)
# 기록: %LOCALAPPDATA%\FindInside-netlify-retry.log
#
# 시험: powershell -File scripts\netlify-retry.ps1 -DryRun  (확인만 하고 커밋·푸시·작업 삭제는 하지 않는다)
param([switch]$DryRun)

$TaskName = "FindInside-Netlify-Retry"
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $env:LOCALAPPDATA "FindInside-netlify-retry.log"

function Write-Log($text) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $text
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Output $line
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$want = (Get-Content (Join-Path $repo "site\latest.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$live = $null
try {
  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $live = (Invoke-RestMethod "https://findinside.netlify.app/latest.json?t=$stamp" -TimeoutSec 30).version
} catch {
  $live = $null
}

if ($live -eq $want) {
  Write-Log "반영됨: netlify.app/latest.json = $live. 예약 작업을 지운다."
  if (-not $DryRun) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  exit 0
}

Write-Log "아직 반영 안 됨: 홈페이지 $(if ($live) { $live } else { '없음' }), 저장소 $want"

$git = "C:\Program Files\Git\cmd\git.exe"
$branch = & $git -C $repo rev-parse --abbrev-ref HEAD
if ($branch -ne "main") { Write-Log "건너뜀: 지금 가지가 main이 아니다 ($branch)"; exit 0 }

& $git -C $repo diff --cached --quiet
if ($LASTEXITCODE -ne 0) { Write-Log "건너뜀: 커밋 대기 중인 변경이 있다"; exit 0 }

if ($DryRun) { Write-Log "시험: 여기서 빈 커밋을 만들어 푸시한다 (하지 않음)"; exit 0 }

& $git -C $repo pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { Write-Log "건너뜀: origin/main을 받아오지 못했다"; exit 0 }

$message = "Netlify 다시 올리기 (월 한도 뒤 자동, scripts/netlify-retry.ps1)`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
& $git -C $repo commit --allow-empty -m $message
if ($LASTEXITCODE -ne 0) { Write-Log "실패: 빈 커밋을 만들지 못했다"; exit 1 }

& $git -C $repo push origin main
if ($LASTEXITCODE -ne 0) { Write-Log "실패: 푸시하지 못했다"; exit 1 }

Write-Log "빈 커밋을 푸시했다. 내일 반영됐는지 다시 본다."
