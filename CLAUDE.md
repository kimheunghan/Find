# FindInside 작업 안내 (클로드용)

내 PC의 파일 이름·문서 내용·이미지 속 글자·메일을 검색하는 Windows 데스크톱 앱(Electron). 한국어로 답한다.

**먼저 `docs/다음-할-일.md`를 읽는다.** 아직 안 끝난 일과 그 일을 어떻게 하는지가 거기 있다.

## 이 PC에서 명령을 부르는 법

`node`와 `gh`는 PATH에 없다. 전체 경로를 쓴다.

```
C:\Program Files\nodejs\node.exe
C:\Program Files\GitHub CLI\gh.exe
```

PowerShell에서 npm을 쓸 때는 먼저 `$env:Path = "C:\Program Files\nodejs;$env:Path"`.

## 새 버전 내기

`docs/PC-MVP.md`에 적힌 순서다. 아래 ①~④는 내가 다 할 수 있고, **사용자가 직접 할 일은 ⑤ 하나뿐이다.**

1. `package.json`과 `package-lock.json`의 버전 올리기 (스토어는 버전이 같으면 새 패키지를 안 받는다)
2. `npm test` (75개) — 그리고 `npm run check`
3. `npm run dist` → `release\Find_Setup.exe` (108MB, 홈페이지용)
   `npm run dist:store` → `release\FindInside_Store.appx` (161MB, 스토어용)
4. 커밋·푸시한 뒤 GitHub 릴리스 올리기:
   ```
   & "C:\Program Files\GitHub CLI\gh.exe" release create v<버전> "D:\Find\release\Find_Setup.exe" `
     -R kimheunghan/findinside-download --title "FindInside <버전>" --notes "바뀐 점"
   ```
   올린 뒤 `gh api repos/kimheunghan/findinside-download/releases/latest --jq .tag_name`으로 확인한다.
5. **(사용자)** Partner Center에 `release\FindInside_Store.appx`를 새 제출로 올린다. 브라우저 작업이라 내가 못 한다.

### 판매 페이지는 새 버전마다 올릴 필요가 없다

판매 페이지의 내려받기 단추가 `releases/latest/download/Find_Setup.exe`를 가리켜 **늘 가장 새 릴리스를 따라간다.** 그래서 GitHub 릴리스만 올리면 페이지는 손대지 않아도 최신 설치 파일을 내려준다. 사용자가 이 점을 자주 되물었으니 먼저 짚어 준다. 페이지는 글·그림·가격을 실제로 고쳤을 때만 올린다 (`npm run docs` → `site/` 폴더를 올림).

## 저장소 두 개

| 저장소 | 들어 있는 것 |
|---|---|
| `kimheunghan/Find` (비공개) | 소스·문서 전부 |
| `kimheunghan/findinside-download` (공개) | 설치 파일 — README 하나뿐이고 실제 파일은 **릴리스 첨부**로 올라간다 |

100MB가 넘는 파일은 GitHub 저장소에 push할 수 없다. 설치 파일이 108MB라 릴리스로만 올라간다.

커밋 작성자는 기록과 같은 `madlrengg100 <madlrengg100@gmail.com>`으로 맞춰 두었다.

## 코드

- `src/main.js` 메인 프로세스·IPC, `src/preload.js` 다리, `src/renderer/` 화면
- 색인·검색·추출은 worker로 분리되어 있다 (`*Worker.js`) — 화면이 멈추지 않게 하려는 것
- 주석과 변수 이름, 사용자에게 보이는 글은 **쉬운 한국어**로 쓴다. "렌더러", "sanitize" 같은 말보다 "화면", "걸러내기"처럼 쓴다
- 바꾼 뒤에는 `npm run check`와 `npm test`를 돌린다
