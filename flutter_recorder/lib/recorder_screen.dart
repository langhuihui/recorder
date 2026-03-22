import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:just_audio/just_audio.dart';
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
  StreamSubscription? _playbackPositionSub;
  StreamSubscription? _playbackDurationSub;
  StreamSubscription? _playbackStateSub;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initSharingIntent();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _sharingIntentSub?.cancel();
    _bgPositionSub?.cancel();
    _bgDurationSub?.cancel();
    _playbackPositionSub?.cancel();
    _playbackDurationSub?.cancel();
    _playbackStateSub?.cancel();
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
    });
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
    setState(() {
      _bgMusicPath = null;
      _bgMusicName = null;
      _bgDuration = 0;
      _bgPosition = 0;
      _bgHistory.clear();
    });
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------
  Future<void> _startRecording() async {
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
      await _recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          sampleRate: 48000,
          bitRate: 192000,
          numChannels: 1,
          autoGain: true,
          echoCancel: false,
          noiseSuppress: false,
        ),
        path: filePath,
      );
    } catch (e) {
      _showSnackBar('无法开始录音: $e');
      return;
    }

    // Start background music if loaded
    if (_bgMusicPath != null) {
      try {
        await _bgPlayer.setVolume(_bgVolume);
        await _bgPlayer.setLoopMode(LoopMode.one);
        await _bgPlayer.seek(Duration.zero);
        await _bgPlayer.play();
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
        // Normalize dBFS (-60..0) -> (0..1)
        final micPeak = _dbToLinear(amp.current);

        double bgPeak = 0;
        if (_bgMusicPath != null) {
          // Approximate bg peak from volume (no direct amplitude API for player)
          bgPeak = _bgVolume * (0.3 + 0.7 * (0.5 + 0.5 * math.sin(DateTime.now().millisecondsSinceEpoch / 200)));
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
  }

  double _dbToLinear(double db) {
    if (!db.isFinite || db <= -60) return 0.0;
    if (db >= 0) return 1.0;
    return math.pow(10, db / 20).toDouble();
  }

  Future<void> _stopRecording() async {
    _amplitudeTimer?.cancel();
    _recordStopwatch?.stop();

    await _bgPlayer.stop();
    final path = await _recorder.stop();

    // Resample full histories for replay waveform
    const targetPoints = 300;
    final micReplay = _resamplePeaks(_micAllHistory, targetPoints);
    final bgReplay = _resamplePeaks(_bgAllHistory, targetPoints);
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
          if (state.processingState == ProcessingState.completed) {
            setState(() {
              _isPlaying = false;
              _playbackPosition = 0;
            });
            _playbackPlayer.seek(Duration.zero);
          }
        });
      } catch (e) {
        debugPrint('设置回放失败: $e');
      }
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

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------
  Future<void> _togglePlayback() async {
    if (_recordingPath == null) return;
    if (_isPlaying) {
      await _playbackPlayer.pause();
      setState(() => _isPlaying = false);
    } else {
      await _playbackPlayer.play();
      setState(() => _isPlaying = true);
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
      await Share.shareXFiles(
        [XFile(_recordingPath!, mimeType: 'audio/mp4')],
        subject: '录音分享',
        text: '录音分享',
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
      final destPath = '${destDir.path}/录音_$timestamp.m4a';
      await src.copy(destPath);
      _showSnackBar('已保存到: $destPath');
    } catch (e) {
      _showSnackBar('保存失败: $e');
    }
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
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
            final availH = constraints.maxHeight;
            final availW = constraints.maxWidth;
            final innerH = math.max(0.0, availH - 36);
            final waveH = (availH * 0.11).clamp(56.0, 118.0);
            final bgWaveH = (availH * 0.12).clamp(64.0, 130.0);

            return Stack(
              children: [
                Positioned(
                  top: 4,
                  left: 8,
                  child: _versionBadge(),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(8, 28, 8, 8),
                  child: SingleChildScrollView(
                    child: ConstrainedBox(
                      constraints: BoxConstraints(minHeight: innerH),
                      child: _buildCard(
                        isRecording: isRecording,
                        isStopped: isStopped,
                        layoutWidth: availW - 16,
                        waveformHeight: waveH,
                        bgWaveHeight: bgWaveH,
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _versionBadge() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.5),
        border: Border.all(color: Colors.white24),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(
        'v$_kAppVersion',
        style: const TextStyle(fontSize: 11, color: Colors.white54),
      ),
    );
  }

  Widget _buildCard({
    required bool isRecording,
    required bool isStopped,
    required double layoutWidth,
    required double waveformHeight,
    required double bgWaveHeight,
  }) {
    return Card(
      color: const Color(0xFF1e1e2e),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          mainAxisSize: MainAxisSize.max,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _buildTitleRow(isStopped: isStopped),
            const SizedBox(height: 8),
            _buildMicWaveform(
              isRecording: isRecording,
              height: waveformHeight,
            ),
            const SizedBox(height: 4),
            _buildBgMusicPanel(
              isRecording: isRecording,
              waveHeight: bgWaveHeight,
            ),
            const SizedBox(height: 4),
            _buildMixWaveform(height: waveformHeight),
            const SizedBox(height: 8),
            if (isStopped && _recordingPath != null) ...[
              _buildPlaybackBar(),
              const SizedBox(height: 8),
            ],
            _buildControls(
              isRecording: isRecording,
              isStopped: isStopped,
              maxWidth: layoutWidth - 24,
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }

  // --- Title row ---
  Widget _buildTitleRow({required bool isStopped}) {
    final timeStr = isStopped && _recordingPath != null
        ? '${_formatTime(_playbackPosition)} / ${_formatTime(_playbackDuration)}'
        : _formatTime(_recordSeconds);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          child: Row(
            children: [
              const Icon(Icons.volume_up, color: Color(0xFFf472b6), size: 20),
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  '在线录音',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
        Flexible(
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerRight,
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
              ),
              const SizedBox(width: 8),
              const Icon(Icons.headphones, color: Color(0xFFf472b6), size: 18),
              const SizedBox(width: 4),
              Switch(
                value: _isHeadphoneMode,
                onChanged: _recordingState == RecordingState.recording
                    ? null
                    : (v) => setState(() => _isHeadphoneMode = v),
                activeThumbColor: const Color(0xFFf472b6),
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ],
          ),
        ),
      ],
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
  }) {
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
  Widget _buildBgMusicPanel({
    required bool isRecording,
    required double waveHeight,
  }) {
    return GestureDetector(
      onTap: _bgMusicPath == null && !isRecording ? _pickBgMusic : null,
      child: Container(
        constraints: BoxConstraints(minHeight: waveHeight + 20),
        decoration: BoxDecoration(
          color: const Color(0xFF12121f),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: Colors.white12),
        ),
        clipBehavior: Clip.hardEdge,
        child: Column(
          children: [
            // Waveform area
            SizedBox(
              height: waveHeight,
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
                              style: TextStyle(
                                  color: Color(0xFF60a5fa), fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),

            // Metadata row (only when bg music is loaded)
            if (_bgMusicPath != null) ...[
              Container(
                color: Colors.black26,
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
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
                    // Progress bar
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
          ],
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
          onPressed: _stopRecording,
          icon: const Icon(Icons.stop),
          label: const Text('停止录制'),
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
        onTap: _resetRecording,
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
      if (maxWidth < 360) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                playBtn,
                const SizedBox(width: 8),
                rerecordBtn,
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                shareBtn,
                const SizedBox(width: 8),
                saveBtn,
              ],
            ),
          ],
        );
      }
      return Row(
        children: [
          playBtn,
          const SizedBox(width: 8),
          rerecordBtn,
          const SizedBox(width: 8),
          shareBtn,
          const SizedBox(width: 8),
          saveBtn,
        ],
      );
    }

    // Idle state
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton.icon(
        onPressed: _startRecording,
        icon: const Icon(Icons.mic),
        label: const Text('开始录制'),
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
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: const Color(0xFF2a2a3e),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.white12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 20, color: Colors.white70),
              const SizedBox(height: 4),
              Text(label,
                  style: const TextStyle(fontSize: 11, color: Colors.white70)),
            ],
          ),
        ),
      ),
    );
  }
}
