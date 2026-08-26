'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../server/paths');

const WIN = process.platform === 'win32';

test('encodeProjectFolder reproduces real Claude Code folder names', () => {
  // Every pair below was taken from a live ~/.claude/projects tree.
  const cases = [
    ['D:\\Files\\Projects\\AI_Chat_Extractor', 'd--Files-Projects-AI-Chat-Extractor'],
    ['d:\\Files\\Projects\\Digital_Hardware_Share', 'd--Files-Projects-Digital-Hardware-Share'],
    ['D:\\Files\\Projects\\Home_Gym_App', 'd--Files-Projects-Home-Gym-App'],
    ['D:\\Files\\Projects\\Photo_Similarity_Detector', 'd--Files-Projects-Photo-Similarity-Detector'],
    ['D:\\Files\\Projects\\WindowsDNSChanger', 'd--Files-Projects-WindowsDNSChanger'],
    ['d:\\Files\\Projects\\WindowsDNSChanger\\V2RayIssue', 'd--Files-Projects-WindowsDNSChanger-V2RayIssue'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(P.encodeProjectFolder(input), expected, input);
  }
});

test('the drive letter is lowercased, the rest keeps its case', () => {
  assert.equal(P.encodeProjectFolder('D:\\Foo\\BarBaz'), 'd--Foo-BarBaz');
  assert.equal(P.encodeProjectFolder('d:\\Foo\\BarBaz'), 'd--Foo-BarBaz');
});

test('every non-alphanumeric character becomes exactly one dash', () => {
  assert.equal(P.encodeProjectFolder('C:\\a b\\c_d\\e.f\\g-h'), 'c--a-b-c-d-e-f-g-h');
  assert.equal(P.encodeProjectFolder('C:\\a\\\\b'), 'c--a--b');
});

test('forward and backward slashes encode identically', () => {
  assert.equal(P.encodeProjectFolder('E:/Dev/App'), P.encodeProjectFolder('E:\\Dev\\App'));
});

test('trailing separators are ignored', () => {
  assert.equal(P.encodeProjectFolder('D:\\Foo\\Bar\\'), 'd--Foo-Bar');
  assert.equal(P.encodeProjectFolder('D:\\Foo\\Bar'), 'd--Foo-Bar');
});

// --- non-Latin scripts --------------------------------------------------
// These are the cases that surprise people: the rule is per character, so a
// five-letter Persian folder name becomes five dashes.

test('Persian paths encode one dash per character', () => {
  // Modelled on a real folder name from a Windows machine, with the naming
  // anonymised. The shape that matters is intact: sixteen segments, a
  // five-character Persian one, spaces, and literal dashes inside a segment.
  const full = 'C:\\Users\\Sara\\Documents\\Files\\Archive\\Notes\\Quiz\\'
    + 'کوییز\\4- Working\\Team\\App\\Live\\Seasons\\Cycle 75 - Winter\\Survey Tool';
  const expected = 'c--Users-Sara-Documents-Files-Archive-Notes-Quiz-------'
    + '4--Working-Team-App-Live-Seasons-Cycle-75---Winter-Survey-Tool';
  assert.equal(P.encodeProjectFolder(full), expected);
});

test('a five-character Persian segment produces exactly seven dashes between its neighbours', () => {
  const encoded = P.encodeProjectFolder('C:\\Quiz\\کوییز\\4- Working');
  const between = /Quiz(-+)4/.exec(encoded)[1].length;
  assert.equal('کوییز'.length, 5);
  assert.equal(between, 7, '1 separator + 5 characters + 1 separator');
});

test('zero-width non-joiner counts as a character', () => {
  // "نیم‌فاصله" is 3 letters + U+200C + 5 letters = 9 characters, so the
  // segment contributes 9 dashes on top of the separator in front of it.
  const encoded = P.encodeProjectFolder('C:\\a\\نیم\u200Cفاصله');
  assert.equal(encoded, 'c--a' + '-'.repeat(10));
  assert.equal(encoded.includes('\u200C'), false, 'the invisible character becomes a visible dash');
});

test('other scripts follow the same rule', () => {
  // ':' + '\' + two ideographs
  assert.equal(P.encodeProjectFolder('C:\\项目'), 'c' + '-'.repeat(4));
  // ':' + '\' + six Cyrillic letters
  assert.equal(P.encodeProjectFolder('C:\\Проект'), 'c' + '-'.repeat(8));
});

test('unrelated paths of equal non-ASCII length collide, which the app must detect', () => {
  // Not a bug in this tool -- a property of the encoding. The scanner reports
  // it as an "ambiguous" folder rather than silently picking one project.
  assert.equal('کوییز'.length, 'سلامت'.length);
  assert.equal(
    P.encodeProjectFolder('C:\\Work\\کوییز'),
    P.encodeProjectFolder('C:\\Work\\سلامت'),
  );
});

// --- comparison and re-rooting -----------------------------------------

test('replacePrefix re-roots a path and preserves the tail', () => {
  const out = P.replacePrefix('D:\\Files\\Projects\\Foo\\src\\a.js', 'D:\\Files\\Projects\\Foo', 'E:\\Dev\\Foo');
  assert.equal(out, WIN ? 'E:\\Dev\\Foo\\src\\a.js' : 'E:/Dev/Foo/src/a.js');
});

test('replacePrefix matches the root itself', () => {
  const out = P.replacePrefix('D:\\Files\\Foo', 'D:\\Files\\Foo', 'E:\\Bar');
  assert.equal(out, WIN ? 'E:\\Bar' : 'E:/Bar');
});

test('replacePrefix returns null for paths outside the root', () => {
  assert.equal(P.replacePrefix('D:\\Other\\x', 'D:\\Files', 'E:\\Dev'), null);
});

test('replacePrefix does not match a sibling with a shared prefix', () => {
  // "D:\Files2" must not be treated as living under "D:\Files".
  assert.equal(P.replacePrefix('D:\\Files2\\x', 'D:\\Files', 'E:\\Dev'), null);
});

test('replacePrefix preserves non-ASCII tails', () => {
  const out = P.replacePrefix('C:\\Work\\کوییز\\src\\فایل.js', 'C:\\Work\\کوییز', 'E:\\New\\کوییز');
  assert.match(out, /فایل\.js$/);
});

test('a drive letter folds on every platform, not just Windows', () => {
  // Claude Code records both "D:\..." and "d:\..." for one project, and a
  // Windows store is often inspected on Linux or macOS. If the drive letter
  // only folded on Windows, those two spellings would look like two separate
  // projects there and the folder would be reported as shared.
  assert.ok(P.pathsEqual('D:\\Files\\Foo', 'd:\\Files\\Foo'));
  assert.ok(P.isUnder('d:\\Files\\Foo\\bar', 'D:\\Files\\Foo'));
  assert.equal(P.foldCase('D:\\Files\\Foo'), P.foldCase('d:\\Files\\Foo'));
  assert.equal(P.replacePrefix('d:\\Files\\Foo\\a.js', 'D:\\Files\\Foo', 'E:\\Bar'),
    WIN ? 'E:\\Bar\\a.js' : 'E:/Bar/a.js');
});

test('folding a drive letter does not fold the rest of a POSIX path', () => {
  if (WIN) return;   // on Windows everything folds anyway
  assert.equal(P.pathsEqual('/home/Foo', '/home/foo'), false);
});

if (WIN) {
  test('Windows path comparison ignores case', () => {
    assert.ok(P.pathsEqual('D:\\Files\\Foo', 'd:\\files\\FOO'));
    assert.ok(P.isUnder('D:\\Files\\Foo\\bar', 'd:\\FILES\\foo'));
    assert.equal(P.replacePrefix('D:\\Files\\Foo\\a', 'd:\\files\\foo', 'E:\\X'), 'E:\\X\\a');
  });
}

test('isUnder rejects siblings and unrelated paths', () => {
  assert.equal(P.isUnder('D:\\Files2\\a', 'D:\\Files'), false);
  assert.equal(P.isUnder('D:\\Other', 'D:\\Files'), false);
  assert.ok(P.isUnder('D:\\Files', 'D:\\Files'));
});

test('looksAbsolute accepts drive and UNC paths, rejects relative ones', () => {
  assert.ok(P.looksAbsolute('D:\\Foo'));
  assert.ok(P.looksAbsolute('D:/Foo'));
  assert.ok(P.looksAbsolute('\\\\server\\share'));
  assert.equal(P.looksAbsolute('Foo\\Bar'), false);
  assert.equal(P.looksAbsolute('..\\Foo'), false);
  assert.equal(P.looksAbsolute(''), false);
});

test('isSafeFolderName blocks traversal', () => {
  assert.ok(P.isSafeFolderName('d--Files-Projects-Foo'));
  assert.equal(P.isSafeFolderName('..'), false);
  assert.equal(P.isSafeFolderName('a/b'), false);
  assert.equal(P.isSafeFolderName('a\\b'), false);
  assert.equal(P.isSafeFolderName(''), false);
});
