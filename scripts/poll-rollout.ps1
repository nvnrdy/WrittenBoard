$ErrorActionPreference = 'Stop'
$token = gcloud auth print-access-token
$headers = @{ Authorization = "Bearer $token" }
$base = 'https://firebaseapphosting.googleapis.com/v1beta/projects/writtenboard/locations/asia-southeast1/backends/writtenboard'
$target = 'f473b2b1f9bd0563360b6068e8b4345d2f2558d2'

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 15
  $builds = ((Invoke-WebRequest -Uri "$base/builds?pageSize=10" -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json).builds
  $rollouts = ((Invoke-WebRequest -Uri "$base/rollouts?pageSize=10" -Headers $headers -UseBasicParsing).Content | ConvertFrom-Json).rollouts
  $tb = $builds | Where-Object { $_.source.codebase.commit.hash -eq $target } | Select-Object -First 1
  if (-not $tb) {
    Write-Output "poll=$i waiting_for_build"
    continue
  }
  Write-Output ("poll={0} build={1} state={2}" -f $i, $tb.displayName, $tb.state)
  if ($tb.state -eq 'FAILED') {
    if ($tb.error.message) { Write-Output ("fail={0}" -f $tb.error.message.Substring(0, [Math]::Min(240, $tb.error.message.Length))) }
    exit 1
  }
  $tr = $rollouts | Where-Object { $_.build -like ("*/" + $tb.displayName) } | Select-Object -First 1
  if ($tr) {
    Write-Output ("rollout={0} state={1}" -f $tr.name.Split('/')[-1], $tr.state)
    if ($tr.state -eq 'SUCCEEDED') { exit 0 }
    if ($tr.state -eq 'FAILED') { exit 1 }
  }
}
Write-Output 'timeout'
exit 1
