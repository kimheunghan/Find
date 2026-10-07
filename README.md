# FindInside

FindInside는 Windows PC의 파일, 문서 속 내용, 이미지 속 글자, 연결한 메일과 첨부파일을 한곳에서 찾는 **Local-First 검색 프로그램**입니다.

파일 이름이 기억나지 않아도 문서 안의 문장, 숫자, 사람 이름으로 자료를 찾고, 찾은 곳이 몇 쪽·어느 셀·어느 슬라이드인지 보여 줍니다. 색인과 검색은 모두 사용자 PC 안에서 합니다.

- 판매 페이지: https://findinside.netlify.app
- 현재 버전: 1.0.3 — Microsoft Store: https://apps.microsoft.com/detail/9MSTC81374SK

## 지금 되는 것 (1.0.0)

**검색**
- 파일 이름·폴더 이름·경로 (백만 개 이상도 보통 1초 안팎)
- 문서 내용: HWP, HWPX, DOCX, XLSX, PPTX, PDF, TXT, CSV — 결과에 쪽·표·셀·슬라이드 위치 표시, 누르면 문서를 열고 찾을 문구를 복사
- 이미지 속 글자(OCR): Windows 기본 OCR, 작은 글씨·세로쓰기 다시 읽기
- 한자 이름을 한글 음으로 검색 (金英洙 → 김영수)
- 메일: IMAP·POP3 계정 연결, 제목·보낸 사람·받는 사람·본문·첨부 문서 내용, 저장된 MSG·EML 파일
- 분류 탭(전체 · PC 파일 · 메일), 편지함 선택, 검색 범위(폴더)·확장자 조건
- 정렬(관련도순 · 최신순), 결과마다 수정한 날짜 표시
- 검색 중 표시, 실패 이유와 다시 검색, 색인 진행 중이면 그 사실을 안내

**색인**
- 검색 위치·제외 폴더 선택, "색인 시작"으로 파일 목록 만들기
- 폴더 감시로 새로 만들거나 바뀐 파일 자동 반영
- 문서·이미지 내용은 뒤에서 낮은 우선순위로 읽고, 바뀐 파일만 다시 읽음
- 메일은 시작 20초 뒤와 15분마다 새 메일만 가져옴 (연결이 끊기면 다시 접속해 이어서)

**판매**
- 14일 체험판, Lemon Squeezy 라이선스 키 활성화·해제 (PC 2대), 7일마다 확인, 오프라인 30일 유예
- 도움말 메뉴: 라이선스, 이용약관, 개인정보처리방침, 오픈소스 라이선스, 정보

## 아직 안 되는 것 (후속)

- DOC·XLS·PPT(옛 형식), Microsoft 365/Outlook 연결(Graph)
- `AND` / `OR` / `NOT` 검색어 조합, 날짜 조건
- 의미 검색, 육안 검수·수집함, 모바일 앱
- 자동 업데이트, 코드 서명

## 개발

```powershell
npm install
npm start          # 개발 실행
npm test           # 테스트 (node --test)
npm run dist       # 설치 파일 → release\Find_Setup.exe (실행 중인 FindInside를 먼저 닫음)
npm run docs       # 약관·방침·오픈소스 고지·판매 페이지(site/)를 src/product.json 값으로 다시 만들기
npm run icon       # 앱 아이콘 다시 만들기
```

| 경로 | 내용 |
|---|---|
| `src/main.js` | 메인 프로세스: 창, 설정, 색인 흐름, 폴더 감시, 메일 동기화, 라이선스 |
| `src/searchWorker.js` `src/contentWorker.js` `src/mailWorker.js` | 검색·내용 추출·메일을 메인 밖(worker)에서 처리 (입력·한/영 전환이 막히지 않게) |
| `src/contentIndex.js` `src/tokens.js` | SQLite FTS5 색인, 한국어 2글자 단위 토큰 |
| `src/extract.js` `src/ocr.js` | 문서 추출과 쪽·셀 위치, 이미지 OCR |
| `src/imap.js` `src/pop3.js` `src/mail.js` | 메일 가져오기와 해석 |
| `src/license.js` `src/product.json` | 체험·라이선스 로직, 판매 정보(가격·연락처·Lemon Squeezy 번호) |
| `src/renderer/` | 화면 |
| `legal/` `web/` → `src/legal/` `site/` | 약관·방침 원본, 판매 페이지 원본 → 생성 결과 |
| `scripts/` | 빌드, 아이콘, 문서 생성, 판매 페이지·상품 이미지 캡처, OCR 검수 |

## 문서

- [판매 등록 가이드](docs/판매-등록-가이드.md) — 판매 진행 상황과 남은 일
- [PC 앱 진행 기록](docs/PC-MVP.md)
- [제품 요구사항(기획 문서)](docs/FindInside-기획문서.md) — 제품 범위의 기준
- 설계 결정: [docs/adr](docs/adr)

## 제품 원칙

- **Local-First:** 파일·메일 내용을 PC 밖으로 보내지 않습니다.
- **설명 가능한 결과:** 결과가 나온 근거와 문서 안 위치를 함께 보여 줍니다.
- **원본 보호:** 파일은 읽기만 하고 고치거나 지우지 않습니다. 메일도 서버에서 지우지 않습니다.
