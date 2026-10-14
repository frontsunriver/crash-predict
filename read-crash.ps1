Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$window = $null
foreach ($child in $children) {
  if ($child.Current.Name -like "*Crash Game*") { $window = $child; break }
}
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
$stack = New-Object System.Collections.Generic.Stack[object]
$stack.Push($window)
$seen = 0
$rows = New-Object System.Collections.Generic.List[string]
while ($stack.Count -gt 0 -and $seen -lt 12000) {
  $node = $stack.Pop()
  $seen++
  $name = $node.Current.Name
  if ($name -and $name.Length -le 16 -and $name -match "\d") {
    $rect = $node.Current.BoundingRectangle
    if ($rect.Width -gt 0) {
      $rows.Add(("{0:0}`t{1:0}`t{2}" -f $rect.Y, $rect.X, $name))
    }
  }
  $child = $walker.GetFirstChild($node)
  while ($child) {
    $stack.Push($child)
    $child = $walker.GetNextSibling($child)
  }
}
$rows | Sort-Object | Select-Object -First 80
Write-Output "nodes=$seen rows=$($rows.Count)"
