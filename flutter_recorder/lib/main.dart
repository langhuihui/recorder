import 'package:audio_session/audio_session.dart';
import 'package:flutter/material.dart';

import 'recorder_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final session = await AudioSession.instance;
  await session.configure(AudioSessionConfiguration(
    avAudioSessionCategory: AVAudioSessionCategory.playAndRecord,
    avAudioSessionCategoryOptions: AVAudioSessionCategoryOptions.defaultToSpeaker |
        AVAudioSessionCategoryOptions.allowBluetooth,
    avAudioSessionMode: AVAudioSessionMode.defaultMode,
    androidAudioAttributes: const AndroidAudioAttributes(
      contentType: AndroidAudioContentType.music,
      usage: AndroidAudioUsage.media,
    ),
    androidAudioFocusGainType: AndroidAudioFocusGainType.gain,
    androidWillPauseWhenDucked: false,
  ));
  runApp(const RecorderApp());
}

class RecorderApp extends StatelessWidget {
  const RecorderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '伴唱助手',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFf472b6),
          secondary: Color(0xFF60a5fa),
          surface: Color(0xFF1e1e2e),
          onSurface: Colors.white,
        ),
        scaffoldBackgroundColor: const Color(0xFF12121f),
        cardColor: const Color(0xFF1e1e2e),
        cardTheme: const CardThemeData(
          margin: EdgeInsets.zero,
          clipBehavior: Clip.antiAlias,
        ),
        useMaterial3: true,
      ),
      home: const RecorderScreen(),
    );
  }
}
