import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HandAnimator } from './HandAnimator'

test('exported hands deform all five fingers and keep the wrist attachment fixed', async () => {
  const data = await readFile(new URL('../../public/models/playable-cart.glb', import.meta.url))
  const loader = new GLTFLoader()
  // Skinning is checked on the production GLB without requiring a browser image decoder.
  loader.register(parser => ({ name: 'HeadlessSkinCheck', beforeRoot: async () => {
    const removeTextures = (value: Record<string, unknown>) => {
      for (const key of Object.keys(value)) {
        if (key.endsWith('Texture')) delete value[key]
        else if (value[key] && typeof value[key] === 'object') removeTextures(value[key] as Record<string, unknown>)
      }
    }
    for (const material of parser.json.materials ?? []) removeTextures(material)
  } }))
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  gltf.scene.updateMatrixWorld(true)
  for (const side of ['left', 'right']) {
    const root = gltf.scene.getObjectByName(`Hand_${side}`)!
    assert.ok(root)
    const animator = new HandAnimator(root)
    assert.equal(animator.jointCount, 15)
    const skin = root.getObjectByName(`Sculpted_anatomical_hand_${side}`) as THREE.SkinnedMesh
    assert.ok(skin?.isSkinnedMesh)
    assert.equal(skin.skeleton.bones.length, 16)
    const origin = root.getWorldPosition(new THREE.Vector3())
    const pose = (held: string) => {
      for (let frame = 0; frame < 100; frame++) animator.update({ held, dragging: false, mode: 'holding', intensity: 0 }, 1 / 60, 0)
      gltf.scene.updateMatrixWorld(true)
      skin.skeleton.update()
      return Array.from({ length: skin.geometry.attributes.position.count }, (_, index) =>
        skin.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(skin.geometry.attributes.position, index)).applyMatrix4(skin.matrixWorld))
    }
    const open = pose('none'), grip = pose('wok')
    let moved = 0, largest = 0, wristMovement = 0
    for (let index = 0; index < open.length; index++) {
      const delta = open[index].distanceTo(grip[index])
      largest = Math.max(largest, delta)
      if (delta > .015) moved++
      if (root.worldToLocal(open[index].clone()).z > .035) wristMovement = Math.max(wristMovement, delta)
    }
    assert.ok(largest > .06, `${side} fingers must bend visibly; measured ${largest}`)
    assert.ok(moved > 150, `${side} must deform the skin, not just a few vertices`)
    assert.ok(wristMovement < 1e-6, `${side} forearm moved ${wristMovement}`)
    assert.ok(origin.distanceTo(root.getWorldPosition(new THREE.Vector3())) < 1e-8)
    const bottle = pose('oil'), ladle = pose('ladle')
    assert.ok(Math.max(...bottle.map((p, index) => p.distanceTo(ladle[index]))) > .012, 'bottle and ladle need different grips')
    const reopened = pose('none')
    assert.ok(Math.max(...reopened.map((p, index) => p.distanceTo(open[index]))) < 1e-6, 'release must restore the open hand')
    console.log(`${side}: ${skin.geometry.attributes.position.count} skin vertices, ${moved} moved > 15 mm, max finger travel ${(largest * 1000).toFixed(1)} mm, fixed forearm`)
  }
})
