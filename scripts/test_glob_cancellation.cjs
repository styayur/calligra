/** The actual Capacitor/rimraf glob dependency must stop traversal after abort. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),web=createRequire(path.join(root,'apps/web/package.json'));
const rimrafEntry=web.resolve('rimraf'),consumer=createRequire(rimrafEntry);
const {glob,globSync}=consumer('glob');
assert.equal(consumer('glob/package.json').version,'14.0.3');
const work=path.join(root,'work');fs.mkdirSync(work,{recursive:true});
const fixture=fs.mkdtempSync(path.join(work,'glob-abort-'));
for(const file of ['root.txt','keep.md','dir/deep/leaf.txt']){
  const dest=path.join(fixture,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,'own synthetic fixture');
}
(async()=>{
 try{
  assert.deepEqual(globSync('**/*.txt',{cwd:fixture}).map(file=>file.split(path.sep).join('/')).sort(),['dir/deep/leaf.txt','root.txt']);
  const controller=new AbortController();let reads=0;
  const instrumented={...fs,readdir(...args){reads++;controller.abort(new Error('synthetic-abort'));return fs.readdir(...args);}};
  await assert.rejects(glob('**/*',{cwd:fixture,fs:instrumented,signal:controller.signal}),/synthetic-abort/);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(reads,1,'aborted traversal must not schedule deeper directory reads');
  const pattern=path.join(fixture,'*.txt').split(path.sep).join('/');
  assert.equal(await web('rimraf').rimraf(pattern,{glob:true}),true);
  assert.equal(fs.existsSync(path.join(fixture,'root.txt')),false);
  assert.equal(fs.existsSync(path.join(fixture,'dir/deep/leaf.txt')),true);
  assert.equal(fs.existsSync(path.join(fixture,'keep.md')),true);
  console.log('PASS: actual rimraf glob14 positive recursion, immediate cancellation without extra traversal, confined glob deletion and preserved synthetic siblings');
 }finally{
  assert.ok(path.resolve(fixture).startsWith(path.resolve(work)+path.sep));
  fs.rmSync(fixture,{recursive:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1});
