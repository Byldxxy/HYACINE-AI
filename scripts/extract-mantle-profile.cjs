const fs=require('node:fs'),THREE=require('three');
const bytes=fs.readFileSync(__dirname+'/../third_party/motions/quaternius/ClimbUp_1m.glb');
const len=bytes.readUInt32LE(12),j=JSON.parse(bytes.subarray(20,20+len)),binary=bytes.subarray(28+len);
function accessor(i){const a=j.accessors[i],v=j.bufferViews[a.bufferView],n={SCALAR:1,VEC3:3,VEC4:4}[a.type],out=[];for(let k=0;k<a.count;k++)for(let c=0;c<n;c++)out.push(binary.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+k*(v.byteStride||n*4)+c*4));return out;}
const root=new THREE.Group(),nodes=j.nodes.map(n=>{const o=new THREE.Object3D();o.name=n.name;if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);return o;});
j.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>nodes[i].add(nodes[c])));nodes.filter(n=>!n.parent).forEach(n=>root.add(n));root.updateMatrixWorld(true);
const bone=name=>nodes.find(n=>n.name===name),pos=name=>bone(name).getWorldPosition(new THREE.Vector3());
const leg=pos('pelvis').distanceTo(pos('foot_l')),arm=pos('hand_l').distanceTo(pos('lowerarm_l'))+pos('lowerarm_l').distanceTo(pos('upperarm_l'));
const a=j.animations.find(a=>a.name==='ClimbUp_1m');const tracks=a.channels.map(c=>{const sam=a.samplers[c.sampler],p=c.target.path,Type=p==='rotation'?THREE.QuaternionKeyframeTrack:THREE.VectorKeyframeTrack;return new Type(nodes[c.target.node].uuid+'.'+({translation:'position',rotation:'quaternion',scale:'scale'}[p]),accessor(sam.input),accessor(sam.output));});
const clip=new THREE.AnimationClip('ClimbUp_1m',-1,tracks),mixer=new THREE.AnimationMixer(root);mixer.clipAction(clip).setLoop(THREE.LoopOnce,1).play();
const samples=[];
for(let k=0;k<=60;k++){mixer.setTime(Math.min(clip.duration-.0001,k/60*clip.duration));root.updateMatrixWorld(true);const frame={};for(const [side,suffix]of[['left','l'],['right','r']]){const hand=pos('hand_'+suffix).sub(pos('upperarm_'+suffix));const foot=pos('foot_'+suffix).sub(pos('pelvis'));frame[side]={hand:[Math.abs(hand.x)/arm,hand.y/arm,Math.abs(hand.z)/arm],foot:[foot.y/leg,Math.abs(foot.z)/leg]};}samples.push(frame);}
console.log('Extracted ClimbUp_1m:',samples.length,'samples');
fs.writeFileSync(__dirname+'/../src/pet/runtime/mantleProfile.json',JSON.stringify({source:'Quaternius Universal Animation Library 2 / ClimbUp_1m',license:'CC0-1.0',duration:clip.duration,samples}, (_key, value) => typeof value === 'number' ? Math.round(value * 1e5) / 1e5 : value)+'\n');
