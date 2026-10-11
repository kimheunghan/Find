import os, wave, subprocess, imageio_ffmpeg
B = os.path.dirname(os.path.abspath(__file__)); VO = os.path.join(B, "voice"); OUT = os.path.join(B, "out")
PAD = [1.3, 0.8, 2.2, 0.9, 1.1, 0.9, 1.0, 0.9, 0.9, 0.9, 2.0]
durs = []
for i in range(11):
    with wave.open(os.path.join(VO, f"n{i + 1:02d}.wav")) as w: durs.append(w.getnframes() / w.getframerate() + PAD[i])
ff = imageio_ffmpeg.get_ffmpeg_exe()
inputs, vf, off = ["-i", os.path.join(OUT, "lofi.wav")], [], 0.0
for i, d in enumerate(durs):
    inputs += ["-i", os.path.join(VO, f"n{i + 1:02d}.wav")]
    ms = int((off + 0.35) * 1000); vf.append(f"[{i + 2}:a]aresample=44100,adelay={ms}|{ms},volume=1.6[a{i}]"); off += d
voice = "".join(f"[a{i}]" for i in range(11)) + "amix=inputs=11:normalize=0:duration=longest,asplit=2[v1][v2]"
# 말할 때는 음악을 자동으로 낮춤 (덕킹)
music = "[1:a]volume=0.32[m0];[m0][v1]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[m]"
mix = "[m][v2]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[aout]"
final = os.path.join(OUT, "findinside_shorts_features_lofi.mp4")
r = subprocess.run([ff, "-y", "-i", os.path.join(OUT, "video.mp4"), *inputs, "-filter_complex", ";".join(vf) + ";" + voice + ";" + music + ";" + mix,
                    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{sum(durs):.2f}", final], capture_output=True, text=True)
print(r.returncode, r.stderr[-300:] if r.returncode else "", os.path.getsize(final) // 1024, "KB")
