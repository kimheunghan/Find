"use strict";

// 스토어 스크린샷용 예시 문서 폴더를 만든다 (모두 지어낸 내용, 실제 회사·사람과 무관).
// 실행: node scripts/store-demo.js <폴더>
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];
if (!dir) throw new Error("폴더를 지정하세요");
const files = {
  "프로젝트/서버설치정보.csv": "구분,서버명,IP,OS,용도\nWEB,web01,192.168.10.21,Rocky Linux 9,홈페이지\nWAS,was01,192.168.10.22,Rocky Linux 9,업무 시스템\nDB,db01,192.168.10.30,Ubuntu 22.04,PostgreSQL 16\n백업,bak01,192.168.10.40,Windows Server 2022,야간 백업\n",
  "프로젝트/회의록_2026-09-21.txt": "주간 회의록 (2026-09-21)\n\n참석: 기획팀, 개발팀, 운영팀\n\n1. 서버 이전 일정\n - 운영 서버 IP 대역은 192.168.10.0/24로 유지한다.\n - DB 서버는 10월 둘째 주에 이전한다.\n\n2. 견적 검토\n - 한빛솔루션 견적 단가 1,200만원, 설치 포함.\n - 다음 회의 때 최종 결정.\n",
  "견적/견적서_한빛솔루션.txt": "견 적 서\n\n수신: 가나다상사 구매팀\n품명: 문서 관리 시스템 구축\n수량: 1식\n단가: 12,000,000원 (부가세 별도)\n납기: 계약 후 4주\n비고: 서버 3대 설치, 1년 무상 유지보수 포함\n",
  "견적/견적서_누리테크.txt": "견 적 서\n\n수신: 가나다상사 구매팀\n품명: 문서 관리 시스템 구축\n단가: 13,500,000원 (부가세 별도)\n비고: 클라우드 설치, 교육 2회 포함\n",
  "거래처/거래처_연락처.csv": "회사,담당자,전화,이메일\n한빛솔루션,박지훈,02-1234-5678,park@hanbit.example\n누리테크,이서연,031-555-0101,lee@nuri.example\n가온정보,최민수,02-777-8888,choi@gaon.example\n",
  "기획/2026_하반기_사업계획.md": "# 2026 하반기 사업계획\n\n## 목표\n- 신규 고객 30곳 확보\n- 문서 관리 시스템 매출 20% 증가\n\n## 주요 일정\n- 10월: 서버 이전 완료\n- 11월: 신제품 출시\n- 12월: 연간 결산\n",
  "기획/신제품_출시_체크리스트.txt": "신제품 출시 체크리스트\n\n[ ] 제품 소개 자료 확정\n[ ] 가격표 확정 (정가 29,000원)\n[ ] 홈페이지 공지\n[ ] 고객 안내 메일 발송\n",
  "운영/점검일지_2026-09.log": "2026-09-01 09:00 web01 정상\n2026-09-01 09:00 db01 디스크 사용률 71%\n2026-09-15 09:00 was01 재시작 (메모리 부족)\n2026-09-29 09:00 전체 서버 정상\n"
};
for (const [name, text] of Object.entries(files)) {
  const target = path.join(dir, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "﻿" + text);
}
console.log(`예시 문서 ${Object.keys(files).length}개: ${dir}`);
