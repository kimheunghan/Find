// Cloudflare Pages 함수: findinside.pages.dev/download/<파일 이름> → GitHub 릴리스 첨부를 받아 그대로 넘겨준다.
// 설치 파일이 108MB라 Pages(파일당 25MB)에 직접 둘 수 없어 GitHub 릴리스에 두는데, 링크를 github.com으로 걸면
// 휴대폰 "다운로드" 목록에 출처가 github.com으로 찍히고, GitHub 앱이 깔린 휴대폰은 앱이 열린다.
// 이 함수를 거치면 주소가 끝까지 pages.dev라 출처도 findinside.pages.dev가 된다 (족보 jocbo.pages.dev와 같은 방식).
// 저장소 루트의 functions/는 Cloudflare만 쓴다. Netlify는 netlify.toml의 리디렉션으로 GitHub에 넘긴다.
const RELEASES = "https://github.com/kimheunghan/findinside-download/releases";

export async function onRequest({ request, params }) {
  const file = String(params.file || "");
  // Find_Setup_v1.0.4.exe → 그 버전 릴리스(v1.0.4)에서, 예전 이름 Find_Setup.exe → 가장 새 릴리스에서
  const match = /^Find_Setup(?:_v(\d+\.\d+\.\d+))?\.exe$/.exec(file);
  if (!match) return new Response("Not found", { status: 404 });
  const source = match[1] ? `${RELEASES}/download/v${match[1]}/${file}` : `${RELEASES}/latest/download/${file}`;

  const upstream = await fetch(source, { method: request.method === "HEAD" ? "HEAD" : "GET", redirect: "follow", cf: { cacheEverything: true, cacheTtl: 86400 } });
  if (!upstream.ok) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${file}"`,
    "Cache-Control": "public, max-age=86400"
  });
  const length = upstream.headers.get("Content-Length");
  if (length) headers.set("Content-Length", length);
  return new Response(request.method === "HEAD" ? null : upstream.body, { status: 200, headers });
}
