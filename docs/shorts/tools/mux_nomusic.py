import os, wave, subprocess, imageio_ffmpeg
B = os.path.dirname(os.path.abspath(__file__)); VO = os.path.join(B, "voice"); OUT = os.path.join(B, "out")
PAD = [1.3, 0.8, 2.2, 0.9, 1.1, 0.9, 1.0, 0.9, 0.9, 0.9, 2.0]
durs = []
for i in range(11):
    with wave.open(os.path.join(VO, f"n{i + 1:02d}.wav")) as w: durs.append(w.getnframes() / w.getframerate() + PAD[i])
ff = imageio_ffmpeg.get_ffmpeg_exe(); inputs, filters, off = [], [], 0.0
for i, d in enumerate(durs):
    inputs += ["-i", os.path.join(VO, f"n{i + 1:02d}.wav")]
    ms = int((off + 0.35) * 1000); filters.append(f"[{i + 1}:a]adelay={ms}|{ms},volume=1.6[a{i}]"); off += d
mix = "".join(f"[a{i}]" for i in range(11)) + "amix=inputs=11:normalize=0:duration=longest,alimiter=limit=0.95[aout]"
final = os.path.join(OUT, "findinside_shorts_features_nomusic.mp4")
r = subprocess.run([ff, "-y", "-i", os.path.join(OUT, "video.mp4"), *inputs, "-filter_complex", ";".join(filters) + ";" + mix,
                    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", f"{sum(durs):.2f}", final], capture_output=True, text=True)
print(r.returncode, os.path.getsize(final) // 1024, "KB", round(sum(durs), 1), "s")
