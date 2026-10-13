// Cloudflare Pages 미들웨어: pages.dev로 들어온 페이지 요청을 대표 주소 netlify.app의 같은 주소로 301로 넘긴다.
// 같은 내용이 두 주소로 색인돼 구글이 한쪽을 숨기고 점수가 나뉘던 것을 한 곳에 모은다 (2026-10-13 결정).
// /download/ 는 넘기지 않는다 — 설치 파일은 functions/download가 계속 내주고, Netlify도 netlify.toml 프록시로 여기서 받아 간다.
// Netlify는 functions/ 폴더를 쓰지 않으므로 이 파일은 netlify.app에 영향이 없다.
export async function onRequest(context) {
  const url = new URL(context.request.url);
  if (url.pathname.startsWith("/download/")) return context.next();
  return Response.redirect("https://findinside.netlify.app" + url.pathname + url.search, 301);
}
