"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Mic, Square, Play, Pause, Download, RotateCcw, Volume2, Music, X, Loader2 } from "lucide-react"

type RecordingState = "idle" | "recording" | "stopped"

export function AudioRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [bgMusicFile, setBgMusicFile] = useState<File | null>(null)
  const [bgMusicUrl, setBgMusicUrl] = useState<string | null>(null)
  const [bgVolume, setBgVolume] = useState(0.5)
  const [isConverting, setIsConverting] = useState(false)
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const micCanvasRef = useRef<HTMLCanvasElement>(null)
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const mixCanvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const micAnalyserRef = useRef<AnalyserNode | null>(null)
  const bgAnalyserRef = useRef<AnalyserNode | null>(null)
  const mixAnalyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const isRecordingRef = useRef<boolean>(false)
  const micHistoryRef = useRef<number[]>([])
  const bgHistoryRef = useRef<number[]>([])
  const mixHistoryRef = useRef<number[]>([])
  const bgAudioElementRef = useRef<HTMLAudioElement | null>(null)
  const bgGainNodeRef = useRef<GainNode | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ffmpegRef = useRef<any>(null)
  const audioBlobRef = useRef<Blob | null>(null)

  const HISTORY_MAX = 600

  // 动态加载 FFmpeg
  const loadFfmpeg = useCallback(async () => {
    if (ffmpegLoaded || ffmpegRef.current) return
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg")
      const { toBlobURL } = await import("@ffmpeg/util")
      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.9/dist/esm"
      await ffmpeg.load({
        classWorkerURL: `${window.location.origin}/ffmpeg/worker.js`,
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      })
      setFfmpegLoaded(true)
    } catch (err) {
      console.error("FFmpeg 加载失败:", err)
    }
  }, [ffmpegLoaded])

  useEffect(() => {
    loadFfmpeg()
  }, [loadFfmpeg])

  const getPeak = (analyser: AnalyserNode) => {
    const bufferLength = analyser.fftSize
    const dataArray = new Uint8Array(bufferLength)
    analyser.getByteTimeDomainData(dataArray)
    let peak = 0
    for (let i = 0; i < bufferLength; i++) {
      const v = Math.abs(dataArray[i] - 128) / 128
      if (v > peak) peak = v
    }
    return peak
  }

  const drawSingleWave = (
    canvas: HTMLCanvasElement,
    history: number[],
    color: string,
    glowColor: string
  ) => {
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const w = canvas.width
    const h = canvas.height
    const cx = h / 2

    ctx.fillStyle = "#17172c"
    ctx.fillRect(0, 0, w, h)

    // 中心线
    ctx.strokeStyle = `${color}22`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, cx)
    ctx.lineTo(w, cx)
    ctx.stroke()

    if (history.length < 2) return

    // 填充
    ctx.beginPath()
    for (let i = 0; i < history.length; i++) {
      const x = (i / HISTORY_MAX) * w
      const y = cx - history[i] * cx * 0.85
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    for (let i = history.length - 1; i >= 0; i--) {
      const x = (i / HISTORY_MAX) * w
      const y = cx + history[i] * cx * 0.85
      ctx.lineTo(x, y)
    }
    ctx.closePath()
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, `${color}66`)
    grad.addColorStop(0.5, `${color}22`)
    grad.addColorStop(1, `${color}66`)
    ctx.fillStyle = grad
    ctx.fill()

    // 描边
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.shadowColor = glowColor
    ctx.shadowBlur = 4
    ctx.beginPath()
    for (let i = 0; i < history.length; i++) {
      const x = (i / HISTORY_MAX) * w
      const y = cx - history[i] * cx * 0.85
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i < history.length; i++) {
      const x = (i / HISTORY_MAX) * w
      const y = cx + history[i] * cx * 0.85
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    // 游标
    const curX = (history.length / HISTORY_MAX) * w
    ctx.strokeStyle = `${color}99`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(curX, 0)
    ctx.lineTo(curX, h)
    ctx.stroke()
  }

  const drawWaveforms = useCallback(() => {
    const draw = () => {
      if (!isRecordingRef.current) return
      animationRef.current = requestAnimationFrame(draw)

      // 采集数据
      if (micAnalyserRef.current) {
        const peak = getPeak(micAnalyserRef.current)
        micHistoryRef.current.push(peak)
        if (micHistoryRef.current.length > HISTORY_MAX) micHistoryRef.current.shift()
      }
      if (bgAnalyserRef.current) {
        const peak = getPeak(bgAnalyserRef.current)
        bgHistoryRef.current.push(peak)
        if (bgHistoryRef.current.length > HISTORY_MAX) bgHistoryRef.current.shift()
      }
      if (mixAnalyserRef.current) {
        const peak = getPeak(mixAnalyserRef.current)
        mixHistoryRef.current.push(peak)
        if (mixHistoryRef.current.length > HISTORY_MAX) mixHistoryRef.current.shift()
      }

      // 绘制
      if (micCanvasRef.current) {
        drawSingleWave(micCanvasRef.current, micHistoryRef.current, "#f472b6", "#ec4899")
      }
      if (bgCanvasRef.current && bgMusicUrl) {
        drawSingleWave(bgCanvasRef.current, bgHistoryRef.current, "#60a5fa", "#3b82f6")
      }
      if (mixCanvasRef.current) {
        drawSingleWave(mixCanvasRef.current, mixHistoryRef.current, "#4ade80", "#22c55e")
      }
    }
    draw()
  }, [bgMusicUrl])

  const initCanvas = (canvas: HTMLCanvasElement | null, color: string) => {
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#17172c"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = `${color}33`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, canvas.height / 2)
    ctx.lineTo(canvas.width, canvas.height / 2)
    ctx.stroke()
  }

  const startRecording = async () => {
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      const audioCtx = new AudioContext()
      audioContextRef.current = audioCtx

      const destination = audioCtx.createMediaStreamDestination()

      // 麦克风分析器
      const micAnalyser = audioCtx.createAnalyser()
      micAnalyser.fftSize = 2048
      micAnalyserRef.current = micAnalyser
      const micSource = audioCtx.createMediaStreamSource(micStream)
      micSource.connect(micAnalyser)
      micSource.connect(destination)

      // 混音分析器
      const mixAnalyser = audioCtx.createAnalyser()
      mixAnalyser.fftSize = 2048
      mixAnalyserRef.current = mixAnalyser
      micSource.connect(mixAnalyser)

      // 背景音乐
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

        const bgAnalyser = audioCtx.createAnalyser()
        bgAnalyser.fftSize = 2048
        bgAnalyserRef.current = bgAnalyser

        bgSource.connect(gainNode)
        gainNode.connect(bgAnalyser)
        gainNode.connect(mixAnalyser)
        gainNode.connect(destination)
        gainNode.connect(audioCtx.destination)

        bgAudio.play()
      }

      // 清空
      audioChunksRef.current = []
      micHistoryRef.current = []
      bgHistoryRef.current = []
      mixHistoryRef.current = []
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }

      const mediaRecorder = new MediaRecorder(destination.stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" })
        audioBlobRef.current = blob
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        micStream.getTracks().forEach((t) => t.stop())
      }

      mediaRecorder.start()
      setRecordingState("recording")
      setDuration(0)
      setCurrentTime(0)

      timerRef.current = setInterval(() => setDuration((p) => p + 1), 1000)
      isRecordingRef.current = true
      drawWaveforms()
    } catch (err) {
      console.error("无法访问麦克风:", err)
      alert("无法访问麦克风，请确保已授予权限。")
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && recordingState === "recording") {
      isRecordingRef.current = false
      if (bgAudioElementRef.current) {
        bgAudioElementRef.current.pause()
        bgAudioElementRef.current = null
      }
      mediaRecorderRef.current.stop()
      setRecordingState("stopped")
      if (timerRef.current) clearInterval(timerRef.current)
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    }
  }

  const handleBgMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (bgMusicUrl) URL.revokeObjectURL(bgMusicUrl)

    // 检查是否需要转换
    const supportedTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac"]
    if (supportedTypes.includes(file.type) || file.name.match(/\.(mp3|wav|ogg|webm|m4a|aac)$/i)) {
      const url = URL.createObjectURL(file)
      setBgMusicFile(file)
      setBgMusicUrl(url)
    } else {
      // 使用 FFmpeg 转换
      if (!ffmpegRef.current || !ffmpegLoaded) {
        alert("FFmpeg 正在加载，请稍后再试")
        return
      }
      setIsConverting(true)
      try {
        const { fetchFile } = await import("@ffmpeg/util")
        const ffmpeg = ffmpegRef.current
        await ffmpeg.writeFile("input", await fetchFile(file))
        await ffmpeg.exec(["-i", "input", "-acodec", "libmp3lame", "-b:a", "192k", "output.mp3"])
        const data = await ffmpeg.readFile("output.mp3")
        const blob = new Blob([data], { type: "audio/mpeg" })
        const url = URL.createObjectURL(blob)
        setBgMusicFile(new File([blob], file.name.replace(/\.[^.]+$/, ".mp3"), { type: "audio/mpeg" }))
        setBgMusicUrl(url)
      } catch (err) {
        console.error("转换失败:", err)
        alert("音频格式转换失败，请尝试其他文件")
      }
      setIsConverting(false)
    }
  }

  const removeBgMusic = () => {
    if (bgMusicUrl) URL.revokeObjectURL(bgMusicUrl)
    setBgMusicFile(null)
    setBgMusicUrl(null)
    if (bgFileInputRef.current) bgFileInputRef.current.value = ""
    initCanvas(bgCanvasRef.current, "#60a5fa")
  }

  const resetRecording = () => {
    if (bgAudioElementRef.current) {
      bgAudioElementRef.current.pause()
      bgAudioElementRef.current = null
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setRecordingState("idle")
    setDuration(0)
    setCurrentTime(0)
    setIsPlaying(false)
    audioChunksRef.current = []
    isRecordingRef.current = false
    micHistoryRef.current = []
    bgHistoryRef.current = []
    mixHistoryRef.current = []
    initCanvas(micCanvasRef.current, "#f472b6")
    initCanvas(bgCanvasRef.current, "#60a5fa")
    initCanvas(mixCanvasRef.current, "#4ade80")
  }

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return
    if (isPlaying) audioRef.current.pause()
    else audioRef.current.play()
    setIsPlaying(!isPlaying)
  }

  const downloadRecording = async () => {
    if (!audioBlobRef.current || !ffmpegRef.current || !ffmpegLoaded) return
    setIsConverting(true)
    try {
      const { fetchFile } = await import("@ffmpeg/util")
      const ffmpeg = ffmpegRef.current
      await ffmpeg.writeFile("input.webm", await fetchFile(audioBlobRef.current))
      await ffmpeg.exec(["-i", "input.webm", "-acodec", "libmp3lame", "-b:a", "192k", "output.mp3"])
      const data = await ffmpeg.readFile("output.mp3")
      const blob = new Blob([data], { type: "audio/mpeg" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `录音_${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.mp3`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("转换失败:", err)
      alert("MP3 转换失败")
    }
    setIsConverting(false)
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
  }

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current
      const onTimeUpdate = () => setCurrentTime(audio.currentTime)
      const onEnded = () => {
        setIsPlaying(false)
        setCurrentTime(0)
      }
      const onLoaded = () => {
        if (audio.duration && isFinite(audio.duration)) setDuration(audio.duration)
      }
      audio.addEventListener("timeupdate", onTimeUpdate)
      audio.addEventListener("ended", onEnded)
      audio.addEventListener("loadedmetadata", onLoaded)
      return () => {
        audio.removeEventListener("timeupdate", onTimeUpdate)
        audio.removeEventListener("ended", onEnded)
        audio.removeEventListener("loadedmetadata", onLoaded)
      }
    }
  }, [audioUrl])

  useEffect(() => {
    initCanvas(micCanvasRef.current, "#f472b6")
    initCanvas(bgCanvasRef.current, "#60a5fa")
    initCanvas(mixCanvasRef.current, "#4ade80")
  }, [])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
      if (timerRef.current) clearInterval(timerRef.current)
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (audioContextRef.current) audioContextRef.current.close()
    }
  }, [audioUrl])

  return (
    <div className="w-full max-w-3xl mx-auto p-4">
      <Card className="bg-card border-border p-4 md:p-5">
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-primary" />
            <h1 className="text-lg font-bold text-foreground">在线录音</h1>
          </div>
          <span className="text-2xl font-mono text-primary tabular-nums">
            {recordingState === "stopped" && audioUrl
              ? `${formatTime(currentTime)} / ${formatTime(duration)}`
              : formatTime(duration)}
          </span>
        </div>

        {/* 三条波形 */}
        <div className="grid grid-cols-1 gap-2 mb-4">
          {/* 麦克风波形 */}
          <div className="relative rounded overflow-hidden border border-border bg-secondary/30">
            <div className="absolute top-1 left-2 flex items-center gap-1 text-xs text-pink-400">
              <Mic className="w-3 h-3" />
              <span>麦克风</span>
            </div>
            <canvas ref={micCanvasRef} width={700} height={50} className="w-full h-[50px]" />
            {recordingState === "recording" && (
              <span className="absolute top-1 right-2 w-2 h-2 bg-pink-500 rounded-full animate-pulse" />
            )}
          </div>

          {/* 背景音乐波形 */}
          <div className="relative rounded overflow-hidden border border-border bg-secondary/30">
            <div className="absolute top-1 left-2 flex items-center gap-1 text-xs text-blue-400">
              <Music className="w-3 h-3" />
              <span>背景音乐</span>
            </div>
            <canvas ref={bgCanvasRef} width={700} height={50} className="w-full h-[50px]" />
            {!bgMusicFile && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                未添加背景音乐
              </div>
            )}
          </div>

          {/* 混合波形 */}
          <div className="relative rounded overflow-hidden border border-border bg-secondary/30">
            <div className="absolute top-1 left-2 flex items-center gap-1 text-xs text-green-400">
              <Volume2 className="w-3 h-3" />
              <span>混合输出</span>
            </div>
            <canvas ref={mixCanvasRef} width={700} height={50} className="w-full h-[50px]" />
          </div>
        </div>

        {/* 播放进度条 */}
        {recordingState === "stopped" && audioUrl && (
          <div className="mb-4">
            <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-100"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* 控制区：按钮 + 背景音乐 */}
        <div className="flex flex-wrap items-center gap-3">
          {/* 主控制按钮 */}
          {recordingState === "idle" && (
            <Button onClick={startRecording} className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground">
              <Mic className="w-4 h-4" />
              开始录制
            </Button>
          )}
          {recordingState === "recording" && (
            <Button onClick={stopRecording} variant="destructive" className="gap-2">
              <Square className="w-4 h-4" />
              停止
            </Button>
          )}
          {recordingState === "stopped" && audioUrl && (
            <>
              <Button onClick={togglePlayback} variant="secondary" className="gap-2">
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {isPlaying ? "暂停" : "播放"}
              </Button>
              <Button
                onClick={downloadRecording}
                disabled={isConverting}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                下载 MP3
              </Button>
              <Button onClick={resetRecording} variant="outline" className="gap-2">
                <RotateCcw className="w-4 h-4" />
                重录
              </Button>
            </>
          )}

          {/* 分隔线 */}
          <div className="hidden sm:block w-px h-8 bg-border" />

          {/* 背景音乐上传 */}
          {!bgMusicFile ? (
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => bgFileInputRef.current?.click()}
              disabled={recordingState === "recording" || isConverting}
            >
              {isConverting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Music className="w-4 h-4" />}
              添加背景音乐
            </Button>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-secondary/40 text-sm">
              <Music className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="max-w-[100px] truncate text-foreground">{bgMusicFile.name}</span>
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
                className="w-14 accent-blue-400 cursor-pointer"
                aria-label="背景音量"
              />
              <span className="text-xs text-muted-foreground w-6">{Math.round(bgVolume * 100)}%</span>
              <button
                type="button"
                onClick={removeBgMusic}
                disabled={recordingState === "recording"}
                className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-40"
                aria-label="移除"
              >
                <X className="w-3.5 h-3.5" />
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

        {audioUrl && <audio ref={audioRef} src={audioUrl} />}
      </Card>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        支持所有常见音频格式 · 自动转换为 MP3 下载
        {!ffmpegLoaded && " · FFmpeg 加载中..."}
      </p>
    </div>
  )
}
