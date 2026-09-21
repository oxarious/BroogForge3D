import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { animate, hover } from 'motion';
import { createTimeline, stagger } from 'animejs';
import { createIcons, SlidersHorizontal, Grid2x2, MoveUpRight, ArrowUpRight, Pause, Play, X, RotateCcw, Download } from 'lucide';
import { defaults, finishes, normalizePreset } from './presets.js';

const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)');
let saved={};try{saved=JSON.parse(localStorage.getItem('broog-effects-flux')||'{}');}catch{}
let settings=normalizePreset(saved);
let manualStill=false;
const isStill=()=>reduce.matches||settings.still||manualStill;
const icons=()=>createIcons({icons:{SlidersHorizontal,Grid2x2,MoveUpRight,ArrowUpRight,Pause,Play,X,RotateCcw,Download}});
icons();
const save=()=>{try{localStorage.setItem('broog-effects-flux',JSON.stringify(settings));}catch{}};
let scene;
try{scene=createSculpture();}catch(error){console.warn('Sculpture unavailable',error);$('#scene-status').hidden=false;$('#scene-status').textContent='3D is unavailable. The material collection is still available.';}

function createSculpture(){
  const host=$('#scene'),renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
  renderer.setClearColor(0xe9eae6);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
  host.append(renderer.domElement);renderer.domElement.setAttribute('aria-hidden','true');
  const world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,60);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer),env=pmrem.fromScene(environment,.035);
  world.environment=env.texture;world.environmentIntensity=1.45;environment.dispose();pmrem.dispose();
  const material=new THREE.MeshStandardMaterial({color:0xb7bebd,metalness:1,roughness:.20,envMapIntensity:1.55});
  const geometry=new RoundedBoxGeometry(.105,.80,.53,2,.035);
  const blades=new THREE.InstancedMesh(geometry,material,80);blades.instanceMatrix.setUsage(THREE.DynamicDrawUsage);blades.frustumCulled=false;
  const group=new THREE.Group();group.add(blades);world.add(group);
  const rig=new THREE.Object3D(),point=new THREE.Vector2(),targetPoint=new THREE.Vector2();
  const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(-4,5,6);world.add(key);
  const fill=new THREE.DirectionalLight(0x9dafff,1.6);fill.position.set(5,-2,-2);world.add(fill);
  let frame=0,last=0,progress=0,targetProgress=0,spin=0,active=true,destroyed=false,idleUntil=performance.now()+14000;
  let width=1,height=1,eco=false,slow=0,samples=0,adaptiveDpr=1.5,previousRender=0;
  const ease=(a,b,x)=>THREE.MathUtils.smoothstep(x,a,b);
  function invalidate(wake=false){if(wake)idleUntil=performance.now()+7000;if(!frame&&active&&!document.hidden&&!destroyed)frame=requestAnimationFrame(render);}
  function resize(){const box=host.getBoundingClientRect();width=box.width;height=box.height;eco=settings.quality==='eco'||width<760;
    renderer.setPixelRatio(Math.min(devicePixelRatio,settings.quality==='high'?1.75:eco?1:adaptiveDpr));renderer.setSize(width,height);
    camera.aspect=width/height;camera.fov=width<760?40:36;camera.position.set(0,0,width<760?8.7:8.6);camera.updateProjectionMatrix();
    group.position.set(width<760?0:1.45,width<760?-.65:.03,0);group.scale.setScalar(width<760?Math.min(.80,width/460):1.05);invalidate();}
  function render(now){frame=0;if(destroyed||!active||document.hidden)return;
    if(eco&&now-previousRender<31){invalidate();return;}
    const dt=Math.min(.06,last?(now-last)/1000:.016);last=now;previousRender=now;
    progress=isStill()?targetProgress:THREE.MathUtils.damp(progress,targetProgress,8,dt);
    if(Math.abs(progress-targetProgress)<.0001)progress=targetProgress;
    if(isStill())point.set(0,0);else point.lerp(targetPoint,1-Math.exp(-9*dt));
    const automatic=!isStill()&&settings.speed>0&&now<idleUntil;
    if(automatic)spin+=dt*(.045+settings.speed*.13);
    const unfold=ease(.10,.74,progress),flow=ease(.68,1,progress);
    if(width<760)group.scale.setScalar(Math.min(.80,width/460)*(1-flow*.30));
    group.rotation.set(point.y*.13*settings.intensity,.20+point.x*.36*settings.intensity,-.29-flow*.90);
    for(let i=0;i<80;i++){
      const t=i/80,a=t*Math.PI*2+spin,helix=t*Math.PI*4+spin;
      rig.position.set(THREE.MathUtils.lerp(Math.cos(a)*1.33,Math.cos(helix)*1.05,unfold),THREE.MathUtils.lerp(Math.sin(a)*1.33,(t-.5)*4.4,unfold),THREE.MathUtils.lerp(Math.sin(a*2)*.23,Math.sin(helix)*1.05,unfold));
      rig.rotation.set(.16+unfold*.25,THREE.MathUtils.lerp(a*.5+.35,helix+.4,unfold),THREE.MathUtils.lerp(a,Math.PI/2,unfold));
      rig.updateMatrix();blades.setMatrixAt(i,rig.matrix);
    }
    blades.instanceMatrix.needsUpdate=true;
    renderer.render(world,camera);host.classList.add('ready');
    Object.assign(renderer.domElement.dataset,{engine:'three.js',triangles:String(renderer.info.render.triangles),drawCalls:String(renderer.info.render.calls),progress:progress.toFixed(3),quality:eco?'eco':'full'});
    if(automatic||progress!==targetProgress||point.distanceTo(isStill()?new THREE.Vector2():targetPoint)>.001)invalidate();
    if(automatic&&dt<.06){samples++;if(dt>.029)slow++;if(samples>=100){if(slow>55&&adaptiveDpr>1){adaptiveDpr=1;resize();}samples=slow=0;}}
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  const intersection=new IntersectionObserver(entries=>{active=entries[0].isIntersecting;if(active){last=0;invalidate();}else{cancelAnimationFrame(frame);frame=0;}});intersection.observe(host);
  function pointer(event){if(event.pointerType==='touch'||isStill())return;targetPoint.set(event.clientX/innerWidth*2-1,1-event.clientY/innerHeight*2);invalidate(true);}
  document.addEventListener('pointermove',pointer,{passive:true});
  document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(frame);frame=0;last=0;if(!document.hidden)invalidate();});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();destroyed=true;cancelAnimationFrame(frame);host.classList.remove('ready');$('#scene-status').hidden=false;$('#scene-status').textContent='The 3D view was interrupted. Reload to restore it.';});
  window.addEventListener('pagehide',()=>{destroyed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();document.removeEventListener('pointermove',pointer);geometry.dispose();material.dispose();env.dispose();renderer.dispose();});
  resize();
  return {progress(value){targetProgress=value;invalidate();},finish(id){material.color.set(finishes[id].color);material.roughness=finishes[id].roughness;invalidate(true);},refresh(){resize();invalidate(true);}};
}

const names=['THE CLOSED FORM','A FIELD OF POSSIBILITIES','FORM, SET FREE'];
const copy=['One object.<br>Endless possibilities.','Nothing stays<br>ordinary for long.','A different point<br>of view.'];
let currentChapter=-1,scrollQueued=false;
function updateScroll(){scrollQueued=false;const journey=$('.journey'),height=journey.offsetHeight-$('.stage').offsetHeight;
  const p=Math.min(1,Math.max(0,-journey.getBoundingClientRect().top/Math.max(1,height)));scene?.progress(p);
  $('#progress').style.transform=`scaleX(${p})`;const chapter=p<.30?0:p<.76?1:2;
  if(chapter!==currentChapter){currentChapter=chapter;$('#object-state').textContent=names[chapter];$('#chapter-copy').innerHTML=copy[chapter];
    $$('[data-chapter]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.chapter===chapter)));
    if(!isStill())animate($('#chapter-copy'),{opacity:[0,1],y:[8,0]},{duration:.5});
  }
}
window.addEventListener('scroll',()=>{if(!scrollQueued){scrollQueued=true;requestAnimationFrame(updateScroll);}},{passive:true});
window.addEventListener('resize',updateScroll);updateScroll();
function goToChapter(chapter){const points=[0,.53,1],height=$('.journey').offsetHeight-$('.stage').offsetHeight;window.scrollTo({top:points[chapter]*height,behavior:isStill()?'instant':'smooth'});}
$$('[data-chapter]').forEach(button=>button.addEventListener('click',()=>goToChapter(+button.dataset.chapter)));
$('#unfold').addEventListener('click',()=>goToChapter(currentChapter===2?0:currentChapter+1));

function setFinish(id){settings.finish=id;scene?.finish(id);$('#finish-name').textContent=finishes[id].name;
  $('#scene .poster').src=`./assets/${id}.webp`;$$('[data-finish]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.finish===id)));save();}
$$('[data-finish]').forEach(button=>button.addEventListener('click',()=>setFinish(button.dataset.finish)));
$$('[data-study]').forEach(button=>button.addEventListener('click',()=>{setFinish(button.dataset.study);goToChapter(0);}));

const running=new Set();
function spring(el,values){if(isStill())return;const animation=animate(el,values,{type:'spring',stiffness:230,damping:23});running.add(animation);const stop=animation.stop;animation.stop=()=>{running.delete(animation);stop();};animation.finished.then(()=>running.delete(animation));return animation;}
hover('.round-command,.study,.icon-button',element=>{if(!isStill())spring(element,{scale:element.classList.contains('study')?1.012:1.045});return()=>{if(!isStill())spring(element,{scale:1});};});
$$('.study').forEach(card=>{
  let animation;
  card.addEventListener('pointermove',event=>{if(isStill()||event.pointerType==='touch')return;const r=card.getBoundingClientRect(),x=(event.clientX-r.left)/r.width-.5,y=(event.clientY-r.top)/r.height-.5;
    animation?.stop();animation=spring(card,{rotateX:-y*9*settings.intensity,rotateY:x*12*settings.intensity});card.style.setProperty('--glare','.6');card.style.setProperty('--shine',`${x*100}%`);});
  card.addEventListener('pointerleave',()=>{animation?.stop();spring(card,{rotateX:0,rotateY:0});card.style.setProperty('--glare','0');});
});
$$('.magnetic').forEach(button=>{let animation;button.addEventListener('pointermove',event=>{if(isStill()||event.pointerType==='touch')return;const r=button.getBoundingClientRect();animation?.stop();animation=spring(button,{x:(event.clientX-r.left-r.width/2)*.2*settings.intensity,y:(event.clientY-r.top-r.height/2)*.3*settings.intensity});});button.addEventListener('pointerleave',()=>{animation?.stop();spring(button,{x:0,y:0});});});

let entrance;
function updateMotion(){const still=isStill();document.documentElement.classList.toggle('still',still);$('#pause').setAttribute('aria-pressed',String(still));$('#pause').setAttribute('aria-label',still?'Resume motion':'Pause motion');$('#pause').title=still?'Resume motion':'Pause motion';$('#pause').innerHTML=`<i data-lucide="${still?'play':'pause'}"></i>`;icons();
  if(still){entrance?.complete();for(const a of running)a.complete();running.clear();$$('.study,.magnetic,.icon-button').forEach(el=>{el.style.transform='none';el.style.setProperty('--glare','0');});}scene?.refresh();}
$('#pause').addEventListener('click',()=>{if(reduce.matches){$('#settings-status').textContent='Your device has reduced motion enabled.';$('#settings').showModal();return;}manualStill=!isStill();settings.still=false;$('#still').checked=manualStill;updateMotion();});
reduce.addEventListener('change',updateMotion);
function syncSettings(){for(const [id,value] of [['intensity',settings.intensity],['speed',settings.speed]]){$('#'+id).value=String(Math.round(value*100));$('#'+id+'-value').textContent=Math.round(value*100)+'%';}$('#quality').value=settings.quality;$('#still').checked=settings.still;}
$('#open-settings').addEventListener('click',()=>$('#settings').showModal());
$('#settings').addEventListener('click',event=>{if(event.target===$('#settings')){const r=$('#settings').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('#settings').close();}});
for(const id of ['intensity','speed'])$('#'+id).addEventListener('input',event=>{settings[id]=Number(event.target.value)/100;$('#'+id+'-value').textContent=event.target.value+'%';scene?.refresh();save();});
$('#quality').addEventListener('change',event=>{settings.quality=event.target.value;scene?.refresh();save();});
$('#still').addEventListener('change',event=>{settings.still=event.target.checked;manualStill=false;updateMotion();save();});
$('#reset').addEventListener('click',()=>{settings={...defaults};manualStill=false;syncSettings();setFinish(settings.finish);updateMotion();save();$('#settings-status').textContent='Default settings restored.';});
$('#export').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({schema:'broog-effects/1',effect:'flux',...settings},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='broog-flux-preset.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#settings-status').textContent='Preset exported.';});
setFinish(settings.finish);syncSettings();updateMotion();
if(!isStill())entrance=createTimeline().add('h1 span',{y:[90,0],opacity:[0,1],duration:1000,delay:stagger(75),ease:'out(4)'}).add('.eyebrow,.object-note',{opacity:[0,1],duration:750},250);
