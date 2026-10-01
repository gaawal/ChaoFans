import type {Zone} from '../game/simulation'

export interface ZoneHit {
 zone:Zone
 distance:number
}

/**
 * The broad handle interaction box overlaps the rice bin in screen space. Use
 * the rice bin whenever that box alone obscures it; the narrow, visible wooden
 * grip still wins when the ray actually intersects its mesh in front of rice.
 */
export function chooseZoneHit<T extends ZoneHit>(hits:readonly T[],woodGripDistance?:number):T|null {
 if(hits.length===0)return null
 let nearest=hits[0]
 for(const hit of hits)if(hit.distance<nearest.distance)nearest=hit
 if(nearest.zone!=='handle')return nearest

 let rice:T|undefined
 for(const hit of hits)if(hit.zone==='rice'&&(!rice||hit.distance<rice.distance))rice=hit
 if(!rice)return nearest

 // A few millimetres of tolerance absorb differences between the invisible
 // rice box and its modeled grains at the edge of the physical wooden grip.
 if(woodGripDistance!==undefined&&woodGripDistance<=rice.distance+.01)return nearest
 return rice
}
