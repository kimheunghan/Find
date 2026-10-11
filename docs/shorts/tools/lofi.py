# 경쾌한 로파이 비트 합성 (100 BPM, Am7-Fmaj7-C-G), 결과: out/lofi.wav (44.1kHz 스테레오)
import os, sys, wave
import numpy as np

SR = 44100
BPM = 100
BEAT = 60 / BPM
SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 75
N = int(SECS * SR)
rng = np.random.default_rng(7)
L = np.zeros(N); R = np.zeros(N)

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= N: return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * (1 + min(0, pan))

def env(n, a=0.005, d=0.3):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)

def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.9

def snare():
    n = int(0.22 * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n); noise = noise - np.convolve(noise, np.ones(6) / 6, "same")  # 고역만
    return (noise * 0.45 + np.sin(2 * np.pi * 190 * t) * 0.35) * np.exp(-t * 22)

def hat(open_=False):
    n = int((0.12 if open_ else 0.04) * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n); noise = noise - np.convolve(noise, np.ones(3) / 3, "same")
    return noise * np.exp(-t * (25 if open_ else 90)) * 0.18

def note(freq, dur, kind="keys"):
    n = int(dur * SR); t = np.arange(n) / SR
    if kind == "keys":   # 전자 피아노: 짧게 감쇠 + 살짝 떨림
        s = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2 * t) * np.exp(-t * 6)
        s *= env(n, 0.004, 0.45) * (1 + 0.15 * np.sin(2 * np.pi * 4.5 * t))
    elif kind == "bass":
        s = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
        s *= env(n, 0.005, 0.28)
    else:  # pluck 멜로디
        s = np.sign(np.sin(2 * np.pi * freq * t)) * 0.3 + np.sin(2 * np.pi * freq * t)
        s = np.convolve(s, np.ones(8) / 8, "same") * env(n, 0.002, 0.16)
    return s

def hz(m): return 440 * 2 ** ((m - 69) / 12)
CHORDS = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]  # Am7 Fmaj7 Cmaj7 G7
BASS = [45, 41, 36, 43]
MEL = [76, 74, 72, 74, 76, 79, 76, 74]  # 짧은 반복 멜로디 (8분음표)

bars = int(SECS / (4 * BEAT)) + 1
swing = 0.06 * BEAT
for b in range(bars):
    t0 = b * 4 * BEAT; c = b % 4
    intro = b < 1
    for beat in range(4):
        bt = t0 + beat * BEAT
        if not intro:
            if beat in (0, 2): add(kick(), bt, gain=0.9)
            if beat == 2 and b % 2 == 1: add(kick(), bt + BEAT * 0.75, gain=0.6)
            if beat in (1, 3): add(snare(), bt, pan=0.1, gain=0.75)
        for h in range(2):
            add(hat(open_=(h == 1 and beat == 3)), bt + h * BEAT / 2 + (swing if h else 0), pan=-0.3, gain=0.9)
    # 화음: 1박 길게, 2.5박 짧게 끊어서
    for when, dur in ((0, 1.2), (2.5 * BEAT, 0.6)):
        for m in CHORDS[c]:
            add(note(hz(m), dur * 1.0 + 0.3), t0 + when, pan=0.2, gain=0.07)
    if not intro:
        for when in (0, 1.5 * BEAT, 2 * BEAT, 3.5 * BEAT):
            add(note(hz(BASS[c]), 0.5, "bass"), t0 + when, gain=0.32)
    if b >= 4 and (b // 4) % 2 == 1:  # 4마디마다 멜로디 들어갔다 빠졌다
        for k, m in enumerate(MEL):
            add(note(hz(m + (0 if c < 2 else -3)), 0.25, "pluck"), t0 + k * BEAT / 2 + (swing if k % 2 else 0), pan=-0.15, gain=0.09)

# 페이드, 가벼운 로파이 질감(살짝 먹먹하게), 정규화
mix = np.stack([L, R], 1)
mix = np.apply_along_axis(lambda x: np.convolve(x, np.ones(3) / 3, "same"), 0, mix)
t = np.arange(N) / SR
fade = np.minimum(1, np.minimum(t / 1.5, (SECS - t) / 2.5))[:, None]
mix *= np.clip(fade, 0, 1)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.9
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "lofi.wav")
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("lofi", out, round(SECS, 1), "s")
