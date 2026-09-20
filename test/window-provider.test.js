const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readWindowList } = require('../electron/window-provider');

test('macOS reader handles opaque CFArrayRef and outputs only geometry metadata', () => {
    const script = fs.readFileSync(path.join(__dirname,'../electron/native/window-list.js'),'utf8');
    const opaque = {}, list = [{ kCGWindowNumber: 4, kCGWindowOwnerPID: 5, kCGWindowLayer: 0, kCGWindowAlpha: 1, kCGWindowName: 'PRIVATE WINDOW TITLE', kCGWindowBounds: { X: 10, Y: 20, Width: 600, Height: 400 } }];
    const context = { ObjC: { import() {}, deepUnwrap: value => value, castRefToObject: value => value === opaque ? list : value }, $: { CGWindowListCopyWindowInfo: () => opaque } };
    const data = JSON.parse(vm.runInNewContext(script, context));
    assert.equal(data.length,1); assert.deepEqual(data[0].bounds,{x:10,y:20,width:600,height:400}); assert.equal(JSON.stringify(data).includes('PRIVATE'),false);
});
test('macOS reader also accepts older automatically bridged arrays', () => {
    const script=fs.readFileSync(path.join(__dirname,'../electron/native/window-list.js'),'utf8');
    const context={ ObjC:{import(){},deepUnwrap:v=>v,castRefToObject:()=>{throw new Error('unneeded cast')}}, $:{CGWindowListCopyWindowInfo:()=>[]} };
    assert.equal(vm.runInNewContext(script,context),'[]');
});
test('Windows query uses the packaged native script and normalizes a single result', async () => {
    let invocation;
    const result=await readWindowList({platform:'win32',run:async (exe,args,options)=>{invocation={exe,args,options};return {stdout:JSON.stringify({id:'4',pid:5,bounds:{x:0,y:0,width:600,height:400}})}}});
    assert.equal(invocation.exe,'powershell.exe'); assert.ok(invocation.args.at(-1).endsWith('window-list.ps1')); assert.equal(invocation.options.windowsHide,true);assert.equal(result.length,1);
});
test('unsupported platforms signal explicit screen-only fallback', async () => {
    await assert.rejects(readWindowList({platform:'linux'}),{code:'UNSUPPORTED_PLATFORM'});
});
