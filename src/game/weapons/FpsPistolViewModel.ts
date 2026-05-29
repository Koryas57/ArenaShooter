import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface FpsPistolViewModelConfig {
  positionOffset: { x: number; y: number; z: number };
  rotationOffset: { x: number; y: number; z: number };
  scale: number;
  recoilOffset: number;
  swayAmount: number;
  bobAmount: number;
  muzzleLocalOffset: { x: number; y: number; z: number };
}

export interface FpsPistolDebugSnapshot {
  positionOffset: string;
  rotationOffset: string;
  scale: number;
  muzzleLocalOffset: string;
  currentAnimation: string;
  recoil: number;
}

const FPS_PISTOL_PATH = "/assets/weapons/fps-pistol/fps-pistol.gltf";

export class FpsPistolViewModel {
  readonly group = new Group();
  readonly config: FpsPistolViewModelConfig = {
    positionOffset: { x: 0, y: -1.28, z: -0.48 },
    rotationOffset: { x: -0.03, y: Math.PI - 0.02, z: 0.0 },
    scale: 0.65,
    recoilOffset: 0.07,
    swayAmount: 0.00042,
    bobAmount: 0.014,
    muzzleLocalOffset: { x: -0.01, y: 0.34, z: 1.0 },
  };

  private readonly loader = new GLTFLoader();
  private readonly muzzleSocket = new Object3D();
  private readonly mouseSway = new Vector2();
  private readonly muzzleWorldPosition = new Vector3();
  private readonly muzzleFlash = new Mesh(
    new SphereGeometry(0.04, 10, 8),
    new MeshBasicMaterial({
      color: 0xffd06a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  private readonly actions = new Map<string, AnimationAction>();
  private mixer: AnimationMixer | null = null;
  private model: Object3D | null = null;
  private idleAction: AnimationAction | null = null;
  private currentAction: AnimationAction | null = null;
  private currentAnimation = "None";
  private clips: AnimationClip[] = [];
  private recoil = 0;
  private flashTime = 0;
  private bobTime = 0;

  constructor(private readonly camera: PerspectiveCamera) {
    this.group.name = "FpsPistolViewModel";
    this.muzzleSocket.name = "MuzzleSocket";
    this.muzzleFlash.name = "MuzzleFlash";
    this.muzzleSocket.add(this.muzzleFlash);
    this.group.add(this.muzzleSocket);
    this.camera.add(this.group);
  }

  async load(): Promise<void> {
    try {
      const gltf = await this.loadGltf(FPS_PISTOL_PATH);
      this.clips = gltf.animations;
      console.group("fps-pistol animation clips");
      this.clips.forEach((clip, index) => {
        console.log(`${index + 1}. ${clip.name}`);
      });
      console.groupEnd();

      this.model = gltf.scene;
      this.model.name = "FpsPistol_ViewModel";
      this.model.traverse((child) => {
        child.frustumCulled = false;
      });

      this.group.add(this.model);
      this.findOrCreateMuzzleSocket();
      this.setupAnimations(gltf);
      this.applyBaseTransform();
      this.playLoop("idle");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load FPS pistol from "${FPS_PISTOL_PATH}". Ensure fps-pistol.gltf, fps-pistol.bin, and textures are under public/assets/weapons/fps-pistol/. ${detail}`,
      );
    }
  }

  update(
    deltaSeconds: number,
    mouseDelta: Vector2,
    moving: boolean,
    sprinting: boolean,
  ): void {
    this.recoil = Math.max(0, this.recoil - deltaSeconds * 8);
    this.flashTime = Math.max(0, this.flashTime - deltaSeconds * 18);
    this.bobTime += moving
      ? deltaSeconds * (sprinting ? 12.5 : 8.5)
      : deltaSeconds * 2;
    this.mixer?.update(deltaSeconds);

    this.mouseSway.x +=
      (-mouseDelta.x * this.config.swayAmount - this.mouseSway.x) * 0.16;
    this.mouseSway.y +=
      (-mouseDelta.y * this.config.swayAmount - this.mouseSway.y) * 0.16;

    const bobScale = moving ? (sprinting ? 1.65 : 1) : 0.14;
    const bobX =
      Math.sin(this.bobTime) * this.config.bobAmount * 0.7 * bobScale;
    const bobY =
      Math.abs(Math.cos(this.bobTime)) * this.config.bobAmount * bobScale;

    this.group.position.set(
      this.config.positionOffset.x + this.mouseSway.x + bobX,
      this.config.positionOffset.y + this.mouseSway.y + bobY,
      this.config.positionOffset.z + this.recoil * this.config.recoilOffset,
    );

    this.group.rotation.set(
      this.config.rotationOffset.x -
        this.recoil * 0.08 +
        this.mouseSway.y * 0.18,
      this.config.rotationOffset.y + this.mouseSway.x * 0.16,
      this.config.rotationOffset.z - this.mouseSway.x * 0.1,
    );

    const material = this.muzzleFlash.material as MeshBasicMaterial;
    material.opacity = this.flashTime;
    this.muzzleFlash.scale.setScalar(1 + this.flashTime * 2.4);
  }

  shoot(): void {
    this.recoil = Math.min(1, this.recoil + 1);
    this.flashTime = 1;
    this.playOneShot("shoot");
  }

  reload(): void {
    this.playOneShot("reload");
  }

  getMuzzleWorldPosition(target = new Vector3()): Vector3 {
    this.muzzleSocket.getWorldPosition(this.muzzleWorldPosition);
    return target.copy(this.muzzleWorldPosition);
  }

  getDebug(): FpsPistolDebugSnapshot {
    const position = this.config.positionOffset;
    const rotation = this.config.rotationOffset;
    const muzzle = this.config.muzzleLocalOffset;

    return {
      positionOffset: `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`,
      rotationOffset: `${rotation.x.toFixed(2)}, ${rotation.y.toFixed(2)}, ${rotation.z.toFixed(2)}`,
      scale: this.config.scale,
      muzzleLocalOffset: `${muzzle.x.toFixed(2)}, ${muzzle.y.toFixed(2)}, ${muzzle.z.toFixed(2)}`,
      currentAnimation: this.currentAnimation,
      recoil: this.recoil,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.muzzleFlash.geometry.dispose();
    (this.muzzleFlash.material as MeshBasicMaterial).dispose();
  }

  private setupAnimations(gltf: GLTF): void {
    this.mixer = new AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) {
      this.actions.set(clip.name, this.mixer.clipAction(clip));
    }

    const idleClip = this.findClip(["idle"]);
    this.idleAction = idleClip
      ? (this.actions.get(idleClip.name) ?? null)
      : null;
    this.mixer.addEventListener("finished", () => {
      this.playLoop("idle");
    });
  }

  private playLoop(keyword: "idle"): void {
    const clip = this.findClip([keyword]);
    if (!clip) {
      return;
    }

    const action = this.actions.get(clip.name);
    if (!action || action === this.currentAction) {
      return;
    }

    this.currentAction?.fadeOut(0.08);
    action.reset();
    action.setLoop(LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.fadeIn(0.08).play();
    this.currentAction = action;
    this.currentAnimation = clip.name;
  }

  private playOneShot(kind: "shoot" | "reload" | "draw"): void {
    const keywordSets: Record<typeof kind, string[]> = {
      shoot: ["shoot", "fire"],
      reload: ["reload"],
      draw: ["draw", "equip"],
    };
    const clip = this.findClip(keywordSets[kind]);
    if (!clip) {
      return;
    }

    const action = this.actions.get(clip.name);
    if (!action) {
      return;
    }

    this.currentAction?.fadeOut(0.04);
    action.reset();
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = false;
    action.fadeIn(0.035).play();
    this.currentAction = action;
    this.currentAnimation = clip.name;
  }

  private findClip(keywords: string[]): AnimationClip | null {
    let best: { clip: AnimationClip; score: number } | null = null;

    for (const clip of this.clips) {
      const name = clip.name.toLowerCase();
      let score = 0;
      for (const keyword of keywords) {
        if (name.includes(keyword)) {
          score += 100;
        }
      }

      if (name.includes("empty")) {
        score -= 20;
      }

      if (!best || score > best.score) {
        best = { clip, score };
      }
    }

    return best && best.score > 0 ? best.clip : null;
  }

  private findOrCreateMuzzleSocket(): void {
    if (!this.model) {
      return;
    }

    let muzzleParent: Object3D | null = null;
    this.model.traverse((child) => {
      const name = child.name.toLowerCase();
      if (
        !muzzleParent &&
        (name.includes("muzzle") ||
          name.includes("barrel") ||
          name.includes("fire") ||
          name.includes("flash") ||
          name.includes("tip"))
      ) {
        muzzleParent = child;
      }
    });

    if (!muzzleParent) {
      muzzleParent = this.group;
    }

    this.muzzleSocket.position.set(
      this.config.muzzleLocalOffset.x,
      this.config.muzzleLocalOffset.y,
      this.config.muzzleLocalOffset.z,
    );
    muzzleParent.add(this.muzzleSocket);
  }

  private applyBaseTransform(): void {
    this.group.position.set(
      this.config.positionOffset.x,
      this.config.positionOffset.y,
      this.config.positionOffset.z,
    );
    this.group.rotation.set(
      this.config.rotationOffset.x,
      this.config.rotationOffset.y,
      this.config.rotationOffset.z,
    );
    this.group.scale.setScalar(this.config.scale);
  }

  private loadGltf(path: string): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      this.loader.load(path, resolve, undefined, reject);
    });
  }
}
