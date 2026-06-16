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


def make_jingle():
    """~2.0 s iconic 'MOO-FO' boot sting for the title screen. A punchy
    ascending arpeggio/fanfare (square lead + sine bass) with a little UFO
    shimmer on top. NON-looping: fades out cleanly at the end."""
    dur = 2.0
    out = zeros(dur)
    # Punchy ascending arpeggio: C major up-run that lands on a bright high G.
    arp = [(0.00, 523.25, 0.16), (0.13, 659.25, 0.16), (0.26, 783.99, 0.16),
           (0.39, 1046.5, 0.20), (0.55, 1318.5, 0.34)]            # C5 E5 G5 C6 E6
    for off, f, d in arp:
        lead = tone(f, d, kind='square', cutoff=5200.0, a=0.004, r=0.07,
                    g=0.55, vib=0.004, vibr=6.0)
        spark = ping(f * 2.0, dur=d, tau=0.05, g=0.22)
        seg = [a + b for a, b in zip(lead, spark)]
        mix_at(out, seg, offset=off)
    # Final bright major chord stab to cap the fanfare.
    for f, g in [(1046.5, 0.50), (1318.5, 0.42), (1568.0, 0.40), (2093.0, 0.30)]:
        mix_at(out, tone(f, 0.85, kind='square', cutoff=5800.0, r=0.30, g=g,
                         vib=0.005, vibr=6.0), offset=0.95)         # C major
    # Sine bass thump under the run + the final chord.
    mix_at(out, tone(130.81, 0.40, kind='sine', a=0.006, r=0.10, g=0.85), offset=0.00)
    mix_at(out, tone(196.00, 0.30, kind='sine', a=0.006, r=0.08, g=0.75), offset=0.39)
    mix_at(out, tone(65.41, 0.95, kind='sine', a=0.006, r=0.30, g=0.9), offset=0.95)
    # A little UFO shimmer: high vibrato sine swelling under the tail.
    shimmer = osc('sine', lambda t: 2637.0 + 18.0 * math.sin(TWO_PI * 6.0 * t),
                  1.0, amp=lambda t: 0.10 * math.sin(math.pi * min(t / 1.0, 1.0)) ** 2)
    mix_at(out, shimmer, offset=1.0)
    # Chord-top sparkle dusting.
    for k, f in enumerate([2093.0, 2637.0, 3135.9]):
        mix_at(out, ping(f, dur=0.22, tau=0.045, g=0.15), offset=1.05 + 0.07 * k)
    out = soft_clip(out, 1.1)
    return normalize(fade(out, 0.003, 0.10))


def make_ufo_buy():
    """~0.55 s UFO PURCHASE confirm: deep/chunky/mechanical 'ka-CHUNK' + coins.
    A heavy two-stage clunk (drawer slam) with a couple of low coin-ish dings and
    a rising confirmation interval, so it reads as 'you just bought a whole ship'.
    Lower & beefier than beam_buy."""
    dur = 0.55
    out = zeros(dur)
    # Mechanical 'ka-CHUNK': two filtered-noise clunks (register/drawer) with a
    # low body thump under each — chunky, deep, satisfying.
    for off, c0, c1, glen, gt in [(0.00, 2600.0, 500.0, 0.05, 0.018),
                                   (0.10, 1900.0, 350.0, 0.07, 0.026)]:
        clunk = lowpass(noise(glen), xsweep(c0, c1, glen * 0.6))
        clunk = apply_env(clunk, exp_env(gt, attack=0.0008))
        mix_at(out, clunk, offset=off, g=0.7)
        body = osc('sine', xsweep(150.0, 70.0, 0.10), 0.16, amp=exp_env(0.05, attack=0.002))
        mix_at(out, body, offset=off, g=0.85)
    # Coin-ish confirmation dings: low, metallic, two notes resolving upward
    # (a satisfying "bought it" cadence). Slightly inharmonic for a coin clink.
    for off, f, g in [(0.20, 392.00, 0.55), (0.34, 587.33, 0.60)]:  # G4 -> D5
        ding = osc('sine', f, 0.26, amp=exp_env(0.10, attack=0.001))
        ding2 = osc('sine', f * 2.02, 0.26, amp=exp_env(0.05, attack=0.001))   # coin shimmer
        seg = [a + 0.4 * b for a, b in zip(ding, ding2)]
        mix_at(out, seg, offset=off, g=g)
    out = soft_clip(out, 1.3)               # chunky mechanical compression
    return normalize(fade(out, 0.001, 0.05))


def make_ufo_equip():
    """~0.4 s UFO EQUIP: quick mechanical power-up / 'system online' whir.
    A short rising motor whir (filtered saw sweeping up) that thunks into a solid
    low 'engaged' tone — feels like a ship system powering on. Lower/chunkier than
    beam_equip."""
    dur = 0.4
    out = zeros(dur)
    # Rising motor whir: a saw swept up through an opening lowpass (the spin-up).
    whir = osc('saw', xsweep(110.0, 360.0, 0.26), 0.30)
    whir = lowpass(whir, xsweep(700.0, 2600.0, 0.26))
    whir = apply_env(whir, curve([(0, 0.0), (0.02, 0.7), (0.22, 1.0), (0.30, 0.5)]))
    mix_at(out, whir, g=0.55)
    # A little servo flutter on top (fast tremolo) for the mechanical character.
    n = nsamp(0.30)
    for i in range(n):
        t = i / SR
        out[i] *= 1.0 - 0.25 * (0.5 + 0.5 * math.sin(TWO_PI * 30.0 * t))
    # 'Engaged' thunk: a solid low square tone that snaps on at the end = online.
    engage = tone(174.61, 0.18, kind='square', cutoff=1800.0, a=0.003, r=0.07, g=0.8)  # F3
    mix_at(out, engage, offset=0.26, g=0.85)
    sub = osc('sine', xsweep(120.0, 90.0, 0.1), 0.16, amp=exp_env(0.06, attack=0.003))
    mix_at(out, sub, offset=0.26, g=0.7)
    out = soft_clip(out, 1.3)
    return normalize(fade(out, 0.002, 0.04))


def make_beam_buy():
    """~0.5 s BEAM PURCHASE confirm: brighter/airier/higher 'cha-ching' than the
    UFO buy. A crisp register tick then two sparkly coin pings resolving upward,
    with an airy shimmer — a beam, so it's shiny and light, not chunky."""
    dur = 0.5
    out = zeros(dur)
    # Crisp bright register tick (high, short, airy).
    tick = lowpass(noise(0.03), xsweep(7000.0, 2500.0, 0.02))
    tick = apply_env(tick, exp_env(0.012, attack=0.0005))
    mix_at(out, tick, g=0.45)
    # Sparkly coin pings: high sine pings with a 2nd-harmonic sparkle, resolving up.
    for off, f, g in [(0.04, 1046.5, 0.7), (0.18, 1396.9, 0.75)]:  # C6 -> F6
        mix_at(out, ping(f, dur=0.30, tau=0.07, harm=0.5, g=g), offset=off)
    # Airy shimmer swell tying it together (high filtered noise, bell-windowed).
    shimmer = lowpass(noise(dur), 6000.0)
    shimmer = apply_env(shimmer, curve([(0, 0.0), (0.18, 0.5), (0.30, 1.0),
                                        (0.45, 0.4), (dur, 0.0)]))
    mix_at(out, shimmer, g=0.08)
    return normalize(fade(out, 0.001, 0.05), peak=PEAK * 0.9)


def make_beam_equip():
    """~0.45 s BEAM EQUIP: shimmery energize / charge-up sweep — airy and RISING.
    A high sine that sweeps upward, a bright filtered-noise 'energize' whoosh that
    rises with it, and a sparkle ping at the top as the beam comes online. High &
    shiny (vs the chunky UFO equip)."""
    dur = 0.45
    out = zeros(dur)
    # Rising energize tone: high sine sweeping up with a faint detuned shadow.
    riser = osc('sine', xsweep(440.0, 1760.0, 0.38), dur,
                amp=curve([(0, 0.0), (0.05, 0.5), (0.34, 0.9), (0.40, 0.6), (dur, 0.0)]))
    riser2 = osc('sine', xsweep(660.0, 2640.0, 0.38), dur,   # shimmering 5th above
                 amp=curve([(0, 0.0), (0.08, 0.25), (0.36, 0.45), (dur, 0.0)]))
    mix_at(out, riser, g=0.55)
    mix_at(out, riser2, g=0.4)
    # Airy 'charge-up' whoosh: noise through a lowpass sweeping wide open (rising).
    whoosh = lowpass(noise(dur), xsweep(800.0, 7000.0, 0.40))
    whoosh = apply_env(whoosh, curve([(0, 0.0), (0.06, 0.3), (0.34, 0.9),
                                      (0.40, 0.6), (dur, 0.0)]))
    mix_at(out, whoosh, g=0.16)
    # Sparkle 'online' ping right at the top of the sweep.
    mix_at(out, ping(2349.3, dur=0.18, tau=0.05, harm=0.5, g=0.5), offset=0.34)  # D7
    return normalize(fade(out, 0.002, 0.05), peak=PEAK * 0.9)


def make_waterfall():
    """~2.8 s SEAMLESS LOOP of falling-water rush: a filtered white-noise bed
    plus a little bubbling. Positional proximity loop near a waterfall. Built
    periodically (every modulator is an integer cycle count over the loop) so
    finish_loop wraps cleanly."""
    dur = 2.8
    de = dur + 1.0 / SR  # one extra sample for the loop check
    # White-noise rush bed: noise through a slowly wobbling lowpass. The cutoff
    # LFOs use integer cycle counts over `dur` so the filtered bed stays
    # periodic; the noise envelope is windowed to zero at both edges so the
    # aperiodic source can never break the seam.
    bed = noise(de)
    bed = lowpass(bed, lambda t: 1600.0 + 600.0 * math.sin(TWO_PI * (1.0 / dur) * t))
    # crude high-pass to add airy "hiss" of the spray (subtract a low band).
    low = lowpass(bed, 350.0)
    rush = [b - 0.6 * l for b, l in zip(bed, low)]
    rush = apply_env(rush, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * t / dur)))
    out = zeros(de)
    mix_at(out, rush, g=0.85)
    # Steady deep churn underneath: filtered noise with a slow swell (2 cycles).
    churn = lowpass(noise(de), lambda t: 500.0 + 250.0 * math.sin(TWO_PI * (2.0 / dur) * t))
    churn = apply_env(churn, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * 2.0 * t / dur)))
    mix_at(out, churn, g=0.30)
    # Bubbling: short sine "bloops" with quick pitch drops, each amplitude-
    # windowed (sin^2) to zero at its edges so any placement stays loop-safe.
    blo = [(0.18, 360.0), (0.55, 300.0), (0.92, 420.0), (1.30, 280.0),
           (1.68, 390.0), (2.05, 330.0), (2.42, 450.0)]
    for off, f in blo:
        bl = 0.30
        seg = osc('sine', curve([(0, f), (bl, f * 0.7)]), bl,
                  amp=lambda t, L=bl: 0.18 * math.sin(math.pi * t / L) ** 2)
        mix_at(out, seg, offset=off)
    out = soft_clip(out, 1.1)
    out = normalize(out, peak=PEAK * 0.9)
    return finish_loop(out, dur, 'waterfall')


def make_waves():
    """~3.6 s SEAMLESS LOOP of ocean surf: filtered-noise beds with broad, slow
    amplitude swells so the wash rolls IN and OUT roughly once per ~3.6 s (one
    big wave over the loop), plus a soft hiss of foam riding the crest. Modelled
    on make_waterfall (filtered-noise beds + slow swells) but slower and broader
    so it reads as OCEAN WAVES, not falling water. Built periodically — every
    modulator is an integer cycle count over the loop — so finish_loop wraps
    cleanly."""
    dur = 3.6
    de = dur + 1.0 / SR  # one extra sample for the loop check
    out = zeros(de)

    # The wash: one broad swell over the whole loop (1 cycle). A wide noise bed
    # through a slowly opening/closing lowpass that brightens on the crest, so it
    # surges in then ebbs out. Cosine window keeps the aperiodic noise seamless.
    wash = noise(de)
    wash = lowpass(wash, lambda t: 900.0 + 600.0 * math.sin(TWO_PI * (1.0 / dur) * t))
    # crude high-pass (subtract a low band) so the crest gets an airy surf hiss.
    low = lowpass(wash, 300.0)
    surf = [w - 0.55 * l for w, l in zip(wash, low)]
    # Swell shaping: ramps in, peaks just past the middle, ebbs out — and a
    # cosine edge window so both loop ends sit at zero.
    swell = lambda t: (0.20 + 0.80 * (0.5 - 0.5 * math.cos(TWO_PI * (1.0 / dur) * t))) \
        * (0.5 * (1.0 - math.cos(TWO_PI * t / dur)))
    surf = apply_env(surf, swell)
    mix_at(out, surf, g=0.9)

    # Foam hiss riding the crest: brighter filtered noise that swells with the
    # wave but a touch sharper/later (2 cycles of inner wobble for shimmer).
    foam = lowpass(noise(de), lambda t: 2400.0 + 900.0 * math.sin(TWO_PI * (2.0 / dur) * t))
    foam = apply_env(foam, lambda t: (0.5 - 0.5 * math.cos(TWO_PI * (1.0 / dur) * t)) ** 2
                     * (0.5 * (1.0 - math.cos(TWO_PI * t / dur))))
    mix_at(out, foam, g=0.22)

    # Deep undertow rumble underneath: a low filtered-noise bed with a slow swell
    # (1 cycle), giving the surf a broad rolling body.
    under = lowpass(noise(de), lambda t: 220.0 + 90.0 * math.sin(TWO_PI * (1.0 / dur) * t))
    under = apply_env(under, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * t / dur)))
    mix_at(out, under, g=0.30)

    out = soft_clip(out, 1.05)
    out = normalize(out, peak=PEAK * 0.9)
    return finish_loop(out, dur, 'waves')


# ---------------------------------------------------------------------------
# Beach map one-shots
# ---------------------------------------------------------------------------

def make_seagull():
    """~0.7 s SEAGULL cry: a couple of descending 'eee-ah' gull calls. Each call
    is a bright reedy voice (saw + FM grit) whose pitch flicks UP then glides DOWN
    (the 'eee->ah'), through two vowel-ish formant bands so it reads as a bird
    throat, not a synth tone. Second call a touch higher/shorter."""
    out = zeros(0.72)

    def cry(dur, f0, fhi, fend):
        # Pitch: quick rise to the squeal then a falling 'ah' tail.
        pitch = curve([(0, f0), (0.12 * dur, fhi), (0.45 * dur, fhi * 0.9),
                       (dur, fend)])
        # Reedy gull voice: saw + a buzzy FM layer with a little fold jitter.
        rasp = lambda t: pitch(t) * (1.0 + 0.03 * math.sin(TWO_PI * 24.0 * t))
        src = osc('saw', rasp, dur)
        buzz = fm_osc(rasp, 2.0, 2.4, dur)
        src = [a + 0.4 * b for a, b in zip(src, buzz)]
        # Two formant bands ('eee' -> 'ah'): F1 opens, F2 falls.
        f1hi = lowpass(src, curve([(0, 1000.0), (0.4 * dur, 1200.0), (dur, 850.0)]))
        f1lo = lowpass(src, curve([(0, 600.0), (0.4 * dur, 650.0), (dur, 480.0)]))
        f1 = [h - l for h, l in zip(f1hi, f1lo)]
        f2hi = lowpass(src, curve([(0, 3200.0), (0.4 * dur, 2600.0), (dur, 1900.0)]))
        f2lo = lowpass(src, curve([(0, 2200.0), (0.4 * dur, 1800.0), (dur, 1300.0)]))
        f2 = [h - l for h, l in zip(f2hi, f2lo)]
        voice = [1.0 * a + 1.2 * b for a, b in zip(f1, f2)]
        env = curve([(0, 0.0), (0.04 * dur, 1.0), (0.5 * dur, 0.85),
                     (0.8 * dur, 0.45), (dur, 0.0)])
        voice = apply_env(voice, env)
        voice = soft_clip(voice, 1.5)         # reedy, screechy edge
        return voice

    mix_at(out, cry(0.34, 1400.0, 1900.0, 900.0), offset=0.00, g=1.0)
    mix_at(out, cry(0.30, 1550.0, 2100.0, 1000.0), offset=0.40, g=0.85)
    return normalize(fade(out, 0.003, 0.04))


def make_splash():
    """~0.4 s water SPLASH: a wet low thump (descending sine) + a noisy burst of
    spray that opens bright then closes, with a droplet hiss tail. A short
    filtered-noise body sweeping down = the displaced water, over a low thump."""
    dur = 0.4
    out = zeros(dur)
    # Wet low thump: a fast descending sine = the body of water displaced.
    thump = osc('sine', xsweep(180.0, 60.0, 0.12), dur, amp=exp_env(0.06, attack=0.002))
    mix_at(out, thump, g=0.85)
    # Noisy spray burst: broadband noise through a lowpass that opens then closes,
    # quick percussive envelope = the slap/whoosh of the splash.
    spray = lowpass(noise(dur), curve([(0, 3500.0), (0.04, 6500.0), (0.18, 2500.0),
                                       (dur, 900.0)]))
    spray = apply_env(spray, curve([(0, 0.0), (0.006, 1.0), (0.10, 0.6),
                                    (0.28, 0.2), (dur, 0.0)]))
    mix_at(out, spray, g=0.6)
    # Droplet hiss tail: scattered short high noise ticks = falling droplets.
    for _ in range(7):
        off = random.uniform(0.12, 0.34)
        tk = lowpass(noise(random.uniform(0.006, 0.014)), random.uniform(3500.0, 7000.0))
        tk = apply_env(tk, exp_env(0.006, attack=0.0005))
        mix_at(out, tk, offset=off, g=0.3 * (1.0 - off / dur) * random.uniform(0.5, 1.0))
    out = soft_clip(out, 1.2)
    return normalize(fade(out, 0.0008, 0.05))


def make_squirt():
    """~0.38 s WATER-GUN spray: a short pressurised hiss/spurt. Filtered noise
    pitch-swept (the bandpass centre sweeps up then sags) with a fast tremolo
    sputter on top so it reads as a watery jet, not a flat hiss. The lifeguard
    threat firing."""
    dur = 0.38
    out = zeros(dur)
    # Pressurised jet: noise through a crude bandpass (hi-lp minus mid-lp) whose
    # centre sweeps UP fast (the spurt building pressure) then sags as it eases.
    src = noise(dur)
    hi = lowpass(src, curve([(0, 1600.0), (0.10, 5000.0), (0.22, 3800.0), (dur, 1800.0)]))
    lo = lowpass(src, curve([(0, 700.0), (0.10, 1800.0), (0.22, 1400.0), (dur, 600.0)]))
    jet = [h - l for h, l in zip(hi, lo)]
    env = curve([(0, 0.0), (0.012, 1.0), (0.18, 0.85), (0.30, 0.5), (dur, 0.0)])
    jet = apply_env(jet, env)
    # Watery sputter: a fast amplitude tremolo so the jet spits rather than hisses.
    n = len(jet)
    for i in range(n):
        t = i / SR
        jet[i] *= 1.0 - 0.30 * (0.5 + 0.5 * math.sin(TWO_PI * 55.0 * t))
    mix_at(out, jet, g=0.8)
    # A faint low whoosh under the jet for body.
    whoosh = osc('sine', xsweep(260.0, 160.0, 0.2), dur, amp=exp_env(0.08, attack=0.006))
    mix_at(out, whoosh, g=0.12)
    out = soft_clip(out, 1.15)
    return normalize(fade(out, 0.001, 0.04))


def make_crab():
    """~0.32 s CRAB skitter: a few quick dry clicks/castanet-like ticks. Each
    click is a very short high-passed noise snap plus a tiny resonant sine blip,
    scattered in a tight skittering rhythm."""
    dur = 0.32
    out = zeros(dur)
    # A tight burst of dry clicks at slightly irregular spacing = the skitter.
    offs = [0.00, 0.05, 0.095, 0.155, 0.225, 0.275]
    for k, off in enumerate(offs):
        # Dry click: ultra-short high noise snap (high-passed via subtract-low).
        snap = noise(0.008)
        lo = lowpass(snap, 2000.0)
        click = [s - l for s, l in zip(snap, lo)]
        click = apply_env(click, exp_env(0.0018, attack=0.0002))
        # A tiny resonant 'tick' pitch for the castanet body (varies per click).
        f = 2600.0 + (k % 3) * 350.0
        blip = osc('sine', f, 0.012, amp=exp_env(0.003, attack=0.0003))
        seg = zeros(0.014)
        mix_at(seg, click, g=0.8)
        mix_at(seg, blip, g=0.4)
        mix_at(out, seg, offset=off, g=1.0 - 0.06 * k)
    return normalize(fade(out, 0.0005, 0.02))


def make_dolphin():
    """~0.6 s DOLPHIN whistle: a rising-then-falling pure whistle with a faint
    second harmonic, topped by a couple of quick echolocation clicks. The whistle
    swoops up then back down (the classic dolphin call)."""
    dur = 0.6
    out = zeros(dur)
    # Whistle: a clean sine that swoops UP then DOWN, with a subtle vibrato and a
    # soft second harmonic for a slightly metallic shimmer.
    pitch = curve([(0, 1600.0), (0.30 * dur, 2900.0), (0.55 * dur, 3300.0),
                   (dur, 2000.0)])
    freq = lambda t: pitch(t) * (1.0 + 0.012 * math.sin(TWO_PI * 12.0 * t))
    whistle = osc('sine', freq, dur,
                  amp=curve([(0, 0.0), (0.06, 0.9), (0.7 * dur, 1.0), (dur, 0.0)]))
    harm = osc('sine', lambda t: 2.0 * freq(t), dur,
               amp=curve([(0, 0.0), (0.1, 0.18), (0.7 * dur, 0.22), (dur, 0.0)]))
    mix_at(out, whistle, g=0.7)
    mix_at(out, harm, g=0.7)
    # Echolocation clicks: a couple of very short broadband ticks up front.
    for off in (0.02, 0.07):
        tk = lowpass(noise(0.006), 7000.0)
        tk = apply_env(tk, exp_env(0.0015, attack=0.0003))
        mix_at(out, tk, offset=off, g=0.4)
    return normalize(fade(out, 0.002, 0.05), peak=PEAK * 0.9)


# ---------------------------------------------------------------------------
# Farm animal / machine voices
# ---------------------------------------------------------------------------

def _woof(dur=0.30, base=260.0, top=150.0):
    """A single dog 'WOOF': sharp noisy bark attack + a voiced growl body whose
    pitch glides DOWN fast (the mouth closing on the 'oof'), with a quick decay.

    The growl is an FM voice (rich, buzzy harmonics like vocal-fold rasp) put
    through two parallel formant bands so it reads as an animal MOUTH, not a
    pure tone/bloop:
      F1 band ~ 350->550 Hz  (open 'aw' vowel)   -> shaped by a lowpass that
                                                     opens then closes
      F2 band ~ 1100->1700 Hz (the bright 'w/f' edge that snaps a bark)."""
    # Pitch: tiny up-flick on the attack, then a fast drop -> dog inflection.
    pitch = curve([(0, base * 1.12), (0.03, base), (0.10, base * 0.8),
                   (0.55 * dur, top), (dur, top * 0.78)])
    # Rough vocal-fold rasp: pitch jitter that growls the voice.
    growl = lambda t: pitch(t) * (1.0 + 0.05 * math.sin(TWO_PI * 32.0 * t)
                                  + 0.03 * math.sin(TWO_PI * 51.0 * t))
    # FM index high at the attack (buzzy snarl) easing into the body.
    idx = curve([(0, 5.5), (0.04, 4.2), (0.4 * dur, 2.4), (dur, 1.4)])
    src = fm_osc(growl, 1.0, idx, dur)
    bright = fm_osc(growl, 3.0, lambda t: 0.4 * idx(t), dur)  # extra grit
    src = [a + 0.3 * b for a, b in zip(src, bright)]

    # F1: low formant that opens on the attack and closes through the decay.
    f1 = lowpass(src, curve([(0, 300.0), (0.05, 560.0), (0.4 * dur, 430.0),
                             (dur, 300.0)]))
    # F2: crude bandpass (hi-lp minus mid-lp) for the bright bark 'edge'.
    hi = lowpass(src, curve([(0, 1400.0), (0.06, 1750.0), (dur, 1050.0)]))
    lo = lowpass(src, curve([(0, 800.0), (0.06, 950.0), (dur, 650.0)]))
    f2 = [h - l for h, l in zip(hi, lo)]
    voice = [1.0 * a + 1.35 * b for a, b in zip(f1, f2)]

    # Bark envelope: explosive attack, short sustain, quick fall (percussive).
    env = curve([(0, 0.0), (0.006, 1.0), (0.06, 0.78), (0.45 * dur, 0.55),
                 (0.8 * dur, 0.22), (dur, 0.0)])
    voice = apply_env(voice, env)

    # Sharp noisy onset: filtered noise burst = the consonant 'crack' of a bark.
    crack = lowpass(noise(0.05), xsweep(3500.0, 900.0, 0.04))
    crack = apply_env(crack, exp_env(0.012, attack=0.0008))

    seg = zeros(dur)
    mix_at(seg, voice)
    mix_at(seg, crack, g=0.5)
    seg = soft_clip(seg, 1.7)              # throaty compression / growl
    return seg


def make_bark():
    """Convincing DOG BARK: a quick 'WOOF-woof' (two barks). First is loud and
    open, the second a touch higher/shorter — the natural double-bark rhythm."""
    out = zeros(0.62)
    mix_at(out, _woof(0.30, base=260.0, top=150.0), offset=0.00, g=1.0)
    mix_at(out, _woof(0.26, base=300.0, top=175.0), offset=0.33, g=0.85)
    return normalize(fade(out, 0.0015, 0.03))


def make_baa():
    """SHEEP bleat: 'baa-a-a-a' — a throaty open vowel that drifts down in pitch
    and, crucially, develops a pronounced fast AMPLITUDE warble (tremolo) in the
    tail. That fluttery warble is what makes a bleat read as a sheep rather than
    a generic animal vowel."""
    dur = 0.8
    # Lower, throatier than a lamb; a gentle rise then a downward drift.
    base = curve([(0, 300.0), (0.18 * dur, 322.0), (dur, 246.0)])
    vdep = curve([(0, 0.006), (0.3 * dur, 0.03), (dur, 0.055)])
    freq = lambda t: base(t) * (1.0 + vdep(t) * math.sin(TWO_PI * 7.0 * t))
    # Buzzy reedy larynx (FM) for harmonic body.
    idx = curve([(0, 1.8), (0.1 * dur, 3.2), (dur, 2.4)])
    src = fm_osc(freq, 1.0, idx, dur)
    bright = fm_osc(freq, 2.0, lambda t: 0.45 * idx(t), dur)
    src = [a + 0.45 * b for a, b in zip(src, bright)]
    # Open 'aa' vowel: emphasise a broad mid band (~800-1500 Hz).
    hi = lowpass(src, 1500.0)
    lo = lowpass(src, 800.0)
    vowel = [h - 0.4 * l for h, l in zip(hi, lo)]
    body = lowpass(src, 650.0)
    voice = [0.7 * b + 1.3 * v for b, v in zip(body, vowel)]
    # soft 'b' onset -> open vowel -> fade.
    env = curve([(0, 0.0), (0.03, 0.7), (0.10, 1.0), (0.6 * dur, 0.92),
                 (dur, 0.0)])
    voice = apply_env(voice, env)
    # The bleat FLUTTER: a deep ~18 Hz amplitude tremolo that ramps in over the
    # note so the tail "baa-a-a-a-a"s.
    n = len(voice)
    for i in range(n):
        t = i / SR
        depth = min(0.55, 0.05 + (t / dur) * 0.6)
        voice[i] *= 1.0 - depth * (0.5 + 0.5 * math.sin(TWO_PI * 18.0 * t))
    out = zeros(dur)
    mix_at(out, voice)
    out = soft_clip(out, 1.3)
    return normalize(fade(out, 0.004, 0.04))


def _quack_one(dur=0.13, f0=620.0, f1=420.0):
    """One DUCK quack: a short, buzzy, NASAL honk. A bright saw through a
    bandpass formant with a fast downward pitch drop = the pinched duck timbre."""
    pitch = curve([(0, f0), (0.25 * dur, f0 * 0.95), (dur, f1)])
    src = osc('saw', pitch, dur)
    # Add a buzzy FM layer so it rasps (a duck quack is noisy/reedy).
    src2 = fm_osc(pitch, 1.5, 3.0, dur)
    src = [a + 0.5 * b for a, b in zip(src, src2)]
    # Strong nasal bandpass ~1000-2200 Hz -> the honk's pinched buzz.
    hi = lowpass(src, curve([(0, 2400.0), (dur, 1700.0)]))
    lo = lowpass(src, curve([(0, 1000.0), (dur, 750.0)]))
    voice = [h - l for h, l in zip(hi, lo)]
    env = curve([(0, 0.0), (0.008, 1.0), (0.5 * dur, 0.7), (dur, 0.0)])
    voice = apply_env(voice, env)
    voice = soft_clip(voice, 2.0)          # hard buzz
    return voice


def make_quack():
    """DUCK quack: two quick nasal honks ('quack-quack')."""
    out = zeros(0.40)
    mix_at(out, _quack_one(0.13, 640.0, 430.0), offset=0.00, g=1.0)
    mix_at(out, _quack_one(0.12, 600.0, 410.0), offset=0.18, g=0.9)
    return normalize(fade(out, 0.0015, 0.03))


def make_scream():
    """FARMER yelp/holler: a short cartoonish human 'HEY!' yell. A bright sawtooth
    voice with two vowel formants (so it reads as a human voice, not a synth)
    and a pitch that rises sharply then falls — a startled/angry holler. Kept
    short and snappy so it's comedic, not distressing."""
    dur = 0.45
    # Pitch: leaps up (the 'hey!') then sags off.
    pitch = curve([(0, 220.0), (0.06, 300.0), (0.18, 360.0),
                   (0.30, 330.0), (dur, 230.0)])
    vib = lambda t: pitch(t) * (1.0 + 0.02 * math.sin(TWO_PI * 6.0 * t))
    src = osc('saw', vib, dur)
    src2 = osc('square', vib, dur)
    src = [a + 0.3 * b for a, b in zip(src, src2)]
    # Two-formant 'eh' vowel: F1 ~700 Hz, F2 ~1700 Hz (crude bandpass stacks).
    f1hi = lowpass(src, 820.0)
    f1lo = lowpass(src, 480.0)
    f1 = [h - l for h, l in zip(f1hi, f1lo)]
    f2hi = lowpass(src, 1950.0)
    f2lo = lowpass(src, 1350.0)
    f2 = [h - l for h, l in zip(f2hi, f2lo)]
    voice = [1.2 * a + 1.0 * b for a, b in zip(f1, f2)]
    # 'h' breathy onset + sharp vowel + quick cutoff (the exclamation).
    env = curve([(0, 0.0), (0.02, 0.8), (0.10, 1.0), (0.30, 0.85),
                 (0.40, 0.4), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Breathy 'h' at the very start.
    breath = lowpass(noise(0.05), 2000.0)
    breath = apply_env(breath, exp_env(0.02, attack=0.004))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, breath, g=0.12)
    out = soft_clip(out, 1.5)
    return normalize(fade(out, 0.003, 0.04))


def make_tractor():
    """Looping diesel TRACTOR ENGINE idle: a low chugging 'putt-putt-putt'. Built
    as a seamless loop — an integer number (8) of firing pulses over the loop,
    plus a periodic low rumble bed, so finish_loop wraps cleanly. Used as a
    positional engine loop via startLoop/setLoopVolume/stopLoop."""
    dur = 2.0
    de = dur + 1.0 / SR
    cyl = 8                      # 8 firing strokes over 2 s = 4 Hz chug (idle)
    period = dur / cyl
    out = zeros(de)

    # Engine firing pulses: each 'putt' is a short low thump (fast sine pop +
    # filtered-noise diesel knock). Placed on the grid so the pattern is exactly
    # periodic over the loop.
    for k in range(cyl):
        off = k * period
        # Alternate strokes a touch in level/pitch -> uneven diesel lope.
        strong = (k % 2 == 0)
        amp = 1.0 if strong else 0.72
        f_hi = 96.0 if strong else 86.0
        thump = osc('sine', curve([(0, f_hi), (0.05, 52.0), (period, 46.0)]),
                    period, amp=exp_env(0.045, attack=0.002, amp=amp))
        # Diesel 'knock': a short mid noise tick, lowpassed, on each fire.
        knock = lowpass(noise(0.06), 1400.0)
        knock = apply_env(knock, exp_env(0.012, attack=0.0008))
        mix_at(out, thump, offset=off)
        mix_at(out, knock, offset=off, g=0.28 if strong else 0.2)

    # Low rumble bed: detuned sines + slowly wobbling filtered noise, all with
    # integer cycle counts over `dur` so the bed stays seamlessly periodic.
    mix_at(out, osc('sine', 41.0, de,
                    amp=lambda t: 0.30 * (1.0 + 0.3 * math.sin(TWO_PI * 2.0 * t))))
    mix_at(out, osc('sine', 82.0, de,
                    amp=lambda t: 0.16 * (1.0 + 0.3 * math.sin(TWO_PI * 4.0 * t + 1.1))))
    rumble = lowpass(noise(de), lambda t: 220.0 + 90.0 * math.sin(TWO_PI * (4.0 / dur) * t))
    rumble = apply_env(rumble, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * 4.0 * t / dur)))
    mix_at(out, rumble, g=0.22)

    out = soft_clip(out, 1.4)              # mechanical compression / grunt
    out = normalize(out, peak=PEAK * 0.9)
    return finish_loop(out, dur, 'tractor')


def make_hoot():
    """Soft OWL hoot: a low, breathy 'hoo-hoo' — two gentle sine pulses (with a
    faint second harmonic for warmth) and a slight downward inflection each."""
    out = zeros(1.0)

    def hoo(dur, f):
        # Sine fundamental with a tiny pitch fall + soft second harmonic.
        pitch = curve([(0, f * 1.04), (0.3 * dur, f), (dur, f * 0.94)])
        body = osc('sine', pitch, dur)
        harm = osc('sine', lambda t: 2.0 * pitch(t), dur)
        x = [a + 0.18 * b for a, b in zip(body, harm)]
        # Breathy bell-shaped swell (the 'hoo' is soft-attack, soft-release).
        env = curve([(0, 0.0), (0.25 * dur, 1.0), (0.6 * dur, 0.85), (dur, 0.0)])
        x = apply_env(x, env)
        # A whisper of breath noise under the tone.
        br = lowpass(noise(dur), 900.0)
        br = apply_env(br, env)
        seg = [a + 0.05 * b for a, b in zip(x, br)]
        return seg

    mix_at(out, hoo(0.34, 340.0), offset=0.05, g=1.0)
    mix_at(out, hoo(0.40, 320.0), offset=0.50, g=0.95)
    return normalize(fade(out, 0.006, 0.05), peak=PEAK * 0.9)


def make_horse():
    """HORSE WHINNY / NEIGH: a descending, fluttering, raspy 'heeeee-he-he-he' —
    a high squeal that breaks into a lower nickering flutter.

    Construction:
      * A voiced FM larynx (rich buzzy harmonics) whose pitch GLIDES DOWN from a
        ~520 Hz squeal to ~180 Hz, with constant vocal-fold jitter so it rasps.
      * A fast amplitude FLUTTER (tremolo) that starts gentle (~20 Hz, shallow)
        and INTENSIFIES through the second half (~28 Hz, deep and choppy) — the
        'he-he-he' nicker break.
      * A breathy filtered-noise layer (nostril air) under the voice.
      * Two vowel-ish formant bands (crude bandpasses) so it reads as an animal
        MOUTH/voice rather than a synth tone."""
    dur = 1.15
    # Pitch: high squeal that falls fast at first, then settles to the low nicker.
    pitch = curve([(0, 520.0), (0.10 * dur, 470.0), (0.40 * dur, 300.0),
                   (0.70 * dur, 210.0), (dur, 180.0)])
    # Vocal-fold rasp: fast pitch jitter (two incommensurate rates) = a horsey buzz.
    jitter = lambda t: (1.0 + 0.040 * math.sin(TWO_PI * 27.0 * t)
                        + 0.025 * math.sin(TWO_PI * 41.0 * t))
    freq = lambda t: pitch(t) * jitter(t)
    # FM index high during the bright squeal, easing into the body.
    idx = curve([(0, 4.2), (0.15 * dur, 3.6), (0.55 * dur, 2.6), (dur, 1.8)])
    raw = fm_osc(freq, 1.0, idx, dur)
    bright = fm_osc(freq, 2.0, lambda t: 0.5 * idx(t), dur)   # extra harmonic grit
    src = [a + 0.40 * b for a, b in zip(raw, bright)]

    # F1: low formant band (~500->750 Hz), opens on the squeal then closes.
    f1hi = lowpass(src, curve([(0, 800.0), (0.3 * dur, 760.0), (dur, 520.0)]))
    f1lo = lowpass(src, curve([(0, 360.0), (0.3 * dur, 420.0), (dur, 300.0)]))
    f1 = [h - l for h, l in zip(f1hi, f1lo)]
    # F2: brighter band (~1400->2200 Hz) that gives the squeal its 'eee' edge.
    f2hi = lowpass(src, curve([(0, 2400.0), (0.3 * dur, 2100.0), (dur, 1500.0)]))
    f2lo = lowpass(src, curve([(0, 1500.0), (0.3 * dur, 1300.0), (dur, 950.0)]))
    f2 = [h - l for h, l in zip(f2hi, f2lo)]
    voice = [1.0 * a + 1.3 * b for a, b in zip(f1, f2)]

    # Overall envelope: quick squeal onset, full body, fades through the nicker.
    env = curve([(0, 0.0), (0.03, 0.85), (0.12 * dur, 1.0),
                 (0.55 * dur, 0.92), (0.85 * dur, 0.55), (dur, 0.0)])
    voice = apply_env(voice, env)

    # The whinny FLUTTER: amplitude tremolo whose rate and depth RAMP UP in the
    # second half so the tail breaks into a choppy 'he-he-he-he' nicker.
    n = len(voice)
    fph = 0.0                                   # tremolo phase (accumulated)
    for i in range(n):
        t = i / SR
        u = t / dur
        rate = 19.0 + 11.0 * u                  # ~19 Hz -> ~30 Hz, accelerating
        depth = min(0.85, 0.12 + (u ** 1.6) * 0.9)   # shallow -> deep & choppy
        voice[i] *= 1.0 - depth * (0.5 + 0.5 * math.sin(fph))
        fph += TWO_PI * rate / SR

    # Breathy nostril air under the voice (more present at the start of the call).
    breath = lowpass(noise(dur), 1800.0)
    breath = apply_env(breath, curve([(0, 0.0), (0.04, 1.0), (0.4 * dur, 0.55),
                                      (dur, 0.0)]))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, breath, g=0.10)
    out = soft_clip(out, 1.5)                   # raspy, throaty buzz
    return normalize(fade(out, 0.004, 0.05))


def make_farmer():
    """Gruff male FARMER SHOUT: a deliberate angry holler — 'HEY! GIT OFF MY
    LAND!'. A low, chesty male voice (vs the higher cartoon 'scream' yelp): a
    rich buzzy larynx (FM + saw grit) at a LOW pitch with vocal-fold rasp, run
    through two vowel formants so it reads as a human mouth. A noisy fricative
    consonant ONSET ('G/H' burst) snaps it open, then a short shouted vowel body
    with a falling-but-emphatic pitch contour. Deliberately throaty/compressed
    and lower than 'scream' so it's clearly a man bellowing, not a screech."""
    dur = 0.6
    # Pitch: a hard accented onset up around the 'HEY', then a gruff fall on the
    # body — a man's bellow sits low (~150 Hz fundamental), not a yelp.
    pitch = curve([(0, 150.0), (0.04, 175.0), (0.12, 188.0),
                   (0.28, 168.0), (0.42, 150.0), (dur, 128.0)])
    # Vocal-fold rasp: low-rate jitter so the shout sounds chesty and rough.
    rasp = lambda t: pitch(t) * (1.0 + 0.035 * math.sin(TWO_PI * 23.0 * t)
                                 + 0.02 * math.sin(TWO_PI * 37.0 * t))
    # Buzzy larynx: FM fundamental + a saw layer for harsh shouting overtones.
    idx = curve([(0, 4.6), (0.05, 3.8), (0.4 * dur, 2.8), (dur, 1.8)])
    voiced = fm_osc(rasp, 1.0, idx, dur)
    bright = fm_osc(rasp, 2.0, lambda t: 0.5 * idx(t), dur)
    grit = osc('saw', rasp, dur)
    src = [a + 0.35 * b + 0.3 * c for a, b, c in zip(voiced, bright, grit)]
    # Two-formant open shout vowel ('AH/EH'): F1 ~650 Hz, F2 ~1500 Hz, opening on
    # the vowel then closing as the mouth shuts on 'LAND'.
    f1hi = lowpass(src, curve([(0, 600.0), (0.18, 760.0), (dur, 560.0)]))
    f1lo = lowpass(src, curve([(0, 380.0), (0.18, 440.0), (dur, 340.0)]))
    f1 = [h - l for h, l in zip(f1hi, f1lo)]
    f2hi = lowpass(src, curve([(0, 1700.0), (0.18, 1850.0), (dur, 1350.0)]))
    f2lo = lowpass(src, curve([(0, 1150.0), (0.18, 1250.0), (dur, 1000.0)]))
    f2 = [h - l for h, l in zip(f2hi, f2lo)]
    voice = [1.3 * a + 0.9 * b for a, b in zip(f1, f2)]
    # Shout envelope: a hard, percussive accent on the onset then a held vowel
    # that's cut off firmly (the bark of an angry command).
    env = curve([(0, 0.0), (0.012, 1.0), (0.06, 0.82), (0.22, 0.95),
                 (0.45, 0.7), (0.52, 0.4), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Noisy consonant ONSET: a short filtered-noise burst = the 'G/H' fricative
    # crack that kicks off the holler.
    crack = lowpass(noise(0.06), xsweep(3200.0, 800.0, 0.05))
    crack = apply_env(crack, exp_env(0.018, attack=0.001))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, crack, g=0.4)
    out = soft_clip(out, 1.7)               # throaty, compressed bellow
    return normalize(fade(out, 0.002, 0.05))


def make_oink():
    """Short pig OINK/grunt: a couple of quick low, nasal, buzzy grunt pulses.
    Each grunt is a buzzy larynx (FM + saw) at a low pitch with a fast downward
    flick, pushed through a strong NASAL bandpass (~700-1500 Hz) and hard soft-
    clipped so it snorts. Two quick pulses = the 'oink-oink' snuffle."""
    out = zeros(0.42)

    def grunt(dur, f0, f1):
        # Low pitch with a quick downward flick (the snorted 'oink').
        pitch = curve([(0, f0), (0.3 * dur, f0 * 0.92), (dur, f1)])
        # Buzzy nasal larynx with a touch of fold jitter for the wet snort.
        rasp = lambda t: pitch(t) * (1.0 + 0.04 * math.sin(TWO_PI * 30.0 * t))
        src = fm_osc(rasp, 1.5, 3.0, dur)
        grit = osc('saw', rasp, dur)
        src = [a + 0.4 * b for a, b in zip(src, grit)]
        # Strong nasal bandpass (~700-1500 Hz) = the pinched, buzzy pig timbre.
        hi = lowpass(src, curve([(0, 1600.0), (dur, 1200.0)]))
        lo = lowpass(src, curve([(0, 700.0), (dur, 560.0)]))
        voice = [h - l for h, l in zip(hi, lo)]
        env = curve([(0, 0.0), (0.01, 1.0), (0.5 * dur, 0.8), (dur, 0.0)])
        voice = apply_env(voice, env)
        # Wet snuffle: a little nasal noise under each grunt.
        snort = lowpass(noise(dur), 1300.0)
        snort = apply_env(snort, env)
        seg = [a + 0.12 * b for a, b in zip(voice, snort)]
        seg = soft_clip(seg, 2.0)           # hard buzzy snort
        return seg

    mix_at(out, grunt(0.17, 230.0, 150.0), offset=0.00, g=1.0)
    mix_at(out, grunt(0.16, 250.0, 160.0), offset=0.22, g=0.85)
    return normalize(fade(out, 0.0015, 0.03))


# ---------------------------------------------------------------------------
# Savannah map voices / machines
# ---------------------------------------------------------------------------

def make_lion():
    """LION ROAR: a deep, powerful growl. A very low voiced fundamental (~85->110
    ->75 Hz) with a heavy vocal-fold rasp (slow jitter = the chesty rumble) run
    through a buzzy FM larynx and two low formant bands so it reads as a huge
    animal throat. The roar BUILDS — amplitude swells up to a sustained bellow
    then falls away — with a turbulent breath/grit layer for the rough edge."""
    dur = 1.15
    # Pitch: a low rise into the roar then a sag as it dies away.
    pitch = curve([(0, 85.0), (0.18 * dur, 110.0), (0.55 * dur, 100.0),
                   (0.85 * dur, 88.0), (dur, 72.0)])
    # Heavy vocal-fold rasp: two slow incommensurate jitters = a chesty rumble.
    rasp = lambda t: pitch(t) * (1.0 + 0.05 * math.sin(TWO_PI * 18.0 * t)
                                 + 0.03 * math.sin(TWO_PI * 29.0 * t))
    # Buzzy larynx: a low FM fundamental + a brighter FM layer + saw grit.
    idx = curve([(0, 2.4), (0.2 * dur, 4.4), (0.6 * dur, 3.6), (dur, 2.2)])
    voiced = fm_osc(rasp, 1.0, idx, dur)
    bright = fm_osc(rasp, 2.0, lambda t: 0.5 * idx(t), dur)
    grit = osc('saw', rasp, dur)
    src = [a + 0.4 * b + 0.25 * c for a, b, c in zip(voiced, bright, grit)]
    # F1: a low formant (~250->480 Hz) that opens as the mouth widens on the roar.
    f1hi = lowpass(src, curve([(0, 300.0), (0.4 * dur, 520.0), (dur, 320.0)]))
    f1lo = lowpass(src, curve([(0, 150.0), (0.4 * dur, 230.0), (dur, 160.0)]))
    f1 = [h - l for h, l in zip(f1hi, f1lo)]
    # F2: a rough mid band (~800->1300 Hz) for the snarl edge of the roar.
    f2hi = lowpass(src, curve([(0, 900.0), (0.4 * dur, 1400.0), (dur, 900.0)]))
    f2lo = lowpass(src, curve([(0, 600.0), (0.4 * dur, 850.0), (dur, 600.0)]))
    f2 = [h - l for h, l in zip(f2hi, f2lo)]
    voice = [1.4 * a + 0.9 * b for a, b in zip(f1, f2)]
    # The roar SWELLS in, sustains a powerful bellow, then falls away.
    env = curve([(0, 0.0), (0.10 * dur, 0.55), (0.35 * dur, 1.0),
                 (0.65 * dur, 0.95), (0.85 * dur, 0.6), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Turbulent breath/grit riding the roar = the rough, building rasp.
    breath = lowpass(noise(dur), curve([(0, 700.0), (0.4 * dur, 1300.0), (dur, 600.0)]))
    breath = apply_env(breath, curve([(0, 0.0), (0.2 * dur, 0.7), (0.55 * dur, 1.0),
                                      (0.85 * dur, 0.5), (dur, 0.0)]))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, breath, g=0.18)
    out = soft_clip(out, 1.8)               # huge throaty compression / grunt
    return normalize(fade(out, 0.004, 0.06))


def make_elephant():
    """ELEPHANT TRUMPET: a brassy rising blare. A buzzy mid tone (saw + FM grit)
    that sweeps UP sharply then breaks off at the top — the classic trumpeting
    blast. A strong mid bandpass gives it a reedy/brassy honk, and a noisy
    rasp on top adds the air-forced 'blare' edge."""
    dur = 0.85
    # Pitch: a fast brassy sweep UP, peaking near the break, then a tiny crack down.
    pitch = curve([(0, 300.0), (0.10, 440.0), (0.45, 720.0), (0.58, 780.0),
                   (0.66, 700.0), (dur, 520.0)])
    rasp = lambda t: pitch(t) * (1.0 + 0.03 * math.sin(TWO_PI * 22.0 * t))
    # Brassy buzzy source: a saw + a buzzy FM layer = harsh trumpeting overtones.
    src = osc('saw', rasp, dur)
    buzz = fm_osc(rasp, 1.0, curve([(0, 2.0), (0.45, 4.2), (dur, 2.6)]), dur)
    src = [a + 0.5 * b for a, b in zip(src, buzz)]
    # Strong brassy mid bandpass (~900->1600 Hz) sweeping up with the pitch.
    hi = lowpass(src, curve([(0, 1100.0), (0.5, 2000.0), (dur, 1400.0)]))
    lo = lowpass(src, curve([(0, 650.0), (0.5, 1100.0), (dur, 800.0)]))
    voice = [h - l for h, l in zip(hi, lo)]
    # Blare envelope: builds as the pitch sweeps up, holds the blast, breaks off.
    env = curve([(0, 0.0), (0.04, 0.6), (0.40, 1.0), (0.60, 0.95),
                 (0.70, 0.55), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Air-forced rasp on top = the breathy edge of the trumpet.
    air = lowpass(noise(dur), curve([(0, 1500.0), (0.5, 2600.0), (dur, 1600.0)]))
    air = apply_env(air, curve([(0, 0.0), (0.1, 0.5), (0.5, 1.0), (0.66, 0.5),
                                (dur, 0.0)]))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, air, g=0.14)
    out = soft_clip(out, 1.7)               # brassy honk compression
    return normalize(fade(out, 0.003, 0.05))


def make_flamingo():
    """FLAMINGO / wading-bird HONK: a couple of nasal goose-like honks. Each honk
    is a buzzy reedy voice (saw + FM) pushed through a strong nasal bandpass so it
    reads as a pinched, honking squawk, with a quick downward pitch flick."""
    out = zeros(0.55)

    def honk(dur, f0, f1):
        # Nasal pitch with a quick downward flick = the goose-honk inflection.
        pitch = curve([(0, f0), (0.2 * dur, f0 * 1.02), (dur, f1)])
        rasp = lambda t: pitch(t) * (1.0 + 0.025 * math.sin(TWO_PI * 26.0 * t))
        # Buzzy reedy source.
        src = osc('saw', rasp, dur)
        buzz = fm_osc(rasp, 1.5, 3.2, dur)
        src = [a + 0.5 * b for a, b in zip(src, buzz)]
        # Strong nasal bandpass (~900-2000 Hz) = the honking squawk.
        hi = lowpass(src, curve([(0, 2100.0), (dur, 1600.0)]))
        lo = lowpass(src, curve([(0, 900.0), (dur, 700.0)]))
        voice = [h - l for h, l in zip(hi, lo)]
        env = curve([(0, 0.0), (0.01, 1.0), (0.5 * dur, 0.75), (dur, 0.0)])
        voice = apply_env(voice, env)
        voice = soft_clip(voice, 1.9)       # hard nasal buzz
        return voice

    mix_at(out, honk(0.20, 540.0, 380.0), offset=0.00, g=1.0)
    mix_at(out, honk(0.18, 500.0, 360.0), offset=0.27, g=0.85)
    return normalize(fade(out, 0.0015, 0.03))


def make_croc():
    """CROCODILE hiss + low growl: a guttural low rumble under a noisy hiss. A
    very low buzzy growl (FM larynx with heavy rasp) sits beneath a broadband
    hiss (bandpassed noise) that swells in — the warning hiss of a basking croc."""
    dur = 0.6
    out = zeros(dur)
    # Guttural low growl: a very low buzzy larynx with a heavy slow rasp.
    pitch = curve([(0, 70.0), (0.4 * dur, 78.0), (dur, 62.0)])
    rasp = lambda t: pitch(t) * (1.0 + 0.06 * math.sin(TWO_PI * 24.0 * t)
                                 + 0.04 * math.sin(TWO_PI * 13.0 * t))
    growl = fm_osc(rasp, 1.0, curve([(0, 2.6), (0.4 * dur, 3.4), (dur, 2.2)]), dur)
    grit = osc('saw', rasp, dur)
    src = [a + 0.3 * b for a, b in zip(growl, grit)]
    src = lowpass(src, 500.0)               # keep the growl low and chesty
    genv = curve([(0, 0.0), (0.04, 0.8), (0.4 * dur, 1.0), (0.8 * dur, 0.7),
                  (dur, 0.0)])
    src = apply_env(src, genv)
    mix_at(out, src, g=0.85)
    # Noisy hiss: broadband noise through a crude bandpass that swells in then out.
    hiss = noise(dur)
    hi = lowpass(hiss, 5500.0)
    lo = lowpass(hiss, 1600.0)
    hiss = [h - l for h, l in zip(hi, lo)]
    hiss = apply_env(hiss, curve([(0, 0.0), (0.10, 0.5), (0.45, 1.0), (0.7, 0.8),
                                  (dur, 0.0)]))
    mix_at(out, hiss, g=0.4)
    out = soft_clip(out, 1.5)               # throaty compression
    return normalize(fade(out, 0.003, 0.05))


def make_vulture():
    """VULTURE SCREECH/cackle: a harsh, scratchy raspy bird shriek. A bright reedy
    voice (saw + buzzy FM) with a heavy rasp and a falling pitch, through two
    upper formant bands so it's all harsh edge, plus a scratchy noise rasp riding
    on top for the dry, raspy cackle."""
    dur = 0.5
    # Pitch: a harsh shriek that flicks up then falls (the scratchy screech).
    pitch = curve([(0, 1300.0), (0.10, 1800.0), (0.30, 1600.0), (dur, 1000.0)])
    # Heavy fast rasp = the scratchy, broken edge of a vulture's cackle.
    rasp = lambda t: pitch(t) * (1.0 + 0.06 * math.sin(TWO_PI * 33.0 * t)
                                 + 0.04 * math.sin(TWO_PI * 47.0 * t))
    src = osc('saw', rasp, dur)
    buzz = fm_osc(rasp, 2.0, 3.5, dur)
    src = [a + 0.6 * b for a, b in zip(src, buzz)]
    # Two upper formant bands so it's all harsh treble screech.
    f1hi = lowpass(src, curve([(0, 2600.0), (0.3, 2400.0), (dur, 1700.0)]))
    f1lo = lowpass(src, curve([(0, 1600.0), (0.3, 1500.0), (dur, 1100.0)]))
    f1 = [h - l for h, l in zip(f1hi, f1lo)]
    f2hi = lowpass(src, curve([(0, 4200.0), (0.3, 3800.0), (dur, 2800.0)]))
    f2lo = lowpass(src, curve([(0, 3000.0), (0.3, 2700.0), (dur, 2000.0)]))
    f2 = [h - l for h, l in zip(f2hi, f2lo)]
    voice = [1.0 * a + 1.2 * b for a, b in zip(f1, f2)]
    env = curve([(0, 0.0), (0.012, 1.0), (0.35, 0.8), (0.6, 0.5), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Scratchy noise rasp riding on top = the dry, raspy cackle.
    scratch = lowpass(noise(dur), curve([(0, 3500.0), (0.3, 4500.0), (dur, 2500.0)]))
    n = len(scratch)
    for i in range(n):                       # fast tremolo = a scratchy chatter
        t = i / SR
        scratch[i] *= 1.0 - 0.5 * (0.5 + 0.5 * math.sin(TWO_PI * 60.0 * t))
    scratch = apply_env(scratch, env)
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, scratch, g=0.22)
    out = soft_clip(out, 1.9)               # harsh, broken-up screech
    return normalize(fade(out, 0.002, 0.04))


def make_ranger():
    """RANGER SHOUT: a gruff male 'OI!' holler. In the spirit of 'farmer' (a low
    chesty male voice) but its own take — a single sharp barked command. A buzzy
    low larynx (FM + saw grit) with vocal-fold rasp through two vowel formants,
    a noisy consonant ONSET, and a pitch that punches up on the 'OI' then drops."""
    dur = 0.55
    # Pitch: a hard accented onset (the 'OI') then a firm gruff fall.
    pitch = curve([(0, 140.0), (0.05, 185.0), (0.16, 200.0), (0.32, 172.0),
                   (dur, 132.0)])
    rasp = lambda t: pitch(t) * (1.0 + 0.035 * math.sin(TWO_PI * 25.0 * t)
                                 + 0.02 * math.sin(TWO_PI * 39.0 * t))
    idx = curve([(0, 4.4), (0.05, 3.6), (0.4 * dur, 2.6), (dur, 1.7)])
    voiced = fm_osc(rasp, 1.0, idx, dur)
    bright = fm_osc(rasp, 2.0, lambda t: 0.5 * idx(t), dur)
    grit = osc('saw', rasp, dur)
    src = [a + 0.35 * b + 0.3 * c for a, b, c in zip(voiced, bright, grit)]
    # Two-formant 'OI' vowel: F1 ~600 Hz (the 'aw') gliding to F2 ~2000 Hz ('ee').
    f1hi = lowpass(src, curve([(0, 700.0), (0.18, 640.0), (dur, 520.0)]))
    f1lo = lowpass(src, curve([(0, 420.0), (0.18, 380.0), (dur, 320.0)]))
    f1 = [h - l for h, l in zip(f1hi, f1lo)]
    f2hi = lowpass(src, curve([(0, 1500.0), (0.18, 2200.0), (dur, 2300.0)]))
    f2lo = lowpass(src, curve([(0, 1050.0), (0.18, 1600.0), (dur, 1700.0)]))
    f2 = [h - l for h, l in zip(f2hi, f2lo)]
    voice = [1.2 * a + 1.0 * b for a, b in zip(f1, f2)]
    # Shout envelope: a hard percussive accent then a held vowel cut off firmly.
    env = curve([(0, 0.0), (0.012, 1.0), (0.06, 0.85), (0.24, 0.92),
                 (0.40, 0.65), (0.48, 0.4), (dur, 0.0)])
    voice = apply_env(voice, env)
    # Noisy consonant ONSET: a short filtered-noise burst kicks off the holler.
    crack = lowpass(noise(0.05), xsweep(3000.0, 800.0, 0.04))
    crack = apply_env(crack, exp_env(0.016, attack=0.001))
    out = zeros(dur)
    mix_at(out, voice)
    mix_at(out, crack, g=0.38)
    out = soft_clip(out, 1.7)               # throaty, compressed bellow
    return normalize(fade(out, 0.002, 0.05))


def make_jeep():
    """Looping 4x4 JEEP ENGINE idle: a low chugging motor rumble, a bit higher and
    rougher than the diesel tractor. Built as a seamless loop — an integer number
    (12) of firing pulses over the loop, plus a periodic low rumble bed, so
    finish_loop wraps cleanly. Used as a positional engine loop via startLoop."""
    dur = 2.0
    de = dur + 1.0 / SR
    cyl = 12                     # 12 firing strokes over 2 s = 6 Hz chug (rougher/higher)
    period = dur / cyl
    out = zeros(de)

    # Engine firing pulses: each 'chug' is a short low thump (fast sine pop +
    # filtered-noise mechanical knock). Placed on the grid so the pattern is
    # exactly periodic over the loop.
    for k in range(cyl):
        off = k * period
        # Alternate strokes a touch in level/pitch -> uneven rough lope.
        strong = (k % 2 == 0)
        amp = 1.0 if strong else 0.7
        f_hi = 120.0 if strong else 108.0
        thump = osc('sine', curve([(0, f_hi), (0.04, 64.0), (period, 56.0)]),
                    period, amp=exp_env(0.032, attack=0.0018, amp=amp))
        # Mechanical 'knock': a short brighter noise tick on each fire (rougher).
        knock = lowpass(noise(0.05), 1900.0)
        knock = apply_env(knock, exp_env(0.010, attack=0.0007))
        mix_at(out, thump, offset=off)
        mix_at(out, knock, offset=off, g=0.32 if strong else 0.24)

    # Low rumble bed: detuned sines + slowly wobbling filtered noise, all with
    # integer cycle counts over `dur` so the bed stays seamlessly periodic. A
    # touch higher than the tractor's bed.
    mix_at(out, osc('sine', 52.0, de,
                    amp=lambda t: 0.28 * (1.0 + 0.3 * math.sin(TWO_PI * 3.0 * t))))
    mix_at(out, osc('sine', 104.0, de,
                    amp=lambda t: 0.15 * (1.0 + 0.3 * math.sin(TWO_PI * 6.0 * t + 1.1))))
    rumble = lowpass(noise(de), lambda t: 300.0 + 120.0 * math.sin(TWO_PI * (6.0 / dur) * t))
    rumble = apply_env(rumble, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * 6.0 * t / dur)))
    mix_at(out, rumble, g=0.24)

    out = soft_clip(out, 1.45)             # rough mechanical compression / grunt
    out = normalize(out, peak=PEAK * 0.9)
    return finish_loop(out, dur, 'jeep')


def make_dustdevil():
    """Looping DUST DEVIL: a swirling wind/dust howl. Filtered white noise with a
    whooshing swell and a wandering bandpass = the rising-and-falling moan of a
    desert whirlwind. Built periodically (every modulator is an integer cycle
    count over the loop) and edge-windowed so finish_loop wraps cleanly."""
    dur = 2.5
    de = dur + 1.0 / SR  # one extra sample for the loop check
    out = zeros(de)

    # The howl: a wide noise bed through a wandering bandpass whose centre swings
    # up and down (2 cycles over the loop) = the swirling whoosh. A cosine edge
    # window keeps the aperiodic noise seamless at the loop seam.
    bed = noise(de)
    hi = lowpass(bed, lambda t: 1200.0 + 700.0 * math.sin(TWO_PI * (2.0 / dur) * t))
    lo = lowpass(bed, lambda t: 500.0 + 250.0 * math.sin(TWO_PI * (2.0 / dur) * t))
    howl = [h - l for h, l in zip(hi, lo)]
    # Whooshing swell: rises and falls once over the loop (1 cycle), edge-windowed.
    swell = lambda t: (0.4 + 0.6 * (0.5 - 0.5 * math.cos(TWO_PI * (1.0 / dur) * t))) \
        * (0.5 * (1.0 - math.cos(TWO_PI * t / dur)))
    howl = apply_env(howl, swell)
    mix_at(out, howl, g=0.85)

    # Low moaning body underneath: a low filtered-noise bed with a slow swell
    # (1 cycle) giving the whirlwind a broad rolling rumble.
    moan = lowpass(noise(de), lambda t: 280.0 + 120.0 * math.sin(TWO_PI * (1.0 / dur) * t))
    moan = apply_env(moan, lambda t: 0.5 * (1.0 - math.cos(TWO_PI * t / dur)))
    mix_at(out, moan, g=0.35)

    # A faint high whistle of dust shimmer riding the swell (3 cycles of wobble).
    whistle = lowpass(noise(de), lambda t: 3200.0 + 900.0 * math.sin(TWO_PI * (3.0 / dur) * t))
    whistle = apply_env(whistle, lambda t: (0.5 - 0.5 * math.cos(TWO_PI * (1.0 / dur) * t)) ** 2
                        * (0.5 * (1.0 - math.cos(TWO_PI * t / dur))))
    mix_at(out, whistle, g=0.10)

    out = soft_clip(out, 1.1)
    out = normalize(out, peak=PEAK * 0.9)
    return finish_loop(out, dur, 'dustdevil')


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
    ('ufo_buy',   make_ufo_buy),
    ('ufo_equip', make_ufo_equip),
    ('beam_buy',  make_beam_buy),
    ('beam_equip', make_beam_equip),
    ('start',     make_start),
    ('win',       make_win),
    ('lose',      make_lose),
    ('jingle',    make_jingle),
    ('waterfall', make_waterfall),
    ('waves',     make_waves),
    ('seagull',   make_seagull),
    ('splash',    make_splash),
    ('squirt',    make_squirt),
    ('crab',      make_crab),
    ('dolphin',   make_dolphin),
    # 'bark' is a real CC0 dog-bark sample (assets/audio/bark.wav from
    # lavenderdotpet/CC0-Public-Domain-Sounds) — NOT synthesised here, so it is
    # intentionally omitted from this list and left untouched by the generator.
    ('baa',       make_baa),
    ('quack',     make_quack),
    ('scream',    make_scream),
    ('tractor',   make_tractor),
    ('hoot',      make_hoot),
    ('horse',     make_horse),
    ('farmer',    make_farmer),
    ('oink',      make_oink),
    # Savannah map.
    ('lion',      make_lion),
    ('elephant',  make_elephant),
    ('flamingo',  make_flamingo),
    ('croc',      make_croc),
    ('vulture',   make_vulture),
    ('ranger',    make_ranger),
    ('jeep',      make_jeep),       # loopable (finish_loop) -> startLoop
    ('dustdevil', make_dustdevil),  # loopable (finish_loop) -> startLoop
]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"MOO-FO audio synth -> {OUT_DIR}  ({SR} Hz / 16-bit / mono)")
    for name, builder in SOUNDS:
        write_wav(name, builder())
    print(f"Done: {len(SOUNDS)} files.")


if __name__ == '__main__':
    main()
