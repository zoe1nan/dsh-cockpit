param(
  [int]$ParentPid = 0,
  [string]$RuntimeDir = ''
)

# dsh-hud desktop overlay: a frameless, transparent, always-on-top WPF window
# that mirrors the task HUD outside the DSH window. It reads the same local
# snapshot the Host writes (~/.dsh/dsh-hud/state.json) and never talks to the
# network. The Host process starts and stops it.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms

$hudDir = if ($RuntimeDir -ne '') { $RuntimeDir } else { Join-Path (Join-Path $env:USERPROFILE '.dsh\cockpit') 'capsule' }
$stateFile = Join-Path $hudDir 'state.json'
$heartbeatFile = Join-Path $hudDir 'overlay.heartbeat'
$posFile = Join-Path $hudDir 'overlay-pos.json'
$bridgeFile = if ($env:DSH_COCKPIT_BRIDGE_FILE) { $env:DSH_COCKPIT_BRIDGE_FILE } else { Join-Path (Join-Path $env:USERPROFILE '.dsh\cockpit') 'hud.json' }
$script:bridge = $null
$script:bridgeFresh = $false
$script:bridgeStaleMs = 120000
$logFile = Join-Path $hudDir 'overlay.log'
New-Item -ItemType Directory -Force -Path $hudDir | Out-Null

function Write-Log([string]$message) {
  try {
    if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 200000)) { Remove-Item $logFile -Force }
    Add-Content -Path $logFile -Value ('{0:HH:mm:ss.fff} {1}' -f (Get-Date), $message)
  } catch { }
}

function Read-Bridge {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try {
      if (-not (Test-Path $bridgeFile)) { return $null }
      $raw = [System.IO.File]::ReadAllText($bridgeFile, [System.Text.Encoding]::UTF8)
      if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
      return ($raw | ConvertFrom-Json)
    } catch {
      Start-Sleep -Milliseconds 30
    }
  }
  return $null
}

# Single instance: a second overlay would draw a second capsule.
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\dsh-cockpit-overlay', [ref]$createdNew)
if (-not $createdNew) { return }

function Invoke-OnUi([scriptblock]$action) {
  $script:dispatcher.Invoke([Action]$action) | Out-Null
}

function New-Brush([string]$hex, [double]$alpha = 1.0) {
  $color = [System.Windows.Media.ColorConverter]::ConvertFromString($hex)
  $a = [byte][math]::Round([math]::Max(0.0, [math]::Min(1.0, $alpha)) * 255)
  return [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromArgb($a, $color.R, $color.G, $color.B))
}

# Colors are '#AARRGGBB'; offsets are matched by index.
function New-Radial([string]$hex, [double]$alpha) {
  $brush = New-Object System.Windows.Media.RadialGradientBrush
  $color = [System.Windows.Media.ColorConverter]::ConvertFromString($hex)
  $inner = [byte][math]::Round([math]::Max(0.0, [math]::Min(1.0, $alpha)) * 255)
  $mid = [byte][math]::Round([math]::Max(0.0, [math]::Min(1.0, $alpha * 0.55)) * 255)
  $brush.GradientStops.Add((New-Object System.Windows.Media.GradientStop([System.Windows.Media.Color]::FromArgb($inner, $color.R, $color.G, $color.B), 0)))
  $brush.GradientStops.Add((New-Object System.Windows.Media.GradientStop([System.Windows.Media.Color]::FromArgb($mid, $color.R, $color.G, $color.B), 0.5)))
  $brush.GradientStops.Add((New-Object System.Windows.Media.GradientStop([System.Windows.Media.Color]::FromArgb(0, $color.R, $color.G, $color.B), 1)))
  return $brush
}

function New-Gradient([string[]]$colors, [double[]]$offsets, [double]$x1, [double]$y1, [double]$x2, [double]$y2) {
  $brush = New-Object System.Windows.Media.LinearGradientBrush
  $brush.StartPoint = New-Object System.Windows.Point($x1, $y1)
  $brush.EndPoint = New-Object System.Windows.Point($x2, $y2)
  for ($i = 0; $i -lt $colors.Count; $i++) {
    $color = [System.Windows.Media.ColorConverter]::ConvertFromString($colors[$i])
    $brush.GradientStops.Add((New-Object System.Windows.Media.GradientStop($color, [double]$offsets[$i])))
  }
  return $brush
}

$script:theme = 'dark'
$script:palette = @{}
$script:level = 0.0
$script:target = 0.0
$script:phase = 0.0
$script:visibleContent = $null
$script:expanded = $false
$script:indeterminate = $false
$script:idle = $false
$script:appVisible = $false
$script:percentValue = $null
$script:stepsSignature = ''
$script:drag = $null
# v1.1: last bridge snapshot kept for capsule click-through (open cockpit).
$script:cockpitUrl = ''
$script:bridgeRunning = 0
$script:bridgeApprovals = 0
$script:hoverTimer = $null
$script:whaleBitmap = New-Object System.Windows.Media.Imaging.BitmapImage
$script:whaleBitmap.BeginInit()
$script:whaleBitmap.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
$script:whaleBitmap.UriSource = New-Object System.Uri((Join-Path $PSScriptRoot 'whale.png'))
$script:whaleBitmap.EndInit()
$script:whaleBitmap.Freeze()
$script:lastReadError = ''

# ------------------------------------------------------------------ window
$win = New-Object System.Windows.Window
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $false
$win.ShowActivated = $false
$win.ResizeMode = 'NoResize'
$win.Width = 400
$win.Height = 58
$win.FontFamily = New-Object System.Windows.Media.FontFamily('Noto Sans SC')
$win.Visibility = 'Collapsed'

$root = New-Object System.Windows.Controls.Grid
$rowCapsule = New-Object System.Windows.Controls.RowDefinition
$rowCapsule.Height = New-Object System.Windows.GridLength(58)
$rowCard = New-Object System.Windows.Controls.RowDefinition
$rowCard.Height = [System.Windows.GridLength]::Auto
$root.RowDefinitions.Add($rowCapsule) | Out-Null
$root.RowDefinitions.Add($rowCard) | Out-Null
$win.Content = $root

$capsule = New-Object System.Windows.Controls.Border
$capsule.CornerRadius = New-Object System.Windows.CornerRadius(29)
$capsule.BorderThickness = New-Object System.Windows.Thickness(1)
$capsule.Height = 58
$capsule.Cursor = [System.Windows.Input.Cursors]::Hand
$root.Children.Add($capsule) | Out-Null

$capGlow = New-Object System.Windows.Controls.Border
$capGlow.CornerRadius = New-Object System.Windows.CornerRadius(30)
$capGlow.BorderThickness = New-Object System.Windows.Thickness(1.6)
$capGlow.Margin = New-Object System.Windows.Thickness(-2)
$capGlow.IsHitTestVisible = $false
$root.Children.Insert(0, $capGlow) | Out-Null
$capGrid = New-Object System.Windows.Controls.Grid
foreach ($width in @(58, -1, 66, 32)) {
  $col = New-Object System.Windows.Controls.ColumnDefinition
  if ($width -lt 0) { $col.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
  else { $col.Width = New-Object System.Windows.GridLength($width) }
  $capGrid.ColumnDefinitions.Add($col) | Out-Null
}
$capsule.Child = $capGrid
$capSheen = New-Object System.Windows.Controls.Border
$capSheen.CornerRadius = New-Object System.Windows.CornerRadius(29)
$capSheen.IsHitTestVisible = $false
[System.Windows.Controls.Grid]::SetColumnSpan($capSheen, 4) | Out-Null
$capGrid.Children.Add($capSheen) | Out-Null

# Whale mark.
$whaleImage = New-Object System.Windows.Controls.Image
$whaleImage.Width = 32
$whaleImage.Height = 23.5
$whaleImage.Stretch = 'Uniform'
$whaleImage.SnapsToDevicePixels = $true
[System.Windows.Media.RenderOptions]::SetBitmapScalingMode($whaleImage, [System.Windows.Media.BitmapScalingMode]::HighQuality)
$whaleImage.Source = $script:whaleBitmap
[System.Windows.Controls.Grid]::SetColumn($whaleImage, 0) | Out-Null
$whaleHalo = New-Object System.Windows.Shapes.Ellipse
$whaleHalo.Width = 54
$whaleHalo.Height = 54
$whaleHalo.HorizontalAlignment = 'Center'
$whaleHalo.VerticalAlignment = 'Center'
$whaleHalo.IsHitTestVisible = $false
[System.Windows.Controls.Grid]::SetColumn($whaleHalo, 0) | Out-Null
$capGrid.Children.Add($whaleHalo) | Out-Null
$capGrid.Children.Add($whaleImage) | Out-Null

# Liquid tank.
$tankWrap = New-Object System.Windows.Controls.Border
$tankWrap.CornerRadius = New-Object System.Windows.CornerRadius(19)
$tankWrap.BorderThickness = New-Object System.Windows.Thickness(1)
$tankWrap.Height = 38
$tankWrap.Margin = New-Object System.Windows.Thickness(0, 10, 0, 10)
$tankWrap.VerticalAlignment = 'Center'
$tankWrap.ClipToBounds = $true
[System.Windows.Controls.Grid]::SetColumn($tankWrap, 1) | Out-Null
$tankBloom = New-Object System.Windows.Shapes.Ellipse
$tankBloom.Width = 150
$tankBloom.Height = 50
$tankBloom.HorizontalAlignment = 'Center'
$tankBloom.VerticalAlignment = 'Center'
$tankBloom.IsHitTestVisible = $false
$tankBloom.Opacity = 0.5
[System.Windows.Controls.Grid]::SetColumn($tankBloom, 1) | Out-Null
$capGrid.Children.Add($tankBloom) | Out-Null
$capGrid.Children.Add($tankWrap) | Out-Null

$tankCanvas = New-Object System.Windows.Controls.Canvas
$tankCanvas.Height = 38
$tankCanvas.ClipToBounds = $true
$tankCanvas.Add_SizeChanged({
  $canvas = $script:tankCanvas
  $w = $canvas.ActualWidth
  $h = $canvas.ActualHeight
  if ($w -lt 2 -or $h -lt 2) { return }
  $clip = New-Object System.Windows.Media.RectangleGeometry
  $clip.Rect = New-Object System.Windows.Rect(0, 0, $w, $h)
  $clip.RadiusX = $h / 2
  $clip.RadiusY = $h / 2
  $canvas.Clip = $clip
})
$tankWrap.Child = $tankCanvas

$liquidPath = New-Object System.Windows.Shapes.Path
$liquidPath.IsHitTestVisible = $false
$tankCanvas.Children.Add($liquidPath) | Out-Null

$surfaceGlow = New-Object System.Windows.Shapes.Ellipse
$surfaceGlow.Width = 34
$surfaceGlow.Height = 38
$surfaceGlow.IsHitTestVisible = $false
$surfaceGlow.Opacity = 0.55
$surfaceGlow.Effect = New-Object System.Windows.Media.Effects.BlurEffect
$surfaceGlow.Effect.Radius = 12
$tankCanvas.Children.Add($surfaceGlow) | Out-Null

$surfaceLine = New-Object System.Windows.Shapes.Path
$surfaceLine.StrokeThickness = 1.4
$surfaceLine.StrokeStartLineCap = 'Round'
$surfaceLine.StrokeEndLineCap = 'Round'
$surfaceLine.IsHitTestVisible = $false
$surfaceLine.Opacity = 0.85
$surfaceLine.Effect = New-Object System.Windows.Media.Effects.BlurEffect
$surfaceLine.Effect.Radius = 1.6
$tankCanvas.Children.Add($surfaceLine) | Out-Null

$tankShade = New-Object System.Windows.Controls.Border
$tankShade.CornerRadius = New-Object System.Windows.CornerRadius(19)
$tankShade.IsHitTestVisible = $false
$tankCanvas.Children.Add($tankShade) | Out-Null

$tickDots = @()
foreach ($fraction in @(0.2, 0.4, 0.6, 0.8)) {
  $dot = New-Object System.Windows.Shapes.Ellipse
  $dot.Width = 2.4
  $dot.Height = 2.4
  $dot.IsHitTestVisible = $false
  $dot.Opacity = 0.34
  $tankCanvas.Children.Add($dot) | Out-Null
  $tickDots += @{ Ellipse = $dot; Fraction = $fraction }
}

# Readout: step counter cross-fades into the percentage on hover.
# The grid fills its 66dip column exactly (Width/Margin on the grid used to
# overflow the column, pushing the label under the chevron); the right padding
# now lives on the text blocks so the label keeps a clear gap to the chevron.
$readGrid = New-Object System.Windows.Controls.Grid
[System.Windows.Controls.Grid]::SetColumn($readGrid, 2) | Out-Null
$capGrid.Children.Add($readGrid) | Out-Null

$readSteps = New-Object System.Windows.Controls.TextBlock
$readSteps.FontSize = 13
$readSteps.HorizontalAlignment = 'Right'
$readSteps.VerticalAlignment = 'Center'
$readSteps.Margin = New-Object System.Windows.Thickness(0, 0, 18, 0)
$readSteps.FontFamily = New-Object System.Windows.Media.FontFamily('Noto Sans SC')
$readGrid.Children.Add($readSteps) | Out-Null

$readPct = New-Object System.Windows.Controls.TextBlock
$readPct.FontSize = 13
$readPct.Opacity = 0
$readPct.HorizontalAlignment = 'Right'
$readPct.VerticalAlignment = 'Center'
$readPct.Margin = New-Object System.Windows.Thickness(0, 0, 18, 0)
$readPct.FontFamily = New-Object System.Windows.Media.FontFamily('Noto Sans SC')
$readGrid.Children.Add($readPct) | Out-Null

$chev = New-Object System.Windows.Shapes.Path
$chev.Data = [System.Windows.Media.Geometry]::Parse('M 1 1 L 6 5.2 L 11 1')
$chev.StrokeThickness = 1.5
$chev.StrokeStartLineCap = 'Round'
$chev.StrokeEndLineCap = 'Round'
$chev.HorizontalAlignment = 'Center'
$chev.VerticalAlignment = 'Center'
[System.Windows.Controls.Grid]::SetColumn($chev, 3) | Out-Null
$capGrid.Children.Add($chev) | Out-Null

$checkMark = New-Object System.Windows.Shapes.Path
$checkMark.Data = [System.Windows.Media.Geometry]::Parse('M 1 6.4 L 4.8 10.2 L 12 1.6')
$checkMark.StrokeThickness = 1.7
$checkMark.StrokeStartLineCap = 'Round'
$checkMark.StrokeEndLineCap = 'Round'
$checkMark.HorizontalAlignment = 'Center'
$checkMark.VerticalAlignment = 'Center'
$checkMark.Visibility = 'Collapsed'
[System.Windows.Controls.Grid]::SetColumn($checkMark, 3) | Out-Null
$capGrid.Children.Add($checkMark) | Out-Null

# Small pill floating above the liquid: running agents / pending approvals.
$deckBadge = New-Object System.Windows.Controls.Border
$deckBadge.CornerRadius = New-Object System.Windows.CornerRadius(9)
$deckBadge.Padding = New-Object System.Windows.Thickness(7, 1, 7, 2)
$deckBadge.HorizontalAlignment = 'Right'
$deckBadge.VerticalAlignment = 'Top'
$deckBadge.Margin = New-Object System.Windows.Thickness(0, 6, 140, 0)
$deckBadge.IsHitTestVisible = $false
$deckBadge.Visibility = 'Collapsed'
[System.Windows.Controls.Grid]::SetColumnSpan($deckBadge, 4) | Out-Null
$capGrid.Children.Add($deckBadge) | Out-Null
$deckBadgeText = New-Object System.Windows.Controls.TextBlock
$deckBadgeText.FontSize = 9.5
$deckBadgeText.FontWeight = 'Medium'
$deckBadgeText.FontFamily = New-Object System.Windows.Media.FontFamily('Noto Sans SC')
$deckBadge.Child = $deckBadgeText

# -------------------------------------------------------------------- card
$card = New-Object System.Windows.Controls.Border
$card.CornerRadius = New-Object System.Windows.CornerRadius(20)
$card.BorderThickness = New-Object System.Windows.Thickness(1)
$card.Margin = New-Object System.Windows.Thickness(0, 10, 0, 0)
$card.Padding = New-Object System.Windows.Thickness(18, 15, 18, 14)
$card.Visibility = 'Collapsed'
[System.Windows.Controls.Grid]::SetRow($card, 1) | Out-Null
$root.Children.Add($card) | Out-Null

$cardStack = New-Object System.Windows.Controls.StackPanel
$card.Child = $cardStack

$headGrid = New-Object System.Windows.Controls.Grid
foreach ($width in @(20, -1, 18)) {
  $col = New-Object System.Windows.Controls.ColumnDefinition
  if ($width -lt 0) { $col.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
  else { $col.Width = New-Object System.Windows.GridLength($width) }
  $headGrid.ColumnDefinitions.Add($col) | Out-Null
}
$cardStack.Children.Add($headGrid) | Out-Null

$cardWhaleImage = New-Object System.Windows.Controls.Image
$cardWhaleImage.Width = 18
$cardWhaleImage.Height = 13.2
$cardWhaleImage.Stretch = 'Uniform'
$cardWhaleImage.VerticalAlignment = 'Center'
  $cardWhaleImage.SnapsToDevicePixels = $true
$cardWhaleImage.Source = $script:whaleBitmap
[System.Windows.Controls.Grid]::SetColumn($cardWhaleImage, 0) | Out-Null
$headGrid.Children.Add($cardWhaleImage) | Out-Null

$titleText = New-Object System.Windows.Controls.TextBlock
$titleText.FontSize = 15
$titleText.FontWeight = 'SemiBold'
$titleText.TextTrimming = 'CharacterEllipsis'
$titleText.VerticalAlignment = 'Center'
$titleText.Margin = New-Object System.Windows.Thickness(8, 0, 6, 0)
[System.Windows.Controls.Grid]::SetColumn($titleText, 1) | Out-Null
$headGrid.Children.Add($titleText) | Out-Null

$closeText = New-Object System.Windows.Controls.TextBlock
$closeText.Text = '✕'
$closeText.FontSize = 11
$closeText.HorizontalAlignment = 'Right'
$closeText.VerticalAlignment = 'Center'
$closeText.Cursor = [System.Windows.Input.Cursors]::Hand
$closeText.ToolTip = '收起'
[System.Windows.Controls.Grid]::SetColumn($closeText, 2) | Out-Null
$headGrid.Children.Add($closeText) | Out-Null

$subText = New-Object System.Windows.Controls.TextBlock
$subText.FontSize = 11.5
$subText.Margin = New-Object System.Windows.Thickness(28, 3, 0, 0)
$cardStack.Children.Add($subText) | Out-Null

$progressGrid = New-Object System.Windows.Controls.Grid
$progressGrid.Margin = New-Object System.Windows.Thickness(0, 14, 0, 0)
foreach ($width in @(28, -1, 34)) {
  $col = New-Object System.Windows.Controls.ColumnDefinition
  if ($width -lt 0) { $col.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
  else { $col.Width = New-Object System.Windows.GridLength($width) }
  $progressGrid.ColumnDefinitions.Add($col) | Out-Null
}
$cardStack.Children.Add($progressGrid) | Out-Null

$progressLabel = New-Object System.Windows.Controls.TextBlock
$progressLabel.Text = '进度'
$progressLabel.FontSize = 10
$progressLabel.VerticalAlignment = 'Center'
[System.Windows.Controls.Grid]::SetColumn($progressLabel, 0) | Out-Null
$progressGrid.Children.Add($progressLabel) | Out-Null

$progressTrack = New-Object System.Windows.Controls.Border
$progressTrack.Height = 5
$progressTrack.CornerRadius = New-Object System.Windows.CornerRadius(2.5)
$progressTrack.Margin = New-Object System.Windows.Thickness(2, 0, 8, 0)
$progressTrack.VerticalAlignment = 'Center'
[System.Windows.Controls.Grid]::SetColumn($progressTrack, 1) | Out-Null
$progressGrid.Children.Add($progressTrack) | Out-Null

$progressFill = New-Object System.Windows.Controls.Border
$progressFill.CornerRadius = New-Object System.Windows.CornerRadius(2.5)
$progressFill.HorizontalAlignment = 'Left'
$progressFill.Width = 0
$progressTrack.Child = $progressFill

$progressPct = New-Object System.Windows.Controls.TextBlock
$progressPct.FontSize = 10.5
$progressPct.HorizontalAlignment = 'Right'
$progressPct.VerticalAlignment = 'Center'
$progressPct.FontFamily = New-Object System.Windows.Media.FontFamily('Noto Sans SC')
[System.Windows.Controls.Grid]::SetColumn($progressPct, 2) | Out-Null
$progressGrid.Children.Add($progressPct) | Out-Null

$stepsPanel = New-Object System.Windows.Controls.StackPanel
$stepsPanel.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
$cardStack.Children.Add($stepsPanel) | Out-Null

$actionBox = New-Object System.Windows.Controls.Border
$actionBox.CornerRadius = New-Object System.Windows.CornerRadius(12)
$actionBox.BorderThickness = New-Object System.Windows.Thickness(1)
$actionBox.Padding = New-Object System.Windows.Thickness(10, 8, 10, 9)
$actionBox.Margin = New-Object System.Windows.Thickness(0, 14, 0, 0)
$cardStack.Children.Add($actionBox) | Out-Null

# ---- compact cockpit section (HUD bridge, v0.9 A line) ---------------------
$deckPanel = New-Object System.Windows.Controls.Border
$deckPanel.CornerRadius = New-Object System.Windows.CornerRadius(12)
$deckPanel.BorderThickness = New-Object System.Windows.Thickness(1)
$deckPanel.Padding = New-Object System.Windows.Thickness(13, 10, 13, 10)
$deckPanel.Margin = New-Object System.Windows.Thickness(0, 12, 0, 0)
$deckPanel.Visibility = 'Collapsed'
$cardStack.Children.Add($deckPanel) | Out-Null
$deckStack = New-Object System.Windows.Controls.StackPanel
$deckPanel.Child = $deckStack
$deckTitle = New-Object System.Windows.Controls.TextBlock
$deckTitle.Text = '指挥台'
$deckTitle.FontSize = 10
$deckStack.Children.Add($deckTitle) | Out-Null
$deckLine = New-Object System.Windows.Controls.TextBlock
$deckLine.FontSize = 12
$deckLine.FontWeight = 'Medium'
$deckLine.Margin = New-Object System.Windows.Thickness(0, 4, 0, 0)
$deckStack.Children.Add($deckLine) | Out-Null
$deckRound = New-Object System.Windows.Controls.TextBlock
$deckRound.FontSize = 10.5
$deckRound.Margin = New-Object System.Windows.Thickness(0, 2, 0, 0)
$deckStack.Children.Add($deckRound) | Out-Null

$actionStack = New-Object System.Windows.Controls.StackPanel
$actionBox.Child = $actionStack

$actionLabel = New-Object System.Windows.Controls.TextBlock
$actionLabel.Text = '当前动作'
$actionLabel.FontSize = 9.5
$actionStack.Children.Add($actionLabel) | Out-Null

$actionText = New-Object System.Windows.Controls.TextBlock
$actionText.FontSize = 12.5
$actionText.Margin = New-Object System.Windows.Thickness(0, 2, 0, 0)
$actionText.TextWrapping = 'Wrap'
$actionStack.Children.Add($actionText) | Out-Null

$footerGrid = New-Object System.Windows.Controls.Grid
$footerGrid.Margin = New-Object System.Windows.Thickness(0, 14, 0, 0)
foreach ($width in @(86, 60, 78, -1, 52)) {
  $col = New-Object System.Windows.Controls.ColumnDefinition
  if ($width -lt 0) { $col.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
  else { $col.Width = New-Object System.Windows.GridLength($width) }
  $footerGrid.ColumnDefinitions.Add($col) | Out-Null
}
$cardStack.Children.Add($footerGrid) | Out-Null

function New-Button([string]$label, [bool]$primary) {
  $border = New-Object System.Windows.Controls.Border
  $border.CornerRadius = New-Object System.Windows.CornerRadius(10)
  $border.Padding = New-Object System.Windows.Thickness(12, 6, 12, 6)
  $border.Cursor = [System.Windows.Input.Cursors]::Hand
  $border.HorizontalAlignment = 'Left'
  $text = New-Object System.Windows.Controls.TextBlock
  $text.Text = $label
  $text.FontSize = 12
  $text.FontWeight = 'Medium'
  $border.Child = $text
  if ($primary) { $border.Tag = 'primary' } else { $border.Tag = 'ghost' }
  return $border
}

$openButton = New-Button '打开 DSH' $true
[System.Windows.Controls.Grid]::SetColumn($openButton, 0) | Out-Null
$footerGrid.Children.Add($openButton) | Out-Null

$collapseButton = New-Button '收起' $false
[System.Windows.Controls.Grid]::SetColumn($collapseButton, 1) | Out-Null
$collapseButton.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
$footerGrid.Children.Add($collapseButton) | Out-Null

$elapsedText = New-Object System.Windows.Controls.TextBlock
$elapsedText.FontSize = 10.5
$elapsedText.HorizontalAlignment = 'Right'
$elapsedText.VerticalAlignment = 'Center'
$deckButton = New-Button '指挥台' $false
[System.Windows.Controls.Grid]::SetColumn($deckButton, 2) | Out-Null
$deckButton.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
$deckButton.Visibility = 'Collapsed'
$deckButton.Add_MouseLeftButtonUp({
  $target = [string]$deckButton.Tag
  if ($target -ne '') {
    try { Start-Process $target } catch { Write-Log ('open deck failed: ' + $_) }
  }
})
$footerGrid.Children.Add($deckButton) | Out-Null

$elapsedText.FontFamily = New-Object System.Windows.Media.FontFamily('Noto Sans SC')
[System.Windows.Controls.Grid]::SetColumn($elapsedText, 4) | Out-Null
$footerGrid.Children.Add($elapsedText) | Out-Null

# ------------------------------------------------------------------ theme
# Nothing reports the app theme any more now that the docked half is gone:
# follow the Windows app theme directly (Settings → Personalization → Colors).
function Get-SystemTheme {
  try {
    $personalize = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name 'AppsUseLightTheme' -ErrorAction Stop
    if ($personalize.AppsUseLightTheme -eq 1) { return 'light' }
  } catch { }
  return 'dark'
}

function Get-Palette([string]$theme) {
  $dark = @{
    capBg = New-Gradient @('#EE16244A','#F30C1428','#F6070C18') @(0,0.5,1) 0 0 0 1
    capBorder = New-Brush '#8FB0FF' 0.16
halo = New-Radial '#4D6BFE' 0.22
capSheen = New-Gradient @('#38FFFFFF','#00FFFFFF') @(0,1) 0 0 0 1
    ring = New-Brush '#FFFFFF' 0.055
    rim = New-Brush '#4D6BFE' 0.34
    bloom = New-Radial '#4D6BFE' 0.30
    whale = New-Brush '#4D6BFE' 1.0
    tankBg = New-Brush '#0A1020' 0.62
    tankBorder = New-Brush '#FFFFFF' 0.10
    shade = New-Gradient @('#0DFFFFFF','#00FFFFFF') @(0,0.5) 0 0 0 1
    surface = New-Brush '#D6EAFF' 0.85
    glow = New-Brush '#6E9CFF' 0.32
    text = New-Brush '#EAF1FF' 1.0
    sub = New-Brush '#A9B7D6' 0.92
    dim = New-Brush '#7E8DAD' 0.95
    accent = New-Brush '#4D6BFE' 1.0
    cardBg = New-Brush '#101A2E' 0.97
    cardBorder = New-Brush '#A8C0FF' 0.12
    trackBg = New-Brush '#FFFFFF' 0.10
    boxBg = New-Brush '#FFFFFF' 0.045
    boxBorder = New-Brush '#FFFFFF' 0.07
    ghostBg = New-Brush '#FFFFFF' 0.075
    ghostText = New-Brush '#EAF1FF' 0.98
    primaryText = New-Brush '#FFFFFF' 1.0
    check = New-Brush '#FFFFFF' 0.96
    pending = New-Brush '#5A6786' 0.9
    tick = New-Brush '#BCD4FF' 0.9
    busy = New-Brush '#7EA0FF' 1.0
    deckBg = New-Brush '#FFFFFF' 0.055
    deckBorder = New-Brush '#4D6BFE' 0.34
    deckText = New-Brush '#EAF1FF' 1.0
    deckDim = New-Brush '#A9B7D6' 0.92
    deckBadgeBg = New-Brush '#4D6BFE' 0.9
    deckBadgeText = New-Brush '#FFFFFF' 1.0
  }
  $light = @{
    capBg = New-Gradient @('#F0FFFFFF','#F5F2F6FF','#F7EEF3FC') @(0,0.5,1) 0 0 0 1
    capBorder = New-Brush '#4D6BFE' 0.24
halo = New-Radial '#4D6BFE' 0.22
capSheen = New-Gradient @('#8AFFFFFF','#00FFFFFF') @(0,1) 0 0 0 1
    ring = New-Brush '#203566' 0.075
    rim = New-Brush '#4D6BFE' 0.26
    bloom = New-Radial '#4D6BFE' 0.22
    whale = New-Brush '#4D6BFE' 1.0
    tankBg = New-Brush '#E2EAF8' 0.85
    tankBorder = New-Brush '#4D6BFE' 0.16
    shade = New-Gradient @('#6BFFFFFF','#00FFFFFF') @(0,0.55) 0 0 0 1
    surface = New-Brush '#FFFFFF' 0.95
    glow = New-Brush '#9DBBFF' 0.4
    text = New-Brush '#16203A' 1.0
    sub = New-Brush '#5E6B8A' 0.95
    dim = New-Brush '#7A87A6' 0.95
    accent = New-Brush '#4D6BFE' 1.0
    cardBg = New-Brush '#FFFFFF' 0.99
    cardBorder = New-Brush '#4D6BFE' 0.16
    trackBg = New-Brush '#203566' 0.10
    boxBg = New-Brush '#EDF3FF' 0.95
    boxBorder = New-Brush '#4D6BFE' 0.10
    ghostBg = New-Brush '#203566' 0.07
    ghostText = New-Brush '#16203A' 1.0
    primaryText = New-Brush '#FFFFFF' 1.0
    check = New-Brush '#FFFFFF' 0.98
    pending = New-Brush '#93A0BC' 0.95
    tick = New-Brush '#4D6BFE' 0.35
    busy = New-Brush '#4D6BFE' 1.0
    deckBg = New-Brush '#4D6BFE' 0.05
    deckBorder = New-Brush '#4D6BFE' 0.16
    deckText = New-Brush '#16203A' 1.0
    deckDim = New-Brush '#5E6B8A' 0.95
    deckBadgeBg = New-Brush '#4D6BFE' 0.92
    deckBadgeText = New-Brush '#FFFFFF' 1.0
  }
  if ($theme -eq 'light') { return $light }
  return $dark
}

function Update-LiquidBrushes {
  $p = $script:palette
  if ($script:theme -eq 'light') {
    $liquid = New-Gradient @('#F01F3EBE','#F53F63F2','#F74D6BFE','#F29DBBFF') @(0,0.45,0.78,1) 0 0 1 0
  } else {
    $liquid = New-Gradient @('#F212205C','#F52843C8','#F54D6BFE','#EB9FC0FF') @(0,0.42,0.76,1) 0 0 1 0
  }
  $liquidPath.Fill = $liquid
  $surfaceGlow.Fill = $p.glow
  $surfaceLine.Stroke = $p.surface
}

function Apply-Palette([string]$theme) {
  $p = Get-Palette $theme
  $script:palette = $p
  $script:theme = $theme
  $capsule.Background = $p.capBg
$whaleHalo.Fill = $p.halo
$capSheen.Background = $p.capSheen
  $capSheen.BorderBrush = $p.ring
  $capSheen.BorderThickness = New-Object System.Windows.Thickness(1)
  $capGlow.BorderBrush = $p.rim
  $tankBloom.Fill = $p.bloom
  $capsule.BorderBrush = $p.capBorder
  $whaleHalo.Fill = $p.halo
  
  $tankWrap.Background = $p.tankBg
  $tankWrap.BorderBrush = $p.tankBorder
  $tankShade.Background = $p.shade
  $readSteps.Foreground = $p.text
  $readPct.Foreground = $p.text
  $chev.Stroke = $p.dim
  $checkMark.Stroke = $p.accent
  $card.Background = $p.cardBg
  $card.BorderBrush = $p.cardBorder
  $titleText.Foreground = $p.text
  $closeText.Foreground = $p.dim
  $subText.Foreground = $p.sub
  $progressLabel.Foreground = $p.dim
  $progressTrack.Background = $p.trackBg
  $progressFill.Background = New-Gradient @('#FF3D5BF2','#FF6E91FF') @(0,1) 0 0 1 0
  $progressPct.Foreground = $p.sub
  $actionBox.Background = $p.boxBg
  $actionBox.BorderBrush = $p.boxBorder
  $actionLabel.Foreground = $p.dim
  $actionText.Foreground = $p.text
  $openButton.Background = $p.accent
  $openButton.Child.Foreground = $p.primaryText
  $collapseButton.Background = $p.ghostBg
  $collapseButton.Child.Foreground = $p.ghostText
  $elapsedText.Foreground = $p.dim
  $deckPanel.Background = $p.deckBg
  $deckPanel.BorderBrush = $p.deckBorder
  $deckTitle.Foreground = $p.deckDim
  $deckLine.Foreground = $p.deckText
  $deckRound.Foreground = $p.deckDim
  $deckButton.Background = $p.ghostBg
  $deckButton.Child.Foreground = $p.ghostText
  $deckBadge.Background = $p.deckBadgeBg
  $deckBadgeText.Foreground = $p.deckBadgeText
  foreach ($entry in $tickDots) { $entry.Ellipse.Fill = $p.tick }
  Update-LiquidBrushes
  if ($script:stepsSignature -ne '') { $script:stepsSignature = '' }
}

# ------------------------------------------------------------------ layout
function Update-ProgressFill {
  $width = $script:progressTrack.ActualWidth
  if ($width -le 0) { return }
  $percent = if ($null -eq $script:percentValue) { 0 } else { [double]$script:percentValue }
  $script:progressFill.Width = [math]::Max(0.0, [math]::Min($width, $width * $percent / 100.0))
}

function Update-RootSize {
  $script:root.InvalidateMeasure()
  $script:root.Measure([System.Windows.Size]::new(400, [double]::PositiveInfinity))
  $script:root.Arrange([System.Windows.Rect]::new(0, 0, 400, $script:root.DesiredSize.Height))
  if ($script:expanded) {
    $height = [math]::Ceiling($script:root.DesiredSize.Height)
    if ($height -lt 58) { $height = 58 }
    $script:win.Height = $height
  } else {
    $script:win.Height = 58
  }
  Update-ProgressFill
}

$progressTrack.Add_SizeChanged({ Update-ProgressFill })

function Toggle-Expanded([bool]$open) {
  $script:expanded = $open
  $card.Visibility = if ($open) { 'Visible' } else { 'Collapsed' }
  if (-not $script:chevRotate) {
    $script:chevRotate = New-Object System.Windows.Media.RotateTransform(0)
    $chev.RenderTransform = $script:chevRotate
  }
  $script:chevRotate.Angle = if ($open) { 180 } else { 0 }
  Update-RootSize
}

# ------------------------------------------------------------------- liquid
function Update-Liquid {
  if ($script:win.Visibility -ne 'Visible') { return }
  $width = $script:tankCanvas.ActualWidth
  $height = $script:tankCanvas.ActualHeight
  if ($width -lt 4 -or $height -lt 4) { return }
  $target = if ($script:idle) { 0.105 + 0.018 * [math]::Sin($script:phase * 0.5) } elseif ($script:indeterminate) { 0.42 + 0.05 * [math]::Sin($script:phase * 0.5) } else { $script:target }
  $script:level += ($target - $script:level) * 0.12
  $level = [math]::Max(0.0, [math]::Min(1.0, $script:level)) * $width
  $geometry = New-Object System.Windows.Media.StreamGeometry
  $context = $geometry.Open()
  $context.BeginFigure([System.Windows.Point]::new(0, 0), $true, $true)
  $context.LineTo([System.Windows.Point]::new($level, 0), $true, $false)
  $linePoints = New-Object System.Collections.Generic.List[System.Windows.Point]
  for ($y = 0; $y -le $height; $y += 2) {
    $x = $level + 2.4 * [math]::Sin($y * 0.11 + $script:phase) + 1.1 * [math]::Sin($y * 0.052 - $script:phase * 0.72)
    $x = [math]::Max(0.0, [math]::Min($width, $x))
    $linePoints.Add([System.Windows.Point]::new($x, $y))
  }
  for ($i = 1; $i -lt $linePoints.Count; $i++) { $context.LineTo($linePoints[$i], $true, $false) }
  $context.LineTo([System.Windows.Point]::new(0, $height), $true, $false)
  $context.LineTo([System.Windows.Point]::new(0, 0), $true, $false)
  $context.Close()
  $liquidPath.Data = $geometry

  $lineGeometry = New-Object System.Windows.Media.StreamGeometry
  $lineContext = $lineGeometry.Open()
  $lineContext.BeginFigure($linePoints[0], $false, $false)
  for ($i = 1; $i -lt $linePoints.Count; $i++) { $lineContext.LineTo($linePoints[$i], $true, $false) }
  $lineContext.Close()
  $surfaceLine.Data = $lineGeometry

  [System.Windows.Controls.Canvas]::SetLeft($surfaceGlow, $level - 17)
  [System.Windows.Controls.Canvas]::SetTop($surfaceGlow, 0)
  $surfaceGlow.Opacity = 0.34 + 0.1 * [math]::Sin($script:phase * 0.9)

  $script:phase += 0.16
}

function Update-Ticks {
  $width = $script:tankCanvas.ActualWidth
  $height = $script:tankCanvas.ActualHeight
  if ($width -lt 4) { return }
  foreach ($entry in $tickDots) {
    [System.Windows.Controls.Canvas]::SetLeft($entry.Ellipse, $width * $entry.Fraction - 1.2)
    [System.Windows.Controls.Canvas]::SetTop($entry.Ellipse, $height / 2 - 1.2)
  }
}
$tankCanvas.Add_SizeChanged({
  Update-Ticks
  Update-Liquid
})

# --------------------------------------------------------------- rendering
function New-StepRow([string]$status, [string]$text) {
  $p = $script:palette
  $grid = New-Object System.Windows.Controls.Grid
  foreach ($width in @(18, -1)) {
    $col = New-Object System.Windows.Controls.ColumnDefinition
    if ($width -lt 0) { $col.Width = New-Object System.Windows.GridLength(1, [System.Windows.GridUnitType]::Star) }
    else { $col.Width = New-Object System.Windows.GridLength($width) }
    $grid.ColumnDefinitions.Add($col) | Out-Null
  }
  $grid.Margin = New-Object System.Windows.Thickness(0, 4, 0, 4)
  $iconCanvas = New-Object System.Windows.Controls.Canvas
  $iconCanvas.Width = 16
  $iconCanvas.Height = 16
  $iconCanvas.VerticalAlignment = 'Top'
  $iconCanvas.Margin = New-Object System.Windows.Thickness(0, 1, 0, 0)
  [System.Windows.Controls.Grid]::SetColumn($iconCanvas, 0) | Out-Null
  $grid.Children.Add($iconCanvas) | Out-Null

  $ellipse = New-Object System.Windows.Shapes.Ellipse
  $ellipse.Width = 14
  $ellipse.Height = 14
  [System.Windows.Controls.Canvas]::SetLeft($ellipse, 1)
  [System.Windows.Controls.Canvas]::SetTop($ellipse, 1)
  $iconCanvas.Children.Add($ellipse) | Out-Null

  $label = New-Object System.Windows.Controls.TextBlock
  $label.Text = $text
  $label.FontSize = 12.5
  $label.TextTrimming = 'CharacterEllipsis'
  $label.Margin = New-Object System.Windows.Thickness(8, 0, 0, 0)
  $label.VerticalAlignment = 'Center'
  [System.Windows.Controls.Grid]::SetColumn($label, 1) | Out-Null
  $grid.Children.Add($label) | Out-Null

  if ($status -eq 'completed') {
    $ellipse.Fill = $p.accent
    $label.Foreground = $p.sub
  } elseif ($status -eq 'in_progress') {
    $ellipse.Fill = $p.accent
    $ellipse.Opacity = 0.95
    $label.Foreground = $p.text
    $label.FontWeight = 'Medium'
    $dot = New-Object System.Windows.Shapes.Ellipse
    $dot.Width = 4
    $dot.Height = 4
    $dot.Fill = $p.primaryText
    [System.Windows.Controls.Canvas]::SetLeft($dot, 6)
    [System.Windows.Controls.Canvas]::SetTop($dot, 6)
    $iconCanvas.Children.Add($dot) | Out-Null
  } else {
    $ellipse.Stroke = $p.pending
    $ellipse.StrokeThickness = 1.2
    $label.Foreground = $p.dim
    $ellipse.Fill = [System.Windows.Media.Brushes]::Transparent
  }

  if ($status -eq 'completed') {
    $check = New-Object System.Windows.Shapes.Path
    $check.Data = [System.Windows.Media.Geometry]::Parse('M 3.6 7.4 L 6.2 9.9 L 10.6 4.2')
    $check.Stroke = $p.check
    $check.StrokeThickness = 1.5
    $check.StrokeStartLineCap = 'Round'
    $check.StrokeEndLineCap = 'Round'
    $check.IsHitTestVisible = $false
    [System.Windows.Controls.Canvas]::SetLeft($check, 1)
    [System.Windows.Controls.Canvas]::SetTop($check, 1)
    $iconCanvas.Children.Add($check) | Out-Null
  }
  return $grid
}

function Format-Elapsed([double]$ms) {
  if ($ms -le 0) { return '' }
  $seconds = [math]::Floor($ms / 1000)
  $minutes = [math]::Floor($seconds / 60)
  $seconds = $seconds % 60
  return '{0:00}:{1:00}' -f $minutes, $seconds
}

function Render-Idle {
  $script:idle = $true
  $script:indeterminate = $false
  $script:target = 0.0
  $script:percentValue = 0.0
  $readSteps.Text = '待命'
  $readPct.Text = '待命'
  $chev.Visibility = 'Visible'
  $checkMark.Visibility = 'Collapsed'
  $titleText.Text = '小蓝鲸待命'
  $subText.Text = '没有进行中的任务'
  $progressPct.Text = '—'
  $progressFill.Width = 0
  $actionText.Text = '待命中…'
  $elapsedText.Text = ''
  $stepsPanel.Children.Clear()
  $hint = New-Object System.Windows.Controls.TextBlock
  $hint.Text = '等你派个任务给我'
  $hint.FontSize = 12
  $hint.Foreground = $script:palette.dim
  $hint.Margin = New-Object System.Windows.Thickness(2, 4, 0, 4)
  $stepsPanel.Children.Add($hint) | Out-Null
  $script:visibleContent = 'idle'
  Sync-WindowVisibility
}

function Apply-State($state) {
  if ($null -eq $state) { return }
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($null -eq $state.active) {
    Render-Idle
    return
  }
  $active = $state.active
  $lastAt = [double]$active.lastAt
  $idle = $false
  if ($active.status -eq 'noplan' -and -not $active.running) { $idle = $true }
  elseif ($active.status -eq 'done' -and (($now - $lastAt) -gt 6500)) { $idle = $true }
  elseif (($now - $lastAt) -gt 1800000) { $idle = $true }
  if ($idle) {
    Render-Idle
    return
  }
  $script:idle = $false

  $p = $script:palette
  $signature = '{0}|{1}|{2}|{3}|{4}|{5}' -f $active.sessionId, $lastAt, $active.status, $active.percent, $active.title, $active.currentStep
  $same = ($signature -eq $script:visibleContent)
  $script:visibleContent = $signature
  $percent = if ($null -eq $active.percent) { 0 } else { [double]$active.percent }
  $script:target = $percent / 100.0
  $script:percentValue = $percent
  $script:indeterminate = ($null -eq $active.percent)

  if (-not $same) {
    $stepsText = if ($active.status -eq 'noplan') { '进行中' } else { '{0}/{1}' -f $active.completed, $active.total }
    $readSteps.Text = $stepsText
    $readPct.Text = if ($null -eq $active.percent) { '—' } else { '{0}%' -f $active.percent }
    if ($active.status -eq 'done') {
      $chev.Visibility = 'Collapsed'
      $checkMark.Visibility = 'Visible'
    } else {
      $chev.Visibility = 'Visible'
      $checkMark.Visibility = 'Collapsed'
    }
    $titleText.Text = if ($active.title) { $active.title } else { '当前任务' }
    $statusLabel = switch ($active.status) {
      'done' { '已完成' }
      'waiting' { '等待你确认' }
      'noplan' { '进行中' }
      default { '进行中' }
    }
    $total = if ($active.total) { $active.total } else { 0 }
    $completed = if ($active.completed) { $active.completed } else { 0 }
    $subText.Text = if ($active.status -eq 'noplan') { '进行中 · 暂无步骤' } else { '{0} · {1}/{2} 步' -f $statusLabel, $completed, $total }
    $progressPct.Text = if ($null -eq $active.percent) { '—' } else { '{0}%' -f $active.percent }
    $actionText.Text = if ($active.currentStep) { $active.currentStep } elseif ($active.running) { '正在处理…' } else { '等待下一步…' }
    $elapsedText.Text = if ($active.elapsedMs -gt 0) { Format-Elapsed $active.elapsedMs } else { '' }

    $script:stepsSignature = $signature
    $stepsPanel.Children.Clear()
    foreach ($step in @($active.steps)) {
      if ($null -eq $step) { continue }
      $stepsPanel.Children.Add((New-StepRow $step.status $step.text)) | Out-Null
    }
    if (@($active.steps).Count -eq 0) {
      $empty = New-Object System.Windows.Controls.TextBlock
      $empty.Text = '正在分析任务并制定计划…'
      $empty.FontSize = 12
      $empty.Foreground = $p.dim
      $empty.Margin = New-Object System.Windows.Thickness(2, 4, 0, 4)
      $stepsPanel.Children.Add($empty) | Out-Null
    }
  }

  $trackWidth = $progressTrack.ActualWidth
  if ($trackWidth -gt 0) { $progressFill.Width = [math]::Max(0, [math]::Min($trackWidth, $trackWidth * $percent / 100.0)) }
  Update-RootSize
}

# ------------------------------------------------------------------ events
# v1.1: click-through. A plain click on the capsule opens the cockpit (the HUD
# stays read-only; approvals are decided there, never here). When an approval is
# pending, the link deep-links straight to the approval gate (?focus=approvals).
function Get-CockpitTarget {
  $url = [string]$script:cockpitUrl
  if ($url -eq '') { return '' }
  if ($script:bridgeApprovals -gt 0) {
    if ($url.Contains('?')) { return ($url + '&focus=approvals') }
    return ($url + '?focus=approvals')
  }
  return $url
}

function Open-Cockpit {
  $target = Get-CockpitTarget
  if ($target -eq '') { return $false }
  try {
    Start-Process $target
    Write-Log ('open cockpit: ' + $target)
    return $true
  } catch {
    Write-Log ('open cockpit failed: ' + $_)
    return $false
  }
}

$capsule.Add_MouseEnter({
  if ($script:expanded) { return }
  if ($script:hoverTimer) { $script:hoverTimer.Stop() }
  $script:hoverTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:hoverTimer.Interval = [TimeSpan]::FromMilliseconds(150)
  $script:hoverTimer.Add_Tick({
    $script:hoverTimer.Stop()
    $anim = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, [TimeSpan]::FromMilliseconds(160))
    $readPct.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $anim)
    $anim2 = New-Object System.Windows.Media.Animation.DoubleAnimation(1, 0, [TimeSpan]::FromMilliseconds(160))
    $readSteps.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $anim2)
  })
  $script:hoverTimer.Start()
})
$capsule.Add_MouseLeave({
  if ($script:hoverTimer) { $script:hoverTimer.Stop() }
  $script:hoverTimer = New-Object System.Windows.Threading.DispatcherTimer
  $script:hoverTimer.Interval = [TimeSpan]::FromMilliseconds(400)
  $script:hoverTimer.Add_Tick({
    $script:hoverTimer.Stop()
    $anim = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 0, [TimeSpan]::FromMilliseconds(200))
    $readPct.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $anim)
    $anim2 = New-Object System.Windows.Media.Animation.DoubleAnimation(0, 1, [TimeSpan]::FromMilliseconds(200))
    $readSteps.BeginAnimation([System.Windows.UIElement]::OpacityProperty, $anim2)
  })
  $script:hoverTimer.Start()
})

# Dragging tracks the cursor in *screen* pixels. Reading the pointer relative to
# the window would feed the window's own movement back into the delta (move the
# window by the delta, the delta flips sign on the next event) and the capsule
# visibly jitters back and forth under the cursor.
$capsule.Add_MouseLeftButtonDown({
  param($sender, $event)
  $script:drag = $null
  $dpi = [System.Windows.Media.VisualTreeHelper]::GetDpi($script:win)
  $screen = $script:win.PointToScreen($event.GetPosition($script:win))
  $script:drag = @{
    ScreenX = $screen.X
    ScreenY = $screen.Y
    Left = $script:win.Left
    Top = $script:win.Top
    DpiX = $dpi.DpiScaleX
    DpiY = $dpi.DpiScaleY
    Moved = $false
  }
  $capsule.CaptureMouse() | Out-Null
})
$capsule.Add_MouseMove({
  param($sender, $event)
  if ($null -eq $script:drag) { return }
  $screen = $script:win.PointToScreen($event.GetPosition($script:win))
  $dx = ($screen.X - $script:drag.ScreenX) / $script:drag.DpiX
  $dy = ($screen.Y - $script:drag.ScreenY) / $script:drag.DpiY
  if (-not $script:drag.Moved -and ([math]::Abs($dx) + [math]::Abs($dy)) -gt 4) { $script:drag.Moved = $true }
  if ($script:drag.Moved) {
    # Snap to whole device pixels so the layered window never lands on a half
    # pixel and re-blurs its own text while moving.
    $targetLeft = $script:drag.Left + $dx
    $targetTop = $script:drag.Top + $dy
    $script:win.Left = [math]::Round($targetLeft * $script:drag.DpiX) / $script:drag.DpiX
    $script:win.Top = [math]::Round($targetTop * $script:drag.DpiY) / $script:drag.DpiY
  }
})
$capsule.Add_MouseLeftButtonUp({
  param($sender, $event)
  if ($null -eq $script:drag) { return }
  $moved = $script:drag.Moved
  $script:drag = $null
  $capsule.ReleaseMouseCapture()
  if ($moved) {
    try {
      $pos = @{ left = [math]::Round($script:win.Left); top = [math]::Round($script:win.Top) } | ConvertTo-Json -Compress
      Set-Content -Path $posFile -Value $pos -Encoding utf8
    } catch { }
  } else {
    # v1.1: the chevron keeps toggling the card; the rest of the capsule opens
    # the cockpit. Expanded card background collapses again (buttons handle
    # their own clicks before this handler runs).
    $overChevron = $false
    try { $overChevron = ($event.GetPosition($capsule).X -ge ($capsule.ActualWidth - 34)) } catch { }
    if ($overChevron) {
      Toggle-Expanded (-not $script:expanded)
    } elseif ($script:expanded) {
      Toggle-Expanded $false
    } elseif (-not (Open-Cockpit)) {
      # No cockpit URL yet (bridge missing/stale): keep the old behavior.
      Toggle-Expanded $true
    }
  }
})

$collapseButton.Add_MouseLeftButtonUp({ Toggle-Expanded $false })
$closeText.Add_MouseLeftButtonUp({ Toggle-Expanded $false })
$openButton.Add_MouseLeftButtonUp({
  try {
    $process = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($process) {
      $handle = $process.MainWindowHandle
      [DshHudNative]::ShowWindowAsync($handle, 9) | Out-Null
      [DshHudNative]::SetForegroundWindow($handle) | Out-Null
    }
  } catch { }
})

if (-not ('DshHudNative' -as [type])) {
  Add-Type -Namespace '' -Name 'DshHudNative' -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetWindowRect(System.IntPtr hWnd, out RECT rect);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(System.IntPtr hWnd, uint affinity);
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@
}

function Get-HarnessWindow {
  try {
    $process = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -eq $process) { return [IntPtr]::Zero }
    return $process.MainWindowHandle
  } catch {
    return [IntPtr]::Zero
  }
}

function Test-AppMinimized {
  try {
    $handle = Get-HarnessWindow
    if ($handle -eq [IntPtr]::Zero) { return $true }
    return [DshHudNative]::IsIconic($handle)
  } catch {
    return $false
  }
}

# True when some other window occupies the whole monitor in front of everything,
# e.g. a fullscreen video, a game or a fullscreen remote desktop. Narrow windows
# (browsers, chat apps, editors) do NOT pull the capsule out.
function Test-ForegroundFullscreen {
  try {
    $fg = [DshHudNative]::GetForegroundWindow()
    if ($fg -eq [IntPtr]::Zero) { return $false }
    $fgPid = [uint32]0
    [DshHudNative]::GetWindowThreadProcessId($fg, [ref]$fgPid) | Out-Null
    if ($fgPid -eq 0 -or $fgPid -eq $PID) { return $false }
    $owner = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
    if ($null -eq $owner) { return $false }
    if ($owner.ProcessName -eq 'explorer') { return $false }
    if (-not [DshHudNative]::IsWindowVisible($fg)) { return $false }
    $rect = New-Object DshHudNative+RECT
    if (-not [DshHudNative]::GetWindowRect($fg, [ref]$rect)) { return $false }
    $screen = [System.Windows.Forms.Screen]::FromHandle($fg)
    $bounds = $screen.Bounds
    $tolerance = 4
    return (
      [math]::Abs($rect.Left - $bounds.Left) -le $tolerance -and
      [math]::Abs($rect.Top - $bounds.Top) -le $tolerance -and
      [math]::Abs($rect.Right - $bounds.Right) -le $tolerance -and
      [math]::Abs($rect.Bottom - $bounds.Bottom) -le $tolerance
    )
  } catch {
    return $false
  }
}

function Test-CapsuleVisible {
  if ($env:DSH_HUD_FORCE_SHOW -eq '1') { return $true }
  if (Test-Path (Join-Path $hudDir 'force-show')) { return $true }
  # The capsule detaches only when the workspace is minimized or completely
  # covered by a fullscreen window. Alt+Tab, clicking another app or opening a
  # screenshot picker keeps it docked inside the workspace.
  return (Test-AppMinimized) -or (Test-ForegroundFullscreen)
}

# Hide the overlay from screen capture tools so screenshots never contain a
# duplicate capsule. WDA_EXCLUDEFROMCAPTURE (0x11) is Windows 10 2004+; older
# builds fall back to WDA_MONITOR (0x01), which blanks the window in captures.
function Set-CaptureExclusion {
  if ($env:DSH_HUD_ALLOW_CAPTURE -eq '1') { return }
  if (Test-Path (Join-Path $hudDir 'allow-capture')) { return }
  try {
    $helper = New-Object System.Windows.Interop.WindowInteropHelper($win)
    $handle = $helper.Handle
    if ($handle -eq [IntPtr]::Zero) { return }
    if (-not [DshHudNative]::SetWindowDisplayAffinity($handle, 0x11)) {
      [DshHudNative]::SetWindowDisplayAffinity($handle, 0x01) | Out-Null
    }
  } catch {
    Write-Log ('capture exclusion failed: ' + $_)
  }
}

function Sync-WindowVisibility {
  if ($null -eq $win) { return }
  $shouldShow = [bool]$script:appVisible
  if ($shouldShow) {
    if ($win.Visibility -ne 'Visible') {
      $win.Visibility = 'Visible'
      Set-CaptureExclusion
      Update-Ticks
      Update-Liquid
    }
  } elseif ($win.Visibility -ne 'Collapsed') {
    if ($script:expanded) { Toggle-Expanded $false }
    $win.Visibility = 'Collapsed'
  }
}

# ------------------------------------------------------------------ start
Apply-Palette (Get-SystemTheme)
$work = [System.Windows.SystemParameters]::WorkArea
$win.Left = [math]::Round(($work.Width - 400) / 2 + $work.Left)
$win.Top = $work.Top + 12
try {
  if (Test-Path $posFile) {
    $saved = Get-Content $posFile -Raw | ConvertFrom-Json
    if ($saved.left -is [double] -or $saved.left -is [int]) {
      $win.Left = [double]$saved.left
      $win.Top = [double]$saved.top
    }
  }
} catch { }

try {
  $win.Show()
} catch {
  Write-Log ('show failed: ' + $_)
}

# Start hidden; the capsule only detaches when the workspace is minimized or covered by a fullscreen window.
$win.Visibility = 'Collapsed'
Write-Log ('overlay start pid=' + $PID + ' rev=builtin-capsule')
$script:appVisible = Test-CapsuleVisible
# The visibility timer only reacts to *changes*, so apply the initial state
# right away: an overlay that starts while the workspace is already minimized
# (or while a debug flag forces it) must show its capsule immediately.
Sync-WindowVisibility

$script:dispatcher = [System.Windows.Threading.Dispatcher]::CurrentDispatcher
$themeTimer = New-Object System.Windows.Threading.DispatcherTimer
$themeTimer.Interval = [TimeSpan]::FromMilliseconds(350)
$themeTimer.Add_Tick({
  try {
    # Theme follows the OS even before the Host has written its first state.
    $theme = Get-SystemTheme
    if ($theme -ne $script:theme) { Apply-Palette $theme }
    if (-not (Test-Path $script:stateFile)) { return }
    # The Host replaces state.json between reads; a transient sharing violation
    # must not drop a frame of the HUD.
    $raw = $null
    for ($attempt = 0; $attempt -lt 3 -and $null -eq $raw; $attempt++) {
      try {
        $raw = [System.IO.File]::ReadAllText($script:stateFile, [System.Text.Encoding]::UTF8)
      } catch {
        if ($attempt -eq 2) { throw }
        Start-Sleep -Milliseconds 30
      }
    }
    if ([string]::IsNullOrWhiteSpace($raw)) { return }
    $state = $raw | ConvertFrom-Json
    Apply-State $state
  } catch {
    $msg = 'state read failed: ' + $_
    if ($msg -ne $script:lastReadError) { $script:lastReadError = $msg; Write-Log $msg }
  }
})
$themeTimer.Start()

$visibilityTimer = New-Object System.Windows.Threading.DispatcherTimer
$visibilityTimer.Interval = [TimeSpan]::FromMilliseconds(400)
$visibilityTimer.Add_Tick({
  try {
    $foreground = Test-CapsuleVisible
    if ($foreground -ne $script:appVisible) {
      $script:appVisible = $foreground
      Sync-WindowVisibility
    }
  } catch { }
})
$visibilityTimer.Start()

# The capsule mirrors the cockpit through a small JSON file; it never talks to
# the network. A stale file (or a disabled bridge) silently hides the extras.
function Update-BridgeUi {
  $bridge = $script:bridge
  $fresh = $false
  $running = 0
  $pending = 0
  $url = ''
  if ($null -ne $bridge) {
    try {
      if ($bridge.v -eq 1 -and $bridge.enabled -eq $true -and $null -ne $bridge.at) {
        $age = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - [double]$bridge.at
        if ($age -ge 0 -and $age -lt $script:bridgeStaleMs) { $fresh = $true }
      }
      if ($null -ne $bridge.team) { $running = [int]$bridge.team.running }
      if ($null -ne $bridge.approvals) { $pending = [int]$bridge.approvals }
      $url = [string]$bridge.cockpitUrl
    } catch { $fresh = $false }
  }
  $script:bridgeFresh = $fresh
  $script:cockpitUrl = $url
  $script:bridgeRunning = $running
  $script:bridgeApprovals = $pending
  if ($fresh) {
    $capsule.ToolTip = if ($pending -gt 0) { '有待审批 · 点击打开指挥台' } else { '点击打开指挥台' }
  } else {
    $capsule.ToolTip = '点击展开任务胶囊'
  }
  if ($fresh -and ($running -gt 0 -or $pending -gt 0)) {
    $parts = @()
    if ($running -gt 0) { $parts += ('{0} 跑' -f $running) }
    if ($pending -gt 0) { $parts += ('{0} 批' -f $pending) }
    $deckBadgeText.Text = ($parts -join ' · ')
    $deckBadge.Visibility = 'Visible'
  } else {
    $deckBadge.Visibility = 'Collapsed'
  }
  if ($fresh) {
    $deckPanel.Visibility = 'Visible'
    $line = @()
    if ($running -gt 0) { $line += ('{0} 个运行中' -f $running) } else { $line += '暂无运行中的 agent' }
    if ($pending -gt 0) { $line += ('{0} 个待审批' -f $pending) }
    $deckLine.Text = ($line -join ' · ')
    $round = $bridge.round
    if ($null -ne $round -and $null -ne $round.percent) {
      $deckRound.Text = ('{0} · {1}%' -f [string]$round.title, [int]$round.percent)
    } else {
      $deckRound.Text = '编队、任务板与审批都在指挥台里'
    }
    if ($url -ne '') {
      $deckButton.Tag = Get-CockpitTarget
      $deckButton.Visibility = 'Visible'
    } else {
      $deckButton.Visibility = 'Collapsed'
    }
  } else {
    $deckPanel.Visibility = 'Collapsed'
    $deckButton.Visibility = 'Collapsed'
  }
  Update-RootSize
}
$bridgeTimer = New-Object System.Windows.Threading.DispatcherTimer
$bridgeTimer.Interval = [TimeSpan]::FromMilliseconds(3000)
$bridgeTimer.Add_Tick({
  try {
    $script:bridge = Read-Bridge
    Update-BridgeUi
  } catch { }
})
$bridgeTimer.Start()

$liquidTimer = New-Object System.Windows.Threading.DispatcherTimer
$liquidTimer.Interval = [TimeSpan]::FromMilliseconds(33)
$liquidTimer.Add_Tick({ Update-Liquid })
$liquidTimer.Start()

# Debug aid: render the live visual tree to a PNG so layout can be inspected
# without going through OS screen capture (WDA_EXCLUDEFROMCAPTURE hides it).
# Keeps rendering while the flag file exists, so successive states (collapsed,
# card open, hovering) can all be captured from one run.
if (Test-Path (Join-Path $hudDir 'snapshot')) {
  $snapshotTimer = New-Object System.Windows.Threading.DispatcherTimer
  $snapshotTimer.Interval = [TimeSpan]::FromMilliseconds(1200)
  $snapshotTimer.Add_Tick({
    if (-not (Test-Path (Join-Path $hudDir 'snapshot'))) { $snapshotTimer.Stop(); return }
    try {
      $w = [int][math]::Ceiling($win.ActualWidth)
      $h = [int][math]::Ceiling($win.ActualHeight)
      if ($w -lt 2 -or $h -lt 2) { Write-Log 'snapshot: window has no size'; return }
      $bmp = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(($w * 2), ($h * 2), 192, 192, [System.Windows.Media.PixelFormats]::Pbgra32)
      $bmp.Render($win)
      $encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
      $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bmp)) | Out-Null
      $path = Join-Path $hudDir 'overlay-snapshot.png'
      $stream = [System.IO.File]::Open($path, [System.IO.FileMode]::Create)
      $encoder.Save($stream)
      $stream.Close()
      Write-Log ('snapshot written ' + $w + 'x' + $h + ' visible=' + $win.Visibility)
    } catch {
      Write-Log ('snapshot failed: ' + $_)
    }
  })
  $snapshotTimer.Start()
}

$heartbeatTimer = New-Object System.Windows.Threading.DispatcherTimer
$heartbeatTimer.Interval = [TimeSpan]::FromMilliseconds(1000)
$heartbeatTimer.Add_Tick({
  try {
    [System.IO.File]::WriteAllText($script:heartbeatFile, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString())
  } catch { }
  if ($script:ParentPid -gt 0) {
    $alive = Get-Process -Id $script:ParentPid -ErrorAction SilentlyContinue
    if ($null -eq $alive) {
      Write-Log 'parent exited; closing overlay'
      $script:heartbeatTimer.Stop()
      $script:win.Close()
      [System.Windows.Threading.Dispatcher]::CurrentDispatcher.InvokeShutdown()
    }
  }
})
$heartbeatTimer.Start()

try {
  [System.Windows.Threading.Dispatcher]::Run()
} finally {
  try { $mutex.ReleaseMutex() } catch { }
}
