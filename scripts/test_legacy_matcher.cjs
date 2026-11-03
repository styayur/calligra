/** Exercise actual legacy build consumers with the fixed parser, using own data. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const desktop = createRequire(path.join(root, 'apps/desktop/package.json'));
const matcher = desktop('minimatch');
assert.equal(desktop('minimatch/package.json').name, 'calligra-legacy-matcher');
assert.equal(desktop('minimatch-modern/package.json').version, '11.0.1');
for (const name of ['glob', '@electron/asar', 'dir-compare', 'filelist']) {
  const consumer = createRequire(desktop.resolve(name));
  assert.equal(consumer('minimatch/package.json').name, 'calligra-legacy-matcher', name);
  assert.equal(consumer('minimatch'), matcher, name);
}
for (const name of ['app-builder-lib', '@electron/universal']) {
  const consumer = createRequire(desktop.resolve(name));
  assert.equal(consumer('minimatch/package.json').version, '11.0.1', name);
  assert.equal(typeof consumer('minimatch').minimatch, 'function');
}
assert.equal(matcher.defaults({ nocase: true })('A.TXT', '*.txt'), true);
assert.equal(new matcher.Minimatch('**/*.txt').match('dir/笔记.txt'), true);
assert.deepEqual(matcher.braceExpand('file{1..3}.txt'), ['file1.txt','file2.txt','file3.txt']);
const child = spawnSync(process.execPath, ['--max-old-space-size=128', '-e',
  `const m=require(${JSON.stringify(desktop.resolve('minimatch'))});try{m('x','{a,b}'.repeat(100))}catch(e){if(!(e instanceof RangeError||e instanceof TypeError))throw e}`],
  { timeout: 3000, encoding: 'utf8' });
assert.equal(child.error, undefined, child.error?.message);
assert.equal(child.status, 0, child.stderr);
const work = path.join(root, 'work');fs.mkdirSync(work, {recursive:true});
const fixture = fs.mkdtempSync(path.join(work, 'matcher-acceptance-'));
const source = path.join(fixture, 'source'), copy = path.join(fixture, 'copy');
const files = ['a.txt','b.js','dir/c.txt','dir/deeper/d.md','dir/笔记.txt','.hidden.txt','native/addon.node'];
for (const base of [source, copy]) for (const file of files) {
  const dest = path.join(base,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest, 'own synthetic '+file);
}
const previous = process.cwd();
(async () => {
  try {
    const matches = desktop('glob').sync('**/*.txt',{cwd:source,dot:true,nodir:true}).sort();
    assert.deepEqual(matches, ['.hidden.txt','a.txt','dir/c.txt','dir/笔记.txt']);
    process.chdir(source);
    const list = new (desktop('filelist').FileList)('*.txt');list.exclude('*.missing');
    assert.deepEqual(list.toArray().sort(), ['a.txt']);
    process.chdir(previous);
    fs.writeFileSync(path.join(copy,'ignored.tmp'),'own ignored content');
    const result = desktop('dir-compare').compareSync(source,copy,{compareContent:true,includeFilter:'*.txt',excludeFilter:'*.tmp'});
    assert.equal(result.same, true);
    fs.writeFileSync(path.join(copy,'a.txt'),'own changed content');
    assert.equal(desktop('dir-compare').compareSync(source,copy,{compareContent:true,excludeFilter:'*.tmp'}).same,false);
    const asar = desktop('@electron/asar'), archive = path.join(fixture,'synthetic.asar');
    await asar.createPackageWithOptions(source, archive, {unpack:'*.node',unpackDir:'**/native'});
    assert.equal(asar.extractFile(archive,'dir/笔记.txt').toString(), 'own synthetic dir/笔记.txt');
    assert.equal(asar.statFile(archive,'native/addon.node').unpacked,true);
    assert.equal(fs.readFileSync(archive+'.unpacked/native/addon.node','utf8'),'own synthetic native/addon.node');
    console.log('PASS: fixed parser; glob7 traversal, filelist5 exclusions, dir-compare filters, ASAR pack/unpack, modern builder API, bounded adversarial braces');
  } finally {
    process.chdir(previous);
    assert.ok(path.resolve(fixture).startsWith(path.resolve(work)+path.sep));
    fs.rmSync(fixture,{recursive:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
