import * as THREE from 'three'
import {WebGPURenderer,PMREMGenerator,PostProcessing} from 'three/webgpu'
import {pass} from 'three/tsl'
import {bloom} from 'three/addons/tsl/display/BloomNode.js'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js'
import {CookingGestureTracker} from './gestures'
import {wristForSpoonContact,SPOON_BOWL,HAND_GRIP,panFoodSurface,LADLE_REST_ROTATION,LADLE_REST_OFFSET} from './toolContact'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {INGREDIENT_LABELS,type CookingSimulation,type HandSide,type Ingredient,type Zone,type Vec3} from '../game/simulation'
import {WOK_HOME} from '../game/kitchen'

type Layout={cameraMenu:Vec3;lookMenu:Vec3;cameraPlay:Vec3;lookPlay:Vec3;cameraFov:number;wokCenter:Vec3;wokRimHeight:number;wokRadius:number;foodSurface:Vec3;wokHandle:Vec3;burnerCenter:Vec3;trays:Record<string,Vec3>;bottles:Record<'oil'|'soy'|'oyster',Vec3>;tools:{serve:Vec3};handRest:Record<HandSide,Vec3>;handGripOffset:Vec3;prototypes:Record<Ingredient,string>}
type Options={simulation:CookingSimulation;onRenderer:(name:string)=>void;onReady:()=>void;onError:(message:string)=>void}
const SIDES:HandSide[]=['left','right']
const FOOD:Ingredient[]=['rice','carrot','onion','bacon','scallion','egg']
const v=(p:Vec3)=>new THREE.Vector3(...p)
const clamp=THREE.MathUtils.clamp
const maxFood:Record<Ingredient,number>={rice:1250,carrot:95,onion:70,bacon:38,scallion:150,egg:110}

/** Procedural VFX texture: no opaque cones or sphere-shaped smoke. */
function effectTexture(smoke=false){
 const size=smoke?128:192,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size*2
 const c=canvas.getContext('2d')!,data=c.createImageData(size,size*2)
 for(let y=0;y<size*2;y++)for(let x=0;x<size;x++){
  const t=1-y/(size*2),u=x/size-.5
  const n=Math.sin(x*.27+y*.13)*Math.sin(x*.09-y*.074)*.22+Math.sin(x*.19+y*.05)*.12
  const center=Math.sin(t*9)*.035*t+Math.sin(t*21)*.021*t
  const width=smoke?.25:Math.max(.008,(1-t)*.22+.018)
  const density=Math.exp(-Math.pow((u-center)/width,2.0))*(smoke?Math.sin(t*Math.PI):Math.pow(Math.sin(t*Math.PI),.6))
  const a=clamp(density*(.78+n)*(smoke?.45:1.25),0,1)
  const at=(y*size+x)*4
  data.data[at]=255;data.data[at+1]=255;data.data[at+2]=255;data.data[at+3]=Math.round(a*255)
 }
 c.putImageData(data,0,0);const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;return tex
}

export async function createStreetScene(container:HTMLElement,{simulation,onRenderer,onReady,onError}:Options){
 let disposed=false,frame=0,drag:HandSide|null=null,activePointer=-1
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(53,1,.025,160)
 const renderer=new WebGPURenderer({antialias:true,forceWebGL:new URLSearchParams(location.search).get('renderer')==='webgl2'})
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.92
 renderer.shadowMap.enabled=true
 try{await renderer.init()}catch{onError('当前浏览器无法初始化三维画面。请刷新，或使用支持 WebGPU 的浏览器。');renderer.dispose();return ()=>{}}
 onRenderer((renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL2')
 renderer.domElement.style.touchAction='none';container.appendChild(renderer.domElement)
 const overlay=document.createElement('div');overlay.className='world-labels';container.appendChild(overlay)
 const cursor=document.createElement('div');cursor.className='world-tooltip';cursor.hidden=true;overlay.appendChild(cursor)
 const tags={} as Record<HandSide,HTMLDivElement>
 SIDES.forEach(side=>{const el=document.createElement('div');el.className='hand-grab-label';el.dataset.hand=side;el.innerHTML=`<i></i><span>${side==='left'?'左手':'右手'}</span><small>按住拖动</small>`;overlay.appendChild(el);tags[side]=el})
 const ambient=new THREE.HemisphereLight('#b6c6de','#3a2d20',.32);scene.add(ambient)
 const key=new THREE.SpotLight('#ffead2',7.5,7,1.2,.96,2);key.position.set(-.15,2.3,.16);key.target.position.set(0,.96,-.04);key.castShadow=true;key.shadow.mapSize.set(2048,2048);key.shadow.bias=-.0004;key.shadow.normalBias=.002;scene.add(key,key.target)
 const fill=new THREE.DirectionalLight('#bdcce1',.45);fill.position.set(-3,4,2);scene.add(fill)
 const fireLight=new THREE.PointLight('#5899ff',.55,1.4,1.6);fireLight.position.set(0,1.075,0);scene.add(fireLight)
 let envTarget:THREE.RenderTarget|undefined,rawEnv:THREE.Texture|undefined
 try{
  rawEnv=await new HDRLoader().loadAsync('/environment/shanghai-bund-2k.hdr');rawEnv.mapping=THREE.EquirectangularReflectionMapping
  const pmrem=new PMREMGenerator(renderer);const environment=await (pmrem as PMREMGenerator & {fromEquirectangularAsync(texture:THREE.Texture):Promise<THREE.RenderTarget>}).fromEquirectangularAsync(rawEnv);envTarget=environment;scene.environment=environment.texture;scene.environmentIntensity=.65
  scene.background=rawEnv;scene.backgroundIntensity=.23;scene.backgroundBlurriness=.035;scene.backgroundRotation.y=2.1;scene.environmentRotation.y=2.1;pmrem.dispose()
 }catch{scene.background=new THREE.Color('#10151b');onError('街景环境暂未载入，餐车操作仍可使用。')}
 // Contact ground with restrained fine grain; distant streets are photographic HDR.
 const noiseSize=256,noise=new Uint8Array(noiseSize*noiseSize*4)
 for(let i=0;i<noiseSize*noiseSize;i++){const a=105+Math.random()*45;noise.set([a,a,a,255],i*4)}
 const groundTex=new THREE.DataTexture(noise,noiseSize,noiseSize);groundTex.wrapS=groundTex.wrapT=THREE.RepeatWrapping;groundTex.repeat.set(32,32);groundTex.needsUpdate=true
 const groundMat=new THREE.MeshStandardMaterial({color:'#282b2c',roughness:.77,metalness:.08,bumpMap:groundTex,bumpScale:.012})
 const ground=new THREE.Mesh(new THREE.CircleGeometry(22,100),groundMat);ground.rotation.x=-Math.PI/2;ground.position.y=-.027;ground.receiveShadow=true;scene.add(ground)
 const [layout,gltf]=await Promise.all([fetch('/models/playable-cart-layout.json').then(r=>{if(!r.ok)throw Error('layout');return r.json() as Promise<Layout>}),new GLTFLoader().loadAsync('/models/playable-cart.glb')])
 gltf.scene.updateMatrixWorld(true)
 const cart=new THREE.Group();cart.name='TheSamePlayableCart';scene.add(cart)
 const dynamicNames=new Set(['Wok','Bottle_oil','Bottle_soy','Bottle_oyster','Ladle','Hand_left','Hand_right','FoodPrototypes'])
 const microBytes=new Uint8Array(256*256*4)
 for(let i=0;i<256*256;i++){const n=116+Math.random()*22;microBytes.set([n,n,n,255],i*4)}
 const ironMicro=new THREE.DataTexture(microBytes,256,256);ironMicro.wrapS=ironMicro.wrapT=THREE.RepeatWrapping;ironMicro.repeat.set(14,14);ironMicro.needsUpdate=true
 const materialCopies=new Map<THREE.Material,THREE.Material>()
 function prepareMat(m:THREE.Material){
  if(materialCopies.has(m))return materialCopies.get(m)!
  const n=m.clone();if(n instanceof THREE.MeshStandardMaterial){n.envMapIntensity=.85;if(/skin/i.test(n.name)){n.roughness=.62;n.color.set('#c7977d')}if(/carbon steel/i.test(n.name)){n.roughness=.48;n.metalness=.68;n.color.set('#252a2d');n.envMapIntensity=.65;n.bumpMap=ironMicro;n.bumpScale=.0012}if(/Brushed/i.test(n.name)&&n.roughnessMap){n.roughnessMap=n.roughnessMap.clone();n.roughnessMap.wrapS=n.roughnessMap.wrapT=THREE.RepeatWrapping;n.roughnessMap.repeat.set(10,10);n.roughnessMap.needsUpdate=true;n.roughness=.75}if(n.map)n.map.anisotropy=4}
  materialCopies.set(m,n);return n
 }
 function extract(name:string){
  const source=gltf.scene.getObjectByName(name);if(!source)throw Error(`Missing ${name}`)
  const center=source.getWorldPosition(new THREE.Vector3()),root=new THREE.Group();root.name=name;root.position.copy(center)
  source.traverse(o=>{if(o instanceof THREE.Mesh){const geo=o.geometry.clone();const transform=new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z).multiply(o.matrixWorld);geo.applyMatrix4(transform);const materials=Array.isArray(o.material)?o.material.map(prepareMat):prepareMat(o.material);const m=new THREE.Mesh(geo,materials);m.name=o.name;m.castShadow=true;m.receiveShadow=true;root.add(m)}})
  cart.add(root);return root
 }
const wok=extract('Wok'),ladleTool=extract('Ladle'),hands={left:extract('Hand_left'),right:extract('Hand_right')},bottles={oil:extract('Bottle_oil'),soy:extract('Bottle_soy'),oyster:extract('Bottle_oyster')}
 const bottleHomes={oil:bottles.oil.position.clone(),soy:bottles.soy.position.clone(),oyster:bottles.oyster.position.clone()}
 // The retained Hyper3D shell and its Blender worktop stay present in both cameras.
 const batches=new Map<THREE.Material,THREE.BufferGeometry[]>()
 gltf.scene.traverse(o=>{
  if(!(o instanceof THREE.Mesh))return
  let p:THREE.Object3D|null=o;while(p){if(dynamicNames.has(p.name)||p.name.startsWith('FoodPrototype_'))return;p=p.parent}
  const geo=o.geometry.clone().applyMatrix4(o.matrixWorld)
  if(Array.isArray(o.material)){const m=new THREE.Mesh(geo,o.material.map(prepareMat));m.castShadow=true;m.receiveShadow=true;cart.add(m);return}
  for(const key of Object.keys(geo.attributes))if(!['position','normal','uv'].includes(key))geo.deleteAttribute(key)
  if(!geo.attributes.normal)geo.computeVertexNormals();if(!geo.attributes.uv)geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count*2),2))
  const mat=prepareMat(o.material),batch=batches.get(mat)||[];batch.push(geo);batches.set(mat,batch)
 })
 batches.forEach((geometries,mat)=>{const all=geometries.map(g=>g.index?g.toNonIndexed():g);const merged=mergeGeometries(all);if(merged){const m=new THREE.Mesh(merged,mat);m.castShadow=true;m.receiveShadow=true;cart.add(m)}geometries.forEach(g=>g.dispose());all.forEach(g=>g.dispose())})
 // Reuse the exact Blender food shapes in the wok and in a loaded scoop.
 type Grain={x:number;y:number;z:number;vx:number;vy:number;vz:number;rx:number;ry:number;rz:number;scale:number}
 const particles={} as Record<Ingredient,{mesh:THREE.InstancedMesh;grains:Grain[];count:number;materials:THREE.Material[];baseColors:THREE.Color[];geometry:THREE.BufferGeometry}>
 const carrier={} as Record<HandSide,Record<Ingredient,THREE.InstancedMesh>>
 SIDES.forEach(side=>carrier[side]={} as Record<Ingredient,THREE.InstancedMesh>)
 const wokFood=new THREE.Group();wokFood.position.copy(v(layout.wokCenter));scene.add(wokFood)
 FOOD.forEach(kind=>{
  const node=gltf.scene.getObjectByName(layout.prototypes[kind])
  if(!node)throw Error(`Missing food specimen ${kind}`)
  const parts:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[]
  node.traverse(o=>{if(o instanceof THREE.Mesh){
   const world=o.matrixWorld.clone();world.setPosition(0,0,0)
   const geo=o.geometry.clone().applyMatrix4(world);parts.push(geo.index?geo.toNonIndexed():geo)
   const material=Array.isArray(o.material)?o.material[0]:o.material;mats.push(material.clone())
  }})
  if(!parts.length)throw Error(`Empty food specimen ${kind}`)
  const geo=mergeGeometries(parts,true)!;geo.computeBoundingBox();const center=geo.boundingBox!.getCenter(new THREE.Vector3());geo.translate(-center.x,-center.y,-center.z)
  parts.forEach(p=>p.dispose())
  const inst=new THREE.InstancedMesh(geo,mats.length===1?mats[0]:mats,maxFood[kind]);inst.count=0;inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);inst.castShadow=true;inst.receiveShadow=true;inst.frustumCulled=false;wokFood.add(inst)
  const grains=Array.from({length:maxFood[kind]},()=>({x:0,y:0,z:0,vx:0,vy:0,vz:0,rx:Math.random()*3,ry:Math.random()*6,rz:Math.random()*.4,scale:.8+Math.random()*.4}))
  particles[kind]={mesh:inst,grains,count:0,materials:mats,baseColors:mats.map(m=>(m as THREE.MeshStandardMaterial).color.clone()),geometry:geo}
  SIDES.forEach(side=>{const scoop=new THREE.InstancedMesh(geo,mats.length===1?mats[0]:mats,kind==='rice'?42:8);scoop.frustumCulled=false;scoop.visible=false;scene.add(scoop);carrier[side][kind]=scoop})
 })
 // Thin oil sheen conforms to the center of the concave pan.
 const sheen=new THREE.Mesh(new THREE.CircleGeometry(.145,64),new THREE.MeshPhysicalMaterial({color:'#a98733',roughness:.12,metalness:.18,transparent:true,opacity:.52,clearcoat:1,side:THREE.DoubleSide,depthWrite:false}));sheen.rotation.x=-Math.PI/2;sheen.position.set(0,.007,0);wokFood.add(sheen)
 const flames=new THREE.Group();flames.position.copy(v(layout.burnerCenter));scene.add(flames)
 const flameTex=effectTexture(),smokeTex=effectTexture(true)
 const jets:THREE.Sprite[]=[],flares:THREE.Sprite[]=[],vapour:THREE.Sprite[]=[]
 for(let i=0;i<32;i++){const material=new THREE.SpriteMaterial({map:flameTex,color:i%4?'#408aff':'#8bbaff',transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false});const sprite=new THREE.Sprite(material);const a=i/32*Math.PI*2;sprite.position.set(Math.cos(a)*.223,.04,Math.sin(a)*.223);sprite.scale.set(.025,.076,1);flames.add(sprite);jets.push(sprite)}
 for(let i=0;i<9;i++){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:flameTex,color:'#ff8126',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false}));flames.add(sprite);flares.push(sprite)}
 for(let i=0;i<24;i++){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,color:'#d9d3bc',transparent:true,opacity:0,depthWrite:false}));scene.add(sprite);vapour.push(sprite)}
 const streams={} as Record<HandSide,THREE.Mesh>
 SIDES.forEach(side=>{const stream=new THREE.Mesh(new THREE.CylinderGeometry(.002,.0035,1,9),new THREE.MeshPhysicalMaterial({color:'#bf8520',transparent:true,opacity:.8,roughness:.16,metalness:.08}));stream.visible=false;scene.add(stream);streams[side]=stream})
 // Screen labels explain the real draggable hands, and track the actual meshes.
 const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-1.15),intersection=new THREE.Vector3()
 const zones:{zone:Zone;anchor:THREE.Vector3;proxy:THREE.Mesh;title:string}[]=[]
 function addZone(zone:Zone,at:Vec3,size:Vec3,title:string){const proxy=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());proxy.position.copy(v(at));proxy.updateMatrixWorld();zones.push({zone,anchor:v(at),proxy,title})}
 addZone('wok',[0,1.18,0],[.57,.2,.57],'锅内 · 推拉翻炒 / 持料画圈翻勺')
 addZone('handle',layout.wokHandle,[.31,.18,.30],'锅柄 · 松手握住，再拖动提锅')
 for(const kind of FOOD)addZone(kind,layout.trays[kind],kind==='rice'?[.46,.16,.53]:[.30,.16,.26],INGREDIENT_LABELS[kind]+' · 持勺来回划动取料')
 for(const kind of ['oil','soy','oyster'] as const)addZone(kind,[layout.bottles[kind][0],layout.bottles[kind][1]+.14,layout.bottles[kind][2]],[.16,.37,.17],({oil:'食用油',soy:'酱油',oyster:'蚝油'})[kind]+' · 松手抓住')
 addZone('serve',layout.tools.serve,[.39,.17,.41],'出餐碗 · 把勺拖到这里松开')
addZone('rest',[0,1.015,.43],[.50,.025,.14],'台面前沿 · 放下手里的东西，或空手拿起锅铲')
const targetRing=new THREE.Mesh(new THREE.RingGeometry(.045,.05,48),new THREE.MeshBasicMaterial({color:'#e7c493',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));targetRing.rotation.x=-Math.PI/2;targetRing.visible=false;scene.add(targetRing)
/** The stove and its handle ride with the pan, so the pan's own position decides
 * whether letting go means "back on the rack". */
function releaseZone(zone:Zone|null){
 if(!drag)return zone
 const s=simulation.state,h=s.hands[drag]
 if(h.held!=='wok'||s.pan.lift<=.06)return zone
 const near=Math.hypot(s.pan.position[0]-WOK_HOME[0],s.pan.position[2]-WOK_HOME[2])<.22
 return near?'handle':zone==='rest'?'rest':null
}
/** The hand's own contents decide what a release over a zone actually means. */
function promptFor(zone:Zone|null){
 const s=simulation.state
 if(zone==='rest'){
  const h=drag?s.hands[drag]:null
  if(h?.held==='wok')return '台面前沿 · 松手，把锅放在台面上'
  if(h&&['ladle','scoop'].includes(h.held))return '台面前沿 · 松手搁下锅铲'
  if(h&&h.held!=='none')return '台面前沿 · 松手放下手里的瓶子'
  if(s.ladle.resting&&!SIDES.some(side=>['ladle','scoop'].includes(s.hands[side].held)))return '台面前沿 · 锅铲在这里，空手松手拿起'
 }
 if(zone==='handle'&&s.pan.lift>.06&&s.hands.left.held!=='wok'&&s.hands.right.held!=='wok')return '锅柄 · 松手把锅放回锅架'
 return zones.find(z=>z.zone===zone)?.title||''
}
 const project=(position:THREE.Vector3)=>{const p=position.clone().project(camera),rect=container.getBoundingClientRect();return {x:(p.x*.5+.5)*rect.width,y:(-.5*p.y+.5)*rect.height,visible:p.z<1}}
 const tracker=new CookingGestureTracker()
 let lastX=0,lastY=0,lastMove=0,pointerSpeed=0,hover:Zone|null=null
 let dragStartX=0,dragStartY=0,dragStartPoint=new THREE.Vector3()
 function setRay(e:PointerEvent){const r=container.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera)}
 function findZone(){const hit=ray.intersectObjects(zones.map(z=>z.proxy),false)[0];if(hit){const item=zones.find(z=>z.proxy===hit.object)!;return {...item,point:hit.point}}return null}
 function findHand(e:PointerEvent):HandSide|null {
  const r=container.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top
  let best:HandSide|null=null,min=60
  for(const side of SIDES){const p=project(hands[side].position.clone().add(new THREE.Vector3(0,0,-.06))),d=Math.hypot(p.x-x,p.y-y);if(d<min){best=side;min=d}}
  const hit=ray.intersectObjects(SIDES.flatMap(side=>hands[side].children),true)[0]
  if(hit)for(const side of SIDES)if(hands[side].children.includes(hit.object))return side
  return best
 }
 function onDown(e:PointerEvent){
  if(e.button!==0||simulation.state.phase!=='playing'||cameraBlend<.96)return
  setRay(e);drag=findHand(e);if(!drag)return
  activePointer=e.pointerId;container.setPointerCapture(e.pointerId);simulation.beginDrag(drag)
  lastX=dragStartX=e.clientX;lastY=dragStartY=e.clientY;lastMove=performance.now()
  dragStartPoint.copy(v(simulation.state.hands[drag].position));tracker.reset();container.style.cursor='grabbing';e.preventDefault()
 }
 function onMove(e:PointerEvent){
  if(simulation.state.phase!=='playing')return
  setRay(e);const target=findZone();hover=target?.zone||null
  if(drag){
   const now=performance.now(),dt=Math.max(.008,(now-lastMove)/1000)
   pointerSpeed=clamp(Math.hypot(e.clientX-lastX,e.clientY-lastY)/dt/650,0,1)
   lastX=e.clientX;lastY=e.clientY;lastMove=now
   ray.ray.intersectPlane(plane,intersection)
   const p=target?.point||intersection,h=simulation.state.hands[drag]
   let point:Vec3=[clamp(p.x,-1.3,1.65),clamp(p.y,1.05,1.8),clamp(p.z,-.82,.9)]
   if(h.held==='wok'){
    const r=container.getBoundingClientRect(),dx=(e.clientX-dragStartX)/r.width,dy=(e.clientY-dragStartY)/r.height
    point=[dragStartPoint.x+dx*2.7,dragStartPoint.y-dy*1.75,dragStartPoint.z-dy*.25]
   }
   const gesture=tracker.sample(e.clientX,e.clientY,hover)
   simulation.moveHand(drag,hover,point,pointerSpeed,gesture)
  }else container.style.cursor=findHand(e)?'grab':target?'crosshair':'default'
  cursor.textContent=drag?promptFor(releaseZone(hover))||'保持握持 · 拖到目标操作':findHand(e)?'按住这只手拖动':target?.title||''
  cursor.hidden=!cursor.textContent
  const rect=container.getBoundingClientRect();cursor.style.left=`${clamp(e.clientX-rect.left+16,4,rect.width-240)}px`;cursor.style.top=`${e.clientY-rect.top-27}px`
 }
function onUp(e:PointerEvent){
 if(!drag)return;setRay(e);const zone=releaseZone(findZone()?.zone||null)
 simulation.endDrag(drag,zone);drag=null;tracker.reset()
  if(container.hasPointerCapture(activePointer))container.releasePointerCapture(activePointer)
  activePointer=-1;container.style.cursor='grab'
 }
 function onCancel(){if(drag)simulation.endDrag(drag,null);drag=null;activePointer=-1;tracker.reset()}
 container.addEventListener('pointerdown',onDown);container.addEventListener('pointermove',onMove);container.addEventListener('pointerup',onUp);container.addEventListener('pointercancel',onCancel)
 const resize=()=>{const r=container.getBoundingClientRect();camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height)};const observer=new ResizeObserver(resize);observer.observe(container);resize()
 const post=new PostProcessing(renderer),renderPass=pass(scene,camera),colorPass=renderPass.getTextureNode('output');post.outputNode=colorPass.add(bloom(colorPass,.11,.45,2.5))
 let previous=performance.now(),time=0,cameraBlend=0,panPhase=0,lastToss=0
 const bowlContacts={left:new THREE.Vector3(),right:new THREE.Vector3()},lastPayload:Record<HandSide,Ingredient|null>={left:null,right:null},releasedKind:Record<HandSide,Ingredient|null>={left:null,right:null},flipTimers={left:0,right:0}
 const pourOrigin:Partial<Record<Ingredient,THREE.Vector3>>={}
 const lastPan=new THREE.Vector3(...layout.wokCenter),panDelta=new THREE.Vector3()
 const dummy=new THREE.Object3D(),work=new THREE.Vector3(),wrist=new THREE.Vector3(),target=new THREE.Vector3(),tempQ=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0)
 function moveToolToHand(tool:THREE.Object3D,hand:THREE.Object3D){tool.position.copy(hand.position).add(v(layout.handGripOffset).applyQuaternion(hand.quaternion));tool.quaternion.copy(hand.quaternion)}
 camera.position.copy(v(layout.cameraMenu));camera.lookAt(v(layout.lookMenu));onReady()
 function draw(now:number){
  if(disposed)return;const delta=clamp((now-previous)/1000,0,.05);previous=now;const state=simulation.state
  const playing=state.phase==='playing',menu=state.phase==='menu';if(playing||menu)time+=delta
  const destination=menu?0:1;cameraBlend=THREE.MathUtils.damp(cameraBlend,destination,2.8,delta);const blend=cameraBlend*cameraBlend*(3-2*cameraBlend)
  camera.position.lerpVectors(v(layout.cameraMenu),v(layout.cameraPlay),blend);camera.position.y+=Math.sin(blend*Math.PI)*.24;target.lerpVectors(v(layout.lookMenu),v(layout.lookPlay),blend);camera.lookAt(target);camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(THREE.MathUtils.lerp(50,layout.cameraFov,blend)/2))/Math.min(1,camera.aspect/1.45)));camera.updateProjectionMatrix()
  overlay.style.opacity=playing&&cameraBlend>.96?'1':'0';overlay.style.pointerEvents='none';if(!playing&&drag)onCancel()
  const panHand=SIDES.find(side=>state.hands[side].held==='wok'),panIntensity=panHand?state.hands[panHand].intensity:0
  if(playing)panPhase+=delta*(3+panIntensity*12)
  wok.position.lerp(v(state.pan.position),1-Math.exp(-delta*24));wok.position.y+=state.toss*.012
  wok.rotation.set(panIntensity*Math.sin(panPhase)*.07-state.toss*.15-state.pan.tilt,0,panIntensity*Math.cos(panPhase)*.045)
  panDelta.copy(wok.position).sub(lastPan);lastPan.copy(wok.position)
  wokFood.position.copy(wok.position);wokFood.quaternion.copy(wok.quaternion)
  for(const z of zones){
   if(z.zone==='wok'){z.proxy.position.copy(wok.position).add(new THREE.Vector3(0,.08,0));z.anchor.copy(z.proxy.position)}
   if(z.zone==='handle'){z.proxy.position.copy(v(layout.wokHandle).sub(v(layout.wokCenter)).applyQuaternion(wok.quaternion).add(wok.position));z.anchor.copy(z.proxy.position)}
   z.proxy.updateMatrixWorld()
  }
  const visualGrip=v(layout.handGripOffset)
  for(const side of SIDES){
   const h=state.hands[side],model=hands[side];model.visible=cameraBlend>.78
   if(lastPayload[side]&&!h.payload&&!['oil','soy','oyster'].includes(h.held)){
    releasedKind[side]=lastPayload[side];flipTimers[side]=.6
    pourOrigin[lastPayload[side]!]=bowlContacts[side].clone().sub(wok.position).applyQuaternion(wok.quaternion.clone().invert())
   }
   if(menu){flipTimers[side]=0;releasedKind[side]=null}lastPayload[side]=h.payload;if(playing)flipTimers[side]=Math.max(0,flipTimers[side]-delta)
   work.copy(v(h.position));const yaw=side==='left'?.19:-.16
   const spoon=['ladle','scoop','egg'].includes(h.held)
   if(h.held==='wok'){
    // Match the palm to the same transformed wooden handle that moves the pan.
    const handle=v(layout.wokHandle).sub(v(layout.wokCenter)).applyQuaternion(wok.quaternion).add(wok.position)
    model.rotation.set(-.13,-.58,0);model.quaternion.premultiply(wok.quaternion)
    wrist.copy(handle).sub(visualGrip.clone().applyQuaternion(model.quaternion))
   }else if(['oil','soy','oyster'].includes(h.held)){
    model.rotation.set(THREE.MathUtils.lerp(.05,1.88,h.tilt),yaw,side==='left'?-.10:.10)
    wrist.copy(work).add(new THREE.Vector3(0,.065,.05))
    if(h.zone==='wok'){wrist.y=wok.position.y+.34;wrist.z+=.10}
   }else if(spoon&&(h.dragging||h.mode==='stirring'||h.payload||flipTimers[side]>0)){
    const contact=work.clone()
    if(h.mode==='stirring'){
     const local=h.dragging?work.clone().sub(wok.position).applyQuaternion(wok.quaternion.clone().invert()):new THREE.Vector3(Math.sin(time*(3+h.intensity*7))*.14,0,Math.cos(time*(3+h.intensity*7))*.095)
     const radius=Math.hypot(local.x,local.z);if(radius>.185){local.x*=.185/radius;local.z*=.185/radius}
     local.y=panFoodSurface(local.x,local.z,state.food.rice)+.003
     contact.copy(local.applyQuaternion(wok.quaternion).add(wok.position))
    }else if(h.payload||flipTimers[side]>0){contact.y=Math.max(contact.y,wok.position.y+.21)}
    else if(h.zone&&FOOD.includes(h.zone as Ingredient)){contact.y=layout.trays[h.zone][1]+.027}
    else contact.y=Math.max(contact.y,1.19)
    const flip=flipTimers[side]>0?Math.sin((1-flipTimers[side]/.6)*Math.PI)*Math.PI:0
    model.rotation.set(h.mode==='stirring'?-.58:-.43,yaw,flip)
    if(h.mode==='stirring')model.quaternion.premultiply(wok.quaternion)
    wrist.copy(wristForSpoonContact(contact,model.quaternion,visualGrip))
    // This is a contact constraint: smoothing the wrist would leave the bowl floating.
   }else if(h.dragging){wrist.copy(work).add(new THREE.Vector3(0,.025,.10));model.rotation.set(.05,yaw,0)}
   else {wrist.copy(v(layout.handRest[side]));wrist.y+=.045;model.rotation.set(.14,yaw,0)}
   model.position.copy(wrist)
   const projected=project(model.position.clone().add(new THREE.Vector3(0,.02,.04)))
   tags[side].style.transform=`translate(${projected.x}px,${projected.y}px) translate(-50%,32px)`
   tags[side].classList.toggle('is-dragging',h.dragging)
   tags[side].querySelector('small')!.textContent=h.payload?INGREDIENT_LABELS[h.payload]+' · 画圈倒入':h.scoopProgress>0&&h.scoopProgress<1?'铲取 '+Math.round(h.scoopProgress*100)+'%':h.mode==='stirring'&&!h.dragging?'持续翻炒中':h.held==='wok'?'握锅 · 向上拖动提锅':['oil','soy','oyster'].includes(h.held)?'已握住 · 画圈转腕':'按住拖动'
   if(spoon){moveToolToHand(ladleTool,model);bowlContacts[side].copy(SPOON_BOWL).applyQuaternion(ladleTool.quaternion).add(ladleTool.position)}
   for(const kind of FOOD)carrier[side][kind].visible=false
   const loaded=h.payload||(flipTimers[side]>.3?releasedKind[side]:null)
   if(loaded){
    const carried=carrier[side][loaded];carried.visible=!menu;carried.position.copy(ladleTool.position);carried.quaternion.copy(ladleTool.quaternion)
    for(let i=0;i<carried.count;i++){
     const a=i*2.399,r=Math.sqrt(i/carried.count)*.037
     dummy.position.set(Math.sin(a)*r,-.047+Math.sin(i)*.004,-.404+Math.cos(a)*r);dummy.rotation.set(0,i*.76,i*.27);dummy.scale.setScalar(loaded==='rice'?.9:.85);dummy.updateMatrix();carried.setMatrixAt(i,dummy.matrix)
    }carried.instanceMatrix.needsUpdate=true
   }
   streams[side].visible=false
  }
  // There is one ladle on this cart. It is either carried by the hand that has
  // it, or lying flat on the front strip where the player left it.
  const ladleHand=SIDES.find(side=>['ladle','scoop','egg'].includes(state.hands[side].held))
  ladleTool.visible=cameraBlend>.78
  if(!ladleHand){
   ladleTool.position.copy(v(state.ladle.spot)).add(LADLE_REST_OFFSET)
   ladleTool.quaternion.copy(LADLE_REST_ROTATION)
  }
  for(const kind of ['oil','soy','oyster'] as const){const bottle=bottles[kind],side=SIDES.find(side=>state.hands[side].held===kind)
   if(side){const h=state.hands[side],hand=hands[side];bottle.quaternion.copy(hand.quaternion);bottle.position.copy(hand.position).add(new THREE.Vector3(0,-.145,-.10).applyQuaternion(hand.quaternion))
    if(h.mode==='pouring'){
     const start=new THREE.Vector3(0,kind==='oyster'?.275:.3,0).applyQuaternion(bottle.quaternion).add(bottle.position),end=new THREE.Vector3(wok.position.x+clamp(h.position[0]-wok.position.x,-.19,.19),wok.position.y+.025,wok.position.z+clamp(h.position[2]-wok.position.z,-.19,.19)),stream=streams[side],direction=end.clone().sub(start);stream.visible=!menu;stream.position.copy(start).add(end).multiplyScalar(.5);stream.scale.y=direction.length();stream.quaternion.setFromUnitVectors(up,direction.normalize());(stream.material as THREE.MeshPhysicalMaterial).color.set(kind==='oil'?'#c59943':kind==='soy'?'#401b09':'#24150b');stream.scale.x=stream.scale.z=kind==='oyster'?1.7:1
    }
   }else{bottle.position.copy(bottleHomes[kind]);bottle.quaternion.identity()}}
  const tossImpulse=state.toss>lastToss+.1;lastToss=state.toss
  const stirContacts=SIDES.filter(side=>state.hands[side].mode==='stirring').map(side=>bowlContacts[side].clone().sub(wok.position).applyQuaternion(wok.quaternion.clone().invert()))
  FOOD.forEach(kind=>{
   const p=particles[kind],waiting=SIDES.some(side=>releasedKind[side]===kind&&flipTimers[side]>.3),count=waiting?p.count:Math.round(state.food[kind]*maxFood[kind]);p.mesh.count=count
   if(count<p.count)p.count=count
   for(let i=p.count;i<count;i++){const grain=p.grains[i],a=Math.random()*Math.PI*2,r=Math.sqrt(Math.random())*.04,origin=pourOrigin[kind]||new THREE.Vector3(0,.25,0);Object.assign(grain,{x:clamp(origin.x+Math.cos(a)*r,-.21,.21),z:clamp(origin.z+Math.sin(a)*r,-.21,.21),y:Math.max(.20,origin.y)+Math.random()*.035,vx:(Math.random()-.5)*.4,vy:-.18,vz:(Math.random()-.5)*.4})}p.count=count
   for(let i=0;i<count;i++){const g=p.grains[i],r=Math.hypot(g.x,g.z)
    if(playing){const friction=Math.exp(-delta*4),stir=state.motion;
     if(g.y>.13){g.x-=panDelta.x;g.y-=panDelta.y;g.z-=panDelta.z}
     for(const localBowl of stirContacts){
      const dx=g.x-localBowl.x,dz=g.z-localBowl.z,d=Math.hypot(dx,dz)
      if(d<.071&&g.y<localBowl.y+.05){g.vx+=dx/Math.max(.01,d)*stir*delta*3;g.vz+=dz/Math.max(.01,d)*stir*delta*3;g.vy=Math.max(g.vy,.18+stir*.26)}
     }
     g.vx=(g.vx+(-g.z*stir*9-g.x*.6)*delta)*friction;g.vz=(g.vz+(g.x*stir*9-g.z*.6)*delta)*friction
     if(stir>.1&&Math.sin(time*6+i*.19)>.85&&g.y<.04){g.vy+=stir*delta*5}
     if(tossImpulse){g.vy=1.15+state.toss*1.65+Math.random()*.5;g.vz=-.12-state.toss*.3;g.vx+=(Math.random()-.5)*.4}
     g.vy-=delta*6.7;g.x+=g.vx*delta;g.z+=g.vz*delta;g.y+=g.vy*delta
     const radius=Math.hypot(g.x,g.z);if(radius>.247){g.x*=.245/radius;g.z*=.245/radius;g.vx*=-.4;g.vz*=-.4}
     const floor=panFoodSurface(g.x,g.z,state.food.rice)+(kind==='rice'?0:.006)+Math.sin(i*4.12)*.004
     if(g.y<floor){g.y=floor;g.vy=Math.max(0,-g.vy*.10);g.ry+=delta*stir*1.5}
     if(g.y>floor+.02){g.rx+=delta*(2+stir);g.rz+=delta*1.5}
    }
    dummy.position.set(g.x,g.y,g.z);dummy.rotation.set(g.rx,g.ry,g.rz);dummy.scale.setScalar(g.scale);dummy.updateMatrix();p.mesh.setMatrixAt(i,dummy.matrix)
   }p.mesh.instanceMatrix.needsUpdate=true
   p.materials.forEach((m,index)=>{if(m instanceof THREE.MeshStandardMaterial){m.color.copy(p.baseColors[index]);if(kind==='rice')m.color.lerp(new THREE.Color('#d9a545'),clamp(state.cooked*.55+(state.food.soy+state.food.oyster*.55)*.30,0,.75));if(state.burnt>0)m.color.lerp(new THREE.Color('#322014'),state.burnt);m.roughness=.40-state.food.oil*.14}})
  })
  sheen.visible=state.food.oil>0;sheen.scale.setScalar(.45+state.food.oil*.55)
  const onFlame=clamp(1-state.pan.lift/.3,0,1)*clamp(1-Math.hypot(state.pan.position[0],state.pan.position[2])/.5,0,1),activity=Math.max(panIntensity,state.toss*.8)*onFlame,foodQuantity=FOOD.reduce((sum,k)=>sum+state.food[k],0)
  jets.forEach((j,i)=>{const flicker=.82+Math.sin(time*33+i*4)*.12+Math.sin(time*17+i)*.06;j.scale.y=.066*flicker*(.7+state.temperature*.5);j.material.rotation=Math.sin(time*8+i)*.12})
  flares.forEach((f,i)=>{const a=i/9*Math.PI*2,flare=clamp(activity*.9+(state.hands.left.mode==='pouring'||state.hands.right.mode==='pouring'?.25:0),0,1);f.position.set(Math.cos(a)*.257,.09+flare*.055,Math.sin(a)*.257);f.scale.set(.037+Math.sin(i*7)*.012,(.12+flare*.23)*(.65+Math.sin(time*23+i*3)*.22),1);f.material.opacity=flare*(.31+Math.sin(time*27+i)*.15);f.material.rotation=Math.sin(time*9+i)*.16})
  fireLight.intensity=.35+activity*1.3;fireLight.color.set(activity>.2?'#ffa54e':'#579cff')
  vapour.forEach((s,i)=>{const t=(time*.32+i/24)%1,amount=clamp(foodQuantity*.2,0,1);s.position.set(wok.position.x+Math.sin(i*5+t*3)*(.12+t*.12),wok.position.y+.16+t*.70,wok.position.z+Math.cos(i*7+t*2)*.14);s.scale.set(.10+t*.25,.17+t*.4,1);s.material.opacity=amount*state.temperature*(1-t)*.26;s.material.rotation=Math.sin(i+time*.2)*.18})
  if(drag&&hover){const zone=zones.find(z=>z.zone===hover)!;targetRing.visible=true;targetRing.position.copy(zone.anchor);targetRing.position.y=hover==='wok'?wok.position.y+.14:zone.anchor.y+.09;targetRing.scale.setScalar(hover==='wok'?3:1)}else targetRing.visible=false
  post.render();frame=requestAnimationFrame(draw)
 }
 frame=requestAnimationFrame(draw)
 return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();onCancel();container.removeEventListener('pointerdown',onDown);container.removeEventListener('pointermove',onMove);container.removeEventListener('pointerup',onUp);container.removeEventListener('pointercancel',onCancel);overlay.remove();renderer.domElement.remove();post.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){if(o instanceof THREE.Mesh)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}});flameTex.dispose();smokeTex.dispose();groundTex.dispose();ironMicro.dispose();envTarget?.dispose();rawEnv?.dispose();renderer.dispose()}
}
