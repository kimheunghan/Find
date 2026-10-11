# FindInside 쇼츠 만들기: 1080x1920, 30fps, 장면별 내레이션 길이에 맞춤
import os, subprocess, wave
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

BASE = os.path.dirname(os.path.abspath(__file__))
FR = os.path.join(BASE, "frames")
VO = os.path.join(BASE, "voice")
OUT = os.path.join(BASE, "out")
os.makedirs(OUT, exist_ok=True)
W, H, FPS = 1080, 1920, 30
BOLD = "C:/Windows/Fonts/malgunbd.ttf"
REG = "C:/Windows/Fonts/malgun.ttf"
BG_TOP, BG_BOT = (14, 20, 48), (36, 22, 84)
ACCENT, YELLOW = (122, 140, 255), (255, 216, 77)

def font(path, size): return ImageFont.truetype(path, size)

def background():
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3)))
    return bg

BG = background()

def wav_len(n):
    with wave.open(os.path.join(VO, f"n{n}.wav")) as w: return w.getnframes() / w.getframerate()

def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for word in text.split(" "):
        test = (cur + " " + word).strip()
        if draw.textlength(test, font=fnt) <= width: cur = test
        else: lines.append(cur); cur = word
    if cur: lines.append(cur)
    return lines

def draw_text_block(img, text, y, size, color=(255, 255, 255), bold=True, width=960, highlight=None, spacing=14):
    d = ImageDraw.Draw(img)
    f = font(BOLD if bold else REG, size)
    for line in text.split("\n"):
        for sub in wrap(d, line, f, width):
            tw = d.textlength(sub, font=f)
            x = (W - tw) / 2
            if highlight and highlight in sub:
                pre, post = sub.split(highlight, 1)
                d.text((x, y), pre, font=f, fill=color); x += d.textlength(pre, font=f)
                d.text((x, y), highlight, font=f, fill=YELLOW); x += d.textlength(highlight, font=f)
                d.text((x, y), post, font=f, fill=color)
            else:
                d.text((x, y), sub, font=f, fill=color)
            y += size + spacing
    return y

def subtitle(img, text):
    # 화면 아래 자막 (내레이션 그대로)
    d = ImageDraw.Draw(img)
    f = font(BOLD, 46)
    lines = wrap(d, text, f, 940)
    h = len(lines) * 64 + 40
    top = H - 330 - h
    box = Image.new("RGBA", (W - 80, h), (0, 0, 0, 150))
    img.paste(box, (40, top), box)
    y = top + 20
    for line in lines:
        tw = d.textlength(line, font=f)
        d.text(((W - tw) / 2, y), line, font=f, fill=(255, 255, 255))
        y += 64

def brand(img):
    d = ImageDraw.Draw(img)
    icon = Image.open(os.path.join(BASE, "icon.png")).convert("RGBA").resize((72, 72), Image.LANCZOS)
    img.paste(icon, (W // 2 - 150, 1760), icon)
    d.text((W // 2 - 64, 1768), "FindInside", font=font(BOLD, 46), fill=(255, 255, 255))

def framed(shot, box, target_w, t, zoom=0.06, focus=(0.5, 0.5)):
    # 캡처에서 box 부분을 잘라 천천히 확대(켄 번스)
    crop = Image.open(os.path.join(FR, shot)).convert("RGB").crop(box)
    s = 1 + zoom * t
    cw, ch = crop.size
    vw, vh = cw / s, ch / s
    x0 = (cw - vw) * focus[0]; y0 = (ch - vh) * focus[1]
    crop = crop.crop((int(x0), int(y0), int(x0 + vw), int(y0 + vh)))
    th = int(target_w * ch / cw)
    return crop.resize((target_w, th), Image.LANCZOS)

def card(img, panel, y):
    # 둥근 모서리 + 그림자
    pw, ph = panel.size
    shadow = Image.new("RGBA", (pw + 60, ph + 60), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((30, 36, pw + 30, ph + 36), 28, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    x = (W - pw) // 2
    img.paste(shadow, (x - 30, y - 30), shadow)
    mask = Image.new("L", (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw, ph), 24, fill=255)
    img.paste(panel, (x, y), mask)
    ImageDraw.Draw(img).rounded_rectangle((x, y, x + pw, y + ph), 24, outline=(110, 120, 200), width=3)

NARR = [
    "지난달 메일로 받은 견적서, 그 금액이 어디 있었는지 기억 안 나시죠?",
    "FindInside에 기억나는 단어만 넣어 보세요.",
    "메일 본문은 물론, 첨부된 한글·엑셀·PDF 안의 글자까지 찾아 줍니다.",
    "첨부된 캡처 이미지 속 글자도 찾습니다.",
    "찾은 메일은 앱 안에서 바로 열고, 첨부파일도 바로 열 수 있어요.",
    "14일 무료 체험. Microsoft Store에서 FindInside를 검색하세요.",
]

def scene1(t, d):
    img = BG.copy()
    y = draw_text_block(img, "지난달 메일로 받은 견적서…", 520, 64)
    y = draw_text_block(img, "그 금액,\n어디 있었지?", y + 40, 110, highlight="어디 있었지?")
    mails = ["[가나시스템] 서버 구축 견적서 송부의 건", "RE: 견적 단가 조정 요청드립니다", "유지보수 계약서 초안 검토 요청"]
    dd = ImageDraw.Draw(img); f = font(REG, 38)
    for i, m in enumerate(mails):
        yy = y + 110 + i * 92
        dd.rounded_rectangle((90, yy, W - 90, yy + 72), 16, fill=(40, 46, 90))
        dd.rounded_rectangle((116, yy + 22, 152, yy + 50), 4, outline=(170, 176, 230), width=3)
        dd.line([(116, yy + 22), (134, yy + 38), (152, yy + 22)], fill=(170, 176, 230), width=3)
        dd.text((176, yy + 13), m, font=f, fill=(190, 196, 230))
    subtitle(img, NARR[0]); return img

def typing_frame(t, d):
    idx = min(5, int(t / d * 7))
    img = BG.copy()
    draw_text_block(img, "기억나는 단어만 검색", 300, 76, highlight="단어만")
    panel = framed(f"t{idx}.png", (405, 165, 905, 312), 1000, 0, zoom=0)
    card(img, panel, 560)
    subtitle(img, NARR[1]); brand(img); return img

ROWS = [(410, 690, 1010, 862), (410, 1040, 1010, 1160), (410, 1190, 1010, 1335)]
def scene3(t, d):
    img = BG.copy()
    draw_text_block(img, "메일 본문 + 첨부파일 안까지", 170, 70, highlight="첨부파일 안까지")
    draw_text_block(img, "한글 · 엑셀 · PDF", 280, 56, color=(200, 206, 255))
    y = 410
    for i, box in enumerate(ROWS):
        appear = 0.6 * i
        if t < appear: break
        panel = framed("results.png", box, 1000, max(0, t - appear) / d, zoom=0.03, focus=(0.0, 0.5))
        card(img, panel, y); y += panel.size[1] + 40
    subtitle(img, NARR[2]); return img

def scene4(t, d):
    img = BG.copy()
    draw_text_block(img, "캡처 이미지 속 글자도", 170, 76, highlight="이미지 속 글자")
    src = Image.open(os.path.join(FR, "ocr_source.png")).convert("RGB")
    src = src.resize((900, int(900 * src.size[1] / src.size[0])), Image.LANCZOS)
    card(img, src, 330)
    dd = ImageDraw.Draw(img)
    ay = 330 + src.size[1] + 40
    dd.polygon([(W // 2 - 40, ay), (W // 2 + 40, ay), (W // 2, ay + 50)], fill=YELLOW)
    if t > 0.8:
        panel = framed("results.png", (405, 880, 1065, 1010), 1000, (t - 0.8) / d, zoom=0.03, focus=(0.0, 0.5))
        card(img, panel, ay + 90)
    subtitle(img, NARR[3]); brand(img); return img

def scene5(t, d):
    img = BG.copy()
    draw_text_block(img, "찾은 메일은 앱 안에서 바로", 200, 70, highlight="앱 안에서 바로")
    panel = framed("viewer.png", (200, 205, 905, 600), 1000, t / d, zoom=0.04, focus=(0.2, 0.3))
    card(img, panel, 360)
    subtitle(img, NARR[4]); brand(img); return img

def scene6(t, d):
    img = BG.copy()
    icon = Image.open(os.path.join(BASE, "icon.png")).convert("RGBA").resize((240, 240), Image.LANCZOS)
    img.paste(icon, ((W - 240) // 2, 380), icon)
    y = draw_text_block(img, "FindInside", 680, 110)
    y = draw_text_block(img, "파일 이름 몰라도, 내용으로 찾는\nPC 파일 검색", y + 20, 54, color=(210, 214, 255))
    dd = ImageDraw.Draw(img)
    f = font(BOLD, 60); label = "14일 무료 체험"
    tw = dd.textlength(label, font=f)
    dd.rounded_rectangle(((W - tw) / 2 - 50, y + 60, (W + tw) / 2 + 50, y + 170), 55, fill=ACCENT)
    dd.text(((W - tw) / 2, y + 78), label, font=f, fill=(255, 255, 255))
    draw_text_block(img, "Microsoft Store에서 \"FindInside\" 검색", y + 230, 50, highlight="\"FindInside\"")
    subtitle(img, NARR[5]); return img

SCENES = [scene1, typing_frame, scene3, scene4, scene5, scene6]
PAD = 0.5
durs = [wav_len(i + 1) + PAD for i in range(6)]
print("장면 길이:", [round(d, 2) for d in durs], "합계", round(sum(durs), 2))

if os.environ.get("PREVIEW"):
    sheet = Image.new("RGB", (W * 3 // 3, H * 2 // 3))
    for i, (scene, d) in enumerate(zip(SCENES, durs)):
        im = scene(d * 0.7, d).resize((W // 3, H // 3))
        sheet.paste(im, ((i % 3) * W // 3, (i // 3) * H // 3))
    sheet.save(os.path.join(OUT, "preview.png")); raise SystemExit("preview saved")
ff = imageio_ffmpeg.get_ffmpeg_exe()
silent = os.path.join(OUT, "video.mp4")
proc = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", silent],
                        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
for scene, d in zip(SCENES, durs):
    n = int(round(d * FPS))
    for k in range(n):
        t = k / FPS
        frame = scene(t, d)
        fade = min(1.0, t / 0.25, (d - t) / 0.25)  # 장면 앞뒤 0.25초 페이드
        if fade < 1: frame = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), frame, max(0.0, fade))
        proc.stdin.write(frame.tobytes())
proc.stdin.close(); proc.wait()

# 내레이션: 장면마다 0.15초 뒤에 시작하도록 이어 붙임
lst = os.path.join(OUT, "audio.txt")
parts = []
for i, d in enumerate(durs):
    parts.append(os.path.join(VO, f"n{i + 1}.wav"))
inputs, filters = [], []
offset = 0.0
for i, (p, d) in enumerate(zip(parts, durs)):
    inputs += ["-i", p]
    ms = int((offset + 0.15) * 1000)
    filters.append(f"[{i + 1}:a]adelay={ms}|{ms}[a{i}]")
    offset += d
mix = "".join(f"[a{i}]" for i in range(len(parts))) + f"amix=inputs={len(parts)}:normalize=0,apad[aout]"
final = os.path.join(OUT, "findinside_shorts_mail.mp4")
subprocess.run([ff, "-y", "-i", silent, *inputs, "-filter_complex", ";".join(filters) + ";" + mix,
                "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", final],
               check=True, stderr=subprocess.DEVNULL)
print("완성:", final, os.path.getsize(final) // 1024, "KB")
