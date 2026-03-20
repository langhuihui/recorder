import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Custom waveform painter that draws amplitude history as a filled wave,
/// mirrored around the horizontal center, matching the web app visual style.
class WaveformPainter extends CustomPainter {
  final List<double> history;
  final Color waveColor;
  final Color glowColor;
  final double cursorRatio;

  const WaveformPainter({
    required this.history,
    required this.waveColor,
    required this.glowColor,
    this.cursorRatio = 0.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final cx = h / 2;

    // Background
    canvas.drawRect(
      Rect.fromLTWH(0, 0, w, h),
      Paint()..color = const Color(0xFF17172c),
    );

    // Center line
    canvas.drawLine(
      Offset(0, cx),
      Offset(w, cx),
      Paint()
        ..color = waveColor.withOpacity(0.13)
        ..strokeWidth = 1.0,
    );

    if (history.length >= 2) {
      // Build upper path for fill
      final fillPath = Path();
      for (int i = 0; i < history.length; i++) {
        final x = (i / (history.length - 1)) * w;
        final y = cx - history[i] * cx * 0.85;
        if (i == 0) {
          fillPath.moveTo(x, y);
        } else {
          fillPath.lineTo(x, y);
        }
      }
      // Mirror bottom
      for (int i = history.length - 1; i >= 0; i--) {
        final x = (i / (history.length - 1)) * w;
        final y = cx + history[i] * cx * 0.85;
        fillPath.lineTo(x, y);
      }
      fillPath.close();

      // Gradient fill
      final gradient = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          waveColor.withOpacity(0.4),
          waveColor.withOpacity(0.13),
          waveColor.withOpacity(0.4),
        ],
        stops: const [0.0, 0.5, 1.0],
      );
      canvas.drawPath(
        fillPath,
        Paint()
          ..shader = gradient.createShader(Rect.fromLTWH(0, 0, w, h)),
      );

      // Upper stroke
      final strokePaint = Paint()
        ..color = waveColor
        ..strokeWidth = 1.5
        ..style = PaintingStyle.stroke
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 2.0);

      final upperPath = Path();
      for (int i = 0; i < history.length; i++) {
        final x = (i / (history.length - 1)) * w;
        final y = cx - history[i] * cx * 0.85;
        if (i == 0) {
          upperPath.moveTo(x, y);
        } else {
          upperPath.lineTo(x, y);
        }
      }
      canvas.drawPath(upperPath, strokePaint);

      // Lower stroke
      final lowerPath = Path();
      for (int i = 0; i < history.length; i++) {
        final x = (i / (history.length - 1)) * w;
        final y = cx + history[i] * cx * 0.85;
        if (i == 0) {
          lowerPath.moveTo(x, y);
        } else {
          lowerPath.lineTo(x, y);
        }
      }
      canvas.drawPath(lowerPath, strokePaint);
    }

    // Cursor line
    final clampedRatio = math.max(0.0, math.min(1.0, cursorRatio));
    final cursorX = clampedRatio * w;
    canvas.drawLine(
      Offset(cursorX, 0),
      Offset(cursorX, h),
      Paint()
        ..color = waveColor.withOpacity(0.6)
        ..strokeWidth = 1.0,
    );
  }

  @override
  bool shouldRepaint(WaveformPainter oldDelegate) =>
      oldDelegate.history != history ||
      oldDelegate.cursorRatio != cursorRatio;
}
