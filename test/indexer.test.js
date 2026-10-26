"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { indexRoots, isExcluded, isChurn, catchUp, INDEX_FORMAT } = require("../src/indexer");
const { updateEntries } = require("../src/search");

test("제외 폴더와 그 하위 경로를 제외한다", () => {
  const excluded = [path.join("D:", "업무")];
  assert.equal(isExcluded(path.join("D:", "업무"), excluded), true);
  assert.equal(isExcluded(path.join("D:", "업무", "서버", "설치정보.xlsx"), excluded), true);
});

test("이름이 제외 폴더로 시작하는 다른 폴더는 제외하지 않는다", () => {
  const excluded = [path.join("D:", "업무")];
  assert.equal(isExcluded(path.join("D:", "업무자료", "회의록.docx"), excluded), false);
});

test("제외 폴더는 대소문자를 구분하지 않는다", () => {
  const excluded = [path.join("D:", "Work", "Private")];
  assert.equal(isExcluded(path.join("D:", "work", "private", "a.txt"), excluded), true);
});

test("색인 시 제외 폴더 아래 항목을 건너뛴다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "업무"));
  await fs.mkdir(path.join(root, "업무자료"));
  await fs.writeFile(path.join(root, "업무", "비공개.txt"), "");
  await fs.writeFile(path.join(root, "업무자료", "설치정보.xlsx"), "");

  const { entries } = await indexRoots([root], { excludedPaths: [path.join(root, "업무")] });
  const names = entries.map((entry) => entry.name).sort();
  assert.deepEqual(names, ["설치정보.xlsx", "업무자료"]);
});

test("색인: 폴더 항목에 수정 시각을 적고 형식 번호를 붙인다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "a", "b"), { recursive: true });
  await fs.writeFile(path.join(root, "a", "b", "c.txt"), "");
  const result = await indexRoots([root]);
  assert.equal(result.format, INDEX_FORMAT);
  assert.deepEqual(result.entries.map((entry) => entry.name).sort(), ["a", "b", "c.txt"]);
  for (const folder of result.entries.filter((entry) => entry.kind === "folder")) assert.equal(typeof folder.mtime, "number");
});

test("켤 때 따라잡기: 꺼져 있던 동안 생기고 지워진 파일·폴더를 바뀐 폴더만 다시 읽어 찾는다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // 임시 폴더(Temp)는 평소에는 따라잡기에서 빼는 곳이라 테스트에서는 빼지 않게 한다
  const options = { skip: () => false };
  await fs.mkdir(path.join(root, "문서", "깊은곳"), { recursive: true });
  await fs.mkdir(path.join(root, "지울폴더", "안"), { recursive: true });
  await fs.mkdir(path.join(root, "그대로"));
  await fs.writeFile(path.join(root, "문서", "깊은곳", "옛파일.txt"), "");
  await fs.writeFile(path.join(root, "지울폴더", "안", "x.txt"), "");
  await fs.writeFile(path.join(root, "그대로", "y.txt"), "");
  const { entries } = await indexRoots([root]);

  // 바로 바꾸면 수정 시각(ms)이 같을 수 있다
  await new Promise((resolve) => setTimeout(resolve, 30));
  await fs.writeFile(path.join(root, "문서", "깊은곳", "새파일.txt"), "");
  await fs.rm(path.join(root, "문서", "깊은곳", "옛파일.txt"));
  await fs.mkdir(path.join(root, "새폴더", "속"), { recursive: true });
  await fs.writeFile(path.join(root, "새폴더", "속", "z.txt"), "");
  await fs.rm(path.join(root, "지울폴더"), { recursive: true });

  const result = await catchUp(entries, [root], options);
  const relative = (list) => list.map((target) => path.relative(root, target)).sort();
  assert.deepEqual(relative(result.added.filter((entry) => entry.kind === "file").map((entry) => entry.path)),
    [path.join("문서", "깊은곳", "새파일.txt"), path.join("새폴더", "속", "z.txt")]);
  assert.deepEqual(relative(result.removed),
    [path.join("문서", "깊은곳", "옛파일.txt"), "지울폴더", path.join("지울폴더", "안"), path.join("지울폴더", "안", "x.txt")]);
  // 바뀌지 않은 폴더는 다시 읽지 않는다 (최상위 + 바뀐 폴더 "깊은곳"만)
  assert.equal(result.changed, 2);

  // 반영한 뒤 다시 따라잡으면 바뀐 것이 없다
  updateEntries(entries, result.added, result.removed);
  const again = await catchUp(entries, [root], options);
  assert.deepEqual(again.removed, []);
  assert.deepEqual(again.added.filter((entry) => entry.kind === "file"), []);
  assert.equal(again.changed, 1);
});

test("켤 때 따라잡기: 폴더 감시가 폴더만 지우고 남긴 안쪽 항목을 정리한다", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "findinside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "a"));
  await fs.writeFile(path.join(root, "a", "x.txt"), "");
  const { entries } = await indexRoots([root]);
  await fs.rm(path.join(root, "a"), { recursive: true });
  updateEntries(entries, [], [path.join(root, "a")]);
  const result = await catchUp(entries, [root], { skip: () => false });
  assert.deepEqual(result.removed, [path.join(root, "a", "x.txt")]);
});

test("늘 바뀌는 폴더(Temp·AppData 등)는 따라잡기에서 빼되, 그런 곳을 검색 위치로 직접 골랐으면 그 안은 뺀다고 보지 않는다", () => {
  const driveC = path.win32.join("C:", path.win32.sep);
  const driveD = path.win32.join("D:", path.win32.sep);
  assert.equal(isChurn(String.raw`C:\Users\me\AppData\Local\x`, [driveC]), true);
  assert.equal(isChurn(String.raw`C:\Windows\System32`, [driveC]), true);
  assert.equal(isChurn(String.raw`D:\업무\보고서`, [driveD]), false);
  assert.equal(isChurn(String.raw`D:\tmp\자료\a`, [String.raw`D:\tmp\자료`]), false);
  assert.equal(isChurn(String.raw`D:\tmp\다른곳`, [String.raw`D:\tmp\자료`]), true);
});
