$ErrorActionPreference = 'Stop'
$targets = Invoke-RestMethod 'http://127.0.0.1:9222/json' -TimeoutSec 5
$dash = $targets | Where-Object { $_.url -like '*dashboard.html*' } | Select-Object -First 1
if (-not $dash) { throw 'dashboard target not found' }

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync([Uri]$dash.webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).Wait()

function Send-Cdp([int]$id, [string]$method, $params) {
  $msg = @{ id = $id; method = $method; params = $params } | ConvertTo-Json -Depth 12 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
  $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
  $buf = [byte[]]::new(262144)
  $ms = [System.IO.MemoryStream]::new()
  do {
    $res = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), [System.Threading.CancellationToken]::None).Result
    $ms.Write($buf, 0, $res.Count)
  } while (-not $res.EndOfMessage)
  return ([System.Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json)
}

$expr = "window.api.saveCalibration(18.77, null).then(() => window.api.getState()).then(s => JSON.stringify({ cal: s.todayCalibration, officialOk: !!(s.officialMonth && s.officialMonth.ok), monthCost: s.officialMonth ? s.officialMonth.cost : null }))"
$r = Send-Cdp 1 'Runtime.evaluate' @{ expression = $expr; awaitPromise = $true; returnByValue = $true }
Write-Output ("RESULT: " + $r.result.result.value)

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [System.Threading.CancellationToken]::None).Wait()
