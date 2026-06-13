#!/usr/bin/env python3
"""MOO-FO procedural audio synthesizer.

Python 3 stdlib only (math, wave, struct, random, os).
Writes 22050 Hz / 16-bit / mono WAVs into assets/audio/.

Run:  python3 tools/generate_audio.py
"""

import math
import os
import random
import struct
import wave

SR = 22050
TWO_PI = 2.0 * math.pi
PEAK = 10.0 ** (-1.0 / 20.0)          # -1 dBFS peak normalization target
OUT_DIR = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'audio'))

random.seed(20260612)  # deterministic output


# ---------------------------------------------------------------------------
# Tiny synth toolkit
# ---------------------------------------------------------------------------

def nsamp(dur):
    return int(round(SR * dur))


def zeros(dur):
    return [0.0] * nsamp(dur)


def _f(v, t):
    """Evaluate a scalar-or-callable parameter at time t."""
    return v(t) if callable(v) else v


def curve(points):
    """Piecewise-linear breakpoint function: [(t, v), ...] -> callable(t)."""
    def f(t):
        if t <= points[0][0]:
            return points[0][1]
        for (t0, v0), (t1, v1) in zip(points, points[1:]):
            if t <= t1:
                return v0 if t1 <= t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0)
        return points[-1][1]
    return f


def xsweep(f0, f1, dur):
    """Exponential sweep f0 -> f1 over dur seconds, then holds f1."""
    ratio = f1 / f0
    def f(t):
        u = min(max(t / dur, 0.0), 1.0)
        return f0 * (ratio ** u)
    return f


def osc(kind, freq, dur, amp=1.0, phase=0.0):
    """Phase-accumulating oscillator. freq/amp may be callables of time
    (per-sample frequency => clean sweeps and vibrato)."""
    n = nsamp(dur)
    out = [0.0] * n
    ph = phase
    sin = math.sin
    for i in range(n):
        t = i / SR
        if kind == 'sine':
            v = sin(ph)
        elif kind == 'saw':
            v = 2.0 * ((ph / TWO_PI) % 1.0) - 1.0
        elif kind == 'square':
            v = 1.0 if ((ph / TWO_PI) % 1.0) < 0.5 else -1.0
        else:  # triangle
            fr = (ph / TWO_PI) % 1.0
            v = 4.0 * fr - 1.0 if fr < 0.5 else 3.0 - 4.0 * fr
        out[i] = v * _f(amp, t)
        ph += TWO_PI * _f(freq, t) / SR
    return out


def fm_osc(freq, ratio, index, dur, amp=1.0):
    """Simple 2-op FM (phase modulation): sin(ph_c + index*sin(ph_m)),
    modulator tracks carrier (fm = freq*ratio). freq/index/amp may be callables."""
    n = nsamp(dur)
    out = [0.0] * n
    phc = phm = 0.0
    sin = math.sin
    for i in range(n):
        t = i / SR
        f = _f(freq, t)
        out[i] = _f(amp, t) * sin(phc + _f(index, t) * sin(phm))
        phc += TWO_PI * f / SR
        phm += TWO_PI * f * ratio / SR
    return out


def noise(dur, amp=1.0):
    n = nsamp(dur)
    u = random.uniform
    return [u(-1.0, 1.0) * _f(amp, i / SR) for i in range(n)]


def lowpass(x, cutoff):
    """One-pole lowpass y += a*(x-y); cutoff may be a callable for sweeps."""
    y = 0.0
    out = [0.0] * len(x)
    exp = math.exp
    if callable(cutoff):
        for i, s in enumerate(x):
            a = 1.0 - exp(-TWO_PI * cutoff(i / SR) / SR)
            y += a * (s - y)
            out[i] = y
    else:
        a = 1.0 - exp(-TWO_PI * cutoff / SR)
        for i, s in enumerate(x):
            y += a * (s - y)
            out[i] = y
    return out


def apply_env(x, env):
    """Multiply by an envelope (callable of time, or list)."""
    if callable(env):
        return [s * env(i / SR) for i, s in enumerate(x)]
    return [s * e for s, e in zip(x, env)]


def exp_env(tau, attack=0.001, amp=1.0):
    """Instant-ish attack then exponential decay, as a callable."""
    def f(t):
        a = min(t / attack, 1.0) if attack > 0 else 1.0
        return amp * a * math.exp(-max(t - attack, 0.0) / tau)
    return f


def gain(x, g):
    return [s * g for s in x]


def mix_at(dest, src, offset=0.0, g=1.0):
    """Mix src into dest (in place) at offset seconds, growing dest if needed."""
    o = int(round(offset * SR))
    need = o + len(src)
    if len(dest) < need:
        dest.extend([0.0] * (need - len(dest)))
    for i, v in enumerate(src):
        dest[o + i] += v * g
    return dest


def soft_clip(x, drive=1.0):
    th = math.tanh
    return [th(s * drive) for s in x]


def normalize(x, peak=PEAK):
    m = max(abs(s) for s in x) or 1.0
    g = peak / m
    return [s * g for s in x]


def fade(x, fin=0.002, fout=0.012):
    """Short linear fade-in/out to kill clicks (applied to every one-shot)."""
    x = list(x)
    ni, no = min(nsamp(fin), len(x)), min(nsamp(fout), len(x))
    for i in range(ni):
        x[i] *= i / ni
    for i in range(no):
        x[len(x) - 1 - i] *= i / no
    return x


def write_wav(name, samples):
    path = os.path.join(OUT_DIR, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for s in samples:
            v = int(max(-1.0, min(1.0, s)) * 32767.0)
            frames += struct.pack('<h', v)
        w.writeframes(bytes(frames))
    peak = max(abs(s) for s in samples)
    db = 20.0 * math.log10(peak) if peak > 0 else -120.0
    size = os.path.getsize(path)
    print(f"  {name + '.wav':<16} {len(samples) / SR:5.2f}s  peak {db:+.2f} dBFS  {size:>7,} B")
    return path


def finish_loop(x, dur, label):
    """x was synthesized with ONE extra sample (periodic construction).
    Verify the wrap sample equals the first sample, then trim it off."""
    n = nsamp(dur)
    delta = abs(x[n] - x[0])
    print(f"  [loop-check {label}] first={x[0]:+.6f}  wrap={x[n]:+.6f}  delta={delta:.2e}")
    assert delta < 2e-3, f"{label} is not seamlessly loopable (delta={delta})"
    return x[:n]


# ---------------------------------------------------------------------------
# Musical helpers
# ---------------------------------------------------------------------------

def tone(freq, dur, kind='square', cutoff=None, a=0.004, r=0.05, g=1.0,
         vib=0.0, vibr=5.5, bend=None):
    """One musical note: osc -> optional lowpass -> trapezoid envelope."""
    if bend is not None:
        fr = curve(bend)
    elif vib:
        fr = lambda t: freq * (1.0 + vib * math.sin(TWO_PI * vibr * t))
    else:
        fr = freq
    x = osc(kind, fr, dur)
    if cutoff:
        x = lowpass(x, cutoff)
    x = apply_env(x, curve([(0, 0.0), (a, 1.0), (max(a, dur - r), 1.0), (dur, 0.0)]))
    return gain(x, g)


def ping(freq, dur=0.15, tau=0.045, g=1.0, harm=0.0):
    """Short sine ping with exp decay (optional 2nd harmonic sparkle)."""
    x = osc('sine', freq, dur, amp=exp_env(tau, attack=0.002))
    if harm:
        h = osc('sine', freq * 2.0, dur, amp=exp_env(tau * 0.6, attack=0.002))
        x = [a + harm * b for a, b in zip(x, h)]
    return gain(x, g)


def bell(freq, dur, g=1.0):
    """Bell voice: stacked slightly-inharmonic partials, exp decays."""
    partials = [(1.00, 1.00, 0.50), (2.00, 0.55, 0.32), (2.96, 0.40, 0.22),
                (4.20, 0.22, 0.13), (5.40, 0.12, 0.09)]
    out = [0.0] * nsamp(dur)
    for ratio, amp, tau in partials:
        comp = osc('sine', freq * ratio, dur, amp=exp_env(tau, attack=0.002, amp=amp))
        mix_at(out, comp)
    return gain(out, g)


# ---------------------------------------------------------------------------
# Sound designs
# ---------------------------------------------------------------------------

def make_ufo_hum():
    """2.0 s seamlessly loopable warm pad. Every oscillator/LFO completes an
    integer number of cycles over the loop, so sample[N] == sample[0]."""
    dur = 2.0
    de = dur + 1.0 / SR  # synth one extra sample for the loop check
    out = zeros(de)
    # Detuned low sine cluster (54.5/55/55.5 beat with a 2 s period = the loop).
    mix_at(out, osc('sine', 55.0, de, amp=lambda t: 0.50 * (1.0 + 0.25 * math.sin(TWO_PI * 1.0 * t))))
    mix_at(out, osc('sine', 55.5, de, amp=lambda t: 0.34 * (1.0 + 0.30 * math.sin(TWO_PI * 1.5 * t + 1.7))))
    mix_at(out, osc('sine', 54.5, de, amp=lambda t: 0.34 * (1.0 + 0.30 * math.sin(TWO_PI * 2.0 * t + 4.0))))
    # Octave + soft third harmonic body.
    mix_at(out, osc('sine', 110.0, de, amp=lambda t: 0.26 * (1.0 + 0.35 * math.sin(TWO_PI * 0.5 * t + 0.9))))
    mix_at(out, osc('sine', 165.0, de, amp=lambda t: 0.10 * (1.0 + 0.40 * math.sin(TWO_PI * 2.5 * t + 2.2))))
    # Slow filtered-noise shimmer; windowed to zero at both loop edges so the
    # aperiodic noise cannot break seamlessness.
    sh = lowpass(noise(de), lambda t: 900.0 + 500.0 * math.sin(TWO_PI * 1.0 * t))
    sh = apply_env(sh, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * t / dur)))
    mix_at(out, sh, g=0.16)
    out = soft_clip(out, 1.25)            # gentle warmth (memoryless => still periodic)
    out = normalize(out)
    return finish_loop(out, dur, 'ufo_hum')


def make_beam():
    """1.5 s loopable ethereal shimmer: vibrato pad + windowed arpeggio pings.
    Pad frequencies & LFO rates are integer cycles over 1.5 s (multiples of 2/3 Hz)."""
    dur = 1.5
    de = dur + 1.0 / SR
    out = zeros(de)
    # Shimmer pad: detuned high sines with slow vibrato (4/2/6 Hz => 6/3/9 cycles).
    mix_at(out, osc('sine', lambda t: 660.0 + 3.0 * math.sin(TWO_PI * 2.0 * t),
                    de, amp=lambda t: 0.22 * (0.8 + 0.2 * math.sin(TWO_PI * 2.0 * t + 2.0))))
    mix_at(out, osc('sine', lambda t: 880.0 + 5.0 * math.sin(TWO_PI * 4.0 * t),
                    de, amp=lambda t: 0.26 * (0.8 + 0.2 * math.sin(TWO_PI * 2.0 * t))))
    mix_at(out, osc('sine', lambda t: 1320.0 + 7.0 * math.sin(TWO_PI * 6.0 * t),
                    de, amp=lambda t: 0.16 * (0.8 + 0.2 * math.sin(TWO_PI * 4.0 * t + 4.4))))
    # Gentle arpeggio: 6 steps of 0.25 s; each ping amplitude-windowed to zero
    # at its edges (sin^2), so any pitch is loop-safe.
    arp = [1568.0, 1760.0, 2093.0, 2349.3, 2637.0, 2093.0]
    step = dur / len(arp)
    for k, f in enumerate(arp):
        seg = osc('sine', f, step,
                  amp=lambda t, L=step: 0.30 * math.sin(math.pi * t / L) ** 2)
        mix_at(out, seg, offset=k * step)
    # Faint airy noise, also edge-windowed.
    air = lowpass(noise(de), 3000.0)
    air = apply_env(air, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * 2.0 * t / dur)))
    mix_at(out, air, g=0.045)
    out = normalize(out, peak=PEAK * 0.85)  # shimmer sits a touch under full scale
    return finish_loop(out, dur, 'beam')


def make_warp():
    """0.8 s whoosh: noise through a 200->6000 Hz lowpass sweep + rising sine."""
    dur = 0.8
    body = lowpass(noise(dur), xsweep(200.0, 6000.0, 0.7))
    body = apply_env(body, curve([(0, 0.0), (0.06, 0.3), (0.55, 1.0), (0.72, 0.8), (dur, 0.0)]))
    riser = osc('sine', xsweep(100.0, 700.0, 0.75), dur,
                amp=curve([(0, 0.0), (0.1, 0.35), (0.6, 0.55), (dur, 0.0)]))
    riser2 = osc('sine', xsweep(201.0, 1403.0, 0.75), dur,  # detuned octave shadow
                 amp=curve([(0, 0.0), (0.2, 0.15), (0.65, 0.25), (dur, 0.0)]))
    out = zeros(dur)
    mix_at(out, body)
    mix_at(out, riser)
    mix_at(out, riser2)
    return normalize(fade(out, 0.004, 0.03))


def make_moo(f_start, f_peak, f_end, dur):
    """Cartoon cow moo. FM voice (rich harmonics) with a rise-then-fall pitch
    contour ('mooOOoo'), shaped by two parallel lowpass paths:
      path 1: low cutoff opening 110->340 Hz  (the 'm' -> 'oo' mouth opening / F1)
      path 2: lp(high)-lp(mid) crude bandpass ~700-1100 Hz (F2-ish band emphasis)."""
    pitch = curve([(0, f_start), (0.35 * dur, f_peak), (dur, f_end)])
    vibd = curve([(0, 0.0), (0.30 * dur, 0.5), (0.55 * dur, 3.2), (dur, 1.8)])
    freq = lambda t: pitch(t) + vibd(t) * math.sin(TWO_PI * 5.3 * t)
    idx = curve([(0, 1.0), (0.15 * dur, 3.4), (0.6 * dur, 2.7), (dur, 1.1)])
    raw = fm_osc(freq, 1.0, idx, dur)
    bright = fm_osc(freq, 2.0, lambda t: 0.5 * idx(t), dur)
    src = [a + 0.35 * b for a, b in zip(raw, bright)]

    f1 = lowpass(src, curve([(0, 110.0), (0.30 * dur, 340.0), (dur, 190.0)]))
    hi = lowpass(src, curve([(0, 700.0), (0.35 * dur, 1150.0), (dur, 650.0)]))
    lo = lowpass(src, curve([(0, 380.0), (0.35 * dur, 640.0), (dur, 360.0)]))
    f2 = [h - l for h, l in zip(hi, lo)]
    voice = [1.0 * a + 1.5 * b for a, b in zip(f1, f2)]

    env = curve([(0, 0.0), (0.06, 0.55), (0.35 * dur, 1.0),
                 (0.75 * dur, 0.85), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Tiny breath at the onset (the 'm' hum has a soft noisy edge).
    breath = lowpass(noise(0.12), 700.0)
    breath = apply_env(breath, exp_env(0.05, attack=0.01))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, breath, g=0.05)
    out = soft_clip(out, 1.6)              # a little throaty growl
    return normalize(fade(out, 0.004, 0.04))


def make_abduct():
    """0.6 s rising sparkle: pentatonic up-run of sine pings + noise shimmer."""
    dur = 0.6
    out = zeros(dur)
    run = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5]  # C maj pentatonic up
    for k, f in enumerate(run):
        mix_at(out, ping(f, dur=0.18, tau=0.05, harm=0.4, g=1.0 - 0.06 * k),
               offset=0.085 * k)
    shimmer = lowpass(noise(dur), 4500.0)
    shimmer = apply_env(shimmer, curve([(0, 0.0), (0.4, 0.6), (0.5, 1.0), (dur, 0.0)]))
    mix_at(out, shimmer, g=0.07)
    return normalize(fade(out))


def make_golden():
    """1.0 s rich major chime: staggered bell notes on a C-major stack."""
    dur = 1.0
    out = zeros(dur)
    notes = [(523.25, 0.00, 1.00), (659.25, 0.06, 0.80),
             (783.99, 0.12, 0.70), (1046.5, 0.18, 0.62)]
    for f, off, g in notes:
        mix_at(out, bell(f, dur - off, g=g), offset=off)
    # Sparkle dusting on top.
    for off, f in [(0.30, 2093.0), (0.42, 2637.0), (0.55, 3135.9)]:
        mix_at(out, ping(f, dur=0.18, tau=0.035, g=0.16), offset=off)
    return normalize(fade(out, 0.002, 0.05))


def make_chicken():
    """0.35 s cluck: noise tick + two quick square blips with pitch drops."""
    dur = 0.35
    out = zeros(dur)
    tick = lowpass(noise(0.012), 4000.0)
    mix_at(out, apply_env(tick, exp_env(0.004, attack=0.0005)), g=0.55)
    b1 = tone(0, 0.10, kind='square', cutoff=2600.0, a=0.004, r=0.05,
              bend=[(0, 950.0), (0.04, 880.0), (0.10, 620.0)])
    b2 = tone(0, 0.13, kind='square', cutoff=2400.0, a=0.005, r=0.06,
              bend=[(0, 800.0), (0.05, 740.0), (0.13, 470.0)])
    mix_at(out, b1, offset=0.015, g=0.9)
    mix_at(out, b2, offset=0.16, g=0.8)
    return normalize(fade(out))


def make_gunshot():
    """0.4 s shot: sharp noise burst (lowpass 8000->400) + 120->40 Hz body thump."""
    dur = 0.4
    crack = lowpass(noise(dur), xsweep(8000.0, 400.0, 0.30))
    crack = apply_env(crack, exp_env(0.07, attack=0.0008))
    thump = osc('sine', xsweep(120.0, 40.0, 0.15), dur, amp=exp_env(0.07, attack=0.002))
    snap = apply_env(noise(0.006), exp_env(0.002, attack=0.0003))  # full-band edge
    out = zeros(dur)
    mix_at(out, crack)
    mix_at(out, thump, g=0.9)
    mix_at(out, snap, g=0.8)
    out = soft_clip(out, 1.8)              # compressed punch
    return normalize(fade(out, 0.0008, 0.05))


def make_hit():
    """0.3 s metallic clank: detuned inharmonic partials, fast decay, noise tick."""
    dur = 0.3
    out = zeros(dur)
    partials = [(800.0, 1.00, 0.085), (807.0, 0.70, 0.085), (1130.0, 0.80, 0.060),
                (1467.0, 0.60, 0.045), (2210.0, 0.35, 0.030), (3050.0, 0.20, 0.022)]
    for f, g, tau in partials:
        mix_at(out, osc('sine', f, dur, amp=exp_env(tau, attack=0.0008, amp=g)))
    tick = lowpass(noise(0.010), 6000.0)
    mix_at(out, apply_env(tick, exp_env(0.003, attack=0.0004)), g=0.7)
    return normalize(fade(out, 0.0008, 0.04))


def make_explosion():
    """1.4 s boom: noise rumble (lowpass 3000->80) + 60->25 Hz sub + tail crackle."""
    dur = 1.4
    rumble = lowpass(noise(dur), xsweep(3000.0, 80.0, 1.0))
    rumble = apply_env(rumble, curve([(0, 0.0), (0.008, 1.0), (0.25, 0.85),
                                      (0.8, 0.35), (dur, 0.0)]))
    sub = osc('sine', xsweep(60.0, 25.0, 0.8), dur, amp=exp_env(0.5, attack=0.004))
    out = zeros(dur)
    mix_at(out, rumble)
    mix_at(out, sub, g=0.85)
    # Crackle: random short noise ticks scattered through the tail, fading out.
    for _ in range(16):
        off = random.uniform(0.18, 1.25)
        tk = lowpass(noise(random.uniform(0.012, 0.03)), random.uniform(900.0, 3500.0))
        tk = apply_env(tk, exp_env(0.008, attack=0.0006))
        mix_at(out, tk, offset=off, g=0.5 * (1.0 - off / dur) * random.uniform(0.5, 1.0))
    out = soft_clip(out, 1.5)
    return normalize(fade(out, 0.001, 0.08))


def make_tick():
    """0.1 s woodblock blip: 1200 Hz sine, near-instant decay."""
    dur = 0.1
    out = zeros(dur)
    mix_at(out, osc('sine', curve([(0, 1200.0), (dur, 1080.0)]), dur,
                    amp=exp_env(0.016, attack=0.0008)))
    tk = lowpass(noise(0.004), 5000.0)
    mix_at(out, apply_env(tk, exp_env(0.0015, attack=0.0003)), g=0.25)
    return normalize(fade(out, 0.0008, 0.015))


def make_combo():
    """0.35 s fast 3-note rising arp, bright square+sine mix."""
    dur = 0.35
    out = zeros(dur)
    notes = [523.25, 659.25, 783.99]  # C5 E5 G5
    for k, f in enumerate(notes):
        sq = tone(f, 0.16, kind='square', cutoff=4500.0, a=0.003, r=0.09, g=0.5)
        sp = ping(f * 2.0, dur=0.16, tau=0.05, g=0.45)
        seg = [a + b for a, b in zip(sq, sp)]
        mix_at(out, seg, offset=0.09 * k, g=1.0 + 0.12 * k)  # brighter each step
    return normalize(fade(out))


def make_click():
    """0.06 s soft UI tick."""
    dur = 0.06
    out = zeros(dur)
    mix_at(out, osc('sine', 1700.0, dur, amp=exp_env(0.010, attack=0.0008)))
    tk = lowpass(noise(0.003), 5500.0)
    mix_at(out, apply_env(tk, exp_env(0.0012, attack=0.0003)), g=0.2)
    out = lowpass(out, 6000.0)  # keep it soft
    return normalize(fade(out, 0.0008, 0.01), peak=PEAK * 0.8)


def make_start():
    """~1.5 s upbeat fanfare: square lead + sine bass, ends on a bright major chord."""
    dur = 1.5
    out = zeros(dur)
    lead = [(0.00, 392.00, 0.13), (0.14, 523.25, 0.13), (0.28, 659.25, 0.13),
            (0.42, 783.99, 0.28)]                                   # G4 C5 E5 G5
    for off, f, d in lead:
        mix_at(out, tone(f, d, kind='square', cutoff=5000.0, g=0.55), offset=off)
    for f, g in [(523.25, 0.55), (659.25, 0.45), (783.99, 0.42), (1046.5, 0.38)]:
        mix_at(out, tone(f, 0.72, kind='square', cutoff=5500.0, r=0.25, g=g,
                         vib=0.004, vibr=6.0), offset=0.75)         # final C chord
    mix_at(out, tone(130.81, 0.40, kind='sine', a=0.006, r=0.08, g=0.8), offset=0.00)
    mix_at(out, tone(98.00, 0.30, kind='sine', a=0.006, r=0.08, g=0.8), offset=0.42)
    mix_at(out, tone(65.41, 0.72, kind='sine', a=0.006, r=0.20, g=0.9), offset=0.75)
    for k, f in enumerate([2093.0, 2637.0, 3135.9]):                 # chord sparkle
        mix_at(out, ping(f, dur=0.2, tau=0.04, g=0.14), offset=0.80 + 0.07 * k)
    return normalize(fade(out, 0.003, 0.06))


def make_win():
    """~3 s victory jingle: I-IV-V-I melody + sine bass + sparkle topping."""
    dur = 3.0
    out = zeros(dur)
    mel = [(0.00, 659.25, 0.17), (0.20, 783.99, 0.17), (0.40, 1046.5, 0.34),  # I
           (0.80, 698.46, 0.17), (1.00, 880.00, 0.17), (1.20, 1046.5, 0.34),  # IV
           (1.60, 783.99, 0.17), (1.80, 987.77, 0.17), (2.00, 1174.7, 0.30)]  # V
    for off, f, d in mel:
        mix_at(out, tone(f, d, kind='square', cutoff=5200.0, g=0.50), offset=off)
    for f, g in [(1046.5, 0.50), (1318.5, 0.42), (1568.0, 0.40)]:    # final I chord
        mix_at(out, tone(f, 0.62, kind='square', cutoff=5800.0, r=0.22, g=g,
                         vib=0.005, vibr=6.0), offset=2.35)
    bass = [(0.00, 130.81, 0.72), (0.80, 174.61, 0.72),
            (1.60, 196.00, 0.70), (2.35, 130.81, 0.62)]
    for off, f, d in bass:
        mix_at(out, tone(f, d, kind='sine', a=0.006, r=0.12, g=0.85), offset=off)
        mix_at(out, tone(f / 2.0, d, kind='sine', a=0.006, r=0.12, g=0.4), offset=off)
    spark = [(2.40, 2093.0), (2.50, 2349.3), (2.60, 2637.0), (2.74, 3135.9)]
    for off, f in spark:
        mix_at(out, ping(f, dur=0.2, tau=0.04, g=0.15), offset=off)
    return normalize(fade(out, 0.003, 0.08))


def make_lose():
    """~2.5 s sad-trombone descent: saw lead, slow vibrato, minor resolve."""
    dur = 2.5
    out = zeros(dur)
    steps = [(0.00, 329.63, 0.46, 0.004), (0.50, 293.66, 0.46, 0.006),
             (1.00, 261.63, 0.46, 0.008)]                            # E4 D4 C4
    for off, f, d, v in steps:
        x = tone(f, d, kind='saw', cutoff=2200.0, a=0.015, r=0.10, g=0.8,
                 vib=v, vibr=4.5)
        mix_at(out, x, offset=off)
    # Final note: B3 sagging down to A3, vibrato deepening ("waaah...").
    bendf = curve([(0, 246.94), (0.25, 235.0), (0.9, 220.0), (1.0, 220.0)])
    f_final = lambda t: bendf(t) * (1.0 + min(0.018, 0.004 + 0.014 * t) * math.sin(TWO_PI * 4.2 * t))
    x = osc('saw', f_final, 1.0)
    x = lowpass(x, 2000.0)
    x = apply_env(x, curve([(0, 0.0), (0.02, 1.0), (0.75, 0.9), (1.0, 0.0)]))
    mix_at(out, x, offset=1.50, g=0.85)
    # Soft A-minor resolve underneath the final note.
    for f, g in [(110.0, 0.55), (220.0, 0.30), (261.63, 0.22), (329.63, 0.20)]:
        mix_at(out, tone(f, 0.95, kind='sine', a=0.05, r=0.30, g=g), offset=1.55)
    return normalize(fade(out, 0.004, 0.10))


# ---------------------------------------------------------------------------
# Music: the MOO-FO theme
# ---------------------------------------------------------------------------
#
# Key:   C major (with the relative A-minor pull of the vi chord).
# Tempo: 120 BPM  ->  beat = 0.5 s, bar (4/4) = 2.0 s, eighth = 0.25 s.
# Form:  8 bars = 16.0 s — an exact, beat-aligned seamless loop.
# Harmony: the evergreen, singable  I - V - vi - IV  =  C - G - Am - F
#          played twice across the 8 bars.
#
# THE HOOK ("the MOO-FO motif"), C-major pentatonic, lands on the down-beats so
# players hum it.  Read it as: up the triad, skip to the high note, bounce back.
#   Bar1 (C):  G4  C5   E5 . G5 ---   "moo-oo-foo!"   (rising answer)
#   Bar2 (G):  D5  B4   G4 . A4 ---   (settles, leaves the line hanging)
#   Bar3 (Am): C5  E5   A5 . G5 ---   (the big lift — highest point)
#   Bar4 (F):  F5  E5 . C5 . D5 . C5  (curls back down, ready to repeat)
# The 2nd four bars re-use the same motif with small tail variations so it
# resolves cleanly back onto bar-1's G4 at the loop seam.

BPM = 120.0
BEAT = 60.0 / BPM          # 0.5 s
BAR = 4.0 * BEAT           # 2.0 s
N8 = BEAT / 2.0            # eighth note = 0.25 s
MUSIC_BARS = 8
MUSIC_DUR = MUSIC_BARS * BAR   # 16.0 s

# Equal-tempered note table (Hz), enough range for melody + bass.
_NOTE_BASE = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4,
              'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}


def nf(name):
    """Note name like 'C4','G5','A#3' -> frequency in Hz (A4 = 440)."""
    octave = int(name[-1])
    semis = _NOTE_BASE[name[:-1]] + (octave - 4) * 12
    return 440.0 * (2.0 ** (semis / 12.0))


def seq(out, events, voice):
    """Place a melodic line. events = [(beat, note_or_None, beats, *opts)].
    `voice(freq, dur, *opts)` renders one note; None note = rest."""
    for ev in events:
        beat, note, beats = ev[0], ev[1], ev[2]
        if note is None:
            continue
        seg = voice(nf(note), beats * BEAT, *ev[3:])
        mix_at(out, seg, offset=beat * BEAT)


def kick(dur=0.16, g=1.0):
    """Punchy synth kick: pitch-dropping sine + click transient."""
    body = osc('sine', xsweep(150.0, 48.0, 0.10), dur, amp=exp_env(0.07, attack=0.001))
    click = lowpass(noise(0.008), 3000.0)
    click = apply_env(click, exp_env(0.003, attack=0.0003))
    out = zeros(dur)
    mix_at(out, body)
    mix_at(out, click, g=0.35)
    return gain(fade(soft_clip(out, 1.4), 0.0006, 0.02), g)


def snare(dur=0.14, g=1.0):
    """Noise-body snare with a little tonal snap."""
    body = lowpass(noise(dur), 6500.0)
    body = apply_env(body, exp_env(0.045, attack=0.0006))
    tone200 = osc('triangle', 190.0, dur, amp=exp_env(0.03, attack=0.0008))
    out = zeros(dur)
    mix_at(out, body)
    mix_at(out, tone200, g=0.4)
    return gain(fade(out, 0.0006, 0.02), g)


def hat(dur=0.05, g=1.0, bright=8000.0):
    """Closed hi-hat: high filtered-noise tick."""
    h = noise(dur)
    h = [s - l for s, l in zip(h, lowpass(h, bright))]  # crude high-pass
    h = apply_env(h, exp_env(0.012, attack=0.0003))
    return gain(fade(h, 0.0004, 0.012), g)


def loop_xfade(out, dur, label, tail=0.18):
    """Make `out` (length dur + tail seconds) seamlessly loopable: crossfade the
    extra `tail` seconds back over the start, then trim to exactly dur.
    Robust for dense musical content where finish_loop's hard equality is hard
    to hit. Reports the resulting seam delta for transparency."""
    n = nsamp(dur)
    nt = min(nsamp(tail), len(out) - n)
    for i in range(nt):
        w = (i + 1) / (nt + 1)            # 0..1 ramp, weight of the tail
        out[i] = out[i] * (1.0 - w) + out[n + i] * w
    out = out[:n]
    # Wrap delta after the crossfade (compare last sample's neighbour to first).
    delta = abs(out[-1] - out[0])
    print(f"  [loop-xfade {label}] len={dur:.2f}s  seam delta~{delta:.2e}")
    return out


# --- drum patterns (beat positions within the 8-bar loop) -------------------

def _drums_play(out, g=1.0):
    """Steady, light arcade pulse: four-on-the-floor kick, backbeat snare,
    off-beat hats. Beats are absolute (0..32 across 8 bars of 4 beats)."""
    for bar in range(MUSIC_BARS):
        b0 = bar * 4
        mix_at(out, kick(g=0.9 * g), offset=(b0 + 0) * BEAT)
        mix_at(out, kick(g=0.7 * g), offset=(b0 + 2) * BEAT)
        mix_at(out, snare(g=0.55 * g), offset=(b0 + 1) * BEAT)
        mix_at(out, snare(g=0.55 * g), offset=(b0 + 3) * BEAT)
        for e in range(8):  # eighth-note hats, accent the off-beats
            gg = (0.30 if e % 2 else 0.16) * g
            mix_at(out, hat(g=gg), offset=(b0 * BEAT) + e * N8)


def _drums_chase(out, g=1.0):
    """Tension layer percussion: driving 16th-note hats + extra kicks/toms
    to raise urgency. Same grid as _drums_play so they phase-lock."""
    for bar in range(MUSIC_BARS):
        b0 = bar * 4
        # extra syncopated kicks
        mix_at(out, kick(dur=0.13, g=0.6 * g), offset=(b0 + 0.5) * BEAT)
        mix_at(out, kick(dur=0.13, g=0.5 * g), offset=(b0 + 2.75) * BEAT)
        # urgent 16th hats
        for s in range(16):
            gg = (0.22 if s % 2 else 0.12) * g
            mix_at(out, hat(dur=0.04, g=gg, bright=9000.0),
                   offset=(b0 * BEAT) + s * (N8 / 2.0))


# --- the recurring chord bed -----------------------------------------------

# I - V - vi - IV in C, two passes.  (root, [chord-tone notes for the pad])
_PROG = [
    ('C',  ['C3', 'E3', 'G3', 'C4']),   # I   (C major)
    ('G',  ['G2', 'B2', 'D3', 'G3']),   # V   (G major)
    ('Am', ['A2', 'C3', 'E3', 'A3']),   # vi  (A minor)
    ('F',  ['F2', 'A2', 'C3', 'F3']),   # IV  (F major)
]


def _chord_bed(out, g=1.0, kind='triangle', cutoff=2200.0):
    """Soft sustained chord pad — one chord per bar across the 8-bar form."""
    for bar in range(MUSIC_BARS):
        _, notes = _PROG[bar % 4]
        for j, nm in enumerate(notes):
            v = tone(nf(nm), BAR * 0.98, kind=kind, cutoff=cutoff,
                     a=0.04, r=0.22, g=(0.34 if j == 0 else 0.24) * g,
                     vib=0.003, vibr=4.5)
            mix_at(out, v, offset=bar * BAR)


# Bouncy bass line: root on beat 1, octave-up bounce on the 'and', a fifth
# pickup into the next bar.  Bright but short so it grooves.
_BASS = [  # (note, beat-in-bar, beats)
    [('C2', 0, 1.0), ('C3', 1.5, 0.5), ('C2', 2, 1.0), ('G2', 3.5, 0.5)],
    [('G1', 0, 1.0), ('G2', 1.5, 0.5), ('G1', 2, 1.0), ('B1', 3.5, 0.5)],
    [('A1', 0, 1.0), ('A2', 1.5, 0.5), ('A1', 2, 1.0), ('C2', 3.5, 0.5)],
    [('F1', 0, 1.0), ('F2', 1.5, 0.5), ('F1', 2, 1.0), ('G1', 3.5, 0.5)],
]


def _bass_line(out, g=1.0, cutoff=900.0):
    for bar in range(MUSIC_BARS):
        for nm, b, beats in _BASS[bar % 4]:
            v = tone(nf(nm), beats * BEAT, kind='square', cutoff=cutoff,
                     a=0.006, r=0.06, g=0.7 * g)
            # add a sub-sine octave-down for weight
            sub = tone(nf(nm) / 2.0, beats * BEAT, kind='sine',
                       a=0.006, r=0.06, g=0.35 * g)
            mix_at(out, v, offset=bar * BAR + b * BEAT)
            mix_at(out, sub, offset=bar * BAR + b * BEAT)


# THE MOTIF — the catchy lead, written as (beat-from-loop-start, note, beats).
# First 4 bars (beats 0..15) = statement; last 4 bars = answer that lands the
# line back on bar-1's first note across the loop seam.
def _motif_events():
    e = []
    # Bar 1 (C):  G4  C5  E5 . G5            "moo-oo-foo!"
    e += [(0.0, 'G4', 1.0), (1.0, 'C5', 1.0), (2.0, 'E5', 0.75), (3.0, 'G5', 1.0)]
    # Bar 2 (G):  D5  B4  G4 . A4
    e += [(4.0, 'D5', 1.0), (5.0, 'B4', 1.0), (6.0, 'G4', 0.75), (7.0, 'A4', 1.0)]
    # Bar 3 (Am): C5  E5  A5 . G5            (the lift)
    e += [(8.0, 'C5', 1.0), (9.0, 'E5', 1.0), (10.0, 'A5', 0.75), (11.0, 'G5', 1.0)]
    # Bar 4 (F):  F5  E5 . C5 . D5 . C5      (curl down)
    e += [(12.0, 'F5', 0.75), (13.0, 'E5', 0.75), (13.75, 'C5', 0.75),
          (14.5, 'D5', 0.5), (15.0, 'C5', 1.0)]
    # Bars 5-8: repeat motif, with a small variation in the final bar so the
    # last note (G4) leads cleanly back into bar-1's G4 at the seam.
    e += [(16.0, 'G4', 1.0), (17.0, 'C5', 1.0), (18.0, 'E5', 0.75), (19.0, 'G5', 1.0)]
    e += [(20.0, 'D5', 1.0), (21.0, 'B4', 1.0), (22.0, 'G4', 0.75), (23.0, 'A4', 1.0)]
    e += [(24.0, 'C5', 1.0), (25.0, 'E5', 1.0), (26.0, 'A5', 0.75), (27.0, 'G5', 1.0)]
    # answer cadence: F5 E5 D5 G4  -> resolves down to the dominant-ish G4 pickup
    e += [(28.0, 'F5', 0.75), (29.0, 'E5', 0.75), (30.0, 'D5', 1.0), (31.0, 'G4', 1.0)]
    return e


def _lead_voice(freq, dur, kind='square', cutoff=4200.0, g=0.55):
    """Bright, playful lead note: square + a sine octave 'whistle' on top."""
    sq = tone(freq, dur, kind=kind, cutoff=cutoff, a=0.006, r=0.07, g=g,
              vib=0.004, vibr=5.5)
    whistle = tone(freq * 2.0, dur, kind='sine', a=0.01, r=0.07, g=0.18)
    return [a + b for a, b in zip(sq, whistle)]


def make_music_title():
    """The full iconic MOO-FO theme: lead motif over bouncy bass + chord bed +
    light kit, with a sparkle counter-melody.  16 s, seamless."""
    tail = 0.30
    de = MUSIC_DUR + tail
    out = zeros(de)
    _chord_bed(out, g=1.0, kind='triangle', cutoff=2000.0)
    _bass_line(out, g=1.0, cutoff=950.0)
    _drums_play(out, g=0.85)
    # The lead motif, full strength.
    seq(out, _motif_events(), _lead_voice)
    # Twinkle counter-melody: soft bell pings tracing the top of each bar.
    for bar in range(MUSIC_BARS):
        root = _PROG[bar % 4][1][-1]            # top chord tone of the bar
        mix_at(out, ping(nf(root) * 2.0, dur=0.5, tau=0.16, harm=0.4, g=0.18),
               offset=bar * BAR + 0.5 * BEAT)
    out = soft_clip(out, 1.1)
    out = normalize(out, peak=PEAK * 0.95)
    return loop_xfade(out, MUSIC_DUR, 'music_title', tail=tail)


def make_music_play():
    """Gameplay groove: SAME motif & harmony, lighter mix so it doesn't fatigue.
    Lead is softer/rounder, drums steady but gentle.  16 s, seamless, and in
    the SAME key/tempo/length as music_chase for phase-lock."""
    tail = 0.30
    de = MUSIC_DUR + tail
    out = zeros(de)
    _chord_bed(out, g=0.7, kind='triangle', cutoff=1700.0)
    _bass_line(out, g=0.85, cutoff=850.0)
    _drums_play(out, g=0.6)
    # Lead: quieter, rounder (triangle) so it sits back during play.
    seq(out, _motif_events(),
        lambda f, d: _lead_voice(f, d, kind='triangle', cutoff=2600.0, g=0.34))
    out = soft_clip(out, 1.05)
    out = normalize(out, peak=PEAK * 0.82)
    return loop_xfade(out, MUSIC_DUR, 'music_play', tail=tail)


def make_music_chase():
    """Tension LAYER designed to play SIMULTANEOUSLY on top of music_play.
    Same key (C), tempo (120), and 16 s length => phase-locked.  Adds urgent
    16th-note percussion, a syncopated saw bassline doubling the harmony, and a
    minor-flavoured arpeggio that ratchets the pressure.  No lead melody (the
    base track keeps the tune)."""
    tail = 0.30
    de = MUSIC_DUR + tail
    out = zeros(de)
    _drums_chase(out, g=0.9)
    # Driving saw 'pulse' bass: 8th notes on the chord root, gritty.
    for bar in range(MUSIC_BARS):
        root = _PROG[bar % 4][1][0]
        for e in range(8):
            v = tone(nf(root), N8 * 0.9, kind='saw', cutoff=1100.0,
                     a=0.004, r=0.04, g=0.30)
            mix_at(out, v, offset=bar * BAR + e * N8)
    # Tense arpeggio: fast triplet-ish run up each chord (adds the 'oh no' rush).
    for bar in range(MUSIC_BARS):
        notes = _PROG[bar % 4][1]
        arp = [notes[1], notes[2], notes[3], notes[2]]  # mid->top->mid
        for k in range(8):
            nm = arp[k % len(arp)]
            v = tone(nf(nm) * 2.0, N8 * 0.8, kind='square', cutoff=3800.0,
                     a=0.003, r=0.05, g=0.16)
            mix_at(out, v, offset=bar * BAR + k * N8)
    out = soft_clip(out, 1.1)
    out = normalize(out, peak=PEAK * 0.80)
    return loop_xfade(out, MUSIC_DUR, 'music_chase', tail=tail)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SOUNDS = [
    ('ufo_hum',   make_ufo_hum),
    ('beam',      make_beam),
    ('warp',      make_warp),
    ('moo1',      lambda: make_moo(80.0, 93.0, 62.0, 1.0)),
    ('moo2',      lambda: make_moo(95.0, 108.0, 72.0, 0.75)),
    ('moo3',      lambda: make_moo(70.0, 82.0, 54.0, 1.1)),
    ('abduct',    make_abduct),
    ('golden',    make_golden),
    ('chicken',   make_chicken),
    ('gunshot',   make_gunshot),
    ('hit',       make_hit),
    ('explosion', make_explosion),
    ('tick',      make_tick),
    ('combo',     make_combo),
    ('click',     make_click),
    ('start',     make_start),
    ('win',       make_win),
    ('lose',      make_lose),
    ('music_title', make_music_title),
    ('music_play',  make_music_play),
    ('music_chase', make_music_chase),
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"MOO-FO audio synth -> {OUT_DIR}  ({SR} Hz / 16-bit / mono)")
    for name, builder in SOUNDS:
        write_wav(name, builder())
    print(f"Done: {len(SOUNDS)} files.")


if __name__ == '__main__':
    main()
