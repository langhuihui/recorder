"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Mic, Square, Play, Pause, Download, RotateCcw, Volume2, Music, X, Loader2, Headphones, CircleHelp } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import packageJson from "@/package.json"

const APP_VERSION = (packageJson as { version?: string }).version ?? "unknown"

type RecordingState = "idle" | "recording" | "stopped"

export function AudioRecorder() {
  const [recordingState, setRecordingState] = useState<RecordingState>("idle")
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isHeadphoneMode, setIsHeadphoneMode] = useState(false)
  const isSeekingRef = useRef(false)
  const [bgMusicFile, setBgMusicFile] = useState<File | null>(null)
  const [bgMusicUrl, setBgMusicUrl] = useState<string | null>(null)
  const [bgVolume, setBgVolume] = useState(0.5)
  const [isBgDropActive, setIsBgDropActive] = useState(false)
  const [isConverting, setIsConverting] = useState(false)
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false)
  const [outputExt, setOutputExt] = useState<string>("") // ".m4a" / ".webm"

  const canRecordM4a =
    typeof MediaRecorder !== "undefined" &&
    (MediaRecorder.isTypeSupported("audio/mp4;codecs=mp4a.40.2") || MediaRecorder.isTypeSupported("audio/mp4"))

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
  const replayRafIdRef = useRef<number | null>(null)
  const progressFillRef = useRef<HTMLDivElement | null>(null)
  // Live: 录制时用于实时绘制的滑动窗口（有限长度，避免实时绘制越来越慢）
  const micAllHistoryRef = useRef<number[]>([])
  const bgAllHistoryRef = useRef<number[]>([])
  const mixAllHistoryRef = useRef<number[]>([])
  // Replay: 回放时展示“完整录音”的波形（在 stopRecording 时从 AllHistory 采样生成）
  const micReplayHistoryRef = useRef<number[]>([])
  const bgReplayHistoryRef = useRef<number[]>([])
  const mixReplayHistoryRef = useRef<number[]>([])
  const bgAudioElementRef = useRef<HTMLAudioElement | null>(null)
  const bgGainNodeRef = useRef<GainNode | null>(null)
  const bgFileInputRef = useRef<HTMLInputElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ffmpegRef = useRef<any>(null)
  const audioBlobRef = useRef<Blob | null>(null)
  // 录音期间的 PCM 缓存（用于后续转码/分析）
  const pcmChunksRef = useRef<Float32Array[]>([])
  const pcmSampleRateRef = useRef<number>(0)
  const pcmCaptureNodeRef = useRef<ScriptProcessorNode | null>(null)
  const pcmSourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const pcmZeroGainRef = useRef<GainNode | null>(null)

  const HISTORY_MAX = 600

  // 动态加载 FFmpeg
  const loadFfmpeg = useCallback(async () => {
    if (ffmpegLoaded || ffmpegRef.current) return
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg")
      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg

      const CORE_VERSION = "0.12.9"
      const origin = window.location.origin
      const cacheBust = Date.now().toString()
      // 优先从本项目 public 目录加载，避免每次都从 unpkg 拉 wasm。
      const localCoreURL = `${origin}/ffmpeg/ffmpeg-core.js?v=${cacheBust}`
      const localWasmURL = `${origin}/ffmpeg/ffmpeg-core.wasm?v=${cacheBust}`

      const assetExists = async (url: string) => {
        // 本地 assets 应同源，HEAD 应该很快；若不支持则用 Range 做轻量探测。
        const timeoutMs = 4000
        const controller = new AbortController()
        const t = window.setTimeout(() => controller.abort(), timeoutMs)
        try {
          const res = await fetch(url, { method: "HEAD", cache: "force-cache", signal: controller.signal })
          if (res.ok) return true
        } catch {
          // ignore and fallback to range probe below
        } finally {
          window.clearTimeout(t)
        }

        // Fallback: range 探测，避免下载整个 wasm
        const controller2 = new AbortController()
        const t2 = window.setTimeout(() => controller2.abort(), timeoutMs)
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: { Range: "bytes=0-0" },
            cache: "force-cache",
            signal: controller2.signal,
          })
          // GET + Range 成功通常是 206；部分服务也可能返回 200（小响应）。
          return res.status === 206 || res.status === 200
        } catch {
          return false
        } finally {
          window.clearTimeout(t2)
        }
      }

      const loadFromRemote = async () => {
        const { toBlobURL } = await import("@ffmpeg/util")
        // 跟最初的实现保持一致：优先使用 ESM 构建（支持 import() 默认导出）。
        const baseURL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`
        await ffmpeg.load({
          classWorkerURL: `${origin}/ffmpeg/worker.js`,
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
        })
      }

      if ((await assetExists(localWasmURL)) && (await assetExists(localCoreURL))) {
        try {
          console.info("FFmpeg: using local ffmpeg-core", { localCoreURL, localWasmURL })

          // 用 Blob URL 让 wasm/js 的 MIME 与 core 期望更一致，避免本地加载时的边界问题。
          const { toBlobURL } = await import("@ffmpeg/util")
          const localCoreBlobURL = await toBlobURL(localCoreURL, "text/javascript")
          const localWasmBlobURL = await toBlobURL(localWasmURL, "application/wasm")

          await ffmpeg.load({
            classWorkerURL: `${origin}/ffmpeg/worker.js`,
            coreURL: localCoreBlobURL,
            wasmURL: localWasmBlobURL,
          })
        } catch (localErr) {
          console.warn("Local ffmpeg-core 加载失败，回退到 CDN：", localErr)
          await loadFromRemote()
        }
      } else {
        console.warn("FFmpeg: local ffmpeg-core not found, falling back to CDN", {
          localCoreURL,
          localWasmURL,
        })
        await loadFromRemote()
      }
      setFfmpegLoaded(true)
    } catch (err) {
      console.error("FFmpeg 加载失败:", err)
    }
  }, [ffmpegLoaded])

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

  const resamplePeaks = (peaks: number[], targetPoints: number) => {
    if (targetPoints <= 0) return []
    if (peaks.length === 0) return []
    if (peaks.length <= targetPoints) return peaks.slice()

    // 将原始 peaks 按区间聚合（取每个 bin 的最大值），以最大限度保留尖峰信息。
    const out = new Array<number>(targetPoints).fill(0)
    for (let i = 0; i < targetPoints; i++) {
      const start = Math.floor((i * peaks.length) / targetPoints)
      const end = Math.floor(((i + 1) * peaks.length) / targetPoints)
      let m = 0
      for (let j = start; j < end && j < peaks.length; j++) m = Math.max(m, peaks[j])
      out[i] = m
    }
    return out
  }

  const drawSingleWave = (
    canvas: HTMLCanvasElement,
    history: number[],
    color: string,
    glowColor: string,
    cursorRatio: number
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

    if (history.length >= 2) {
      // 填充
      ctx.beginPath()
      for (let i = 0; i < history.length; i++) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w
        const y = cx - history[i] * cx * 0.85
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      for (let i = history.length - 1; i >= 0; i--) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w
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
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w
        const y = cx - history[i] * cx * 0.85
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      ctx.beginPath()
      for (let i = 0; i < history.length; i++) {
        const x = history.length <= 1 ? 0 : (i / (history.length - 1)) * w
        const y = cx + history[i] * cx * 0.85
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      ctx.shadowBlur = 0
    }

    // 游标：始终绘制（即使 history 还很短/为空也要显示播放位置）
    const ratio = Number.isFinite(cursorRatio) ? cursorRatio : 0
    const cursorX = Math.max(0, Math.min(1, ratio)) * w
    ctx.strokeStyle = `${color}99`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cursorX, 0)
    ctx.lineTo(cursorX, h)
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
        micAllHistoryRef.current.push(peak)
      }
      if (bgAnalyserRef.current) {
        const peak = getPeak(bgAnalyserRef.current)
        bgHistoryRef.current.push(peak)
        if (bgHistoryRef.current.length > HISTORY_MAX) bgHistoryRef.current.shift()
        bgAllHistoryRef.current.push(peak)
      }
      if (mixAnalyserRef.current) {
        const peak = getPeak(mixAnalyserRef.current)
        mixHistoryRef.current.push(peak)
        if (mixHistoryRef.current.length > HISTORY_MAX) mixHistoryRef.current.shift()
        mixAllHistoryRef.current.push(peak)
      }

      // 绘制
      if (micCanvasRef.current) {
        const cursorRatio = Math.min(1, micHistoryRef.current.length / HISTORY_MAX)
        drawSingleWave(micCanvasRef.current, micHistoryRef.current, "#f472b6", "#ec4899", cursorRatio)
      }
      if (bgCanvasRef.current && bgMusicUrl) {
        const cursorRatio = Math.min(1, bgHistoryRef.current.length / HISTORY_MAX)
        drawSingleWave(bgCanvasRef.current, bgHistoryRef.current, "#60a5fa", "#3b82f6", cursorRatio)
      }
      if (mixCanvasRef.current) {
        const cursorRatio = Math.min(1, mixHistoryRef.current.length / HISTORY_MAX)
        drawSingleWave(mixCanvasRef.current, mixHistoryRef.current, "#4ade80", "#22c55e", cursorRatio)
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
      const desiredSampleRate = 48000
      const echoCancellation = false
      const autoGainControl = true
      const noiseSuppression = false

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation,
          autoGainControl,
          noiseSuppression,
          sampleRate: desiredSampleRate,
        },
      })

      // 尽量让 WebAudio 的内部采样率与目标一致
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext
      let audioCtx: AudioContext
      try {
        audioCtx = new AudioContextCtor({ sampleRate: desiredSampleRate }) as AudioContext
      } catch {
        audioCtx = new AudioContextCtor() as AudioContext
      }
      audioContextRef.current = audioCtx
      // AudioContext may start in 'suspended' state when created after an async
      // await (e.g. getUserMedia) — even inside a user-gesture handler.
      // Explicitly resume so audio routed through the context (including bgAudio
      // via createMediaElementSource) actually reaches the speakers.
      try {
        await audioCtx.resume()
      } catch (resumeErr) {
        console.error("无法激活音频上下文，请重试:", resumeErr)
        alert("无法激活音频上下文，请重试。")
        return
      }

      const destination = audioCtx.createMediaStreamDestination()

      // 麦克风分析器（显示原始麦克风信号）
      const micAnalyser = audioCtx.createAnalyser()
      micAnalyser.fftSize = 2048
      micAnalyserRef.current = micAnalyser
      const micSource = audioCtx.createMediaStreamSource(micStream)
      micSource.connect(micAnalyser)

      // 混音分析器
      const mixAnalyser = audioCtx.createAnalyser()
      mixAnalyser.fftSize = 2048
      mixAnalyserRef.current = mixAnalyser

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

        // 背景音乐：始终播放到用户耳机/扬声器；“数字混音进录音”仅在耳机模式开启（麦克风采不到音乐时）。
        gainNode.connect(audioCtx.destination) // 音乐通过音频设备播放给用户

        if (isHeadphoneMode) {
          // 耳机模式：麦克风采不到音乐 → 数字混音进录音
          gainNode.connect(mixAnalyser)
          gainNode.connect(destination)
          micSource.connect(destination)
          micSource.connect(mixAnalyser)
        } else {
          // 外放：麦克风会采到音乐 → 录音只接麦克风，不数字混音
          micSource.connect(destination)
          micSource.connect(mixAnalyser)
        }

        bgAudio.play()
      } else {
        // 无背景音乐，麦克风直连录音
        micSource.connect(destination)
        micSource.connect(mixAnalyser)
      }

      // PCM 采集：保存混音后的完整 PCM（Float32，单声道）
      // 后续如果要“PCM -> mp3/m4a”，可以直接用这里的缓存。
      pcmChunksRef.current = []
      pcmSampleRateRef.current = audioCtx.sampleRate
      try {
        const pcmSource = audioCtx.createMediaStreamSource(destination.stream)
        // 用 ScriptProcessorNode 采集最简实现（不引入 audio worklet 复杂度）。
        const processor = audioCtx.createScriptProcessor(4096, 1, 1)
        const zeroGain = audioCtx.createGain()
        zeroGain.gain.value = 0

        pcmSource.connect(processor)
        processor.connect(zeroGain)
        zeroGain.connect(audioCtx.destination) // 必须接到 destination 才会持续触发回调

        processor.onaudioprocess = (ev) => {
          const channelData = ev.inputBuffer.getChannelData(0)
          // 拷贝一份，避免后续 buffer 复用导致数据被覆盖
          pcmChunksRef.current.push(new Float32Array(channelData))
        }

        pcmSourceNodeRef.current = pcmSource
        pcmCaptureNodeRef.current = processor
        pcmZeroGainRef.current = zeroGain
      } catch (e) {
        console.warn("PCM 采集失败（不影响录音导出）:", e)
      }

      // 清空
      audioChunksRef.current = []
      micHistoryRef.current = []
      bgHistoryRef.current = []
      mixHistoryRef.current = []
      micAllHistoryRef.current = []
      bgAllHistoryRef.current = []
      mixAllHistoryRef.current = []
      micReplayHistoryRef.current = []
      bgReplayHistoryRef.current = []
      mixReplayHistoryRef.current = []
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
        setAudioUrl(null)
      }

      // 优先录成 m4a（AAC），避免 ffmpeg 转码开销。
      // 不支持时再退回 webm。
      const preferredMimeTypes = canRecordM4a
        ? ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"]
        : ["audio/webm;codecs=opus", "audio/webm"]
      const mimeType = preferredMimeTypes.find((t) => MediaRecorder.isTypeSupported(t))

      const mediaRecorder = new MediaRecorder(destination.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 192000, // mono 下通常足够高质量（仍受浏览器实现影响）
      })
      mediaRecorderRef.current = mediaRecorder
      const recordedMimeType = mediaRecorder.mimeType || "audio/webm"
      const nextExt = recordedMimeType && (recordedMimeType.includes("mp4") || recordedMimeType.includes("aac")) ? ".m4a" : ".webm"
      setOutputExt(nextExt)

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recordedMimeType })
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

      // 停止 PCM 采集
      if (pcmCaptureNodeRef.current) {
        pcmCaptureNodeRef.current.disconnect()
        pcmCaptureNodeRef.current.onaudioprocess = null
        pcmCaptureNodeRef.current = null
      }
      if (pcmSourceNodeRef.current) {
        pcmSourceNodeRef.current.disconnect()
        pcmSourceNodeRef.current = null
      }
      if (pcmZeroGainRef.current) {
        pcmZeroGainRef.current.disconnect()
        pcmZeroGainRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

      // 生成回放用的完整波形数据（压缩到画布宽度），并立刻重画。
      const targetPoints = micCanvasRef.current?.width ?? 700
      micReplayHistoryRef.current = resamplePeaks(micAllHistoryRef.current, targetPoints)
      bgReplayHistoryRef.current = resamplePeaks(bgAllHistoryRef.current, targetPoints)
      mixReplayHistoryRef.current = resamplePeaks(mixAllHistoryRef.current, targetPoints)

      const cursorRatio = duration > 0 ? currentTime / duration : 0
      if (micCanvasRef.current) {
        drawSingleWave(micCanvasRef.current, micReplayHistoryRef.current, "#f472b6", "#ec4899", cursorRatio)
      }
      if (bgCanvasRef.current && bgMusicUrl) {
        drawSingleWave(bgCanvasRef.current, bgReplayHistoryRef.current, "#60a5fa", "#3b82f6", cursorRatio)
      }
      if (mixCanvasRef.current) {
        drawSingleWave(mixCanvasRef.current, mixReplayHistoryRef.current, "#4ade80", "#22c55e", cursorRatio)
      }
    }
  }

  const handleBgMusicFile = async (file: File) => {
    const isSelectionDisabled = recordingState === "recording" || isConverting
    if (isSelectionDisabled) return

    // 允许拖拽时复用：始终以同一套逻辑完成“直接播放/FFmpeg 转换”
    if (bgMusicUrl) URL.revokeObjectURL(bgMusicUrl)
    setIsConverting(false)
    if (bgFileInputRef.current) bgFileInputRef.current.value = ""

    // 检查是否需要转换
    const supportedTypes = ["audio/mpeg", "audio/wav", "audio/ogg", "audio/webm", "audio/mp4", "audio/aac"]
    if (supportedTypes.includes(file.type) || file.name.match(/\.(mp3|wav|ogg|webm|m4a|aac)$/i)) {
      const url = URL.createObjectURL(file)
      setBgMusicFile(file)
      setBgMusicUrl(url)
      return
    }

    // 使用 FFmpeg 转换
    setIsConverting(true)
    try {
      if (!ffmpegRef.current || !ffmpegLoaded) {
        await loadFfmpeg()
      }
      if (!ffmpegRef.current || !ffmpegLoaded) {
        throw new Error("FFmpeg 加载失败")
      }
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
    } finally {
      setIsConverting(false)
    }
  }

  const handleBgMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await handleBgMusicFile(file)
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
    setOutputExt("")
    pcmChunksRef.current = []
    pcmSampleRateRef.current = 0
    audioChunksRef.current = []
    isRecordingRef.current = false
    micHistoryRef.current = []
    bgHistoryRef.current = []
    mixHistoryRef.current = []
    micAllHistoryRef.current = []
    bgAllHistoryRef.current = []
    mixAllHistoryRef.current = []
    micReplayHistoryRef.current = []
    bgReplayHistoryRef.current = []
    mixReplayHistoryRef.current = []
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

  const seekTo = (time: number) => {
    const audio = audioRef.current
    if (!audio) return
    const dur = audio.duration
    const safeDuration = Number.isFinite(dur) && dur > 0 ? dur : duration
    if (!Number.isFinite(safeDuration) || safeDuration <= 0) return

    const clamped = Math.max(0, Math.min(time, safeDuration))
    audio.currentTime = clamped
    setCurrentTime(clamped)
  }

  const downloadRecording = async () => {
    if (!audioBlobRef.current) return

    // 方案1：如果已经录成 m4a，直接导出，不需要 ffmpeg。
    if (outputExt === ".m4a") {
      try {
        const url = URL.createObjectURL(audioBlobRef.current)
        const a = document.createElement("a")
        a.href = url
        a.download = `录音_${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.m4a`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch (err) {
        console.error("m4a 导出失败:", err)
        alert("M4A 导出失败")
      }
      return
    }

    // 兜底：如果浏览器不支持 m4a，就用前端编码库把 PCM 编码为 mp3。
    const sampleRate = pcmSampleRateRef.current
    const pcmChunks = pcmChunksRef.current
    const hasPcm = Boolean(sampleRate && pcmChunks.length > 0)

    setIsConverting(true)
    try {
      if (!hasPcm) {
        // 最后兜底：PCM 捕获失败时，退回使用 ffmpeg（会比较慢，但能确保功能可用）
        if (!ffmpegRef.current || !ffmpegLoaded) await loadFfmpeg()
        if (!ffmpegRef.current || !ffmpegLoaded) throw new Error("FFmpeg 加载失败")

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
        return
      }

      const { Mp3Encoder } = await import("lamejs")
      const encoder = new Mp3Encoder(1, sampleRate, 192)

      const mp3Data: Uint8Array[] = []
      const frameSize = 1152
      let frame = new Int16Array(frameSize)
      let framePos = 0

      // 为避免长录音卡住 UI：每处理一段数据就让出线程。
      let processedFrames = 0

      for (const chunk of pcmChunks) {
        for (let i = 0; i < chunk.length; i++) {
          const f = chunk[i]
          // Float32 PCM 通常在 [-1, 1]。超出则钳位，避免溢出。
          const clamped = Math.max(-1, Math.min(1, Number.isFinite(f) ? f : 0))
          // 负数用 32768，避免 -1 -> -32768 的对称性问题
          frame[framePos] = clamped < 0 ? clamped * 32768 : clamped * 32767
          framePos++

          if (framePos === frameSize) {
            const buf = encoder.encodeBuffer(frame)
            if (buf && buf.length > 0) mp3Data.push(buf)
            frame = new Int16Array(frameSize)
            framePos = 0
            processedFrames++
            // 每编码一段时间就让出线程，避免长任务阻塞。
            if (processedFrames % 50 === 0) await new Promise((r) => setTimeout(r, 0))
          }
        }
      }

      if (framePos > 0) {
        const tail = frame.subarray(0, framePos)
        const buf = encoder.encodeBuffer(tail)
        if (buf && buf.length > 0) mp3Data.push(buf)
      }

      const flushBuf = encoder.flush()
      if (flushBuf && flushBuf.length > 0) mp3Data.push(flushBuf)

      const blob = new Blob(mp3Data, { type: "audio/mpeg" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `录音_${new Date().toLocaleString("zh-CN").replace(/[/:]/g, "-")}.mp3`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("PCM->MP3 编码失败:", err)
      alert("MP3 转换失败")
    } finally {
      setIsConverting(false)
    }
  }

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`
  }

  useEffect(() => {
    if (audioRef.current) {
      const audio = audioRef.current
      const onTimeUpdate = () => {
        if (isSeekingRef.current) return
        setCurrentTime(audio.currentTime)
      }
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

  // 回放阶段：用 requestAnimationFrame 连续更新竖线位置 + 进度条宽度。
  // 这样不会依赖 `timeupdate` 的节奏，视觉上更流畅。
  useEffect(() => {
    if (recordingState !== "stopped" || !audioUrl) return

    const tick = () => {
      const audio = audioRef.current
      if (!audio) return

      const dur = audio.duration && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration
      const t = audio.currentTime
      const cursorRatio = dur > 0 ? t / dur : 0

      if (micCanvasRef.current) {
        drawSingleWave(micCanvasRef.current, micReplayHistoryRef.current, "#f472b6", "#ec4899", cursorRatio)
      }
      if (bgCanvasRef.current && bgMusicUrl) {
        drawSingleWave(bgCanvasRef.current, bgReplayHistoryRef.current, "#60a5fa", "#3b82f6", cursorRatio)
      }
      if (mixCanvasRef.current) {
        drawSingleWave(mixCanvasRef.current, mixReplayHistoryRef.current, "#4ade80", "#22c55e", cursorRatio)
      }

      if (progressFillRef.current) progressFillRef.current.style.width = `${Math.max(0, Math.min(1, cursorRatio)) * 100}%`

      replayRafIdRef.current = window.requestAnimationFrame(tick)
    }

    replayRafIdRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (replayRafIdRef.current != null) window.cancelAnimationFrame(replayRafIdRef.current)
      replayRafIdRef.current = null
    }
  }, [recordingState, audioUrl, duration, bgMusicUrl])

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
            <span className="text-xs text-muted-foreground border border-border rounded px-2 py-0.5">
              v{APP_VERSION}
            </span>
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
          <div
            className="relative rounded overflow-hidden border border-border bg-secondary/30"
            onDragEnter={(e) => {
              if (recordingState === "recording" || isConverting) return
              e.preventDefault()
              e.stopPropagation()
              setIsBgDropActive(true)
            }}
            onDragOver={(e) => {
              if (recordingState === "recording" || isConverting) return
              e.preventDefault()
              e.stopPropagation()
              e.dataTransfer.dropEffect = "copy"
              setIsBgDropActive(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setIsBgDropActive(false)
            }}
            onDrop={async (e) => {
              if (recordingState === "recording" || isConverting) return
              e.preventDefault()
              e.stopPropagation()
              setIsBgDropActive(false)
              const file = e.dataTransfer.files?.[0]
              if (!file) return
              await handleBgMusicFile(file)
            }}
          >
            <div className="absolute top-1 left-2 flex items-center gap-1 text-xs text-blue-400">
              <Music className="w-3 h-3" />
              <span>背景音乐</span>
            </div>
            <canvas ref={bgCanvasRef} width={700} height={50} className="w-full h-[50px]" />
            {isBgDropActive && (
              <div className="absolute inset-0 bg-blue-500/15 border-2 border-blue-400 flex items-center justify-center text-xs text-blue-200 pointer-events-none">
                放开以添加/替换背景音乐
              </div>
            )}
            {!bgMusicFile && (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                拖入音频文件添加背景音乐
              </div>
            )}
          </div>

          {/* 混合波形 */}
          <div className="relative rounded overflow-hidden border border-border bg-secondary/30">
            <div className="absolute top-1 left-2 flex items-center gap-1 text-xs text-green-400">
              <Volume2 className="w-3 h-3" />
              <span>{isHeadphoneMode ? "混合输出" : "录音输出"}</span>
            </div>
            <canvas ref={mixCanvasRef} width={700} height={50} className="w-full h-[50px]" />
          </div>
        </div>

        {/* 播放进度条 */}
        {recordingState === "stopped" && audioUrl && (
          <div className="mb-4">
            <div className="relative h-1.5 bg-secondary rounded-full overflow-hidden">
              <div
                ref={progressFillRef}
                className="h-full bg-primary"
              />
              <input
                type="range"
                min={0}
                max={duration > 0 ? duration : 0}
                step={0.01}
                value={duration > 0 ? currentTime : 0}
                disabled={duration <= 0}
                onPointerDown={() => {
                  if (duration <= 0) return
                  isSeekingRef.current = true
                }}
                onPointerUp={() => {
                  isSeekingRef.current = false
                  if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
                }}
                onPointerCancel={() => {
                  isSeekingRef.current = false
                }}
                onBlur={() => {
                  isSeekingRef.current = false
                }}
                onKeyDown={() => {
                  if (duration <= 0) return
                  isSeekingRef.current = true
                }}
                onKeyUp={() => {
                  isSeekingRef.current = false
                  if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
                }}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  isSeekingRef.current = true
                  seekTo(v)
                }}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="播放进度"
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
                {outputExt === ".m4a" ? "下载 M4A" : "下载 MP3"}
              </Button>
              <Button onClick={resetRecording} variant="outline" className="gap-2">
                <RotateCcw className="w-4 h-4" />
                重录
              </Button>
            </>
          )}

          {/* 分隔线 */}
          <div className="hidden sm:block w-px h-8 bg-border" />

          {/* 耳机模式 */}
          <div className="flex items-center gap-3 px-2 py-1 rounded-md border border-border bg-secondary/30">
            <Headphones className="w-4 h-4 text-primary" />
            <div className="flex items-center gap-1.5">
              <Label className="text-sm">耳机模式</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label="耳机模式说明"
                  >
                    <CircleHelp className="size-3.5 shrink-0" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-balance">
                  开：数字混音 · 关：不混音
                </TooltipContent>
              </Tooltip>
            </div>
            <Switch
              checked={isHeadphoneMode}
              onCheckedChange={setIsHeadphoneMode}
              disabled={recordingState === "recording"}
              aria-label="耳机模式"
            />
          </div>

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
        支持所有常见音频格式 · 录音后可下载（优先 m4a；不支持时用前端编码库把 PCM 编码成 mp3）
        支持拖拽添加或替换背景音乐
      </p>
    </div>
  )
}
