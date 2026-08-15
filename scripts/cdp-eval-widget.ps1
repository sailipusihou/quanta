$ErrorActionPreference = 'Stop'
$targets = Invoke-RestMethod 'http://127.0.0.1:9222/json' -TimeoutSec 5
$w = $targets | Where-Object { $_.url -like '*widget.html*' } | Select-Object -First 1
if (-not $w) { throw 'widget target not found' }

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync([Uri]$w.webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).Wait()

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

$expr = $args[0]
$r = Send-Cdp 1 'Runtime.evaluate' @{ expression = $expr; awaitPromise = $true; returnByValue = $true }
if ($r.result.result.value -ne $null) {
  Write-Output ("RESULT: " + $r.result.result.value)
} elseif ($r.result.exceptionDetails) {
  Write-Output ("EXCEPTION: " + $r.result.exceptionDetails.text + " :: " + $r.result.exceptionDetails.exception.description)
} else {
  Write-Output ("RAW: " + ($r | ConvertTo-Json -Depth 12 -Compress))
}

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [System.Threading.CancellationToken]::None).Wait()
