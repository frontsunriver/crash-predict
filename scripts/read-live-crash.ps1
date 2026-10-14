Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$children = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)
$window = $null
foreach ($child in $children) {
  $name = $child.Current.Name
  if ($name -like "*Crash Game*") { $window = $child; break }
  if (-not $window -and $name -like "*CRYGODI*") { $window = $child }
}
if (-not $window) {
  Write-Output "IDLE"
  exit 0
}
if ($window.Current.Name -like "*Log In*") {
  Write-Output "LOGIN"
  exit 0
}

$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$stack = New-Object System.Collections.Generic.Stack[object]
$stack.Push($window)
$seen = 0
$pills = @()
while ($stack.Count -gt 0 -and $seen -lt 12000) {
  $node = $stack.Pop()
  $seen++
  $label = $node.Current.Name
  if ($label -match "^(\d+\.\d+)(.)$") {
    $suffix = [int][char]$Matches[2]
    $value = [double]$Matches[1]
    $rect = $node.Current.BoundingRectangle
    if (($suffix -eq 215 -or $suffix -eq 120 -or $suffix -eq 88) -and $value -ge 1 -and $rect.Width -gt 0) {
      $pills += [pscustomobject]@{
        Y = [math]::Round($rect.Y)
        X = [math]::Round($rect.X)
        Value = "{0:0.00}" -f $value
      }
    }
  }
  $child = $walker.GetFirstChild($node)
  while ($child) {
    $stack.Push($child)
    $child = $walker.GetNextSibling($child)
  }
}

$groups = @($pills | Group-Object { [math]::Round($_.Y / 24) } | Where-Object { $_.Count -ge 2 })
if ($groups.Count -eq 0) {
  Write-Output "IDLE"
  exit 0
}

$history = $groups | Sort-Object { $_.Group[0].Y } | Select-Object -First 1
$ordered = @($history.Group | Sort-Object X)
Write-Output (($ordered | ForEach-Object { $_.Value }) -join ",")
