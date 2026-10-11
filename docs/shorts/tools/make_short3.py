# FindInside 쇼츠 4편 — 기능 총정리 (1080x1920, 30fps, 내레이션 + 배경음 + 자막)
import os, sys, math, wave, struct, random, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import imageio_ffmpeg

B = os.path.dirname(os.path.abspath(__file__))
FR, VO, OUT = (os.path.join(B, d) for d in ("frames", "voice", "out"))
os.makedirs(OUT, exist_ok=True)
W, H, FPS = 1080, 1920, 30
BOLD, REG = "C:/Windows/Fonts/malgunbd.ttf", "C:/Windows/Fonts/malgun.ttf"
YEL = (255, 214, 64)
URL = "findinside.netlify.app"
_fc = {}
def F(size, bold=True):
    k = (size, bold)
    if k not in _fc: _fc[k] = ImageFont.truetype(BOLD if bold else REG, size)
    return _fc[k]

def ease(t): t = max(0.0, min(1.0, t)); return 1 - (1 - t) ** 3
def back(t):  # 살짝 튀어 오르는 등장
    t = max(0.0, min(1.0, t)); c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2

# ---------- 배경 ----------
def make_bg(c1, c2, seed):
    big = Image.new("RGB", (W + 160, H + 160))
    d = ImageDraw.Draw(big)
    for y in range(H + 160):
        t = y / (H + 160)
        d.line([(0, y), (W + 160, y)], fill=tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)))
    glow = Image.new("RGBA", big.size, (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    rnd = random.Random(seed)
    for _ in range(4):
        r = rnd.randint(260, 460); x = rnd.randint(0, W + 160); y = rnd.randint(0, H + 160)
        col = tuple(min(255, int(v * 1.6 + 40)) for v in c2) + (70,)
        g.ellipse((x - r, y - r, x + r, y + r), fill=col)
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    big.paste(glow, (0, 0), glow)
    # 은은한 점 무늬
    dots = Image.new("RGBA", big.size, (0, 0, 0, 0)); dd = ImageDraw.Draw(dots)
    for yy in range(0, H + 160, 48):
        for xx in range(0, W + 160, 48):
            dd.ellipse((xx, yy, xx + 3, yy + 3), fill=(255, 255, 255, 18))
    big.paste(dots, (0, 0), dots)
    return big

def bg_at(big, t):
    ox = 80 + 60 * math.sin(t * 0.35); oy = 80 + 60 * math.cos(t * 0.27)
    return big.crop((int(ox), int(oy), int(ox) + W, int(oy) + H))

# ---------- 고정 막대 ----------
ICON = Image.open(os.path.join(B, "icon.png")).convert("RGBA")
def topbar():
    l = Image.new("RGBA", (W, 150), (0, 0, 0, 0)); d = ImageDraw.Draw(l)
    d.rectangle((0, 0, W, 150), fill=(8, 10, 24, 150))
    l.paste(ICON.resize((76, 76), Image.LANCZOS), (40, 37), ICON.resize((76, 76), Image.LANCZOS))
    d.text((132, 44), "FindInside", font=F(46), fill=(255, 255, 255))
    tw = d.textlength(URL, font=F(32, False))
    d.rounded_rectangle((W - tw - 80, 46, W - 36, 104), 29, fill=(255, 255, 255, 30), outline=(255, 255, 255, 90), width=2)
    d.text((W - tw - 58, 52), URL, font=F(32, False), fill=(235, 238, 255))
    return l
def bottombar():
    l = Image.new("RGBA", (W, 130), (0, 0, 0, 0)); d = ImageDraw.Draw(l)
    d.rectangle((0, 0, W, 130), fill=(8, 10, 24, 170))
    txt = "Microsoft Store 무료 다운로드 · 14일 무료 체험"
    tw = d.textlength(txt, font=F(38))
    d.text(((W - tw) / 2, 40), txt, font=F(38), fill=YEL)
    return l
TOP, BOT = topbar(), bottombar()

# ---------- 글자 ----------
def text_layer(lines, size, color=(255, 255, 255), hl=None, bold=True, spacing=16, width=980):
    f = F(size, bold); tmp = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    rows = []
    for line in lines.split("\n"):
        cur = ""
        for w in line.split(" "):
            test = (cur + " " + w).strip()
            if tmp.textlength(test, font=f) <= width: cur = test
            else: rows.append(cur); cur = w
        rows.append(cur)
    h = len(rows) * (size + spacing) + 20
    l = Image.new("RGBA", (W, h), (0, 0, 0, 0)); d = ImageDraw.Draw(l)
    y = 0
    for r in rows:
        x = (W - d.textlength(r, font=f)) / 2
        parts = [r]
        if hl and hl in r:
            a, b = r.split(hl, 1); parts = [a, hl, b]
        for i, p in enumerate(parts):
            col = YEL if (len(parts) == 3 and i == 1) else color
            d.text((x + 3, y + 4), p, font=f, fill=(0, 0, 0, 120))
            d.text((x, y), p, font=f, fill=col)
            x += d.textlength(p, font=f)
        y += size + spacing
    return l

def pop(img, layer, y, t, start=0.0, dur=0.45, dx=0):
    p = (t - start) / dur
    if p <= 0: return
    s = back(p); a = ease(p)
    lw, lh = layer.size
    if s != 1:
        L = layer.resize((max(1, int(lw * s)), max(1, int(lh * s))), Image.BILINEAR)
    else: L = layer
    if a < 1:
        alpha = L.split()[3].point(lambda v: int(v * a)); L = L.copy(); L.putalpha(alpha)
    img.paste(L, ((W - L.size[0]) // 2 + dx, int(y + (lh - L.size[1]) / 2)), L)

def subtitle(img, text, t):
    a = ease(t / 0.3)
    f = F(44); d0 = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    rows, cur = [], ""
    for w in text.split(" "):
        test = (cur + " " + w).strip()
        if d0.textlength(test, font=f) <= 920: cur = test
        else: rows.append(cur); cur = w
    rows.append(cur)
    h = len(rows) * 62 + 36
    l = Image.new("RGBA", (W - 90, h), (0, 0, 0, 0)); d = ImageDraw.Draw(l)
    d.rounded_rectangle((0, 0, W - 90, h), 26, fill=(0, 0, 0, int(165 * a)))
    y = 18
    for r in rows:
        d.text(((W - 90 - d.textlength(r, font=f)) / 2, y), r, font=f, fill=(255, 255, 255, int(255 * a)))
        y += 62
    img.paste(l, (45, 1770 - 40 - h), l)

def pill(img, text, color, t, y=180):
    a = ease(t / 0.35)
    f = F(36); d0 = ImageDraw.Draw(Image.new("RGB", (1, 1))); tw = d0.textlength(text, font=f)
    l = Image.new("RGBA", (int(tw) + 60, 64), (0, 0, 0, 0)); d = ImageDraw.Draw(l)
    d.rounded_rectangle((0, 0, tw + 60, 64), 32, fill=color + (int(235 * a),))
    d.text((30, 9), text, font=f, fill=(255, 255, 255, int(255 * a)))
    img.paste(l, ((W - l.size[0]) // 2, y - int(20 * (1 - a))), l)

# ---------- 앱 화면 카드 ----------
_cards = {}
def card(name, box, width, hls=()):
    k = (name, box, width)
    if k in _cards: return _cards[k]
    src = Image.open(os.path.join(FR, name)).convert("RGB").crop(box)
    sc = width / src.size[0]
    panel = src.resize((width, int(src.size[1] * sc)), Image.LANCZOS)
    pw, ph = panel.size
    L = Image.new("RGBA", (pw + 80, ph + 80), (0, 0, 0, 0))
    sh = Image.new("RGBA", L.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((40, 52, pw + 40, ph + 52), 30, fill=(0, 0, 0, 170))
    sh = sh.filter(ImageFilter.GaussianBlur(20)); L.paste(sh, (0, 0), sh)
    m = Image.new("L", (pw, ph), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, pw, ph), 26, fill=255)
    L.paste(panel, (40, 40), m)
    ImageDraw.Draw(L).rounded_rectangle((40, 40, pw + 40, ph + 40), 26, outline=(255, 255, 255, 110), width=3)
    _cards[k] = (L, sc)
    return _cards[k]

def show_card(img, name, box, width, y, t, start=0.0, hls=(), hl_start=0.9, cx=None):
    L, sc = card(name, box, width)
    p = ease((t - start) / 0.5)
    if p <= 0: return 0
    x = ((W if cx is None else 2 * cx) - L.size[0]) // 2; yy = int(y + 260 * (1 - p))
    if p < 1:
        L2 = L.copy(); L2.putalpha(L.split()[3].point(lambda v: int(v * p))); img.paste(L2, (x, yy), L2)
    else: img.paste(L, (x, yy), L)
    # 위치 표시에 노란 테두리 (깜빡임)
    if t > start + hl_start:
        pulse = 0.55 + 0.45 * math.sin((t - start - hl_start) * 6)
        o = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(o)
        for (x1, y1, x2, y2) in hls:
            X1, Y1 = x + 40 + x1 * sc - 8, yy + 40 + y1 * sc - 8
            X2, Y2 = x + 40 + x2 * sc + 8, yy + 40 + y2 * sc + 8
            d.rounded_rectangle((X1, Y1, X2, Y2), 14, outline=YEL + (int(255 * pulse),), width=6)
        img.paste(o, (0, 0), o)
    return L.size[1]

# ---------- 장면 ----------
NARR = [
    "파일은 분명 있는데, 어느 파일에 있었는지 기억 안 날 때 있죠?",
    "FindInside는 폴더를 미리 색인해 둬서, 검색이 정말 빨라요.",
    "기억나는 단어만 입력하세요.",
    "이미지 안의 글자도 검색돼요. 캡처한 화면이나 스캔한 서류 속 글자까지 찾아 줍니다.",
    "한글 파일은 그 문장이 있는 위치까지 보여 주고요,",
    "엑셀은 어느 시트, 어느 칸인지 알려 줘요.",
    "PDF는 몇 쪽인지, 파워포인트는 몇 번째 슬라이드인지 바로 보여요.",
    "메일 본문은 물론, 첨부파일 안의 내용까지 한 번에 찾아요.",
    "폴더나 파일 형식으로 좁혀서 찾을 수도 있어요.",
    "지금 Microsoft Store에서 무료로 받아 보세요. 14일 동안 모든 기능을 써 볼 수 있어요.",
]
BGS = [((10, 14, 40), (49, 46, 129)), ((4, 47, 46), (14, 116, 144)), ((22, 20, 64), (67, 56, 202)),
       ((90, 32, 8), (234, 88, 12)), ((15, 30, 90), (37, 99, 235)), ((6, 50, 28), (22, 163, 74)),
       ((80, 18, 24), (220, 38, 38)), ((44, 8, 84), (124, 58, 237)), ((10, 40, 60), (8, 145, 178)),
       ((24, 30, 110), (124, 58, 237))]
BIG = [make_bg(c1, c2, i) for i, (c1, c2) in enumerate(BGS)]
TL = {}
def T(key, *a, **k):
    if key not in TL: TL[key] = text_layer(*a, **k)
    return TL[key]

FILES = ["보고서_최종.hwp", "보고서_최종(2).hwp", "보고서_진짜최종.hwp", "견적서_수정본.xlsx", "회의록_10월.hwpx", "계약서_스캔.pdf", "스크린샷_1008.png", "발표자료_v3.pptx"]
TYPE_COL = {"hwp": (37, 99, 235), "hwpx": (37, 99, 235), "xlsx": (22, 163, 74), "pdf": (220, 38, 38), "png": (234, 88, 12), "pptx": (234, 88, 12)}
def s_hook(img, t, d):
    for i, name in enumerate(FILES):
        st = 0.12 * i; p = ease((t - st) / 0.5)
        if p <= 0: continue
        col = i % 2
        x = 70 + col * 480; y = 520 + (i // 2) * 120 - int(120 * (1 - p))
        ext = name.rsplit(".", 1)[1]
        box = Image.new("RGBA", (450, 96), (0, 0, 0, 0)); bd = ImageDraw.Draw(box)
        bd.rounded_rectangle((0, 0, 450, 96), 20, fill=(255, 255, 255, int(28 * p)), outline=(255, 255, 255, int(70 * p)), width=2)
        bd.rounded_rectangle((18, 26, 108, 70), 10, fill=TYPE_COL[ext] + (int(255 * p),))
        bd.text((63 - bd.textlength(ext.upper(), font=F(24)) / 2, 31), ext.upper(), font=F(24), fill=(255, 255, 255, int(255 * p)))
        bd.text((124, 26), name, font=F(32, False), fill=(230, 232, 255, int(255 * p)))
        img.paste(box, (x, y), box)
    pop(img, T("h2", "그 파일,\n어디 있었지?", 100, hl="어디 있었지?"), 1060, t, 1.0)

def s_index(img, t, d):
    pill(img, "미리 색인", (13, 148, 136), t)
    pop(img, T("i1", "미리 색인해 둬서 빠르다", 72, hl="색인"), 270, t, 0.1)
    show_card(img, "index_panel.png", (0, 0, 544, 1160), 430, 400, t, 0.3, hls=[(42, 993, 483, 1076)], hl_start=1.0)

def s_type(img, t, d):
    pill(img, "검색", (99, 102, 241), t)
    pop(img, T("t1", "기억나는 단어만 입력", 76, hl="단어만"), 320, t, 0.1)
    idx = 1 + min(4, int(t / max(0.1, d - 0.6) * 5))
    L, sc = card(f"t{idx}.png", (405, 165, 905, 312), 960)
    p = ease(t / 0.4); y = int(640 + 200 * (1 - p))
    img.paste(L, ((W - L.size[0]) // 2, y), L)
    if t > d - 1.5:
        pop(img, T("t2", "↓  결과가 바로", 48, color=(225, 230, 255)), 1000, t, d - 1.5)
        show_card(img, "results.png", (410, 690, 1010, 862), 1000, 1080, t, d - 1.3, hls=[], hl_start=9)

def feature(img, t, d, label, color, title, hl_word, shots, sub=None, size=72):
    pill(img, label, color, t)
    pop(img, T(title, title, size, hl=hl_word), 270, t, 0.1)
    if sub: pop(img, T(sub, sub, 42, color=(225, 230, 255), bold=False), 390, t, 0.35)
    y = 490
    for i, (name, box, width, hls) in enumerate(shots):
        h = show_card(img, name, box, width, y, t, 0.35 + 0.55 * i, hls=hls, hl_start=0.7)
        y += (h or card(name, box, width)[0].size[1]) - 30

def s_ocr(img, t, d):
    pill(img, "이미지 검색", (234, 88, 12), t)
    pop(img, T("o1", "이미지 안의 글자 검색", 80, hl="이미지 안의 글자"), 260, t, 0.1)
    pop(img, T("o0", "캡처 화면 · 스캔 서류 · 사진", 44, color=(255, 236, 214), bold=False), 380, t, 0.3)
    L, sc = card("ocr_source.png", (0, 0, 760, 260), 920)
    p = ease((t - 0.4) / 0.5)
    if p > 0:
        L2 = L.copy(); L2.putalpha(L.split()[3].point(lambda v: int(v * p)))
        img.paste(L2, ((W - L.size[0]) // 2, int(470 + 120 * (1 - p))), L2)
        # 이미지 속에서 찾은 글자에 노란 테두리 (원본 이미지 좌표: "192.168.10.21" 줄)
        if t > 1.2:
            pulse = 0.55 + 0.45 * math.sin((t - 1.2) * 6)
            o = Image.new("RGBA", img.size, (0, 0, 0, 0)); od = ImageDraw.Draw(o)
            x0 = (W - L.size[0]) // 2 + 40; y0 = 470 + 40
            od.rounded_rectangle((x0 + 30 * sc, y0 + 128 * sc, x0 + 520 * sc, y0 + 178 * sc), 12, outline=YEL + (int(255 * pulse),), width=6)
            img.paste(o, (0, 0), o)
    if t > 1.6:
        cy = 470 + L.size[1] + 10
        ImageDraw.Draw(img).polygon([(W // 2 - 46, cy), (W // 2 + 46, cy), (W // 2, cy + 56)], fill=YEL)
        show_card(img, "docs02.png", (20, 785, 720, 985), 1000, cy + 70, t, 1.7, hls=[(130, 145, 342, 180)], hl_start=0.6)

def s_hwp(img, t, d):
    feature(img, t, d, "한글(HWP · HWPX)", (37, 99, 235), "한글 파일 내용 검색", "내용 검색",
            [("docs02.png", (20, 345, 720, 545), 1000, [(130, 143, 306, 180)]),
             ("docs02.png", (20, 125, 720, 325), 1000, [(130, 143, 306, 180)])], sub="문장이 있는 위치까지")

def s_xlsx(img, t, d):
    feature(img, t, d, "엑셀", (22, 163, 74), "어느 시트, 어느 칸인지", "어느 칸",
            [("docs01.png", (410, 472, 1010, 636), 1000, [(82, 98, 187, 120), (82, 126, 187, 148)])])
    pop(img, T("x2", "단가표 시트 › C1 · D4", 64, hl="C1 · D4"), 1000, t, 1.4)

def s_pdfppt(img, t, d):
    feature(img, t, d, "PDF · 파워포인트", (220, 38, 38), "몇 쪽, 몇 번째 슬라이드", "몇 쪽,",
            [("docs02.png", (20, 1005, 720, 1205), 1000, [(130, 145, 183, 183)]),
             ("docs02.png", (20, 565, 720, 765), 1000, [(130, 145, 248, 180)])])
    pop(img, T("pp2", "PDF 1쪽 · 슬라이드 3", 70, hl="1쪽 · 슬라이드 3"), 1240, t, 1.9)

def s_mail(img, t, d):
    feature(img, t, d, "메일 · 첨부파일", (124, 58, 237), "메일 + 첨부파일 내용까지", "첨부파일 내용까지",
            [("mail03.png", (20, 125, 720, 325), 1000, [(128, 143, 655, 180)]),
             ("viewer04.png", (20, 15, 900, 470), 1000, [])], size=68)

def s_filter(img, t, d):
    pill(img, "좁혀 찾기", (8, 145, 178), t)
    pop(img, T("f1", "폴더 · 형식으로 좁혀 찾기", 72, hl="좁혀 찾기"), 270, t, 0.1)
    show_card(img, "f_after.png", (0, 0, 1000, 947), 860, 400, t, 0.35, hls=[(252, 30, 552, 80), (566, 30, 735, 80)], hl_start=0.8)

def s_cta(img, t, d):
    p = back(t / 0.6); s = int(260 * max(0.01, p))
    ic = ICON.resize((s, s), Image.LANCZOS)
    img.paste(ic, ((W - s) // 2, 300 + (260 - s) // 2), ic)
    pop(img, T("c1", "FindInside", 110), 600, t, 0.3)
    pop(img, T("c2", "파일 안의 내용으로 찾는\nPC 파일 검색", 50, color=(225, 230, 255)), 750, t, 0.5)
    q = ease((t - 0.9) / 0.5)
    if q > 0:
        btn = Image.new("RGBA", (860, 150), (0, 0, 0, 0)); bd = ImageDraw.Draw(btn)
        bd.rounded_rectangle((0, 0, 860, 150), 75, fill=(255, 255, 255, int(255 * q)))
        ax, ay = 110, 75
        bd.line((ax, ay - 34, ax, ay + 20), fill=(37, 99, 235, int(255 * q)), width=12)
        bd.polygon([(ax - 26, ay + 2), (ax + 26, ay + 2), (ax, ay + 32)], fill=(37, 99, 235, int(255 * q)))
        bd.line((ax - 34, ay + 42, ax + 34, ay + 42), fill=(37, 99, 235, int(255 * q)), width=10)
        bd.text((170, 22), "Microsoft Store에서", font=F(40, False), fill=(60, 64, 90, int(255 * q)))
        bd.text((170, 70), "무료 다운로드", font=F(54), fill=(20, 24, 60, int(255 * q)))
        pulse = 1 + 0.03 * math.sin(t * 5) if t > 1.5 else 1
        b2 = btn.resize((int(860 * pulse), int(150 * pulse)), Image.BILINEAR)
        img.paste(b2, ((W - b2.size[0]) // 2, int(960 + 60 * (1 - q))), b2)
    pop(img, T("c3", "14일 무료 체험 · 카드 등록 없음\n파일은 내 PC 밖으로 나가지 않아요", 38, color=(225, 230, 255), bold=False), 1150, t, 1.3)
    r = ease((t - 1.7) / 0.5)
    if r > 0:
        f = F(58); d0 = ImageDraw.Draw(img); tw = d0.textlength(URL, font=f)
        l = Image.new("RGBA", (int(tw) + 90, 110), (0, 0, 0, 0)); ld = ImageDraw.Draw(l)
        ld.rounded_rectangle((0, 0, tw + 90, 110), 55, fill=(0, 0, 0, int(140 * r)), outline=YEL + (int(255 * r),), width=4)
        ld.text((45, 16), URL, font=f, fill=YEL + (int(255 * r),))
        img.paste(l, ((W - l.size[0]) // 2, 1300), l)

SCENES = [s_hook, s_index, s_type, s_ocr, s_hwp, s_xlsx, s_pdfppt, s_mail, s_filter, s_cta]
VO = os.path.join(B, "voice3")
def wav_len(i):
    with wave.open(os.path.join(VO, f"n{i:02d}.wav")) as w: return w.getnframes() / w.getframerate()
PAD = [2.0, 1.2, 2.2, 1.6, 1.0, 1.4, 1.2, 1.2, 1.4, 2.2]
DURS = [wav_len(i + 1) + PAD[i] for i in range(len(SCENES))]
TOTAL = sum(DURS)

def render(i, t):
    img = bg_at(BIG[i], t + i * 3).copy()
    SCENES[i](img, t, DURS[i])
    img.paste(TOP, (0, 0), TOP)
    if i != len(SCENES) - 1: img.paste(BOT, (0, H - 130), BOT)
    subtitle(img, NARR[i], t)
    if t < 0.2:
        img = Image.blend(img, Image.new("RGB", (W, H), (255, 255, 255)), 0.35 * (1 - t / 0.2))
    if i == len(SCENES) - 1 and DURS[i] - t < 0.5:
        img = Image.blend(Image.new("RGB", (W, H), (0, 0, 0)), img, max(0, (DURS[i] - t) / 0.5))
    return img

if os.environ.get("PREVIEW"):
    sheet = Image.new("RGB", (W // 3 * 4, H // 3 * 3), (0, 0, 0))
    for i in range(len(SCENES)):
        im = render(i, DURS[i] * 0.85).resize((W // 3, H // 3))
        sheet.paste(im, ((i % 4) * W // 3, (i // 4) * H // 3))
    sheet.save(os.path.join(OUT, "preview3.png")); print("preview", [round(x, 1) for x in DURS], round(TOTAL, 1)); sys.exit()

ff = imageio_ffmpeg.get_ffmpeg_exe()
silent = os.path.join(OUT, "video3.mp4")
proc = subprocess.Popen([ff, "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "medium", silent],
                        stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
for i, d in enumerate(DURS):
    for k in range(int(round(d * FPS))):
        proc.stdin.write(render(i, k / FPS).tobytes())
    print("장면", i + 1, "끝", flush=True)
proc.stdin.close(); proc.wait()

# 경쾌한 비트(lofi.py) + 내레이션, 말할 때 음악 낮춤
subprocess.run([sys.executable, os.path.join(B, "lofi.py"), f"{TOTAL + 1:.1f}"], check=True)
inputs, vf, off = ["-i", os.path.join(OUT, "lofi.wav")], [], 0.0
for i, d in enumerate(DURS):
    inputs += ["-i", os.path.join(VO, f"n{i + 1:02d}.wav")]
    ms = int((off + 0.35) * 1000); vf.append(f"[{i + 2}:a]aresample=44100,adelay={ms}|{ms},volume=1.3[a{i}]"); off += d
voice = "".join(f"[a{i}]" for i in range(len(DURS))) + f"amix=inputs={len(DURS)}:normalize=0:duration=longest,asplit=2[v1][v2]"
music = "[1:a]volume=0.30[m0];[m0][v1]sidechaincompress=threshold=0.02:ratio=6:attack=20:release=400[m]"
mix = "[m][v2]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[aout]"
final = os.path.join(OUT, "findinside_shorts_v4.mp4")
r = subprocess.run([ff, "-y", "-i", silent, *inputs, "-filter_complex", ";".join(vf) + ";" + voice + ";" + music + ";" + mix,
                    "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{TOTAL:.2f}", final], capture_output=True, text=True)
print("ffmpeg", r.returncode, r.stderr[-300:] if r.returncode else "")
print("완성", final, os.path.getsize(final) // 1024, "KB", round(TOTAL, 1), "초")
