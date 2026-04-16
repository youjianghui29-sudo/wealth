$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$TaskName = "WealthDashboardDailyCollect"
$PythonScript = Join-Path $ProjectRoot "scripts\collector\run_daily.py"

$Action = New-ScheduledTaskAction `
  -Execute "python" `
  -Argument "`"$PythonScript`"" `
  -WorkingDirectory $ProjectRoot

$Trigger = New-ScheduledTaskTrigger -Daily -At "22:30"
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "每日采集基金与银行理财公开数据，供本地 Next.js 看板展示。" `
  -Force

Write-Host "Registered task: $TaskName"
