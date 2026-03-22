import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:just_audio/just_audio.dart';
import 'package:just_waveform/just_waveform.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';
import 'package:record/record.dart';
import 'package:share_plus/share_plus.dart';

import 'waveform_painter.dart';

// ---------------------------------------------------------------------------
// App version
// ---------------------------------------------------------------------------
const _kAppVersion = '1.0.1';

/// Native `recorder.start` can hang indefinitely on some devices when ExoPlayer
/// is already playing; Dart `finally` then never runs and the UI stays on「准备中」.
const Duration _kRecordStartTimeout = Duration(seconds: 15);

// ---------------------------------------------------------------------------
// Recording state enum
// ---------------------------------------------------------------------------
enum RecordingState { idle, recording, stopped }

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
class RecorderScreen extends StatefulWidget {
  const RecorderScreen({super.key});

  @override
  State<RecorderScreen> createState() => _RecorderScreenState();
}

class _RecorderScreenState extends State<RecorderScreen>
    with WidgetsBindingObserver {
  // --- State ---
  RecordingState _recordingState = RecordingState.idle;
  bool _isHeadphoneMode = false;
  bool _isPlaying = false;
  double _recordSeconds = 0;
  Stopwatch? _recordStopwatch;
  double _playbackPosition = 0;
  double _playbackDuration = 0;

  // --- Background music ---
  String? _bgMusicPath;
  String? _bgMusicName;
  double _bgVolume = 0.5;
  double _bgDuration = 0;
  double _bgPosition = 0;

  // --- Output file ---
  String? _recordingPath;

  // --- Audio objects ---
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _bgPlayer = AudioPlayer();
  final AudioPlayer _playbackPlayer = AudioPlayer();

  // --- Waveform history ---
  static const int _historyMax = 300;
  final List<double> _micHistory = [];
  final List<double> _bgHistory = [];
  final List<double> _mixHistory = [];

  // Full history for replay waveform
  final List<double> _micAllHistory = [];
  final List<double> _bgAllHistory = [];
  final List<double> _mixAllHistory = [];

  // Resampled replay waveforms
  List<double> _micReplay = [];
  List<double> _bgReplay = [];
  List<double> _mixReplay = [];

  // --- Timers & subscriptions ---
  Timer? _amplitudeTimer;
  StreamSubscription? _sharingIntentSub;
  StreamSubscription? _bgPositionSub;
  StreamSubscription? _bgDurationSub;
  StreamSubscription<PlayerState>? _bgPlayerStateSub;
  StreamSubscription? _playbackPositionSub;
  StreamSubscription? _playbackDurationSub;
  StreamSubscription? _playbackStateSub;
  StreamSubscription? _playbackPlayingSub;
  StreamSubscription<WaveformProgress>? _bgWaveExtractSub;

  /// Extracted from background file (Android / iOS / macOS). Null while loading.
  Waveform? _bgWaveform;

  /// Prevents overlapping start/stop: async handlers return immediately from
  /// onPressed, so without this a second tap can run while the first awaits mic start.
  bool _recordOpInFlight = false;

  /// `audioInterruption: none` avoids fighting just_audio. Mic + normal mode tends
  /// to complete `start()` reliably with BGM on more devices.
  RecordConfig _micRecordConfig(AudioEncoder encoder, {required int bitRate}) {
    return RecordConfig(
      encoder: encoder,
      sampleRate: 48000,
      bitRate: bitRate,
      numChannels: 1,
      autoGain: true,
      echoCancel: false,
      noiseSuppress: false,
      audioInterruption: AudioInterruptionMode.none,
      androidConfig: (!kIsWeb && Platform.isAndroid)
          ? const AndroidRecordConfig(
              audioSource: AndroidAudioSource.mic,
              audioManagerMode: AudioManagerMode.modeNormal,
            )
          : const AndroidRecordConfig(),
    );
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _bgPlayerStateSub = _bgPlayer.playerStateStream.listen((state) {
      if (!mounted) return;
      if (state.processingState == ProcessingState.completed) {
        setState(() => _bgPosition = _bgDuration);
        if (_recordingState == RecordingState.recording && !_recordOpInFlight) {
          unawaited(_stopRecording());
        }
      }
    });
    _initSharingIntent();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sharingIntentSub?.cancel();
    _bgPositionSub?.cancel();
    _bgDurationSub?.cancel();
    _bgPlayerStateSub?.cancel();
    _playbackPositionSub?.cancel();
    _playbackDurationSub?.cancel();
    _playbackStateSub?.cancel();
    _playbackPlayingSub?.cancel();
    _bgWaveExtractSub?.cancel();
    _amplitudeTimer?.cancel();
    _recorder.dispose();
    _bgPlayer.dispose();
    _playbackPlayer.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Sharing intent – receive audio files shared from other apps
  // ---------------------------------------------------------------------------
  void _initSharingIntent() {
    if (kIsWeb) return;
    // Handle the intent that launched the app
    ReceiveSharingIntent.instance.getInitialMedia().then((files) {
      _handleSharedFiles(files);
    });

    // Handle intents while the app is already open
    _sharingIntentSub =
        ReceiveSharingIntent.instance.getMediaStream().listen(_handleSharedFiles);
  }

  void _handleSharedFiles(List<SharedMediaFile> files) {
    if (files.isEmpty) return;
    SharedMediaFile? audioFile;
    for (final f in files) {
      if (_isSharedAudio(f)) {
        audioFile = f;
        break;
      }
    }
    if (audioFile != null) {
      _setBgMusicFromPath(audioFile.path);
      ReceiveSharingIntent.instance.reset();
    }
  }

  /// True for paths that look like audio, or MIME from ACTION_VIEW / share.
  bool _isSharedAudio(SharedMediaFile f) {
    if (_isAudioFile(f.path)) return true;
    final m = f.mimeType?.toLowerCase();
    if (m == null) return false;
    if (m.startsWith('audio/')) return true;
    return m == 'application/ogg' ||
        m == 'application/x-flac' ||
        m == 'application/flac';
  }

  bool _isAudioFile(String path) {
    final lower = path.toLowerCase();
    return lower.endsWith('.mp3') ||
        lower.endsWith('.m4a') ||
        lower.endsWith('.aac') ||
        lower.endsWith('.wav') ||
        lower.endsWith('.ogg') ||
        lower.endsWith('.flac') ||
        lower.endsWith('.opus') ||
        lower.endsWith('.webm');
  }

  // ---------------------------------------------------------------------------
  // Background music helpers
  // ---------------------------------------------------------------------------
  Future<void> _setBgMusicFromPath(String path) async {
    if (_recordingState == RecordingState.recording) return;
    await _bgPlayer.stop();
    setState(() {
      _bgMusicPath = path;
      _bgMusicName = path.split('/').last;
      _bgDuration = 0;
      _bgPosition = 0;
      _bgHistory.clear();
      _bgWaveform = null;
    });
    _bgWaveExtractSub?.cancel();
    _bgWaveExtractSub = null;
    _startBgWaveformExtraction(path);
    try {
      await _bgPlayer.setFilePath(path);
      await _bgPlayer.setVolume(_bgVolume);
      final duration = _bgPlayer.duration;
      if (duration != null) {
        setState(() => _bgDuration = duration.inMilliseconds / 1000.0);
      }
      _bgDurationSub?.cancel();
      _bgDurationSub = _bgPlayer.durationStream.listen((d) {
        if (d != null) setState(() => _bgDuration = d.inMilliseconds / 1000.0);
      });
      _bgPositionSub?.cancel();
      _bgPositionSub = _bgPlayer.positionStream.listen((p) {
        setState(() => _bgPosition = p.inMilliseconds / 1000.0);
      });
    } catch (e) {
      _showSnackBar('无法加载背景音乐: $e');
    }
  }

  Future<void> _pickBgMusic() async {
    if (_recordingState == RecordingState.recording) return;
    final result = await FilePicker.platform.pickFiles(
      type: FileType.audio,
      allowMultiple: false,
    );
    if (result == null || result.files.isEmpty) return;
    final path = result.files.single.path;
    if (path == null) return;
    await _setBgMusicFromPath(path);
  }

  void _removeBgMusic() {
    if (_recordingState == RecordingState.recording) return;
    _bgPlayer.stop();
    _bgWaveExtractSub?.cancel();
    _bgWaveExtractSub = null;
    setState(() {
      _bgMusicPath = null;
      _bgMusicName = null;
      _bgDuration = 0;
      _bgPosition = 0;
      _bgHistory.clear();
      _bgWaveform = null;
    });
  }

  /// Real waveform from file (just_waveform). No-op on Web / Linux / Windows.
  void _startBgWaveformExtraction(String audioPath) {
    if (kIsWeb) return;
    if (!Platform.isAndroid && !Platform.isIOS && !Platform.isMacOS) return;

    _bgWaveExtractSub?.cancel();
    _bgWaveExtractSub = null;

    unawaited(() async {
      try {
        final dir = await getTemporaryDirectory();
        final waveOut =
            File('${dir.path}/bg_wave_${audioPath.hashCode.abs()}.wave');
        final inFile = File(audioPath);
        if (!await inFile.exists()) return;

        _bgWaveExtractSub = JustWaveform.extract(
          audioInFile: inFile,
          waveOutFile: waveOut,
          zoom: const WaveformZoom.pixelsPerSecond(256),
        ).listen(
          (progress) {
            if (!mounted) return;
            final wv = progress.waveform;
            if (wv != null) {
              setState(() => _bgWaveform = wv);
            }
          },
          onError: (Object e, StackTrace st) =>
              debugPrint('just_waveform: $e'),
        );
      } catch (e) {
        debugPrint('bg waveform extract: $e');
      }
    }());
  }

  double _sampleBgWaveformPeak() {
    final wv = _bgWaveform;
    if (wv == null || wv.length == 0 || _bgDuration <= 0.02) return 0;
    final pos = Duration(milliseconds: (_bgPosition * 1000).round());
    var px = wv.positionToPixel(pos).floor();
    if (px < 0) px = 0;
    if (px >= wv.length) px = wv.length - 1;
    final hi = wv.getPixelMax(px).abs();
    final lo = wv.getPixelMin(px).abs();
    final raw = math.max(hi, lo).toDouble();
    final norm = (wv.flags & 1) != 0 ? raw / 128.0 : raw / 32768.0;
    return (norm * _bgVolume).clamp(0.0, 1.0);
  }

  String _recordingMimeForShare() {
    return 'audio/mp4';
  }

  String _recordingSaveExtension() {
    return 'm4a';
  }

  bool get _bgWaveformReady =>
      !kIsWeb &&
      (Platform.isAndroid || Platform.isIOS || Platform.isMacOS) &&
      _bgWaveform != null;

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------
  Future<void> _startRecording() async {
    if (_recordingState != RecordingState.idle || _recordOpInFlight) return;
    _recordOpInFlight = true;
    if (mounted) setState(() {});

    try {
    // Request microphone permission
    final micStatus = await Permission.microphone.request();
    if (!micStatus.isGranted) {
      _showSnackBar('需要麦克风权限才能录音');
      return;
    }

    final dir = await getTemporaryDirectory();
    final timestamp = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
    final filePath = '${dir.path}/recording_$timestamp.m4a';

    try {
      await _recorder
          .start(
            _micRecordConfig(AudioEncoder.aacLc, bitRate: 192000),
            path: filePath,
          )
          .timeout(
            _kRecordStartTimeout,
            onTimeout: () => throw TimeoutException('recorder.start aac'),
          );
    } catch (e) {
      try {
        await _recorder.cancel();
      } catch (_) {}
      await _bgPlayer.stop();
      if (e is TimeoutException) {
        _showSnackBar('打开麦克风超时，请关闭其他占用麦克风的应用后重试');
      } else {
        _showSnackBar('无法开始录音: $e');
      }
      return;
    }

    if (_bgMusicPath != null) {
      try {
        await _bgPlayer.setVolume(_bgVolume);
        await _bgPlayer.setLoopMode(LoopMode.off);
        await _bgPlayer.seek(Duration.zero);
        unawaited(_bgPlayer.play());
        await Future<void>.delayed(const Duration(milliseconds: 90));
      } catch (e) {
        debugPrint('背景音乐播放失败: $e');
      }
    }

    _recordStopwatch = Stopwatch()..start();
    setState(() {
      _recordingState = RecordingState.recording;
      _recordSeconds = 0;
      _micHistory.clear();
      _bgHistory.clear();
      _mixHistory.clear();
      _micAllHistory.clear();
      _bgAllHistory.clear();
      _mixAllHistory.clear();
      _recordingPath = filePath;
      _isPlaying = false;
      _playbackPosition = 0;
      _playbackDuration = 0;
    });

    // Amplitude polling at ~20 fps (also drives recording time display)
    _amplitudeTimer = Timer.periodic(const Duration(milliseconds: 50), (_) async {
      if (_recordingState != RecordingState.recording) return;
      try {
        final amp = await _recorder.getAmplitude();
        final micPeak = _dbToLinear(amp.current);

        double bgPeak = 0;
        if (_bgMusicPath != null) {
          if (_bgWaveformReady) {
            bgPeak = _sampleBgWaveformPeak();
          } else {
            final t = _bgDuration > 0.05
                ? (_bgPosition % (_bgDuration + 1e-6))
                : DateTime.now().millisecondsSinceEpoch / 1000.0;
            final wobble = 0.5 +
                0.28 * math.sin(t * 2.6) +
                0.22 * math.sin(t * 5.1 + 0.7);
            bgPeak = (_bgVolume * wobble).clamp(0.0, 1.0);
          }
        }

        final mixPeak = _isHeadphoneMode
            ? math.min(1.0, micPeak + bgPeak * 0.6)
            : micPeak;

        setState(() {
          final sw = _recordStopwatch;
          if (sw != null) {
            _recordSeconds = sw.elapsedMilliseconds / 1000.0;
          }
          _micHistory.add(micPeak);
          if (_micHistory.length > _historyMax) _micHistory.removeAt(0);

          _bgHistory.add(bgPeak);
          if (_bgHistory.length > _historyMax) _bgHistory.removeAt(0);

          _mixHistory.add(mixPeak);
          if (_mixHistory.length > _historyMax) _mixHistory.removeAt(0);

          _micAllHistory.add(micPeak);
          _bgAllHistory.add(bgPeak);
          _mixAllHistory.add(mixPeak);
        });
      } catch (_) {}
    });
    } finally {
      _recordOpInFlight = false;
      if (mounted) setState(() {});
    }
  }

  double _dbToLinear(double db) {
    if (!db.isFinite || db <= -60) return 0.0;
    if (db >= 0) return 1.0;
    return math.pow(10, db / 20).toDouble();
  }

  Future<void> _stopRecording() async {
    if (_recordingState != RecordingState.recording || _recordOpInFlight) return;
    _recordOpInFlight = true;
    if (mounted) setState(() {});

    try {
      _amplitudeTimer?.cancel();
      _recordStopwatch?.stop();

      await _bgPlayer.stop();

      final path = await _recorder.stop();

      // Resample full histories for replay waveform
      const targetPoints = 300;
      final micReplay = _resamplePeaks(_micAllHistory, targetPoints);
      final bgReplay = _buildBgReplay(targetPoints);
      final mixReplay = _resamplePeaks(_mixAllHistory, targetPoints);

      setState(() {
        _recordingState = RecordingState.stopped;
        _recordingPath = path ?? _recordingPath;
        _micReplay = micReplay;
        _bgReplay = bgReplay;
        _mixReplay = mixReplay;
        _playbackPosition = 0;
        _playbackDuration = _recordSeconds;
      });

      if (_recordingPath != null) {
        try {
          // Brief delay so the container is fully finalized on Android before ExoPlayer opens it.
          await Future<void>.delayed(const Duration(milliseconds: 120));
          await _playbackPlayer.stop();
          await _playbackPlayer.setAudioSource(
            AudioSource.file(_recordingPath!),
          );
          final duration = _playbackPlayer.duration;
          if (duration != null) {
            setState(() => _playbackDuration = duration.inMilliseconds / 1000.0);
          }
          _playbackDurationSub?.cancel();
          _playbackDurationSub = _playbackPlayer.durationStream.listen((d) {
            if (d != null) {
              setState(() => _playbackDuration = d.inMilliseconds / 1000.0);
            }
          });
          _playbackPositionSub?.cancel();
          _playbackPositionSub = _playbackPlayer.positionStream.listen((p) {
            setState(() => _playbackPosition = p.inMilliseconds / 1000.0);
          });
          _playbackStateSub?.cancel();
          _playbackStateSub = _playbackPlayer.playerStateStream.listen((state) {
            if (!mounted) return;
            if (state.processingState == ProcessingState.completed) {
              setState(() => _playbackPosition = 0);
              _playbackPlayer.seek(Duration.zero);
            }
          });
          _playbackPlayingSub?.cancel();
          _playbackPlayingSub = _playbackPlayer.playingStream.listen((playing) {
            if (mounted) setState(() => _isPlaying = playing);
          });
          setState(() => _isPlaying = _playbackPlayer.playing);
        } catch (e) {
          debugPrint('设置回放失败: $e');
        }
      }
    } finally {
      _recordOpInFlight = false;
      if (mounted) setState(() {});
    }
  }

  List<double> _resamplePeaks(List<double> peaks, int targetPoints) {
    if (targetPoints <= 0 || peaks.isEmpty) return [];
    if (peaks.length <= targetPoints) return List<double>.from(peaks);
    final out = List<double>.filled(targetPoints, 0);
    for (int i = 0; i < targetPoints; i++) {
      final start = (i * peaks.length) ~/ targetPoints;
      final end = ((i + 1) * peaks.length) ~/ targetPoints;
      double m = 0;
      for (int j = start; j < end && j < peaks.length; j++) {
        if (peaks[j] > m) m = peaks[j];
      }
      out[i] = m;
    }
    return out;
  }

  List<double> _buildBgReplay(int targetPoints) {
    if (_bgMusicPath == null) return _resamplePeaks(_bgAllHistory, targetPoints);
    final wv = _bgWaveform;
    if (wv == null || _recordSeconds <= 0 || targetPoints <= 0) {
      return _resamplePeaks(_bgAllHistory, targetPoints);
    }

    final out = List<double>.filled(targetPoints, 0);
    final totalMs = (_recordSeconds * 1000).round();
    for (var i = 0; i < targetPoints; i++) {
      final ms = (i * totalMs) ~/ targetPoints;
      final pos = Duration(milliseconds: ms);
      var px = wv.positionToPixel(pos).floor();
      if (px < 0) px = 0;
      if (px >= wv.length) px = wv.length - 1;
      final hi = wv.getPixelMax(px).abs().toDouble();
      final lo = wv.getPixelMin(px).abs().toDouble();
      final raw = math.max(hi, lo);
      final norm = (wv.flags & 1) != 0 ? raw / 128.0 : raw / 32768.0;
      out[i] = (norm * _bgVolume).clamp(0.0, 1.0);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------
  Future<void> _togglePlayback() async {
    if (_recordingPath == null) return;
    try {
      // Use player.playing + playingStream for UI — avoids first tap showing
      // "播放" because setState ran before the engine reported playing.
      if (_playbackPlayer.playing) {
        await _playbackPlayer.pause();
      } else {
        await _playbackPlayer.play();
      }
    } catch (e) {
      _showSnackBar('播放失败: $e');
    }
  }

  Future<void> _seekTo(double seconds) async {
    await _playbackPlayer.seek(Duration(milliseconds: (seconds * 1000).toInt()));
    setState(() => _playbackPosition = seconds);
  }

  void _resetRecording() {
    _playbackPlayer.stop();
    setState(() {
      _recordingState = RecordingState.idle;
      _isPlaying = false;
      _recordSeconds = 0;
      _recordStopwatch = null;
      _playbackPosition = 0;
      _playbackDuration = 0;
      _micHistory.clear();
      _bgHistory.clear();
      _mixHistory.clear();
      _micAllHistory.clear();
      _bgAllHistory.clear();
      _mixAllHistory.clear();
      _micReplay.clear();
      _bgReplay.clear();
      _mixReplay.clear();
    });
  }

  Future<void> _restartRecording() async {
    if (_recordOpInFlight) return;
    _resetRecording();
    await _startRecording();
  }

  // ---------------------------------------------------------------------------
  // Share recording
  // ---------------------------------------------------------------------------
  Future<void> _shareRecording() async {
    if (_recordingPath == null) return;
    final file = File(_recordingPath!);
    if (!await file.exists()) {
      _showSnackBar('录音文件不存在');
      return;
    }
    try {
      final ext = _recordingSaveExtension();
      final suggestedName = _defaultShareFileName();
      final inputName = await _promptShareFileName(suggestedName);
      if (inputName == null) return;

      final normalizedBase = _sanitizeFileName(_stripFileExtension(inputName).trim());
      if (normalizedBase.isEmpty) {
        _showSnackBar('文件名不能为空');
        return;
      }

      final tempDir = await getTemporaryDirectory();
      final sharePath = '${tempDir.path}/$normalizedBase.$ext';
      await file.copy(sharePath);

      await Share.shareXFiles(
        [XFile(sharePath, mimeType: _recordingMimeForShare())],
        subject: '录音分享',
        text: normalizedBase,
      );
    } catch (e) {
      _showSnackBar('分享失败: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Save recording to Downloads
  // ---------------------------------------------------------------------------
  Future<void> _saveRecording() async {
    if (_recordingPath == null) return;
    final src = File(_recordingPath!);
    if (!await src.exists()) {
      _showSnackBar('录音文件不存在');
      return;
    }
    try {
      Directory? destDir;
      if (Platform.isAndroid) {
        destDir = Directory('/storage/emulated/0/Download');
        if (!await destDir.exists()) {
          destDir = await getExternalStorageDirectory();
        }
      } else if (Platform.isIOS) {
        destDir = await getApplicationDocumentsDirectory();
      } else {
        destDir = await getDownloadsDirectory();
      }
      if (destDir == null) {
        _showSnackBar('无法获取存储路径');
        return;
      }
      final timestamp = DateFormat('yyyyMMdd_HHmmss').format(DateTime.now());
      final ext = _recordingSaveExtension();
      final destPath = '${destDir.path}/录音_$timestamp.$ext';
      await src.copy(destPath);
      _showSnackBar('已保存到: $destPath');
    } catch (e) {
      _showSnackBar('保存失败: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  String _defaultShareFileName() {
    final bgName = _bgMusicName?.trim();
    if (bgName != null && bgName.isNotEmpty) {
      return _stripFileExtension(bgName);
    }

    final recordingPath = _recordingPath;
    if (recordingPath == null || recordingPath.isEmpty) {
      return '录音';
    }

    final fileName = recordingPath.split('/').last;
    return _stripFileExtension(fileName);
  }

  String _stripFileExtension(String name) {
    final dot = name.lastIndexOf('.');
    if (dot <= 0) return name;
    return name.substring(0, dot);
  }

  String _sanitizeFileName(String name) {
    return name
        .replaceAll(RegExp(r'[\\/:*?"<>|]'), '_')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }

  Future<String?> _promptShareFileName(String initialName) async {
    final controller = TextEditingController(text: initialName);
    try {
      return await showDialog<String>(
        context: context,
        builder: (dialogContext) {
          return AlertDialog(
            backgroundColor: const Color(0xFF1e1e2e),
            title: const Text(
              '分享文件名',
              style: TextStyle(color: Colors.white),
            ),
            content: TextField(
              controller: controller,
              autofocus: true,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: '请输入文件名',
                hintStyle: TextStyle(
                  color: Colors.white.withValues(alpha: 0.45),
                ),
                suffixText: '.${_recordingSaveExtension()}',
                suffixStyle: const TextStyle(color: Colors.white54),
                enabledBorder: const UnderlineInputBorder(
                  borderSide: BorderSide(color: Colors.white24),
                ),
                focusedBorder: const UnderlineInputBorder(
                  borderSide: BorderSide(color: Color(0xFFf472b6)),
                ),
              ),
              onSubmitted: (value) {
                Navigator.of(dialogContext).pop(value.trim());
              },
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: () {
                  Navigator.of(dialogContext).pop(controller.text.trim());
                },
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFf472b6),
                  foregroundColor: Colors.white,
                ),
                child: const Text('分享'),
              ),
            ],
          );
        },
      );
    } finally {
      controller.dispose();
    }
  }

  void _showSnackBar(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 3)));
  }

  String _formatTime(double seconds) {
    final s = seconds.isFinite ? seconds : 0;
    final m = (s / 60).floor();
    final sec = (s % 60).floor();
    return '${m.toString().padLeft(2, '0')}:${sec.toString().padLeft(2, '0')}';
  }

  double get _bgProgressPercent {
    if (_bgDuration <= 0) return 0;
    return (_bgPosition / _bgDuration).clamp(0.0, 1.0);
  }

  double get _playbackCursorRatio {
    if (_playbackDuration <= 0) return 0;
    return (_playbackPosition / _playbackDuration).clamp(0.0, 1.0);
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final isRecording = _recordingState == RecordingState.recording;
    final isStopped = _recordingState == RecordingState.stopped;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final availW = constraints.maxWidth;

            return SizedBox.expand(
              child: _buildCard(
                isRecording: isRecording,
                isStopped: isStopped,
                layoutWidth: availW,
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildCard({
    required bool isRecording,
    required bool isStopped,
    required double layoutWidth,
  }) {
    return Card(
      margin: EdgeInsets.zero,
      color: const Color(0xFF1e1e2e),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.zero,
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        // Card + Padding do not always pass a tight height to Column on web;
        // without this, Expanded children collapse and the button sits mid-screen.
        child: SizedBox.expand(
          child: Column(
            mainAxisSize: MainAxisSize.max,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _buildTitleRow(),
              const SizedBox(height: 8),
              Expanded(
                flex: 1,
                child: LayoutBuilder(
                  builder: (context, c) => _buildMicWaveform(
                    isRecording: isRecording,
                    height: c.maxHeight,
                  ),
                ),
              ),
              const SizedBox(height: 4),
              Expanded(
                flex: 1,
                child: _buildBgMusicPanel(isRecording: isRecording),
              ),
              const SizedBox(height: 4),
              Expanded(
                flex: 1,
                child: LayoutBuilder(
                  builder: (context, c) =>
                      _buildMixWaveform(height: c.maxHeight),
                ),
              ),
              const SizedBox(height: 8),
              if (isStopped && _recordingPath != null) ...[
                _buildPlaybackBar(),
                const SizedBox(height: 8),
              ],
              _buildTimeAboveControls(isStopped: isStopped),
              const SizedBox(height: 8),
              _buildControls(
                isRecording: isRecording,
                isStopped: isStopped,
                maxWidth: layoutWidth - 24,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // --- Title row ---
  Widget _buildTitleRow() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const Icon(Icons.volume_up, color: Color(0xFFf472b6), size: 20),
        const SizedBox(width: 8),
        Expanded(
          child: Row(
            children: [
              const Flexible(
                child: Text(
                  '伴唱助手',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                'v$_kAppVersion',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.white.withValues(alpha: 0.6),
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        const Icon(Icons.headphones, color: Color(0xFFf472b6), size: 18),
        const SizedBox(width: 4),
        Text(
          '耳机模式',
          style: TextStyle(
            fontSize: 13,
            color: Colors.white.withValues(alpha: 0.75),
          ),
        ),
        const SizedBox(width: 2),
        Switch(
          value: _isHeadphoneMode,
          onChanged: _recordingState == RecordingState.recording
              ? null
              : (v) => setState(() => _isHeadphoneMode = v),
          activeThumbColor: const Color(0xFFf472b6),
          materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        ),
      ],
    );
  }

  /// Recording / playback time, shown above the primary control buttons.
  Widget _buildTimeAboveControls({required bool isStopped}) {
    final timeStr = isStopped && _recordingPath != null
        ? '${_formatTime(_playbackPosition)} / ${_formatTime(_playbackDuration)}'
        : _formatTime(_recordSeconds);

    return Center(
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Text(
          timeStr,
          style: const TextStyle(
            fontSize: 22,
            fontFamily: 'monospace',
            fontWeight: FontWeight.w600,
            color: Color(0xFFf472b6),
          ),
        ),
      ),
    );
  }

  // --- Waveform panels ---
  Widget _buildMicWaveform({
    required bool isRecording,
    required double height,
  }) {
    return _waveformPanel(
      height: height,
      label: '麦克风',
      labelColor: const Color(0xFFf472b6),
      icon: Icons.mic,
      history: _recordingState == RecordingState.stopped ? _micReplay : _micHistory,
      waveColor: const Color(0xFFf472b6),
      glowColor: const Color(0xFFec4899),
      cursorRatio: _recordingState == RecordingState.stopped
          ? _playbackCursorRatio
          : _micHistory.isEmpty ? 0 : _micHistory.length / _historyMax,
      scrollWhileRecording: true,
      trailing: isRecording
          ? Container(
              width: 8,
              height: 8,
              decoration: const BoxDecoration(
                color: Color(0xFFf472b6),
                shape: BoxShape.circle,
              ),
            )
          : null,
    );
  }

  Widget _buildMixWaveform({required double height}) {
    return _waveformPanel(
      height: height,
      label: _isHeadphoneMode ? '混合输出' : '录音输出',
      labelColor: const Color(0xFF4ade80),
      icon: Icons.volume_up,
      history: _recordingState == RecordingState.stopped ? _mixReplay : _mixHistory,
      waveColor: const Color(0xFF4ade80),
      glowColor: const Color(0xFF22c55e),
      cursorRatio: _recordingState == RecordingState.stopped
          ? _playbackCursorRatio
          : _mixHistory.isEmpty ? 0 : _mixHistory.length / _historyMax,
      scrollWhileRecording: true,
    );
  }

  Widget _waveformPanel({
    required double height,
    required String label,
    required Color labelColor,
    required IconData icon,
    required List<double> history,
    required Color waveColor,
    required Color glowColor,
    required double cursorRatio,
    Widget? trailing,
    bool scrollWhileRecording = false,
  }) {
    final useScroll =
        scrollWhileRecording && _recordingState == RecordingState.recording;
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: const Color(0xFF12121f),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.white12),
      ),
      clipBehavior: Clip.hardEdge,
      child: Stack(
        children: [
          SizedBox.expand(
            child: CustomPaint(
              painter: WaveformPainter(
                history: history,
                waveColor: waveColor,
                glowColor: glowColor,
                cursorRatio: cursorRatio,
                scrollMode: useScroll,
                scrollBufferCapacity: _historyMax,
                scrollCursorXFactor: 0.5,
              ),
            ),
          ),
          Positioned(
            top: 4,
            left: 8,
            child: Row(
              children: [
                Icon(icon, color: labelColor, size: 12),
                const SizedBox(width: 4),
                Text(label,
                    style: TextStyle(color: labelColor, fontSize: 11)),
              ],
            ),
          ),
          if (trailing != null)
            Positioned(top: 4, right: 8, child: trailing),
        ],
      ),
    );
  }

  // --- Background music panel ---
  Widget _buildBgMusicPanel({required bool isRecording}) {
    return SizedBox.expand(
      child: GestureDetector(
        onTap: _bgMusicPath == null && !isRecording ? _pickBgMusic : null,
        child: Container(
          decoration: BoxDecoration(
            color: const Color(0xFF12121f),
            borderRadius: BorderRadius.circular(6),
            border: Border.all(color: Colors.white12),
          ),
          clipBehavior: Clip.hardEdge,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Stack(
                  children: [
                    SizedBox.expand(
                      child: CustomPaint(
                        painter: WaveformPainter(
                          history: _recordingState == RecordingState.stopped
                              ? _bgReplay
                              : _bgHistory,
                          waveColor: const Color(0xFF60a5fa),
                          glowColor: const Color(0xFF3b82f6),
                          cursorRatio: _recordingState == RecordingState.stopped
                              ? _playbackCursorRatio
                              : _bgHistory.isEmpty
                                  ? 0
                                  : _bgHistory.length / _historyMax,
                          scrollMode:
                              _recordingState == RecordingState.recording,
                          scrollBufferCapacity: _historyMax,
                          scrollCursorXFactor: 0.5,
                        ),
                      ),
                    ),
                    Positioned(
                      top: 4,
                      left: 8,
                      child: Row(
                        children: [
                          const Icon(Icons.music_note,
                              color: Color(0xFF60a5fa), size: 12),
                          const SizedBox(width: 4),
                          const Text('背景音乐',
                              style: TextStyle(
                                  color: Color(0xFF60a5fa), fontSize: 11)),
                        ],
                      ),
                    ),
                    if (_bgMusicPath != null)
                      Positioned(
                        top: 4,
                        right: 8,
                        child: GestureDetector(
                          onTap: !isRecording ? _removeBgMusic : null,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.black54,
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              '移除',
                              style: TextStyle(
                                fontSize: 11,
                                color: isRecording
                                    ? Colors.white30
                                    : Colors.white70,
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (_bgMusicPath == null)
                      Center(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.add_circle_outline,
                                  color: Colors.white38, size: 20),
                              const SizedBox(height: 4),
                              GestureDetector(
                                onTap: !isRecording ? _pickBgMusic : null,
                                child: const Text(
                                  '点击选择背景音乐（或接收分享的音频）',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                      color: Color(0xFF60a5fa),
                                      fontSize: 12),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (_bgMusicPath != null)
                Container(
                  color: Colors.black26,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          const Icon(Icons.music_note,
                              color: Color(0xFF60a5fa), size: 12),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              _bgMusicName ?? '',
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  color: Colors.white70, fontSize: 11),
                            ),
                          ),
                          Text(
                            _bgDuration > 0
                                ? '${_formatTime(_bgPosition)} / ${_formatTime(_bgDuration)}'
                                : '--:-- / --:--',
                            style: const TextStyle(
                                fontFamily: 'monospace',
                                fontSize: 11,
                                color: Colors.white54),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          const Icon(Icons.volume_up,
                              color: Color(0xFF60a5fa), size: 12),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Slider(
                              value: _bgVolume,
                              onChanged: (v) {
                                setState(() => _bgVolume = v);
                                _bgPlayer.setVolume(v);
                              },
                              min: 0,
                              max: 1,
                              activeColor: const Color(0xFF60a5fa),
                              inactiveColor: Colors.white12,
                            ),
                          ),
                          Text(
                            '${(_bgVolume * 100).round()}%',
                            style: const TextStyle(
                                fontSize: 11, color: Colors.white54),
                          ),
                        ],
                      ),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: LinearProgressIndicator(
                          value: _bgProgressPercent,
                          backgroundColor: Colors.white12,
                          valueColor: const AlwaysStoppedAnimation<Color>(
                              Color(0xFF3b82f6)),
                          minHeight: 4,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  // --- Playback bar ---
  Widget _buildPlaybackBar() {
    return Column(
      children: [
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 4,
            thumbShape:
                const RoundSliderThumbShape(enabledThumbRadius: 6),
            overlayShape:
                const RoundSliderOverlayShape(overlayRadius: 12),
            activeTrackColor: const Color(0xFFf472b6),
            inactiveTrackColor: Colors.white12,
            thumbColor: const Color(0xFFf472b6),
          ),
          child: Slider(
            value: _playbackDuration > 0 ? _playbackPosition : 0,
            min: 0,
            max: _playbackDuration > 0 ? _playbackDuration : 1,
            onChanged: _playbackDuration > 0 ? _seekTo : null,
          ),
        ),
      ],
    );
  }

  // --- Controls ---
  Widget _buildControls({
    required bool isRecording,
    required bool isStopped,
    required double maxWidth,
  }) {
    if (isRecording) {
      return SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: _recordOpInFlight
              ? null
              : () {
                  unawaited(_stopRecording());
                },
          icon: const Icon(Icons.stop),
          label: Text(_recordOpInFlight ? '停止中…' : '停止录制'),
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.red,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(vertical: 14),
          ),
        ),
      );
    }

    if (isStopped && _recordingPath != null) {
      final playBtn = _controlBtn(
        icon: _isPlaying ? Icons.pause : Icons.play_arrow,
        label: _isPlaying ? '暂停' : '播放',
        onTap: _togglePlayback,
      );
      final rerecordBtn = _controlBtn(
        icon: Icons.refresh,
        label: '重录',
        onTap: () {
          unawaited(_restartRecording());
        },
      );
      final shareBtn = _controlBtn(
        icon: Icons.share,
        label: '分享',
        onTap: _shareRecording,
      );
      final saveBtn = _controlBtn(
        icon: Icons.download,
        label: '保存',
        onTap: _saveRecording,
      );
      // Always one row; scale down on very narrow widths instead of wrapping.
      return LayoutBuilder(
        builder: (context, constraints) {
          final w = constraints.maxWidth.isFinite
              ? constraints.maxWidth
              : maxWidth;
          return FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.center,
            child: SizedBox(
              width: w,
              child: Row(
                children: [
                  playBtn,
                  const SizedBox(width: 6),
                  rerecordBtn,
                  const SizedBox(width: 6),
                  shareBtn,
                  const SizedBox(width: 6),
                  saveBtn,
                ],
              ),
            ),
          );
        },
      );
    }

    // Idle state
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _recordOpInFlight
            ? null
            : () {
                unawaited(_startRecording());
              },
        icon: const Icon(Icons.mic),
        label: Text(_recordOpInFlight ? '准备中…' : '开始录制'),
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFFf472b6),
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
        ),
      ),
    );
  }

  Widget _controlBtn({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
          decoration: BoxDecoration(
            color: const Color(0xFF2a2a3e),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.white12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: Colors.white70),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 10, color: Colors.white70),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
