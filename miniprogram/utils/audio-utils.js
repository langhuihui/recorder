/**
 * PCM 帧解析与音频分析工具
 */

/**
 * 解析 16-bit LE PCM ArrayBuffer 为 Float32Array
 * @param {ArrayBuffer} buffer
 * @returns {Float32Array}
 */
function parsePcmFrame(buffer) {
  var dataView = new DataView(buffer)
  var len = dataView.byteLength / 2
  var floats = new Float32Array(len)
  for (var i = 0; i < len; i++) {
    var sample = dataView.getInt16(i * 2, true) // little-endian
    floats[i] = sample < 0 ? sample / 32768 : sample / 32767
  }
  return floats
}

/**
 * 计算音频帧的可视化振幅
 *
 * 这里不用“单个采样峰值”，因为它很容易被偶发尖峰拉满，
 * 导致每一帧都接近 1，画出来所有柱子几乎一样高。
 *
 * 改用 RMS（均方根能量）+ 轻度增益映射，得到更稳定、
 * 更适合波形显示的 0~1 振幅值。
 *
 * @param {Float32Array} samples
 * @returns {number} 0~1 的可视化振幅
 */
function computePeak(samples) {
  if (!samples || samples.length === 0) return 0

  var sumSq = 0
  for (var i = 0; i < samples.length; i++) {
    var v = samples[i]
    sumSq += v * v
  }

  var rms = Math.sqrt(sumSq / samples.length)

  // 给语音能量做一点提升，让小幅度变化更容易看见
  var boosted = Math.min(1, rms * 3.5)

  // 轻微非线性映射，增强中低振幅的可见度
  return Math.pow(boosted, 0.85)
}

/**
 * 将 peaks 重采样到目标点数
 * @param {number[]} peaks
 * @param {number} targetCount
 * @returns {number[]}
 */
function resamplePeaks(peaks, targetCount) {
  if (targetCount <= 0) return []
  if (peaks.length === 0) return []
  if (peaks.length <= targetCount) return peaks.slice()

  var out = new Array(targetCount)
  for (var i = 0; i < targetCount; i++) {
    var start = Math.floor((i * peaks.length) / targetCount)
    var end = Math.floor(((i + 1) * peaks.length) / targetCount)
    var m = 0
    for (var j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > m) m = peaks[j]
    }
    out[i] = m
  }
  return out
}

/**
 * 根据文件元数据生成确定性的模拟能量曲线（用于背景音乐波形模拟）
 * @param {number} fileSize
 * @param {number} duration
 * @param {number} targetPoints
 * @returns {number[]}
 */
function generateEnergyProfile(fileSize, duration, targetPoints) {
  if (targetPoints <= 0) return []
  // 用文件大小和时长作为种子生成确定性伪随机序列
  var seed = fileSize + Math.floor(duration * 1000)
  function nextRand() {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff
    return (seed >>> 0) / 4294967296
  }

  var profile = new Array(targetPoints)
  var smooth = 0.3 // 平滑因子

  for (var i = 0; i < targetPoints; i++) {
    // 模拟音乐节奏感：在 0.05 ~ 0.8 之间波动
    var raw = nextRand() * 0.75 + 0.05
    if (i > 0) {
      profile[i] = profile[i - 1] * smooth + raw * (1 - smooth)
    } else {
      profile[i] = raw
    }
  }

  // 归一化到 0~1
  var max = 0
  for (var j = 0; j < profile.length; j++) {
    if (profile[j] > max) max = profile[j]
  }
  if (max > 0) {
    for (var k = 0; k < profile.length; k++) {
      profile[k] = profile[k] / max
    }
  }

  return profile
}

/**
 * 格式化时间为 MM:SS
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) seconds = 0
  var m = Math.floor(seconds / 60)
  var s = Math.floor(seconds % 60)
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
}

module.exports = {
  parsePcmFrame: parsePcmFrame,
  computePeak: computePeak,
  resamplePeaks: resamplePeaks,
  generateEnergyProfile: generateEnergyProfile,
  formatTime: formatTime
}
