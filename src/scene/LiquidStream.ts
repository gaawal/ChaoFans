import * as THREE from 'three'
import type {Bottle} from '../game/simulation'

const up=new THREE.Vector3(0,1,0)
const palette:Record<Bottle,string>={oil:'#e2bc65',soy:'#643018',oyster:'#402313'}

/** Segmented, gravity-curved liquid with moving menisci and free splash drops. */
export class LiquidStream extends THREE.Group {
  private ribbon:THREE.InstancedMesh
  private droplets:THREE.InstancedMesh
  private dummy=new THREE.Object3D()
  private a=new THREE.Vector3()
  private b=new THREE.Vector3()
  private direction=new THREE.Vector3()
  private kind:Bottle='oil'

  constructor(){
    super()
    const material=new THREE.MeshPhysicalMaterial({color:palette.oil,metalness:.02,roughness:.13,clearcoat:1,clearcoatRoughness:.04,transparent:true,opacity:.88,depthWrite:false})
    this.ribbon=new THREE.InstancedMesh(new THREE.CylinderGeometry(1,1,1,8,1),material,30)
    this.droplets=new THREE.InstancedMesh(new THREE.SphereGeometry(1,8,6),material,16)
    this.ribbon.frustumCulled=this.droplets.frustumCulled=false
    this.ribbon.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.add(this.ribbon,this.droplets)
    this.visible=false
  }

  update(kind:Bottle,start:THREE.Vector3,end:THREE.Vector3,time:number,flow=1){
    this.visible=true
    if(this.kind!==kind){this.kind=kind;(this.ribbon.material as THREE.MeshPhysicalMaterial).color.set(palette[kind])}
    const strength=THREE.MathUtils.clamp(flow,0,1)
    ;(this.ribbon.material as THREE.MeshPhysicalMaterial).opacity=.88*strength
    const fall=Math.max(.03,start.y-end.y)
    const initial=-.17,flight=(initial+Math.sqrt(initial*initial+2*9.81*fall))/9.81
    const trace=(t:number,out:THREE.Vector3)=>out.set(
      start.x+(end.x-start.x)*t,
      start.y+initial*flight*t-.5*9.81*flight*flight*t*t,
      start.z+(end.z-start.z)*t,
    )
    const sections=kind==='oyster'?24:27
    this.ribbon.count=sections
    for(let i=0;i<sections;i++){
      const t0=i/sections,t1=(i+1)/sections
      trace(t0,this.a);trace(t1,this.b)
      this.direction.copy(this.b).sub(this.a)
      const length=this.direction.length()
      // Surface-tension beads thicken the flow and short gaps break up thin oil.
      const bead=Math.sin(t0*94-time*32+i*.4)
      const radius=(kind==='oyster'?.0075:kind==='soy'?.0054:.0048)*(.76+.30*bead)*(.35+.65*strength)
      this.dummy.position.copy(this.a).add(this.b).multiplyScalar(.5)
      this.dummy.position.x+=Math.sin(t0*11-time*13)*.005*t0
      this.dummy.position.z+=Math.cos(t0*9-time*10)*.004*t0
      this.dummy.quaternion.setFromUnitVectors(up,this.direction.multiplyScalar(1/Math.max(length,1e-6)))
      const breakIntoDrops=kind!=='oyster'&&i>sections*.72&&i%4===0
      this.dummy.scale.set(Math.max(.0008,radius),length*(breakIntoDrops?.55:1.07),Math.max(.0008,radius))
      this.dummy.updateMatrix();this.ribbon.setMatrixAt(i,this.dummy.matrix)
    }
    this.ribbon.instanceMatrix.needsUpdate=true
    this.droplets.count=Math.ceil((kind==='oyster'?10:16)*strength)
    for(let i=0;i<this.droplets.count;i++){
      const phase=(time*(kind==='oyster'?3.1:6.8)+i/this.droplets.count)%1
      const around=phase<.72?phase/.72:1
      trace(around,this.dummy.position)
      if(phase>=.72){
        const age=(phase-.72)/.28,angle=i*2.39996
        this.dummy.position.set(end.x+Math.cos(angle)*age*.035,end.y+Math.sin(age*Math.PI)*.023,end.z+Math.sin(angle)*age*.035)
      }else{
        this.dummy.position.x+=Math.sin(i*8.2+time*13)*.003*phase
        this.dummy.position.z+=Math.cos(i*4.8+time*11)*.003*phase
      }
      const radius=(kind==='oyster'?.0065:.0054)*(.5+.55*Math.sin(i*12.1+time*9)**2)
      this.dummy.scale.set(radius,radius*(kind==='oyster'?2.0:1.45),radius)
      this.dummy.quaternion.identity();this.dummy.updateMatrix();this.droplets.setMatrixAt(i,this.dummy.matrix)
    }
    this.droplets.instanceMatrix.needsUpdate=true
  }
}
