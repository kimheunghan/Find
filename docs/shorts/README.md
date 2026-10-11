# 쇼츠 영상

## 3편 — 메일 첨부파일 속 글자로 찾기 (`findinside_shorts_mail.mp4`, 2026-10-11)

34.5초 · 1080×1920 · 30fps · 한국어 내레이션(윈도우 기본 음성 "Microsoft Heami") + 화면 자막. 화면은 가짜 회사(한빛상사·가나시스템) 메일로 찍은 실제 앱 화면.

**유튜브 제목**
```
메일 첨부파일 속 그 금액, 3초 만에 찾기 | 첨부파일 내용 검색 FindInside
```

**설명**
```
지난달 메일로 받은 견적서, 그 금액이 어디 있었는지 기억 안 날 때.
FindInside는 메일 본문은 물론 첨부된 한글·엑셀·PDF 안의 글자, 첨부 캡처 이미지 속 글자까지 찾아 줍니다.

✔ 메일 본문·첨부파일 내용 검색
✔ 첨부 한글(HWP)·엑셀·PDF·이미지(OCR) 속 글자
✔ 찾은 메일은 앱 안에서 바로 열기
✔ 파일은 내 PC 밖으로 나가지 않음

14일 무료 체험 (Windows 10·11)
Microsoft Store에서 "FindInside" 검색

#메일검색 #첨부파일검색 #파일내용검색 #파일찾기 #파일검색 #업무꿀팁 #직장인꿀팁 #FindInside #shorts
```

**내레이션 대본** (장면 순서)
1. 지난달 메일로 받은 견적서, 그 금액이 어디 있었는지 기억 안 나시죠?
2. FindInside에 기억나는 단어만 넣어 보세요.
3. 메일 본문은 물론, 첨부된 한글·엑셀·PDF 안의 글자까지 찾아 줍니다.
4. 첨부된 캡처 이미지 속 글자도 찾습니다.
5. 찾은 메일은 앱 안에서 바로 열고, 첨부파일도 바로 열 수 있어요.
6. 14일 무료 체험. Microsoft Store에서 FindInside를 검색하세요.

## 다시 만드는 법 (`tools/`)

1. 가짜 자료: `make-samples.js`(문서 8개) → `make-mails.js`(메일 5통, 첨부는 앞의 샘플)를 `C:\공유자료\메일보관` 같은 곳에 만든다.
2. 개발판 앱을 **격리된 설정**으로 띄운다: `LOCALAPPDATA`를 임시 폴더로, `electron . --user-data-dir=<임시> --remote-debugging-port=9333`.
3. `cdp.js`로 검색 폴더 지정(`window.findInside.setRoots`) → 색인(`rebuildIndex`) → 검색어를 한 글자씩 넣으며 `shot`으로 캡처(`t0~t5.png`, `results.png`, `viewer.png`).
4. 끝나면 `cdp.js eval "window.close()"`로 **정상 종료**(강제 종료하면 숨은 한글 Hwp.exe가 남는다), 임시 폴더 삭제.
5. 내레이션: PowerShell `System.Speech`로 장면별 `n1~n6.wav` (Heami, Rate 1, 24kHz mono).
6. `make_short.py`(Pillow + imageio-ffmpeg, 임시 venv) → `video.mp4`, `mux.py`로 내레이션 합치기. `PREVIEW=1`이면 장면별 한 장씩 미리보기만 뽑는다.
