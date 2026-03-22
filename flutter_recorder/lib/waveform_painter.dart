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

    // Need at least two sample columns to span the width; duplicate a single point.
    final n = history.length;
    if (n >= 1) {
      double xAt(int i) {
        if (n == 1) return i == 0 ? 0.0 : w;
        return (i / (n - 1)) * w;
      }

      // Build upper path for fill
      final fillPath = Path();
      final count = n == 1 ? 2 : n;
      for (int i = 0; i < count; i++) {
        final idx = n == 1 ? 0 : i;
        final x = xAt(i);
        final y = cx - history[idx] * cx * 0.85;
        if (i == 0) {
          fillPath.moveTo(x, y);
        } else {
          fillPath.lineTo(x, y);
        }
      }
      // Mirror bottom
      for (int i = count - 1; i >= 0; i--) {
        final idx = n == 1 ? 0 : i;
        final x = xAt(i);
        final y = cx + history[idx] * cx * 0.85;
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
      for (int i = 0; i < count; i++) {
        final idx = n == 1 ? 0 : i;
        final x = xAt(i);
        final y = cx - history[idx] * cx * 0.85;
        if (i == 0) {
          upperPath.moveTo(x, y);
        } else {
          upperPath.lineTo(x, y);
        }
      }
      canvas.drawPath(upperPath, strokePaint);

      // Lower stroke
      final lowerPath = Path();
      for (int i = 0; i < count; i++) {
        final idx = n == 1 ? 0 : i;
        final x = xAt(i);
        final y = cx + history[idx] * cx * 0.85;
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
  bool shouldRepaint(WaveformPainter oldDelegate) {
    if (oldDelegate.waveColor != waveColor ||
        oldDelegate.glowColor != glowColor ||
        oldDelegate.cursorRatio != cursorRatio) {
      return true;
    }
    if (identical(oldDelegate.history, history)) {
      if (history.isEmpty) return false;
      if (oldDelegate.history.isEmpty) return true;
      if (oldDelegate.history.length != history.length) return true;
      return oldDelegate.history.last != history.last;
    }
    if (oldDelegate.history.length != history.length) return true;
    if (history.isEmpty) return oldDelegate.history.isNotEmpty;
    if (oldDelegate.history.isEmpty) return true;
    return oldDelegate.history.last != history.last;
  }
}
