import { AnimationClip, LoadingManager, Object3D } from 'three';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const ASSET_PATHS = {
  map: '/assets/maps/fruzer-city.glb',
  player: '/assets/characters/Superhero_Male_FullBody.gltf',
  animation: '/assets/animations/UAL1_Standard.glb',
  pincherMonster: '/assets/monsters/pincherMonster/scene.gltf',
} as const;

export interface MonsterAsset {
  scene: Object3D;
  animations: AnimationClip[];
}

export class AssetLoader {
  private readonly manager = new LoadingManager();
  private readonly gltfLoader = new GLTFLoader(this.manager);

  loadMap(): Promise<Object3D> {
    return this.loadScene(ASSET_PATHS.map, 'city map');
  }

  loadPlayer(): Promise<Object3D> {
    return this.loadScene(ASSET_PATHS.player, 'player character');
  }

  async loadAnimationClips(): Promise<AnimationClip[]> {
    try {
      const gltf = await this.loadGltf(ASSET_PATHS.animation);
      return gltf.animations;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load animation library from "${ASSET_PATHS.animation}". ${detail}`,
      );
    }
  }

  async loadPincherMonster(): Promise<MonsterAsset> {
    try {
      const gltf = await this.loadGltf(ASSET_PATHS.pincherMonster);
      console.group('Pincher monster animation clips');
      gltf.animations.forEach((clip, index) => {
        console.log(`${index + 1}. ${clip.name} (${clip.duration.toFixed(2)}s)`);
      });
      console.groupEnd();
      return {
        scene: gltf.scene,
        animations: gltf.animations,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load pincher monster from "${ASSET_PATHS.pincherMonster}". ${detail}`,
      );
    }
  }

  private async loadScene(path: string, label: string): Promise<Object3D> {
    try {
      const gltf = await this.loadGltf(path);
      return gltf.scene;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load ${label} from "${path}". ${detail}`);
    }
  }

  private loadGltf(path: string): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(path, resolve, undefined, reject);
    });
  }
}
