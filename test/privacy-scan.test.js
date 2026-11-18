'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const S = require('../scripts/privacy-scan');

/*
 * The scanner must not find itself, so no sample below is written out whole:
 * every address, path and key is put together while the test runs.
 */
const at = '@';
const scan = (text) => {
  S.findings.length = 0;
  S.scanText('sample.txt', 'sample.txt', text);
  return S.findings.map((f) => f.kind);
};

test('an e-mail address is found, a GitHub noreply address is not', () => {
  assert.deepEqual(scan('write to ' + 'jane.doe' + at + 'mail' + '.com today'), ['email']);
  assert.deepEqual(scan('123+someone' + at + 'users.noreply.github' + '.com'), []);
  assert.deepEqual(scan('test' + at + 'example' + '.com'), []);
});

test('a private network address is found, the loopback address is not', () => {
  assert.deepEqual(scan('server at ' + ['192', '168', '1', '20'].join('.')), ['private-ip']);
  assert.deepEqual(scan('bind ' + ['127', '0', '0', '1'].join('.')), []);
});

test('a home folder with a user name is found, a placeholder one is not', () => {
  assert.deepEqual(scan('C:' + '\\Users\\' + 'Jane' + 'Doe\\notes.txt'), ['home-path']);
  assert.deepEqual(scan('/' + 'home/' + 'jdoe' + '/project'), ['home-path']);
  assert.deepEqual(scan('/' + 'home/' + 'me' + '/my-app'), []);
  assert.deepEqual(scan('C:' + '\\Users\\' + '<you>' + '\\x'), []);
});

test('credentials are found and their value is never printed', () => {
  const key = 'sk' + '-ant-' + 'a'.repeat(30);
  S.findings.length = 0;
  S.scanText('k.txt', 'k.txt', 'key=' + key);
  assert.equal(S.findings[0].kind, 'credential');
  assert.ok(!S.findings[0].detail.includes(key));
});

test('text hidden in a PNG is found', () => {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
  };
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = chunk('IHDR', Buffer.alloc(13));
  const clean = Buffer.concat([sig, ihdr, chunk('IDAT', zlib.deflateSync(Buffer.alloc(4))), chunk('IEND', Buffer.alloc(0))]);
  const tagged = Buffer.concat([sig, ihdr, chunk('tEXt', Buffer.from('Author\0someone', 'latin1')), chunk('IEND', Buffer.alloc(0))]);
  S.findings.length = 0;
  S.scanImage('a.png', 'a.png', clean);
  assert.equal(S.findings.length, 0);
  S.scanImage('b.png', 'b.png', tagged);
  assert.equal(S.findings[0].kind, 'image-metadata');
});

test('blocked values match whatever their spelling', () => {
  const v = S.fold('Some-Name');
  for (const variant of ['some name', 'SOME_NAME', 'some​name', 'Somé-Name']) {
    assert.ok(S.fold(variant).includes(v) || S.fold(variant) === S.fold('Some-Name'), variant);
  }
});
