import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Custom waveform painter: mirrored fill, smoothed outline (reduces jagged
/// edges when the panel is tall/wide), stroke width scales with canvas size.
///
/// When [scrollMode] is true (live recording), the playhead stays at
/// [scrollCursorXFactor] * width and samples use fixed horizontal spacing so
/// the wave scrolls left at constant speed as the buffer fills.
class WaveformPainter extends CustomPainter {
  final List<double> history;
  final Color waveColor;
  final Color glowColor;
  final double cursorRatio;
  final bool scrollMode;
  final double scrollCursorXFactor;
  final int scrollBufferCapacity;

  const WaveformPainter({
    required this.history,
    required this.waveColor,
    required this.glowColor,
    this.cursorRatio = 0.0,
    this.scrollMode = false,
    this.scrollCursorXFactor = 0.5,
    this.scrollBufferCapacity = 300,
  });

  static double _yUpper(double cx, double amp) => cx - amp * cx * 0.85;

  static double _yLower(double cx, double amp) => cx + amp * cx * 0.85;

  static void _subdivideLinePath(
    Path path,
    int n,
    double w,
    double cx,
    List<double> history,
    bool upper,
  ) {
    if (n < 1) return;
    double xAt(int i) {
      if (n == 1) return i == 0 ? 0.0 : w;
      return (i / (n - 1)) * w;
    }

    double yAt(int idx) {
      final a = history[idx];
      return upper ? _yUpper(cx, a) : _yLower(cx, a);
    }

    final count = n == 1 ? 2 : n;
    path.moveTo(xAt(0), yAt(n == 1 ? 0 : 0));
    for (int i = 0; i < count - 1; i++) {
      final idx0 = n == 1 ? 0 : i;
      final idx1 = n == 1 ? 0 : i + 1;
      final x0 = xAt(i);
      final x1 = xAt(i + 1);
      final y0 = yAt(idx0);
      final y1 = yAt(idx1);
      path.lineTo((x0 + x1) / 2, (y0 + y1) / 2);
      path.lineTo(x1, y1);
    }
  }

  static Path _smoothStrokePath(
    int n,
    double w,
    double cx,
    List<double> history,
    bool upper,
  ) {
    final path = Path();
    if (n < 1) return path;

    double xAt(int i) {
      if (n == 1) return i == 0 ? 0.0 : w;
      return (i / (n - 1)) * w;
    }

    double yAt(int idx) {
      final a = history[n == 1 ? 0 : idx];
      return upper ? _yUpper(cx, a) : _yLower(cx, a);
    }

    final count = n == 1 ? 2 : n;
    if (count < 2) {
      path.moveTo(xAt(0), yAt(0));
      path.lineTo(xAt(1), yAt(0));
      return path;
    }

    path.moveTo(xAt(0), yAt(0));
    for (int i = 0; i < count - 1; i++) {
      final idx = n == 1 ? 0 : i;
      final idxN = n == 1 ? 0 : i + 1;
      final px = xAt(i);
      final py = yAt(idx);
      final qx = xAt(i + 1);
      final qy = yAt(idxN);
      final mx = (px + qx) / 2;
      final my = (py + qy) / 2;
      path.quadraticBezierTo(px, py, mx, my);
    }
    path.lineTo(xAt(count - 1), yAt(n == 1 ? 0 : count - 1));
    return path;
  }

  void _paintScrollMode(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;
    final cx = h / 2;

    final dim = math.sqrt(w * w + h * h);
    final scale = (dim / 420).clamp(0.75, 2.2);
    final strokeW = (1.3 * scale).clamp(1.1, 3.2);
    final centerStroke = (1.0 * scale).clamp(0.75, 2.0);

    canvas.drawRect(
      Rect.fromLTWH(0, 0, w, h),
      Paint()..color = const Color(0xFF17172c),
    );

    canvas.drawLine(
      Offset(0, cx),
      Offset(w, cx),
      Paint()
        ..color = waveColor.withValues(alpha: 0.13)
        ..strokeWidth = centerStroke,
    );

    final cursorX = (scrollCursorXFactor.clamp(0.15, 0.9)) * w;
    final cap = math.max(2, scrollBufferCapacity);
    final maxSpan = w * 0.46;
    final dx = maxSpan / (cap - 1);

    final n = history.length;
    if (n >= 1) {
      final upper = <Offset>[];
      final lower = <Offset>[];
      for (int j = 0; j < n; j++) {
        final x = cursorX - (n - 1 - j) * dx;
        if (x < -dx) continue;
        final a = history[j];
        upper.add(Offset(x, _yUpper(cx, a)));
        lower.add(Offset(x, _yLower(cx, a)));
      }

      if (upper.length >= 2) {
        final fillPath = Path()..moveTo(upper.first.dx, upper.first.dy);
        for (int i = 1; i < upper.length; i++) {
          final p0 = upper[i - 1];
          final p1 = upper[i];
          fillPath.lineTo((p0.dx + p1.dx) / 2, (p0.dy + p1.dy) / 2);
          fillPath.lineTo(p1.dx, p1.dy);
        }
        fillPath.lineTo(lower.last.dx, lower.last.dy);
        for (int i = lower.length - 2; i >= 0; i--) {
          final p0 = lower[i];
          final p1 = lower[i + 1];
          fillPath.lineTo((p0.dx + p1.dx) / 2, (p0.dy + p1.dy) / 2);
          fillPath.lineTo(p0.dx, p0.dy);
        }
        fillPath.close();

        final gradient = LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            waveColor.withValues(alpha: 0.4),
            waveColor.withValues(alpha: 0.13),
            waveColor.withValues(alpha: 0.4),
          ],
          stops: const [0.0, 0.5, 1.0],
        );
        canvas.drawPath(
          fillPath,
          Paint()..shader = gradient.createShader(Rect.fromLTWH(0, 0, w, h)),
        );

        final strokePaint = Paint()
          ..color = waveColor
          ..strokeWidth = strokeW
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..isAntiAlias = true;

        canvas.drawPath(_smoothStrokeFromOffsets(upper), strokePaint);
        canvas.drawPath(_smoothStrokeFromOffsets(lower), strokePaint);
      } else if (upper.length == 1) {
        canvas.drawCircle(upper.first, strokeW, Paint()..color = waveColor);
      }
    }

    canvas.drawLine(
      Offset(cursorX, 0),
      Offset(cursorX, h),
      Paint()
        ..color = waveColor.withValues(alpha: 0.6)
        ..strokeWidth = centerStroke,
    );
  }

  static Path _smoothStrokeFromOffsets(List<Offset> pts) {
    final path = Path();
    if (pts.isEmpty) return path;
    if (pts.length == 1) {
      path.moveTo(pts[0].dx, pts[0].dy);
      path.lineTo(pts[0].dx + 0.5, pts[0].dy);
      return path;
    }
    path.moveTo(pts[0].dx, pts[0].dy);
    for (int i = 0; i < pts.length - 1; i++) {
      final px = pts[i].dx;
      final py = pts[i].dy;
      final qx = pts[i + 1].dx;
      final qy = pts[i + 1].dy;
      final mx = (px + qx) / 2;
      final my = (py + qy) / 2;
      path.quadraticBezierTo(px, py, mx, my);
    }
    path.lineTo(pts.last.dx, pts.last.dy);
    return path;
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (scrollMode) {
      _paintScrollMode(canvas, size);
      return;
    }

    final w = size.width;
    final h = size.height;
    final cx = h / 2;

    final dim = math.sqrt(w * w + h * h);
    final scale = (dim / 420).clamp(0.75, 2.2);
    final strokeW = (1.3 * scale).clamp(1.1, 3.2);
    final centerStroke = (1.0 * scale).clamp(0.75, 2.0);

    canvas.drawRect(
      Rect.fromLTWH(0, 0, w, h),
      Paint()..color = const Color(0xFF17172c),
    );

    canvas.drawLine(
      Offset(0, cx),
      Offset(w, cx),
      Paint()
        ..color = waveColor.withValues(alpha: 0.13)
        ..strokeWidth = centerStroke,
    );

    final n = history.length;
    if (n >= 1) {
      final fillPath = Path();
      _subdivideLinePath(fillPath, n, w, cx, history, true);
      final count = n == 1 ? 2 : n;
      for (int i = count - 1; i >= 0; i--) {
        final idx = n == 1 ? 0 : i;
        double xAt(int j) {
          if (n == 1) return j == 0 ? 0.0 : w;
          return (j / (n - 1)) * w;
        }

        final x = xAt(i);
        final y = _yLower(cx, history[idx]);
        if (i == count - 1) {
          fillPath.lineTo(x, y);
        } else {
          final xNext = xAt(i + 1);
          final yNext = _yLower(cx, history[n == 1 ? 0 : i + 1]);
          fillPath.lineTo((x + xNext) / 2, (y + yNext) / 2);
          fillPath.lineTo(x, y);
        }
      }
      fillPath.close();

      final gradient = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          waveColor.withValues(alpha: 0.4),
          waveColor.withValues(alpha: 0.13),
          waveColor.withValues(alpha: 0.4),
        ],
        stops: const [0.0, 0.5, 1.0],
      );
      canvas.drawPath(
        fillPath,
        Paint()..shader = gradient.createShader(Rect.fromLTWH(0, 0, w, h)),
      );

      final strokePaint = Paint()
        ..color = waveColor
        ..strokeWidth = strokeW
        ..style = PaintingStyle.stroke
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..isAntiAlias = true;

      canvas.drawPath(
        _smoothStrokePath(n, w, cx, history, true),
        strokePaint,
      );
      canvas.drawPath(
        _smoothStrokePath(n, w, cx, history, false),
        strokePaint,
      );
    }

    final clampedRatio = cursorRatio.clamp(0.0, 1.0);
    final cursorX = clampedRatio * w;
    canvas.drawLine(
      Offset(cursorX, 0),
      Offset(cursorX, h),
      Paint()
        ..color = waveColor.withValues(alpha: 0.6)
        ..strokeWidth = centerStroke,
    );
  }

  @override
  bool shouldRepaint(WaveformPainter oldDelegate) {
    if (oldDelegate.waveColor != waveColor ||
        oldDelegate.glowColor != glowColor ||
        oldDelegate.cursorRatio != cursorRatio ||
        oldDelegate.scrollMode != scrollMode ||
        oldDelegate.scrollCursorXFactor != scrollCursorXFactor ||
        oldDelegate.scrollBufferCapacity != scrollBufferCapacity) {
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
