import { AudioRecorder } from "@/components/audio-recorder"

export default function Home() {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4 md:p-8">
      <AudioRecorder />
    </main>
  )
}
