# Flutter Recorder (在线录音 Flutter App)

A Flutter implementation of the karaoke recorder web app, with added support for:
- **Receiving shared audio** as background music from other apps
- **Sharing recordings** via the system share sheet

## Features

| Feature | Description |
|---------|-------------|
| 🎙️ Microphone recording | Records voice/audio from the device microphone |
| 🎵 Background music | Load a local audio file or receive one shared from another app |
| 🔊 Volume control | Adjust background music volume with a slider |
| 🎧 Headphone mode | Digitally mixes background music into the recording when using headphones (mic can't capture speaker output) |
| 📊 Waveform display | Live waveforms for mic, background music, and mixed output; replay waveform after recording |
| ▶️ Playback | Play back the recording with a seek bar |
| 📤 Share | Share the recording file via the system share sheet |
| 💾 Save | Save the recording to local storage / Downloads |
| 📥 Receive shared audio | Accept audio files shared from other apps (e.g. music apps) as background music |

## Getting Started

### Prerequisites

- Flutter SDK ≥ 3.3.0
- Android SDK (API 21+) or iOS 12+

### Install dependencies

```bash
cd flutter_recorder
flutter pub get
```

### Run

```bash
flutter run
```

### Build release APK (Android)

```bash
flutter build apk --release
```

### Build iOS IPA

```bash
flutter build ipa
```

## Permissions

### Android

The app requests the following runtime permissions:
- `RECORD_AUDIO` – for microphone access
- `READ_MEDIA_AUDIO` (Android 13+) / `READ_EXTERNAL_STORAGE` (Android < 13) – for reading shared audio files
- `WRITE_EXTERNAL_STORAGE` (Android < 13) – for saving recordings

### iOS

The `Info.plist` declares:
- `NSMicrophoneUsageDescription` – required for microphone access
- `NSDocumentsFolderUsageDescription` – for saving recordings

## Receiving Shared Audio (Background Music)

### Android

Other apps can share an `audio/*` file to this app via the standard `ACTION_SEND` intent. The shared file is automatically loaded as the background music.

### iOS

Other apps can open audio files in this app using the iOS Files / Share sheet. The opened file is automatically loaded as the background music.

## Project Structure

```
flutter_recorder/
├── lib/
│   ├── main.dart               # App entry point & theme
│   ├── recorder_screen.dart    # Main UI screen (all states & interactions)
│   └── waveform_painter.dart   # Custom waveform canvas painter
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml # Permissions + share intent filters
│       └── kotlin/.../MainActivity.kt
├── ios/
│   ├── Runner/
│   │   ├── Info.plist          # Permissions + URL scheme + document types
│   │   └── AppDelegate.swift
│   └── Podfile
└── pubspec.yaml                # Flutter dependencies
```

## Architecture Notes

- **Recording**: Uses the `record` package which streams amplitude data for live waveform display.
- **Background music playback**: Uses `just_audio` for gapless looping with volume control.
- **Sharing**: Uses `share_plus` to invoke the native share sheet with the recorded audio file.
- **Receive sharing intent**: Uses `receive_sharing_intent` to handle `ACTION_SEND` on Android and `openURL`/`application:openURL` on iOS.
- **File picking**: Uses `file_picker` as an alternative to sharing intent for choosing background music.
- **Waveform**: Custom `CustomPainter` replicating the web app's visual style (filled mirror wave + cursor).
- **Headphone mode**: When enabled, the mixed waveform combines mic + background music amplitudes visually, representing what the digital mix in the recording would look like.
