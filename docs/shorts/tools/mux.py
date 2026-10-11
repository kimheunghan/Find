import os, subprocess, wave, imageio_ffmpeg
B = os.path.dirname(os.path.abspath(__file__)); VO = os.path.join(B, "voice"); OUT = os.path.join(B, "out")
lens = []
for i in range(1, 7):
    with wave.open(os.path.join(VO, f"n{i}.wav")) as w: lens.append(w.getnframes() / w.getframerate())
durs = [l + 0.5 for l in lens]
ff = imageio_ffmpeg.get_ffmpeg_exe()
inputs, filters, off = [], [], 0.0
for i, d in enumerate(durs):
    inputs += ["-i", os.path.join(VO, f"n{i + 1}.wav")]
    ms = int((off + 0.15) * 1000); filters.append(f"[{i + 1}:a]adelay={ms}|{ms}[a{i}]"); off += d
mix = "".join(f"[a{i}]" for i in range(6)) + "amix=inputs=6:normalize=0:duration=longest[aout]"
final = os.path.join(OUT, "findinside_shorts_mail.mp4")
r = subprocess.run([ff, "-y", "-i", os.path.join(OUT, "video.mp4"), *inputs, "-filter_complex", ";".join(filters) + ";" + mix,
                    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-t", f"{sum(durs):.2f}", final], capture_output=True, text=True)
print(r.returncode, r.stderr[-400:] if r.returncode else "")
print(final, os.path.getsize(final) // 1024, "KB")
r = subprocess.run([ff, "-i", final], capture_output=True, text=True); print([l.strip() for l in r.stderr.splitlines() if "Duration" in l or "Stream" in l])
