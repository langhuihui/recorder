/**
 * Canvas 2D 柱状波形绘制工具
 *
 * 核心规则：
 *   - 竖线游标始终在画布正中央，永不移动
 *   - cursorRatio=null → 录制模式：柱子从游标处生出向左滚动，右侧静音
 *   - cursorRatio=0~1 → 回放模式：波形以 centerIdx 为锚点左右分布，整体从右向左移动
 */

var BG_COLOR = '#17172c'

function clamp01(v) {
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

function clearCanvas(canvas, w, h, color) {
  if (!canvas) return
  var ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = color + '15'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, h / 2)
  ctx.lineTo(w, h / 2)
  ctx.stroke()
}

function getVisibleStats(peaks, start, end) {
  var min = 1
  var max = 0
  var hasValue = false

  for (var i = start; i < end; i++) {
    if (i < 0 || i >= peaks.length) continue
    var v = clamp01(peaks[i] || 0)
    if (!hasValue) {
      min = v
      max = v
      hasValue = true
    } else {
      if (v < min) min = v
      if (v > max) max = v
    }
  }

  if (!hasValue) {
    return { min: 0, max: 1, range: 1 }
  }

  var range = max - min
  if (range < 0.001) range = 0.001
  return { min: min, max: max, range: range }
}

function mapVisibleLevel(raw, stats) {
  raw = clamp01(raw)

  // 优先按当前视窗做拉伸，保证“看得见差异”
  var normalized = (raw - stats.min) / stats.range
  normalized = clamp01(normalized)

  // 让中高振幅差异更明显
  normalized = Math.pow(normalized, 1.35)

  // 给一个小底座，避免太矮时看不见
  return 0.12 + normalized * 0.88
}

function drawBarWaveform(canvas, w, h, peaks, cursorRatio, color, glowColor) {
  if (!canvas) return
  var ctx = canvas.getContext('2d')
  if (!ctx) return
  var cy = h / 2

  // 单侧最大振幅；总柱高约为画布高度的 52%
  var maxAmp = h * 0.26

  // 柱子尺寸
  var step = Math.max(4, Math.round(w / 140))
  var barWidth = Math.max(2, Math.round(step * 0.58))
  var barOffset = Math.round((step - barWidth) / 2)
  var silentH = Math.max(2, h * 0.015)
  var barColor = color + 'd9'
  var silentColor = color + '1a'

  // 游标永远在正中央
  var cursorX = Math.round(w / 2)

  // 模式
  var isLiveMode = (cursorRatio === null || cursorRatio === undefined)
  var ratio = isLiveMode ? 0 : clamp01(cursorRatio)

  // 当前中心点
  var centerIdx = isLiveMode
    ? peaks.length
    : Math.round(ratio * peaks.length)

  // 清空
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, w, h)

  // 水平基线
  ctx.strokeStyle = color + '15'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, cy)
  ctx.lineTo(w, cy)
  ctx.stroke()

  // 竖线游标
  ctx.save()
  ctx.shadowColor = glowColor
  ctx.shadowBlur = 8
  ctx.strokeStyle = color + 'cc'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cursorX, 0)
  ctx.lineTo(cursorX, h)
  ctx.stroke()
  ctx.restore()

  var totalBars = Math.floor(w / step)
  var cursorBar = Math.floor(cursorX / step)
  var barsLeft = cursorBar
  var barsRight = totalBars - cursorBar - 1
  if (barsRight < 0) barsRight = 0

  if (!peaks || peaks.length === 0) {
    ctx.fillStyle = silentColor
    for (var s = 0; s < totalBars; s++) {
      ctx.fillRect(s * step + barOffset, cy - silentH, barWidth, silentH * 2)
    }
    return
  }

  var viewStart = centerIdx - barsLeft
  var viewEnd = isLiveMode ? centerIdx : (centerIdx + barsRight)
  var stats = getVisibleStats(peaks, viewStart, viewEnd)

  // 左侧
  for (var nl = 0; nl < barsLeft; nl++) {
    var barXl = nl * step + barOffset
    var pIdx = centerIdx - barsLeft + nl

    if (pIdx >= 0 && pIdx < peaks.length) {
      var val = mapVisibleLevel(peaks[pIdx], stats)
      var barH = Math.max(2, val * maxAmp)
      ctx.fillStyle = barColor
      ctx.fillRect(barXl, cy - barH, barWidth, barH * 2)
    } else {
      ctx.fillStyle = silentColor
      ctx.fillRect(barXl, cy - silentH, barWidth, silentH * 2)
    }
  }

  // 右侧
  for (var nr = 0; nr < barsRight; nr++) {
    var barXr = (cursorBar + 1 + nr) * step + barOffset
    var prIdx = centerIdx + nr

    if (isLiveMode) {
      ctx.fillStyle = silentColor
      ctx.fillRect(barXr, cy - silentH, barWidth, silentH * 2)
    } else if (prIdx < peaks.length) {
      var rv = mapVisibleLevel(peaks[prIdx], stats)
      var rH = Math.max(2, rv * maxAmp)
      ctx.fillStyle = barColor
      ctx.fillRect(barXr, cy - rH, barWidth, rH * 2)
    } else {
      ctx.fillStyle = silentColor
      ctx.fillRect(barXr, cy - silentH, barWidth, silentH * 2)
    }
  }
}

module.exports = {
  clearCanvas: clearCanvas,
  drawBarWaveform: drawBarWaveform
}
