import * as THREE from 'three'
import {WebGPURenderer,PMREMGenerator,PostProcessing,SpriteNodeMaterial} from 'three/webgpu'
import {pass} from 'three/tsl'
import {bloom} from 'three/addons/tsl/display/BloomNode.js'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import {HDRLoader} from 'three/addons/loaders/HDRLoader.js'
import {CookingGestureTracker} from './gestures'
import {wristForSpoonContact,SPOON_BOWL,HAND_GRIP,panFoodSurface,LADLE_REST_ROTATION,LADLE_REST_OFFSET} from './toolContact'
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js'
import {INGREDIENT_LABELS,type CookingSimulation,type HandSide,type Ingredient,type Zone,type Vec3} from '../game/simulation'
import {HandAnimator} from './HandAnimator'
import {createFireOcclusion} from './fireOcclusion'
import {LiquidStream} from './LiquidStream'
import {MobileInputController,type MobileTouchTarget} from './mobileInput'
import {FoodPhysics} from './FoodPhysics'
import {PoseTransition,POSE_TRANSITION_SECONDS} from './PoseTransition'
import {StirStroke} from './StirStroke'
import {chooseZoneHit} from './zonePicking'
import {WOK_HOME} from '../game/kitchen'

type Layout={cameraMenu:Vec3;lookMenu:Vec3;cameraPlay:Vec3;lookPlay:Vec3;cameraFov:number;wokCenter:Vec3;wokRimHeight:number;wokRadius:number;foodSurface:Vec3;wokHandle:Vec3;burnerCenter:Vec3;trays:Record<string,Vec3>;bottles:Record<'oil'|'soy'|'oyster',Vec3>;tools:{serve:Vec3;knob:Vec3};handRest:Record<HandSide,Vec3>;handGripOffset:Vec3;prototypes:Record<Ingredient,string>}
type Options={simulation:CookingSimulation;onRenderer:(name:string)=>void;onReady:()=>void;onError:(message:string)=>void}
const SIDES:HandSide[]=['left','right']
const FOOD:Ingredient[]=['rice','carrot','onion','bacon','scallion','egg','corn','peas','ham']
const v=(p:Vec3)=>new THREE.Vector3(...p)
const clamp=THREE.MathUtils.clamp
const maxFood:Record<Ingredient,number>={rice:1250,carrot:95,onion:70,bacon:38,scallion:150,egg:110,corn:130,peas:130,ham:40}

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
 const fireLight=new THREE.PointLight('#5899ff',.55,1.4,1.6);fireLight.position.set(0,1.075,0);fireLight.castShadow=true;fireLight.shadow.mapSize.set(512,512);fireLight.shadow.camera.near=.012;fireLight.shadow.camera.far=1.8;fireLight.shadow.bias=-.00005;fireLight.shadow.normalBias=.001;scene.add(fireLight)
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
 const dynamicNames=new Set(['Wok','Bottle_oil','Bottle_soy','Bottle_oyster','Ladle','Hand_left','Hand_right','GasKnob','FoodPrototypes'])
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
function extractHand(name:string){
 const source=gltf.scene.getObjectByName(name);if(!source)throw Error(`Missing ${name}`)
 source.traverse(o=>{if(o instanceof THREE.Mesh){o.material=Array.isArray(o.material)?o.material.map(prepareMat):prepareMat(o.material);o.castShadow=true;o.receiveShadow=true;o.frustumCulled=false}})
 cart.attach(source);return source
}
const wok=extract('Wok'),ladleTool=extract('Ladle'),hands={left:extractHand('Hand_left'),right:extractHand('Hand_right')},bottles={oil:extract('Bottle_oil'),soy:extract('Bottle_soy'),oyster:extract('Bottle_oyster')},gasKnob=extract('GasKnob')
 const handAnimators={left:new HandAnimator(hands.left),right:new HandAnimator(hands.right)}
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
 const foodPhysics=new FoodPhysics({position:wok.position,quaternion:wok.quaternion})
 const particles={} as Record<Ingredient,{mesh:THREE.InstancedMesh;count:number;materials:THREE.Material[];baseColors:THREE.Color[];geometry:THREE.BufferGeometry}>
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
  particles[kind]={mesh:inst,count:0,materials:mats,baseColors:mats.map(m=>(m as THREE.MeshStandardMaterial).color.clone()),geometry:geo}
  SIDES.forEach(side=>{const scoop=new THREE.InstancedMesh(geo,mats.length===1?mats[0]:mats,kind==='rice'?42:8);scoop.frustumCulled=false;scoop.visible=false;scene.add(scoop);carrier[side][kind]=scoop})
 })
 // Thin oil sheen conforms to the center of the concave pan.
 const sheen=new THREE.Mesh(new THREE.CircleGeometry(.145,64),new THREE.MeshPhysicalMaterial({color:'#a98733',roughness:.12,metalness:.18,transparent:true,opacity:.52,clearcoat:1,side:THREE.DoubleSide,depthWrite:false}));sheen.rotation.x=-Math.PI/2;sheen.position.set(0,.007,0);wokFood.add(sheen)
 const flames=new THREE.Group();flames.position.copy(v(layout.burnerCenter));scene.add(flames)
 const flameTex=effectTexture(),smokeTex=effectTexture(true),fireOcclusion=createFireOcclusion()
 // A gas ring reads as living fire only when it flickers in three layers: a
 // small blue combustion core, a yellow body that dominates at high flame,
 // and red-orange tongues that lick up and wander. All sizes breathe with
 // independent noise, and the whole stack scales with the gas knob setting.
 interface FlameLayer{spr:THREE.Sprite;ring:number;a:number;seed:number;speed:number;base:[number,number]}
 const flameLayers:FlameLayer[]=[]
 const addFlameLayer=(count:number,ring:number,colors:string[],base:[number,number],opacity:number,speed:number)=>{
  for(let i=0;i<count;i++){
   const material=new SpriteNodeMaterial({map:flameTex,color:colors[i%colors.length],transparent:true,opacity,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false});material.opacityNode=fireOcclusion.opacity
   const spr=new THREE.Sprite(material);flames.add(spr)
   flameLayers.push({spr,ring,a:i/count*Math.PI*2,seed:Math.random()*20,speed,base})
  }
 }
 addFlameLayer(28,.218,['#3f7dff','#5b9bff'],[.017,.052],.75,1)       // combustion core
 addFlameLayer(20,.237,['#ffc23e','#ffd76a','#ffb02e'],[.026,.10],.85,1.6) // yellow body
 addFlameLayer(12,.298,['#ff5a1f','#ff7a26','#e83c12'],[.024,.13],.65,2.3) // red tongues
 const flameBlue=new THREE.Color('#3f7dff'),flameYellow=new THREE.Color('#ffc23e'),flameOrange=new THREE.Color('#ff7a26'),flameRed=new THREE.Color('#ff3d14')
 // Oil flares belong above the pan's inner surface. Their depth test and the
 // wok mesh hide the back tongues; the gas-fire occlusion remains separate.
 const oilFlare=new THREE.Group();wokFood.add(oilFlare)
 const flareTongues:THREE.Sprite[]=[]
 for(let i=0;i<15;i++){
  const material=new SpriteNodeMaterial({map:flameTex,color:i%3===0?'#fff0a7':i%3===1?'#ffab33':'#ff5c15',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthTest:true,depthWrite:false})
  const spr=new THREE.Sprite(material);oilFlare.add(spr);flareTongues.push(spr)
 }
 const flareRing=new THREE.Mesh(new THREE.RingGeometry(.10,.14,48),new THREE.MeshBasicMaterial({color:'#ffc258',transparent:true,opacity:0,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));flareRing.rotation.x=-Math.PI/2;flareRing.position.y=.055;oilFlare.add(flareRing)
 const flareLight=new THREE.PointLight('#ff8b32',0,.95,2);flareLight.position.set(0,.19,0);oilFlare.add(flareLight)
 const vapour:THREE.Sprite[]=[]
 for(let i=0;i<24;i++){const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,color:'#d9d3bc',transparent:true,opacity:0,depthWrite:false}));scene.add(sprite);vapour.push(sprite)}
 const streams={} as Record<HandSide,LiquidStream>
 SIDES.forEach(side=>{const stream=new LiquidStream();scene.add(stream);streams[side]=stream})
 // Screen labels explain the real draggable hands, and track the actual meshes.
 const ray=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-1.15),intersection=new THREE.Vector3()
 const zones:{zone:Zone;anchor:THREE.Vector3;proxy:THREE.Mesh;title:string}[]=[]
 function addZone(zone:Zone,at:Vec3,size:Vec3,title:string){const proxy=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshBasicMaterial());proxy.position.copy(v(at));proxy.updateMatrixWorld();zones.push({zone,anchor:v(at),proxy,title})}
 addZone('wok',[0,1.18,0],[.57,.2,.57],'锅内 · 推拉翻炒 / 持料画圈翻勺')
 addZone('handle',layout.wokHandle,[.31,.18,.30],'锅柄 · 松手握住，再拖动提锅')
 for(const kind of FOOD)addZone(kind,layout.trays[kind],kind==='rice'?[.44,.16,.52]:[.27,.16,.24],INGREDIENT_LABELS[kind]+' · 持勺来回划动取料')
 for(const kind of ['oil','soy','oyster'] as const)addZone(kind,[layout.bottles[kind][0],layout.bottles[kind][1]+.14,layout.bottles[kind][2]],[.16,.37,.17],({oil:'食用油',soy:'酱油',oyster:'蚝油'})[kind]+' · 松手抓住')
 addZone('knob',[layout.tools.knob[0],layout.tools.knob[1]+.06,layout.tools.knob[2]],[.24,.17,.24],'煤气旋钮 · 按住手左右拖动调火力，越向右火越大')
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
 let lastX=0,lastY=0,lastMove=0,pointerSpeed=0,hover:Zone|null=null,lastHand:HandSide='right'
 let dragStartX=0,dragStartY=0,dragStartPoint=new THREE.Vector3()
 let mobileCameraPan=0
 const touchTwist:Record<HandSide,number>={left:0,right:0}
 function setRay(e:PointerEvent){const r=container.getBoundingClientRect();mouse.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(mouse,camera)}
 function findZone(){
  const hits=ray.intersectObjects(zones.map(z=>z.proxy),false).map(hit=>{
   const item=zones.find(z=>z.proxy===hit.object)!
   return {...item,point:hit.point,distance:hit.distance}
  })
  // The generous invisible handle box sits in front of the rice on this camera.
  // Only the actual wooden grip may occlude the rice picking area.
  const grip=ray.intersectObjects(wok.children.filter(o=>o.name==='Wok turned walnut grip'),true)[0]
  return chooseZoneHit(hits,grip?.distance)
 }
 function findHand(e:PointerEvent):HandSide|null {
  const r=container.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top
  let best:HandSide|null=null,min=60
  for(const side of SIDES){const p=project(hands[side].position.clone().add(new THREE.Vector3(0,0,-.06))),d=Math.hypot(p.x-x,p.y-y);if(d<min){best=side;min=d}}
  const hit=ray.intersectObjects(SIDES.flatMap(side=>hands[side].children),true)[0]
  if(hit)for(const side of SIDES){let node:THREE.Object3D|null=hit.object;while(node){if(node===hands[side])return side;node=node.parent}}
  for(const side of SIDES){const held=simulation.state.hands[side].held;const tool=['ladle','scoop'].includes(held)?ladleTool:['oil','soy','oyster'].includes(held)?bottles[held as keyof typeof bottles]:null;if(tool&&ray.intersectObject(tool,true).length)return side}
  return best
 }
 function pointAt(x:number,y:number):Vec3 {
  setRay({clientX:x,clientY:y} as PointerEvent)
  const hit=findZone()
  ray.ray.intersectPlane(plane,intersection)
  const p=hit?.point||intersection
  return [clamp(p.x,-1.3,1.65),clamp(p.y,1.04,1.8),clamp(p.z,-.82,.9)]
 }
 function spoonTouchesFood(zone:Zone|null,point:THREE.Vector3|Vec3){
  if(!zone||!FOOD.includes(zone as Ingredient))return false
  const center=layout.trays[zone],x=Array.isArray(point)?point[0]:point.x,z=Array.isArray(point)?point[2]:point.z
  const halfX=zone==='rice'?.22:.135,halfZ=zone==='rice'?.26:.12
  // The modelled spoon bowl has a 4 cm collision radius. Its low point is
  // constrained to the food surface by wristForSpoonContact when scooping.
  return Math.abs(x-center[0])<halfX+.03&&Math.abs(z-center[2])<halfZ+.03
 }
 const mobile=new MobileInputController({
  pick:(x,y)=>{
   setRay({clientX:x,clientY:y} as PointerEvent)
   const zone=findZone()?.zone||null,s=simulation.state
   if(s.ladle.resting&&ray.intersectObject(ladleTool,true).length)return {kind:'object',side:SIDES.find(candidate=>s.hands[candidate].held==='none')||'right',zone:'rest'}
   if(zone==='rest'){
    const touchedHand=findHand({clientX:x,clientY:y} as PointerEvent)
    return touchedHand?{kind:'hand',side:touchedHand,zone:null}:null
   }
   if(zone){
    let side:HandSide='right'
    if(zone==='handle')side=SIDES.find(candidate=>s.hands[candidate].held==='wok')||SIDES.find(candidate=>s.hands[candidate].held==='none')||(s.hands.left.held==='ladle'?'left':'right')
    else if(zone==='knob')side=s.hands.left.held==='wok'?'right':'left'
    else if(zone==='oil'||zone==='soy'||zone==='oyster')side=SIDES.find(candidate=>s.hands[candidate].held===zone)||SIDES.find(candidate=>s.hands[candidate].held==='none')||'left'
    else if(zone==='wok')side=SIDES.find(candidate=>['ladle','scoop'].includes(s.hands[candidate].held))||'right'
    else side=SIDES.find(candidate=>['ladle','scoop'].includes(s.hands[candidate].held))||'right'
    return {kind:'object',side,zone}
   }
   const side=findHand({clientX:x,clientY:y} as PointerEvent)
   return side?{kind:'hand',side,zone:null}:null
  },
  zoneAt:(x,y)=>{setRay({clientX:x,clientY:y} as PointerEvent);return findZone()?.zone||null},
  grab:(picked,x,y)=>{
   drag=picked.side;lastHand=drag;dragStartX=x;dragStartY=y;dragStartPoint.copy(v(simulation.state.hands[drag].position))
   touchTwist[drag]=0
   const zone=picked.zone,h=simulation.state.hands[drag]
   if(picked.kind==='object'&&zone&&['oil','soy','oyster','handle','rest'].includes(zone)&&
      (zone==='handle'?h.held!=='wok':zone==='rest'?h.held==='none':h.held!==zone)){
    simulation.beginDrag(drag)
    simulation.moveHand(drag,zone,pointAt(x,y),0)
    simulation.endDrag(drag,zone)
   }
   simulation.beginDrag(drag)
   if(picked.kind==='object'&&zone&&FOOD.includes(zone as Ingredient)&&['ladle','scoop'].includes(simulation.state.hands[drag].held)){
    const point=pointAt(x,y)
    simulation.moveHand(drag,zone,point,.15,{sweep:.45,contact:spoonTouchesFood(zone,point)})
   }
   dragStartPoint.copy(v(simulation.state.hands[drag].position))
  },
  move:(picked,motion)=>{
   const side=picked.side,h=simulation.state.hands[side]
   let point=pointAt(motion.clientX,motion.clientY)
   if(h.held==='wok'){
    const r=container.getBoundingClientRect(),dx=(motion.clientX-dragStartX)/r.width,dy=(motion.clientY-dragStartY)/r.height
    point=[dragStartPoint.x+dx*2.7,dragStartPoint.y-dy*1.75,dragStartPoint.z-dy*.25]
   }
   hover=motion.over
   simulation.moveHand(side,motion.over,point,motion.speed,{...motion.gesture,contact:spoonTouchesFood(motion.over,point)})
  },
  rotate:(picked,rotation)=>{
   const side=picked.side,h=simulation.state.hands[side]
   touchTwist[side]=clamp(rotation.total,-Math.PI,Math.PI)
   const turn=clamp(Math.abs(rotation.delta)/(Math.PI*.38),0,1)
   if(['oil','soy','oyster','wok'].includes(h.held))simulation.moveHand(side,h.zone,v(h.position).toArray() as Vec3,Math.min(1,turn),{tilt:turn})
   else if(h.payload)simulation.moveHand(side,h.zone,v(h.position).toArray() as Vec3,Math.min(1,turn),{circle:turn})
  },
  drop:(picked,x,y,over,cancelled)=>{
   const side=picked.side,held=simulation.state.hands[side].held
   simulation.endDrag(side,cancelled?null:over)
   if(['oil','soy','oyster'].includes(held)&&simulation.state.hands[side].held===held)simulation.putDown(side,pointAt(x,y))
   else if(held==='wok'&&simulation.state.hands[side].held==='wok')simulation.putDown(side)
   touchTwist[side]=0;drag=null;hover=null
  },
  pan:deltaX=>{mobileCameraPan=clamp(mobileCameraPan-deltaX/Math.max(1,container.clientWidth)*2.5,-1.05,1.05)},
 })
 function putDownHand(side:HandSide){simulation.putDown(side);if(drag===side){drag=null;tracker.reset();if(activePointer>=0&&container.hasPointerCapture(activePointer))container.releasePointerCapture(activePointer);activePointer=-1}cursor.hidden=true}
 function onContext(e:MouseEvent){e.preventDefault()}
 function onReleaseKey(e:KeyboardEvent){if(e.code!=='KeyR'||e.repeat||e.ctrlKey||e.metaKey||e.altKey||e.target instanceof HTMLInputElement)return;if(simulation.state.phase==='playing'){e.preventDefault();putDownHand(drag||lastHand)}}
 function onDown(e:PointerEvent){
  if(e.pointerType==='touch'&&simulation.state.phase==='playing'&&cameraBlend>.96){if(mobile.pointerDown(e)){container.setPointerCapture(e.pointerId);e.preventDefault()}return}
  if(e.button===2&&simulation.state.phase==='playing'){setRay(e);const side=drag||findHand(e);if(side){e.preventDefault();lastHand=side;putDownHand(side)}return}
  if(e.button!==0||simulation.state.phase!=='playing'||cameraBlend<.96)return
  setRay(e);drag=findHand(e);if(!drag)return;lastHand=drag
  activePointer=e.pointerId;container.setPointerCapture(e.pointerId);simulation.beginDrag(drag)
  lastX=dragStartX=e.clientX;lastY=dragStartY=e.clientY;lastMove=performance.now()
  dragStartPoint.copy(v(simulation.state.hands[drag].position));tracker.reset();container.style.cursor='grabbing';e.preventDefault()
 }
 function onMove(e:PointerEvent){
  if(e.pointerType==='touch'){if(mobile.pointerMove(e))e.preventDefault();return}
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
   simulation.moveHand(drag,hover,point,pointerSpeed,{...gesture,contact:spoonTouchesFood(hover,point)})
  }else container.style.cursor=findHand(e)?'grab':target?'crosshair':'default'
  cursor.textContent=drag?promptFor(releaseZone(hover))||'保持握持 · 拖到目标操作':findHand(e)?'按住这只手拖动':target?.title||''
  cursor.hidden=!cursor.textContent
  const rect=container.getBoundingClientRect();cursor.style.left=`${clamp(e.clientX-rect.left+16,4,rect.width-240)}px`;cursor.style.top=`${e.clientY-rect.top-27}px`
 }
function onUp(e:PointerEvent){
 if(e.pointerType==='touch'){if(mobile.pointerUp(e)){if(container.hasPointerCapture(e.pointerId))container.releasePointerCapture(e.pointerId);e.preventDefault()}return}
 if(!drag)return;setRay(e);const zone=releaseZone(findZone()?.zone||null)
 simulation.endDrag(drag,zone);drag=null;tracker.reset()
  if(container.hasPointerCapture(activePointer))container.releasePointerCapture(activePointer)
  activePointer=-1;container.style.cursor='grab'
 }
 function onCancel(e?:PointerEvent){if(e?.pointerType==='touch'){mobile.pointerCancel(e);if(container.hasPointerCapture(e.pointerId))container.releasePointerCapture(e.pointerId);return}mobile.reset();if(drag)simulation.endDrag(drag,null);drag=null;activePointer=-1;tracker.reset()}
 container.addEventListener('pointerdown',onDown);container.addEventListener('pointermove',onMove);container.addEventListener('pointerup',onUp);container.addEventListener('pointercancel',onCancel);container.addEventListener('contextmenu',onContext);window.addEventListener('keydown',onReleaseKey)
 const resize=()=>{const r=container.getBoundingClientRect();camera.aspect=r.width/r.height;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height)};const observer=new ResizeObserver(resize);observer.observe(container);resize()
 const post=new PostProcessing(renderer),renderPass=pass(scene,camera),colorPass=renderPass.getTextureNode('output');post.outputNode=colorPass.add(bloom(colorPass,.11,.45,2.5))
 let previous=performance.now(),time=0,cameraBlend=0,panPhase=0,lastToss=0
 const bowlContacts={left:new THREE.Vector3(),right:new THREE.Vector3()},lastPayload:Record<HandSide,Ingredient|null>={left:null,right:null},releasedKind:Record<HandSide,Ingredient|null>={left:null,right:null},flipTimers={left:0,right:0}
 const stirStrokes={left:new StirStroke(),right:new StirStroke()}
 const poseTransitions={left:new PoseTransition(),right:new PoseTransition()}
 const renderedTilt:Record<HandSide,number>={left:0,right:0}
 const pourOrigin:Partial<Record<Ingredient,THREE.Vector3>>={}
 type ReleaseMotion={held:string;start:number;from:THREE.Vector3;rotation:THREE.Quaternion;place:THREE.Vector3;placeRotation:THREE.Quaternion}
 const releases:Partial<Record<HandSide,ReleaseMotion>>={}
 const previousHeld:Record<HandSide,string>={left:'none',right:'ladle'}
 function visualHeld(side:HandSide){const r=releases[side];return r&&simulation.state.time-r.start<.28?r.held:simulation.state.hands[side].held}
 const ease=(t:number)=>{t=clamp(t,0,1);return t*t*(3-2*t)}
 const dummy=new THREE.Object3D(),work=new THREE.Vector3(),wrist=new THREE.Vector3(),target=new THREE.Vector3()
 function moveToolToHand(tool:THREE.Object3D,hand:THREE.Object3D){tool.position.copy(hand.position).add(v(layout.handGripOffset).applyQuaternion(hand.quaternion));tool.quaternion.copy(hand.quaternion)}
 camera.position.copy(v(layout.cameraMenu));camera.lookAt(v(layout.lookMenu));onReady()
 function draw(now:number){
  if(disposed)return;const delta=clamp((now-previous)/1000,0,.05);previous=now;const state=simulation.state
  const playing=state.phase==='playing',menu=state.phase==='menu';if(playing||menu)time+=delta
  const destination=menu?0:1;cameraBlend=THREE.MathUtils.damp(cameraBlend,destination,2.8,delta);const blend=cameraBlend*cameraBlend*(3-2*cameraBlend)
  camera.position.lerpVectors(v(layout.cameraMenu),v(layout.cameraPlay),blend);camera.position.y+=Math.sin(blend*Math.PI)*.24;target.lerpVectors(v(layout.lookMenu),v(layout.lookPlay),blend)
  if(camera.aspect<.85){camera.position.x+=mobileCameraPan*blend;target.x+=mobileCameraPan*blend;if(menu)camera.position.add(v(layout.cameraMenu).sub(v(layout.lookMenu)).multiplyScalar(.48))}
  camera.lookAt(target);camera.fov=camera.aspect<.85?THREE.MathUtils.lerp(60,73,blend):THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(THREE.MathUtils.lerp(50,layout.cameraFov,blend)/2))/Math.min(1,camera.aspect/1.45)));camera.updateProjectionMatrix()
  overlay.style.opacity=playing&&cameraBlend>.96?'1':'0';overlay.style.pointerEvents='none';if(!playing&&drag)onCancel()
  const panHand=SIDES.find(side=>state.hands[side].held==='wok'),panIntensity=panHand?state.hands[panHand].intensity:0
  if(playing)panPhase+=delta*(3+panIntensity*12)
  wok.position.lerp(v(state.pan.position),1-Math.exp(-delta*24));wok.position.y+=state.toss*.012
  wok.rotation.set(panIntensity*Math.sin(panPhase)*.07-state.toss*.15-state.pan.tilt,0,panIntensity*Math.cos(panPhase)*.045)
  wok.updateMatrixWorld(true);fireOcclusion.inverseWok.value.copy(wok.matrixWorld).invert()
  wokFood.position.copy(wok.position);wokFood.quaternion.copy(wok.quaternion)
  for(const z of zones){
   if(z.zone==='wok'){z.proxy.position.copy(wok.position).add(new THREE.Vector3(0,.08,0));z.anchor.copy(z.proxy.position)}
   if(z.zone==='handle'){z.proxy.position.copy(v(layout.wokHandle).sub(v(layout.wokCenter)).applyQuaternion(wok.quaternion).add(wok.position));z.anchor.copy(z.proxy.position)}
   if(z.zone==='oil'||z.zone==='soy'||z.zone==='oyster'){
    z.proxy.position.copy(v(state.bottleSpots[z.zone])).add(new THREE.Vector3(0,.14,0))
    z.anchor.copy(z.proxy.position)
    z.proxy.scale.setScalar(SIDES.some(side=>state.hands[side].held===z.zone)?1e-5:1)
   }
   z.proxy.updateMatrixWorld()
  }
  const visualGrip=v(layout.handGripOffset)
  for(const side of SIDES){
   const h=state.hands[side],model=hands[side];model.visible=cameraBlend>.78
   if(menu){delete releases[side];previousHeld[side]=h.held;stirStrokes[side].reset()}
   if(previousHeld[side]!=='none'&&h.held==='none'){
    const held=previousHeld[side],place=new THREE.Vector3(),placeRotation=new THREE.Quaternion()
    if(['oil','soy','oyster'].includes(held)){place.copy(v(state.bottleSpots[held as keyof typeof bottles])).add(new THREE.Vector3(0,.145,.10))}
    else if(held==='wok'){place.copy(model.position);placeRotation.copy(model.quaternion)}
    else{placeRotation.copy(LADLE_REST_ROTATION);place.copy(v(state.ladle.spot)).add(LADLE_REST_OFFSET).sub(visualGrip.clone().applyQuaternion(placeRotation))}
    releases[side]={held,start:state.time,from:model.position.clone(),rotation:model.quaternion.clone(),place,placeRotation}
   }
   previousHeld[side]=h.held
   const visibleItem=visualHeld(side)

   if(lastPayload[side]&&!h.payload&&h.held!=='none'&&!['oil','soy','oyster'].includes(h.held)){
    releasedKind[side]=lastPayload[side];flipTimers[side]=.6
    pourOrigin[lastPayload[side]!]=bowlContacts[side].clone()
   }
   if(menu){flipTimers[side]=0;releasedKind[side]=null}lastPayload[side]=h.payload;if(playing)flipTimers[side]=Math.max(0,flipTimers[side]-delta)
   work.copy(v(h.position));const yaw=side==='left'?.19:-.16
   const spoon=['ladle','scoop','egg'].includes(visibleItem)
   let spoonContact:THREE.Vector3|null=null,wokGripContact:THREE.Vector3|null=null
   if(h.held==='wok'){
    // Match the palm to the same transformed wooden handle that moves the pan.
    const handle=v(layout.wokHandle).sub(v(layout.wokCenter)).applyQuaternion(wok.quaternion).add(wok.position)
    model.rotation.set(-.13,-.58,0);model.quaternion.premultiply(wok.quaternion)
    wrist.copy(handle).sub(visualGrip.clone().applyQuaternion(model.quaternion))
    wokGripContact=handle
   }else if(['oil','soy','oyster'].includes(h.held)){
    model.rotation.set(THREE.MathUtils.lerp(.05,1.88,h.tilt),yaw,(side==='left'?-.10:.10)+touchTwist[side]*.55)
    wrist.copy(work).add(new THREE.Vector3(0,.065,.05))
    if(h.zone==='wok'){wrist.y=wok.position.y+.34;wrist.z+=.10}
   }else if(spoon&&(h.dragging||h.mode==='stirring'||h.mode==='scooping'||h.payload||flipTimers[side]>0)){
    const contact=work.clone()
    if(h.mode==='stirring'){
     const manual=work.clone().sub(wok.position).applyQuaternion(wok.quaternion.clone().invert())
     const local=stirStrokes[side].sample(manual,h.dragging,delta,h.intensity)
     const radius=Math.hypot(local.x,local.z);if(radius>.185){local.x*=.185/radius;local.z*=.185/radius}
     local.y=panFoodSurface(local.x,local.z,state.food.rice)+.003
     contact.copy(local.applyQuaternion(wok.quaternion).add(wok.position))
    }else if(h.payload){
     contact.y=h.zone==='wok'?Math.max(contact.y,wok.position.y+.21):h.zone&&FOOD.includes(h.zone as Ingredient)?layout.trays[h.zone][1]+.07:contact.y
    }else if(flipTimers[side]>0){contact.y=Math.max(contact.y,wok.position.y+.21)}
    else if(h.zone&&FOOD.includes(h.zone as Ingredient)){contact.y=layout.trays[h.zone][1]+.027}
    else contact.y=Math.max(contact.y,1.19)
    // Approach the left rice bin from the cook's center instead of forcing the
    // right wrist through the edge of the cart to keep the spoon bowl planted.
    const spoonYaw=side==='right'&&!h.payload&&h.zone==='rice'&&h.mode==='scooping' ? .48 : yaw
    // A level wrist points the forearm back toward the cook; pitching it down
    // sent its modeled end across the upper half of the first-person view.
    const spoonPitch=h.mode==='stirring' ? .02 : !h.payload&&h.zone==='rice'&&h.mode==='scooping' ? -.05 : -.43
    model.rotation.set(spoonPitch,spoonYaw,(h.payload?h.circleProgress*Math.PI:0)+touchTwist[side]*.18)
    if(h.mode==='stirring')model.quaternion.premultiply(wok.quaternion)
    wrist.copy(wristForSpoonContact(contact,model.quaternion,visualGrip))
    if(h.mode==='stirring'||(!h.payload&&h.mode==='scooping'&&h.zone&&FOOD.includes(h.zone as Ingredient)))spoonContact=contact
   }else if(h.dragging){wrist.copy(work).add(new THREE.Vector3(0,.025,.10));model.rotation.set(.05,yaw,0)}
   else {wrist.copy(v(layout.handRest[side]));wrist.y+=.045;model.rotation.set(.14,yaw,0)}
   const release=releases[side]
   if(release){
    spoonContact=null;wokGripContact=null
    const age=state.time-release.start
    if(age<.68){
     if(release.held==='wok'){
      release.placeRotation.setFromEuler(new THREE.Euler(-.13,-.58,0)).premultiply(wok.quaternion)
      release.place.copy(v(layout.wokHandle).sub(v(layout.wokCenter)).applyQuaternion(wok.quaternion).add(wok.position)).sub(visualGrip.clone().applyQuaternion(release.placeRotation))
     }
     if(age<.28){const t=ease(age/.28);wrist.lerpVectors(release.from,release.place,t);wrist.y+=Math.sin(t*Math.PI)*.035;model.quaternion.slerpQuaternions(release.rotation,release.placeRotation,t)}
     else{const t=ease((age-.28)/.4),rest=v(layout.handRest[side]).add(new THREE.Vector3(0,.045,0));wrist.lerpVectors(release.place,rest,t);wrist.y+=Math.sin(t*Math.PI)*.045;model.quaternion.slerpQuaternions(release.placeRotation,new THREE.Quaternion().setFromEuler(new THREE.Euler(.14,yaw,0)),t)}
    }else delete releases[side]
   }
   if(h.held==='none'&&!h.dragging&&!release){wrist.y+=Math.sin(time*1.6+(side==='left'?0:1))*.0025;model.rotation.z+=Math.sin(time*1.4)*.012}
   const transition=poseTransitions[side]
   const pose=transition.step(`${visibleItem}:${h.mode}:${h.dragging?'drag':'idle'}:${release?'release':''}`,
    {position:wrist,quaternion:model.quaternion,tilt:h.tilt},delta,
    {duration:release?POSE_TRANSITION_SECONDS.release:h.mode==='pouring'?POSE_TRANSITION_SECONDS.pour:h.mode==='stirring'?POSE_TRANSITION_SECONDS.stir:POSE_TRANSITION_SECONDS.grab,
     trackingHalfLife:h.dragging?.018:.035})
   if(spoonContact)transition.pinContact(spoonContact,visualGrip.clone().add(SPOON_BOWL))
   else if(wokGripContact)transition.pinContact(wokGripContact,visualGrip)
   model.position.copy(pose.position);model.quaternion.copy(pose.quaternion);renderedTilt[side]=pose.tilt
   handAnimators[side].update({...h,held:visibleItem},playing?delta:0,time)
   const projected=project(model.position.clone().add(new THREE.Vector3(0,.02,.04)))
   tags[side].style.transform=`translate(${projected.x}px,${projected.y}px) translate(-50%,32px)`
   tags[side].classList.toggle('is-dragging',h.dragging)
   tags[side].querySelector('small')!.textContent=h.payload?INGREDIENT_LABELS[h.payload]+' · 画圈倒入':h.scoopProgress>0&&h.scoopProgress<1?'铲取 '+Math.round(h.scoopProgress*100)+'%':h.mode==='stirring'&&!h.dragging?'持续翻炒中':h.held==='wok'?'握锅 · 右键放下':['oil','soy','oyster'].includes(h.held)?'握瓶 · 右键放下':'按住拖动'
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
  const ladleHand=SIDES.find(side=>['ladle','scoop','egg'].includes(visualHeld(side)))
  ladleTool.visible=cameraBlend>.78
  if(!ladleHand){
   ladleTool.position.copy(v(state.ladle.spot)).add(LADLE_REST_OFFSET)
   ladleTool.quaternion.copy(LADLE_REST_ROTATION)
  }
  for(const kind of ['oil','soy','oyster'] as const){const bottle=bottles[kind],side=SIDES.find(side=>visualHeld(side)===kind)
   if(side){const h=state.hands[side],hand=hands[side];bottle.quaternion.copy(hand.quaternion);bottle.position.copy(hand.position).add(new THREE.Vector3(0,-.145,-.10).applyQuaternion(hand.quaternion))
    const flow=h.held===kind?clamp((renderedTilt[side]-.15)/.7,0,1):0
    if(flow>.01){
     const start=new THREE.Vector3(0,kind==='oyster'?.275:.3,0).applyQuaternion(bottle.quaternion).add(bottle.position),end=new THREE.Vector3(wok.position.x+clamp(h.position[0]-wok.position.x,-.19,.19),wok.position.y+.035,wok.position.z+clamp(h.position[2]-wok.position.z,-.19,.19));streams[side].update(kind,start,end,time,flow)
    }
   }else{bottle.position.copy(v(state.bottleSpots[kind]));bottle.quaternion.identity()}}
  const tossImpulse=state.toss>lastToss+.1;lastToss=state.toss
  FOOD.forEach(kind=>{
   const p=particles[kind],waiting=SIDES.some(side=>releasedKind[side]===kind&&flipTimers[side]>.3)
   const grainDensity=camera.aspect<.85?.72:1
   const targetCount=waiting?p.count:Math.round(state.food[kind]*maxFood[kind]*grainDensity)
   const count=targetCount>p.count?Math.min(targetCount,p.count+Math.ceil(delta*maxFood[kind]*1.5)):targetCount
   p.count=count;p.mesh.count=count
   foodPhysics.setCount(kind,count,pourOrigin[kind]||wok.position.clone().add(new THREE.Vector3(0,.24,0)))
  })
  foodPhysics.step(playing?delta:0,{position:wok.position,quaternion:wok.quaternion},{
   spoons:SIDES.filter(side=>state.hands[side].mode==='stirring').map(side=>({id:side,position:bowlContacts[side],strength:state.hands[side].intensity})),
   toss:tossImpulse?state.toss:0,
  })
  FOOD.forEach(kind=>{
   const p=particles[kind],bodies=foodPhysics.get(kind)
   for(let i=0;i<bodies.length;i++){
    const body=bodies[i]
    foodPhysics.localPosition(body,dummy.position);dummy.rotation.copy(body.rotation);dummy.scale.setScalar(body.scale);dummy.updateMatrix();p.mesh.setMatrixAt(i,dummy.matrix)
   }p.mesh.instanceMatrix.needsUpdate=true
   p.materials.forEach((m,index)=>{if(m instanceof THREE.MeshStandardMaterial){m.color.copy(p.baseColors[index]);if(kind==='rice')m.color.lerp(new THREE.Color('#d9a545'),clamp(state.cooked*.55+(state.food.soy+state.food.oyster*.55)*.30,0,.75));if(state.burnt>0)m.color.lerp(new THREE.Color('#322014'),state.burnt);m.roughness=.40-state.food.oil*.14}})
  })
  sheen.visible=state.food.oil>0;sheen.scale.setScalar(.45+state.food.oil*.55)
  const onFlame=clamp(1-state.pan.lift/.3,0,1)*clamp(1-Math.hypot(state.pan.position[0],state.pan.position[2])/.5,0,1),activity=Math.max(panIntensity,state.toss*.8)*onFlame,foodQuantity=FOOD.reduce((sum,k)=>sum+state.food[k],0)
  // The gas knob physically turns with the setting: off points left, full
  // open points right, sweeping through the back like a real stove valve.
  gasKnob.rotation.y=Math.PI-clamp(state.fire,0,1)*Math.PI
  const fire=clamp(state.fire,0,1)
  for(const f of flameLayers){
   // Three summed sines per flame read as turbulent combustion, never as a
   // repeating pulse; every sprite carries its own phase.
   const n=Math.sin(time*f.speed*7+f.seed)*.5+Math.sin(time*f.speed*13.7+f.seed*2.7)*.35+Math.sin(time*f.speed*23.3+f.seed*4.3)*.2
   const h=f.base[1]*(.26+fire*(1.05+.55*n)+activity*.3)
   const w=f.base[0]*(.65+fire*.55+.22*n)
   f.spr.position.set(Math.cos(f.a)*f.ring+Math.sin(time*f.speed*4.7+f.seed*1.3)*.006*fire,h*.44,Math.sin(f.a)*f.ring+Math.cos(time*f.speed*3.9+f.seed*2.1)*.006*fire)
   f.spr.scale.set(w,Math.max(.012,h),1)
   f.spr.material.rotation=Math.sin(time*f.speed*3.1+f.seed)*.24
   const pulse=.72+.28*Math.sin(time*f.speed*9.3+f.seed*3.7)
   if(f.base[1]<.06){ // combustion core: stays gas-blue, fades as the roar takes over
    f.spr.material.opacity=fire*(.5+.35*pulse)*(1-clamp(fire*.55,0,1))
   }else if(f.base[1]<.12){ // body: small flame is blue-ish, big flame is yellow
    f.spr.material.color.copy(flameBlue).lerp(flameYellow,clamp(fire*1.35,0,1))
    f.spr.material.opacity=fire*(.55+.4*pulse)
   }else{ // tongues: orange to deep red, strongest on a roaring fire
    f.spr.material.color.copy(flameOrange).lerp(flameYellow,clamp(fire*.8,0,1))
    f.spr.material.opacity=clamp((fire-.48)*1.7+activity*.3,0,1)*(.28+.30*pulse)*onFlame
   }
  }
  fireLight.intensity=fire*(.4+activity*.5)
  fireLight.color.copy(flameBlue).lerp(flameYellow,clamp(fire*1.15,0,1))
  const flash=state.hotOilFlash
  flareLight.intensity=flash*3.7
  flareRing.scale.setScalar(1+(1-flash)*1.3)
  ;(flareRing.material as THREE.MeshBasicMaterial).opacity=flash*.55
  flareTongues.forEach((s,i)=>{
   const a=i*2.39996,turbulence=Math.sin(time*31+i*11.8)*.018
   const radius=.04+(i%5)*.022
   s.position.set(Math.cos(a)*radius+turbulence,.13+Math.sin(time*24+i*3.1)*.024+flash*.065,Math.sin(a)*radius-turbulence)
   s.scale.set(.052+flash*.055,.12+flash*(.13+(i%4)*.028),1)
   s.material.rotation=Math.sin(time*17+i*1.9)*.26
   s.material.opacity=flash*(i%3===0?.83:.65)
  })
  vapour.forEach((s,i)=>{const t=(time*.32+i/24)%1,amount=clamp(foodQuantity*.2+flash*.8,0,1);s.position.set(wok.position.x+Math.sin(i*5+t*3)*(.12+t*.12),wok.position.y+.16+t*.70,wok.position.z+Math.cos(i*7+t*2)*.14);s.scale.set(.10+t*.25,.17+t*.4,1);s.material.opacity=amount*(state.temperature+flash*.45)*(1-t)*.26;s.material.rotation=Math.sin(i+time*.2)*.18})
  if(drag&&hover){const zone=zones.find(z=>z.zone===hover)!;targetRing.visible=true;targetRing.position.copy(zone.anchor);targetRing.position.y=hover==='wok'?wok.position.y+.14:zone.anchor.y+.09;targetRing.scale.setScalar(hover==='wok'?3:1)}else targetRing.visible=false
  post.render();frame=requestAnimationFrame(draw)
 }
 frame=requestAnimationFrame(draw)
 return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();onCancel();container.removeEventListener('pointerdown',onDown);container.removeEventListener('pointermove',onMove);container.removeEventListener('pointerup',onUp);container.removeEventListener('pointercancel',onCancel);container.removeEventListener('contextmenu',onContext);window.removeEventListener('keydown',onReleaseKey);overlay.remove();renderer.domElement.remove();post.dispose();scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){if(o instanceof THREE.Mesh)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose()}});flameTex.dispose();smokeTex.dispose();groundTex.dispose();ironMicro.dispose();envTarget?.dispose();rawEnv?.dispose();renderer.dispose()}
}
