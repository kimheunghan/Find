"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { indexRoots, isExcluded } = require("../src/indexer");

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
