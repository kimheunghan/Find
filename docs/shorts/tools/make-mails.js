// 가짜 메일(.eml) 만들기: node make-mails.js <repo> <첨부 샘플 폴더> <출력 폴더>
const fs = require("fs"), path = require("path");
const [, , repo, samples, out] = process.argv;

const b64 = (buf) => buf.toString("base64").replace(/.{76}/g, "$&\r\n");
const enc = (text) => `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
const addr = (a) => a.replace(/^(.*?) <(.*)>$/, (_, name, email) => `${enc(name)} <${email}>`);
const att = (name) => ({ filename: name, content: fs.readFileSync(path.join(samples, name)) });

function build(m) {
  const bd = `----=_Part_${Math.random().toString(36).slice(2)}`;
  const parts = [`--${bd}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(Buffer.from(m.text, "utf8"))}\r\n`];
  for (const a of m.attachments) {
    parts.push(`--${bd}\r\nContent-Type: application/octet-stream; name="${enc(a.filename)}"\r\nContent-Disposition: attachment; filename="${enc(a.filename)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${b64(a.content)}\r\n`);
  }
  return Buffer.from([
    `From: ${addr(m.from)}`, `To: ${addr(m.to)}`, `Subject: ${enc(m.subject)}`, `Date: ${new Date(m.date).toUTCString()}`,
    "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${bd}"`, "", ...parts, `--${bd}--`, ""
  ].join("\r\n"));
}

const mails = [
  { file: "견적서 송부의 건.eml", date: "2026-09-22T10:12:00+09:00", from: "가나시스템 영업팀 <sales@ganasystem.example>", to: "한빛상사 구매팀 <buy@hanbit.example>",
    subject: "[가나시스템] 서버 구축 견적서 송부의 건", text: "안녕하세요, 가나시스템 영업팀입니다.\r\n요청하신 서버 구축 견적서를 첨부로 보내 드립니다.\r\n검토 후 회신 부탁드립니다.",
    attachments: [att("2026_서버구축_견적서_최종.hwp"), att("2026_부품_단가표.xlsx")] },
  { file: "RE 견적 단가 조정 요청.eml", date: "2026-09-29T15:40:00+09:00", from: "가나시스템 영업팀 <sales@ganasystem.example>", to: "한빛상사 구매팀 <buy@hanbit.example>",
    subject: "RE: 견적 단가 조정 요청드립니다", text: "말씀하신 대로 조정한 견적서를 다시 보내 드립니다.\r\n유지보수 1년을 포함했습니다.",
    attachments: [att("2026_서버구축_견적서_최종(2).hwp")] },
  { file: "유지보수 계약서 초안.eml", date: "2026-10-02T09:05:00+09:00", from: "한빛상사 법무팀 <legal@hanbit.example>", to: "한빛상사 구매팀 <buy@hanbit.example>",
    subject: "유지보수 계약서 초안 검토 요청", text: "계약서 초안입니다. 제3조 장애 대응 시간 확인 부탁드립니다.",
    attachments: [att("유지보수_계약서_샘플.pdf")] },
  { file: "서버 점검 공지.eml", date: "2026-10-08T17:30:00+09:00", from: "한빛상사 전산팀 <it@hanbit.example>", to: "전 직원 <all@hanbit.example>",
    subject: "[공지] 10월 18일 서버 점검 안내", text: "이번 주 토요일 서버 점검이 있습니다. 자세한 내용은 첨부 이미지를 확인해 주세요.",
    attachments: [att("서버점검_공지_캡처.png")] },
  { file: "주간 회의록 공유.eml", date: "2026-10-06T18:10:00+09:00", from: "한빛상사 전산팀 <it@hanbit.example>", to: "한빛상사 구매팀 <buy@hanbit.example>",
    subject: "10월 주간 회의록 공유드립니다", text: "회의록 첨부합니다. 안건 2 견적 단가 재검토 건은 구매팀에서 확인 부탁드립니다.",
    attachments: [att("10월_주간회의록.hwpx")] }
];

for (const m of mails) fs.writeFileSync(path.join(out, m.file), build(m));
console.log(fs.readdirSync(out).join("\n"));
