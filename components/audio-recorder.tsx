"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Mic, Square, Play, Pause, Download, RotateCcw, Volume2, Music, X, Upload } from "lucide-react"

type RecordingState = "idle" | "recording" | "paused" | "stopped"

export function AudioRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [bgMusicFile, setBgMusicFile] = useState<File | null>(null)
  const [bgMusicUrl, setBgMusicUrl] = useState<string | null>(null)
  const [bgVolume, setBgVolume] = useState(0.5)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const isRecordingRef = useRef<boolean>(false)
  // 存储历史波形样本：每帧采集一个振幅值（0~1），最多保留 10s * 60fps = 600 个点
  const waveHistoryRef = useRef<number[]>([])
  const bgAudioElementRef = useRef<HTMLAudioElement | null>(null)
  const bgGainNodeRef = useRef<GainNode | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement>(null)

  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const analyser = analyserRef.current
    // 使用频域数据采集振幅峰值，fftSize 决定时域缓冲区大小
    const bufferLength = analyser.fftSize
    const dataArray = new Uint8Array(bufferLength)

    // 10 秒 × 60fps，每帧在画布上占 1 列像素
    const HISTORY_MAX = 600

    const draw = () => {
      if (!isRecordingRef.current) return

      animationRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      // 计算本帧的峰值振幅（归一化到 0~1）
      let peak = 0
      for (let i = 0; i < bufferLength; i++) {
        const v = Math.abs(dataArray[i] - 128) / 128
        if (v > peak) peak = v
      }
      waveHistoryRef.current.push(peak)
      if (waveHistoryRef.current.length > HISTORY_MAX) {
        waveHistoryRef.current.shift()
      }

      const history = waveHistoryRef.current
      const w = canvas.width
      const h = canvas.height
      const cx = h / 2

      // 清空画布
      ctx.fillStyle = "#17172c"
      ctx.fillRect(0, 0, w, h)

      // 绘制时间刻度线（每秒一条，约 60 帧）
      const framesPerSecond = 60
      const pixelsPerFrame = w / HISTORY_MAX
      ctx.strokeStyle = "rgba(74, 222, 128, 0.08)"
      ctx.lineWidth = 1
      for (let s = 1; s <= 10; s++) {
        const frameIndex = history.length - s * framesPerSecond
        if (frameIndex < 0) continue
        const x = (frameIndex / HISTORY_MAX) * w
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }

      // 绘制中心基准线
      ctx.strokeStyle = "rgba(74, 222, 128, 0.15)"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, cx)
      ctx.lineTo(w, cx)
      ctx.stroke()

      if (history.length < 2) return

      // 上半部分波形路径
      ctx.beginPath()
      for (let i = 0; i < history.length; i++) {
        const x = (i / HISTORY_MAX) * w
        const y = cx - history[i] * cx * 0.9
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      // 下半部分镜像（闭合路径填充）
      for (let i = history.length - 1; i >= 0; i--) {
        const x = (i / HISTORY_MAX) * w
        const y = cx + history[i] * cx * 0.9
        ctx.lineTo(x, y)
      }
      ctx.closePath()

      // 渐变填充
      const grad = ctx.createLinearGradient(0, 0, 0, h)
      grad.addColorStop(0, "rgba(74, 222, 128, 0.5)")
      grad.addColorStop(0.5, "rgba(74, 222, 128, 0.15)")
      grad.addColorStop(1, "rgba(74, 222, 128, 0.5)")
      ctx.fillStyle = grad
      ctx.fill()

      // 描边轮廓（上边缘）
      ctx.beginPath()
      for (let i = 0; i < history.length; i++) {
        const x = (i / HISTORY_MAX) * w
        const y = cx - history[i] * cx * 0.9
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = "#4ade80"
      ctx.lineWidth = 1.5
      ctx.shadowColor = "#4ade80"
      ctx.shadowBlur = 6
      ctx.stroke()

      // 描边轮廓（下边缘）
      ctx.beginPath()
      for (let i = 0; i < history.length; i++) {
        const x = (i / HISTORY_MAX) * w
        const y = cx + history[i] * cx * 0.9
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.shadowBlur = 0

      // 右侧"当前位置"游标线
      const curX = (history.length / HISTORY_MAX) * w
      ctx.strokeStyle = "rgba(74, 222, 128, 0.6)"
      ctx.lineWidth = 1.5
      ctx.shadowColor = "#4ade80"
      ctx.shadowBlur = 8
      ctx.beginPath()
      ctx.moveTo(curX, 0)
      ctx.lineTo(curX, h)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    draw()
  }, [])

  const startRecording = async () => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true })

      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx

      // 混音目标节点 — MediaRecorder 录这一路
      const destination = audioCtx.createMediaStreamDestination()

      // 分析器接到混音总线，波形反映混合信号
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 2048
      analyserRef.current = analyser

      // 接入麦克风
      const micSource = audioCtx.createMediaStreamSource(micStream)
      micSource.connect(analyser)
      micSource.connect(destination)

      // 接入背景音乐（如果有）
      if (bgMusicUrl) {
        const bgAudio = new Audio()
        bgAudio.src = bgMusicUrl
        bgAudio.loop = true
        bgAudio.crossOrigin = "anonymous"
        bgAudioElementRef.current = bgAudio

        const bgSource = audioCtx.createMediaElementSource(bgAudio)
        const gainNode = audioCtx.createGain()
        gainNode.gain.value = bgVolume
        bgGainNodeRef.current = gainNode

        bgSource.connect(gainNode)
        gainNode.connect(analyser)
        gainNode.connect(destination)

        bgAudio.play()
      }

      // 清空之前的录音和波形历史
      audioChunksRef.current = []
      waveHistoryRef.current = []
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }

      // 用混音流创建 MediaRecorder
      const mediaRecorder = new MediaRecorder(destination.stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        const url = URL.createObjectURL(audioBlob)
        setAudioUrl(url)

        // 停止麦克风轨道
        micStream.getTracks().forEach((track) => track.stop())
      }

      mediaRecorder.start()
      setRecordingState("recording")
      setDuration(0)
      setCurrentTime(0)

      // 开始计时
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1)
      }, 1000)

      // 设置录制状态并开始绘制波形
      isRecordingRef.current = true
      drawWaveform()
    } catch (error) {
      console.error("无法访问麦克风:", error)
      alert("无法访问麦克风，请确保已授予麦克风权限。")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingState === "recording") {
      // 先停止波形绘制
      isRecordingRef.current = false

      // 停止背景音乐
      if (bgAudioElementRef.current) {
        bgAudioElementRef.current.pause()
        bgAudioElementRef.current = null
      }

      mediaRecorderRef.current.stop()
      setRecordingState("stopped")

      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }

      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }

  const handleBgMusicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (bgMusicUrl) URL.revokeObjectURL(bgMusicUrl)
    const url = URL.createObjectURL(file)
    setBgMusicFile(file)
    setBgMusicUrl(url)
  }

  const removeBgMusic = () => {
    if (bgMusicUrl) URL.revokeObjectURL(bgMusicUrl)
    setBgMusicFile(null)
    setBgMusicUrl(null)
    if (bgFileInputRef.current) bgFileInputRef.current.value = ""
  }

  const resetRecording = () => {
    if (bgAudioElementRef.current) {
      bgAudioElementRef.current.pause()
      bgAudioElementRef.current = null
    }
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
    }
    setAudioUrl(null)
    setRecordingState("idle")
    setDuration(0)
    setCurrentTime(0)
    setIsPlaying(false)
    audioChunksRef.current = []
    isRecordingRef.current = false
    waveHistoryRef.current = []

    // 清空画布并绘制静态中心线
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "rgba(23, 23, 35, 1)"
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        // 绘制静态中心线
        ctx.strokeStyle = "rgba(74, 222, 128, 0.3)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, canvasRef.current.height / 2)
        ctx.lineTo(canvasRef.current.width, canvasRef.current.height / 2)
        ctx.stroke()
      }
    }
  }

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const downloadRecording = () => {
    if (!audioUrl) return

    const a = document.createElement("a")
    a.href = audioUrl
    a.download = `录音_${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.webm`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current

      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime)
      }

      const handleEnded = () => {
        setIsPlaying(false)
        setCurrentTime(0)
      }

      const handleLoadedMetadata = () => {
        // 如果音频有有效时长，更新duration
        if (audio.duration && isFinite(audio.duration)) {
          setDuration(audio.duration)
        }
      }

      audio.addEventListener("timeupdate", handleTimeUpdate)
      audio.addEventListener("ended", handleEnded)
      audio.addEventListener("loadedmetadata", handleLoadedMetadata)

      return () => {
        audio.removeEventListener("timeupdate", handleTimeUpdate)
        audio.removeEventListener("ended", handleEnded)
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata)
      }
    }
  }, [audioUrl])

  // 初始化画布
  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.fillStyle = "rgba(23, 23, 35, 1)"
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        // 绘���静态中心线
        ctx.strokeStyle = "rgba(74, 222, 128, 0.3)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, canvas.height / 2)
        ctx.lineTo(canvas.width, canvas.height / 2)
        ctx.stroke()
      }
    }
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
      }
    }
  }, [audioUrl])

  return (
    <div className="w-full max-w-2xl mx-auto">
      <Card className="bg-card border-border p-6 md:p-8">
        {/* 标题 */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Volume2 className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground">在线录音</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            点击开始录制，实时查看波形，完成后可播放或下载
          </p>
        </div>

        {/* 背景音乐上传区 */}
        <div className="mb-6">
          <p className="text-sm font-medium text-muted-foreground mb-2">背景音乐（可选）</p>
          {!bgMusicFile ? (
            <button
              type="button"
              onClick={() => bgFileInputRef.current?.click()}
              disabled={recordingState === "recording"}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-4 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Upload className="w-4 h-4" />
              点击上传背景音乐（MP3 / WAV / OGG）
            </button>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-3">
              <Music className="w-4 h-4 shrink-0 text-primary" />
              <span className="flex-1 text-sm text-foreground truncate">{bgMusicFile.name}</span>
              {/* 音量滑块 */}
              <div className="flex items-center gap-2 shrink-0">
                <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={bgVolume}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setBgVolume(v)
                    if (bgGainNodeRef.current) bgGainNodeRef.current.gain.value = v
                  }}
                  className="w-20 accent-primary cursor-pointer"
                  aria-label="背景音量"
                />
                <span className="text-xs text-muted-foreground w-7 text-right">
                  {Math.round(bgVolume * 100)}%
                </span>
              </div>
              <button
                type="button"
                onClick={removeBgMusic}
                disabled={recordingState === "recording"}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="移除背景音乐"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <input
            ref={bgFileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleBgMusicUpload}
          />
        </div>

        {/* 波形显示区域 */}
        <div className="relative mb-8 rounded-lg overflow-hidden bg-secondary/50 border border-border">
          <canvas
            ref={canvasRef}
            width={600}
            height={150}
            className="w-full h-[150px]"
          />

          {/* 录制状态指示器 */}
          {recordingState === "recording" && (
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <span className="w-3 h-3 bg-destructive rounded-full animate-pulse" />
              <span className="text-sm font-medium text-destructive">
                录制中{bgMusicFile ? " · 含背景音乐" : ""}
              </span>
            </div>
          )}

          {/* 时间显示 */}
          <div className="absolute bottom-3 right-3">
            <span className="text-lg font-mono text-primary">
              {recordingState === "stopped" && audioUrl
                ? `${formatTime(currentTime)} / ${formatTime(duration)}`
                : formatTime(duration)}
            </span>
          </div>
        </div>

        {/* 播放进度条 */}
        {recordingState === "stopped" && audioUrl && (
          <div className="mb-6">
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-100"
                style={{
                  width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* 控制按钮 */}
        <div className="flex items-center justify-center gap-4 flex-wrap">
          {recordingState === "idle" && (
            <Button
              onClick={startRecording}
              size="lg"
              className="gap-2 px-8 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Mic className="w-5 h-5" />
              开始录制
            </Button>
          )}

          {recordingState === "recording" && (
            <Button
              onClick={stopRecording}
              size="lg"
              variant="destructive"
              className="gap-2 px-8"
            >
              <Square className="w-5 h-5" />
              停止录制
            </Button>
          )}

          {recordingState === "stopped" && audioUrl && (
            <>
              <Button
                onClick={togglePlayback}
                size="lg"
                variant="secondary"
                className="gap-2"
              >
                {isPlaying ? (
                  <>
                    <Pause className="w-5 h-5" />
                    暂停
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    播放
                  </>
                )}
              </Button>

              <Button
                onClick={downloadRecording}
                size="lg"
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                <Download className="w-5 h-5" />
                下载录音
              </Button>

              <Button
                onClick={resetRecording}
                size="lg"
                variant="outline"
                className="gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                重新录制
              </Button>
            </>
          )}
        </div>

        {/* 隐藏的音频元素 */}
        {audioUrl && <audio ref={audioRef} src={audioUrl} />}
      </Card>

      {/* 使用提示 */}
      <div className="mt-6 text-center">
        <p className="text-muted-foreground text-sm">
          支持的格式: WebM · 录音将保存在本地
        </p>
      </div>
    </div>
  )
}
