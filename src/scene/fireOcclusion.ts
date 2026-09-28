import {Matrix4, Vector3} from 'three'
import {uniform,positionView,cameraWorldMatrix,vec4,smoothstep,materialOpacity} from 'three/tsl'

// Conservative measured envelope: includes the steel wall and every point above
// its inner surface. Keep the gas outside the food volume even with a tilted pan.
export const FIRE_BOWL_RADIUS=.294
export const FIRE_WALL_CLEARANCE=.009
export function protectedByWok(world:Vector3,inverseWok:Matrix4){
 const p=world.clone().applyMatrix4(inverseWok),r=Math.hypot(p.x,p.z)
 const underside=.122*Math.pow(Math.min(r,.28)/.28,1.75)-.0009
 return r<FIRE_BOWL_RADIUS&&p.y>underside-FIRE_WALL_CLEARANCE
}
export function createFireOcclusion(){
 const inverseWok=uniform(new Matrix4())
 // positionWorld on SpriteNodeMaterial is the un-billboarded quad. Reconstruct
 // its actual rasterized world position from view space, so clipping follows
 // the visible flame pixels instead of the sprite's anchor point.
 const pixelWorld=cameraWorldMatrix.mul(vec4(positionView,1))
 const local=inverseWok.mul(pixelWorld).xyz
 const radius=local.xz.length()
 const underside=radius.min(.28).div(.28).pow(1.75).mul(.122).sub(.0009)
 const insideRadius=smoothstep(.288,.294,radius).oneMinus()
 const aboveFloor=smoothstep(underside.sub(.009),underside.sub(.006),local.y)
 const opacity=insideRadius.mul(aboveFloor).oneMinus().mul(materialOpacity)
 return {inverseWok,opacity}
}
