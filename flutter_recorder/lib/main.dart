import 'package:flutter/material.dart';
import 'recorder_screen.dart';

void main() {
  runApp(const RecorderApp());
}

class RecorderApp extends StatelessWidget {
  const RecorderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '在线录音',
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
        useMaterial3: true,
      ),
      home: const RecorderScreen(),
    );
  }
}
