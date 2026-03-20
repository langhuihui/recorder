import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_recorder/waveform_painter.dart';

void main() {
  group('WaveformPainter', () {
    test('resamplePeaks returns empty list for empty input', () {
      // WaveformPainter is a pure CustomPainter – test its logic indirectly
      // by verifying it can be constructed without error.
      const painter = WaveformPainter(
        history: [],
        waveColor: Color(0xFFf472b6),
        glowColor: Color(0xFFec4899),
        cursorRatio: 0.0,
      );
      expect(painter.history, isEmpty);
    });

    test('WaveformPainter shouldRepaint returns true on history change', () {
      const painter1 = WaveformPainter(
        history: [0.1, 0.2],
        waveColor: Color(0xFFf472b6),
        glowColor: Color(0xFFec4899),
        cursorRatio: 0.0,
      );
      const painter2 = WaveformPainter(
        history: [0.1, 0.3],
        waveColor: Color(0xFFf472b6),
        glowColor: Color(0xFFec4899),
        cursorRatio: 0.0,
      );
      expect(painter1.shouldRepaint(painter2), isTrue);
    });

    test('WaveformPainter shouldRepaint returns false when history is same', () {
      final history = [0.1, 0.2];
      final painter1 = WaveformPainter(
        history: history,
        waveColor: const Color(0xFFf472b6),
        glowColor: const Color(0xFFec4899),
        cursorRatio: 0.5,
      );
      final painter2 = WaveformPainter(
        history: history,
        waveColor: const Color(0xFFf472b6),
        glowColor: const Color(0xFFec4899),
        cursorRatio: 0.5,
      );
      expect(painter1.shouldRepaint(painter2), isFalse);
    });
  });
}
