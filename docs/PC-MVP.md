# FindInside PC 앱 진행 기록

이 문서는 구현 진행 기록이며 제품 범위의 최종 기준은 `docs/FindInside-기획문서.md`다.

## 현재: 1.0.3 — Microsoft Store 공개, 판매 준비 (2026-10-07)

### 완료

**1단계 — 파일 이름 검색**
- 검색 위치·제외 폴더 선택, 파일명·폴더명·경로 색인과 검색, 파일 열기·폴더에서 보기
- 폴더 감시(`fs.watch`)로 신규·수정·삭제 자동 반영, 변경분은 `findinside-delta.json`

**2단계 — 문서 내용 검색** (ADR-0001, ADR-0002)
- SQLite FTS5 + 한국어 2글자 단위 토큰, 한 글자 색인, OCR 모음 혼동 색인
- TXT·CSV·PDF·DOCX·XLSX·PPTX·HWP·HWPX 추출, 쪽·표·셀·슬라이드 위치
- 검색·추출을 worker로 분리해 입력 멈춤과 한/영 전환 막힘 해결

**3단계 — 이미지 속 글자**
- Windows.Media.Ocr 상주 프로세스, 2배 확대, 세로쓰기 다시 읽기, 낮은 우선순위
- 한자 한글음(Unihan kHangul) 검색

**4단계 — 메일** (ADR-0004)
- MSG·EML 파일과 첨부(3단계 깊이까지)
- IMAP(imapflow)·POP3(직접 구현) 계정, 비밀번호는 DPAPI 암호화
- 메일 탭, 편지함 선택, 묶음을 먼저 받고 해석(연결 끊김 방지), 끊기면 다시 접속

**5단계 — 검색 화면 다듬기**
- 분류 탭, 정렬(관련도·최신순), 날짜 표시, 검색 중·실패·색인 진행 안내
- 메일 탭에서는 PC용 조건(검색 범위·확장자)을 숨김

**6단계 — 판매 준비**
- 14일 체험, Lemon Squeezy 라이선스 키(활성화·확인·해제), 앱 아이콘
- 이용약관·개인정보처리방침·오픈소스 고지(`legal/` → `src/legal/`, `site/`)
- 판매 페이지(`web/` → `site/`, https://findinside.netlify.app)
- 테스트 모드에서 시험 구매 → 받은 키로 설치된 앱 활성화까지 확인 (PC 1/2 등록)
- 체험판 설치 파일 배포: 공개 저장소 kimheunghan/findinside-download 릴리스 (`releases/latest/download/Find_Setup.exe`)

**7단계 — Microsoft Store (1.0.0 공개, 1.0.1 업데이트 준비)**
- 개인 개발자 계정(무료), 앱 FindInside, Store ID `9MSTC81374SK`, https://apps.microsoft.com/detail/9MSTC81374SK
- 스토어용 MSIX 패키지 `npm run dist:store` (스토어가 서명 → 인증서 불필요, Windows·V3 경고 없음)
- 무료 앱 + 외부 결제(Lemon Squeezy) 선언, 연령 등급 3+, 한국어 목록
- 판매 페이지 기본 버튼을 "Microsoft Store에서 무료 체험"으로, 설치 파일 직접 받기는 보조 링크

**1.0.1**
- 검색 결과 파일 이름 앞에 형식을 색깔로 표시 (HWP 파랑, 엑셀 초록, PDF 빨강, 이미지 주황, 메일 보라) — 판매 페이지 예시 화면과 일치
- 검색 위치 경로가 길면 옆 화면을 덮던 문제 수정
- 스토어 스크린샷용 예시 문서 스크립트 (`scripts/store-demo.js`, `scripts/store-demo-media.js`)

**1.0.2**
- 한글 쪽 번호 정확도, 검색 결과를 누르면 그 위치로 열기, 앱 안 메일 보기·첨부 열기, 창 닫을 때 오류
- HTML 메일을 메일 보기에서 원래 모양(문단·줄바꿈·표·본문 이미지)으로 표시

**1.0.3**
- 메일 본문의 주소를 누르면 기본 웹브라우저로 열린다. HTML 메일은 sandbox 때문에 눌러도 아무 일이 없었고, 글자 메일은 주소가 링크도 아니었다 (`openMailLink`·`linkifyElement`)
- 글자 메일은 주소를 먼저 링크로 바꾼 뒤 검색어를 강조한다 (순서가 반대면 강조가 주소를 끊는다)
- 열 수 있는 주소는 `http`·`https`·`mailto`만 (`file:` 등은 그대로 막는다)

### 다음

1. Lemon Squeezy 실제 판매(Live) 전환: 상품을 Live로 복사하고 결제 링크 교체 (본인 확인 완료)
2. 스토어 1.0.3 인증 결과 확인 (2026-10-07 Submission 5 제출 → 인증 중)
3. Lemon Squeezy 상품 Files에 설치 파일, 2단계 인증
4. 코드 서명은 보류 (스토어 배포로 대체, 설치 파일 직접 받기에는 경고가 남음)
5. DOC·XLS·PPT, `AND`/`OR`/`NOT`, 날짜 조건
6. 자동 업데이트, Microsoft 365 연결, 의미 검색, 육안 검수·수집함

### 알려진 주의점

- 실행 중인 FindInside가 C:\ 전체를 감시하면 빌드 폴더를 읽어 빌드가 EPERM으로 실패한다 → `npm run dist`가 먼저 앱을 닫는다.
- 빌드 후에는 설치된 파일(`%LOCALAPPDATA%\Programs\findinside\resources\app`)에 변경이 들어갔는지 확인한다.
- 스토어에 새 패키지를 올리려면 `package.json` 버전을 올려야 한다 (예: 1.0.0 → 1.0.1).
- 새 버전 배포 순서: 버전 올리기 → `npm test` → `npm run dist` + `npm run dist:store` → GitHub 릴리스(findinside-download)에 Find_Setup.exe → Partner Center 새 제출에 appx → (`site/` 내용이 바뀐 때만) Netlify에 다시 올리기
- 판매 페이지의 내려받기 단추는 `releases/latest/download/Find_Setup.exe`를 가리킨다. 그래서 GitHub 릴리스에 새 설치 파일만 올리면 **판매 페이지를 다시 올리지 않아도** 최신 파일이 내려받아진다 (Netlify 배포가 막혀 있어도 된다).
- GitHub 릴리스는 이 PC의 `gh`(GitHub CLI, `kimheunghan` 로그인 완료)로 올린다. 100MB가 넘는 설치 파일은 저장소에 push할 수 없으므로 릴리스 첨부로만 올라간다.
- 1.0.3 배포 결과: GitHub 릴리스 v1.0.3 공개(2026-10-07), 스토어 Submission 5 인증 중.
