# FindInside PC 앱 진행 기록

이 문서는 구현 진행 기록이며 제품 범위의 최종 기준은 `docs/FindInside-기획문서.md`다.

## 현재: 1.0.0 판매 준비 (2026-09-30)

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

### 다음

1. Lemon Squeezy 본인 확인 심사 통과 → 실제 판매(Live) 전환, 상품을 Live로 복사하고 결제 링크 교체
2. 체험판 내려받기 주소(`downloadUrl`) 정하기, 판매 페이지에 구매·내려받기 버튼 연결
3. 코드 서명 (서명 없는 설치 파일은 Windows 경고가 뜸)
4. DOC·XLS·PPT, `AND`/`OR`/`NOT`, 날짜 조건
5. 자동 업데이트, Microsoft 365 연결, 의미 검색, 육안 검수·수집함

### 알려진 주의점

- 실행 중인 FindInside가 C:\ 전체를 감시하면 빌드 폴더를 읽어 빌드가 EPERM으로 실패한다 → `npm run dist`가 먼저 앱을 닫는다.
- 빌드 후에는 설치된 파일(`%LOCALAPPDATA%\Programs\findinside\resources\app`)에 변경이 들어갔는지 확인한다.
