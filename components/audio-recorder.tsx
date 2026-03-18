"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Mic, Square, Play, Pause, Download, RotateCcw, Volume2 } from "lucide-react"

type RecordingState = "idle" | "recording" | "paused" | "stopped"

export function AudioRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const isRecordingRef = useRef<boolean>(false)

  const drawWaveform = useCallback(() => {
    if (!canvasRef.current || !analyserRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const analyser = analyserRef.current
    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      if (!isRecordingRef.current) return

      animationRef.current = requestAnimationFrame(draw)
      analyser.getByteTimeDomainData(dataArray)

      ctx.fillStyle = "rgba(23, 23, 35, 0.3)"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.lineWidth = 2.5
      ctx.strokeStyle = "#4ade80"
      ctx.shadowColor = "#4ade80"
      ctx.shadowBlur = 4
      ctx.beginPath()

      const sliceWidth = canvas.width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * canvas.height) / 2

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }

        x += sliceWidth
      }

      ctx.lineTo(canvas.width, canvas.height / 2)
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    draw()
  }, [])

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // 设置音频分析器用于波形显示
      audioContextRef.current = new AudioContext()
      analyserRef.current = audioContextRef.current.createAnalyser()
      const source = audioContextRef.current.createMediaStreamSource(stream)
      source.connect(analyserRef.current)
      analyserRef.current.fftSize = 2048

      // 清空之前的录音
      audioChunksRef.current = []
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }

      const mediaRecorder = new MediaRecorder(stream)
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

        // 停止所有轨道
        stream.getTracks().forEach((track) => track.stop())
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

  const resetRecording = () => {
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
        // 绘制静态中心线
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
              <span className="text-sm font-medium text-destructive">录制中</span>
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
        <div className="flex items-center justify-center gap-4">
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
