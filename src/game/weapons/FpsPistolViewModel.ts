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
  weaponState: FpsPistolAnimationState;
  currentAnimation: string;
  stateRemaining: number;
  recoil: number;
}

const FPS_PISTOL_PATH = "/assets/weapons/fps-pistol/fps-pistol.gltf";

export type FpsPistolAnimationState =
  | "Idle"
  | "Fire"
  | "Reload"
  | "Empty"
  | "Equip"
  | "JumpStart"
  | "JumpAirborne"
  | "JumpLand";

export type FpsPistolMovementState =
  | "Grounded"
  | "JumpStart"
  | "JumpAirborne"
  | "JumpLand";

const LOOPING_WEAPON_STATES = new Set<FpsPistolAnimationState>([
  "Idle",
  "Empty",
  "JumpAirborne",
]);

const STATE_KEYWORDS: Record<FpsPistolAnimationState, string[]> = {
  Idle: ["idle"],
  Fire: ["fire", "shoot"],
  Reload: ["reload"],
  Empty: ["empty", "idle"],
  Equip: ["equip", "draw"],
  JumpStart: ["jump_start"],
  JumpAirborne: ["jump"],
  JumpLand: ["jump_end", "jump_land", "land"],
};

export class FpsPistolViewModel {
  readonly group = new Group();
  readonly config: FpsPistolViewModelConfig = {
    positionOffset: { x: 0, y: -1.28, z: -0.48 },
    rotationOffset: { x: -0.03, y: Math.PI - 0.02, z: 0.0 },
    scale: 0.65,
    recoilOffset: 0.07,
    swayAmount: 0.00042,
    bobAmount: 0.014,
    muzzleLocalOffset: { x: -0.48, y: 1.85, z: 0.96 },
  };

  private readonly loader = new GLTFLoader();
  private readonly muzzleSocket = new Object3D();
  private readonly mouseSway = new Vector2();
  private readonly muzzleWorldPosition = new Vector3();
  private readonly muzzleWorldDirection = new Vector3();
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
  private readonly stateClips = new Map<
    FpsPistolAnimationState,
    AnimationClip
  >();
  private mixer: AnimationMixer | null = null;
  private model: Object3D | null = null;
  private currentAction: AnimationAction | null = null;
  private currentAnimation = "None";
  private state: FpsPistolAnimationState = "Equip";
  private stateRemaining = 0;
  private shouldEnterEmptyAfterFire = false;
  private emptyLocked = false;
  private desiredMovementState: FpsPistolAnimationState = "Idle";
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
      this.group.visible = false;
      this.model.traverse((child) => {
        child.frustumCulled = false;
      });

      this.group.add(this.model);
      this.findOrCreateMuzzleSocket();
      this.setupAnimations(gltf);
      this.applyBaseTransform();
      if (!this.transitionTo("Equip", { fadeSeconds: 0, restart: true })) {
        this.transitionTo("Idle", { fadeSeconds: 0, restart: true });
      }
      this.mixer?.update(1 / 60);
      this.group.visible = true;
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
    movementState: FpsPistolMovementState,
  ): void {
    this.desiredMovementState = this.resolveDesiredMovementState(movementState);
    this.recoil = Math.max(0, this.recoil - deltaSeconds * 8);
    this.flashTime = Math.max(0, this.flashTime - deltaSeconds * 18);
    this.bobTime += moving
      ? deltaSeconds * (sprinting ? 12.5 : 8.5)
      : deltaSeconds * 2;
    this.mixer?.update(deltaSeconds);
    this.updateAnimationState(deltaSeconds);
    this.syncMovementAnimation(movementState);

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

  canFire(): boolean {
    return this.state !== "Reload" && this.state !== "Equip";
  }

  canReload(): boolean {
    return this.state !== "Reload" && this.state !== "Equip";
  }

  isReloading(): boolean {
    return this.state === "Reload";
  }

  isEquipping(): boolean {
    return this.state === "Equip";
  }

  getState(): FpsPistolAnimationState {
    return this.state;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  shoot(enterEmptyAfterFire: boolean): boolean {
    if (!this.canFire()) {
      return false;
    }

    if (!this.transitionTo("Fire", { fadeSeconds: 0.045, restart: true })) {
      return false;
    }

    this.emptyLocked = false;
    this.shouldEnterEmptyAfterFire = enterEmptyAfterFire;
    this.recoil = Math.min(1, this.recoil + 1);
    this.flashTime = 1;
    return true;
  }

  reload(): boolean {
    if (!this.canReload()) {
      return false;
    }

    this.shouldEnterEmptyAfterFire = false;
    this.emptyLocked = false;
    return this.transitionTo("Reload", { fadeSeconds: 0.08, restart: true });
  }

  showEmpty(): boolean {
    this.shouldEnterEmptyAfterFire = false;
    this.emptyLocked = true;
    return this.transitionTo("Empty", { fadeSeconds: 0.12 });
  }

  getMuzzleWorldPosition(target = new Vector3()): Vector3 {
    this.muzzleSocket.getWorldPosition(this.muzzleWorldPosition);
    return target.copy(this.muzzleWorldPosition);
  }

  getMuzzleWorldDirection(target = new Vector3()): Vector3 {
    this.muzzleSocket.updateWorldMatrix(true, false);
    this.muzzleWorldDirection
      .set(0, 0, 1)
      .transformDirection(this.muzzleSocket.matrixWorld)
      .normalize();
    return target.copy(this.muzzleWorldDirection);
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
      weaponState: this.state,
      currentAnimation: this.currentAnimation,
      stateRemaining: Number.isFinite(this.stateRemaining)
        ? this.stateRemaining
        : 0,
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

    this.resolveStateClips();
  }

  private updateAnimationState(deltaSeconds: number): void {
    if (LOOPING_WEAPON_STATES.has(this.state)) {
      return;
    }

    this.stateRemaining -= deltaSeconds;
    if (this.stateRemaining > 0) {
      return;
    }

    if (this.state === "Fire" && this.shouldEnterEmptyAfterFire) {
      this.shouldEnterEmptyAfterFire = false;
      this.emptyLocked = true;
      this.transitionTo("Empty", { fadeSeconds: 0.1 });
      return;
    }

    this.shouldEnterEmptyAfterFire = false;
    this.transitionTo(this.desiredMovementState, { fadeSeconds: 0.1 });
  }

  private syncMovementAnimation(movementState: FpsPistolMovementState): void {
    if (
      this.state === "Fire" ||
      this.state === "Reload" ||
      this.state === "Equip"
    ) {
      return;
    }

    if (this.emptyLocked) {
      if (this.state !== "Empty") {
        this.transitionTo("Empty", { fadeSeconds: 0.1 });
      }
      return;
    }

    const nextState = this.resolveDesiredMovementState(movementState);
    if (nextState === this.state) {
      return;
    }

    if (
      this.state === "JumpLand" &&
      this.stateRemaining > 0 &&
      nextState === "Idle"
    ) {
      return;
    }

    this.transitionTo(nextState, {
      fadeSeconds:
        nextState === "JumpStart"
          ? 0.14
          : movementState === "Grounded"
            ? 0.12
            : 0.08,
      restart: nextState === "JumpStart" || nextState === "JumpLand",
      startAtNormalized: nextState === "JumpStart" ? 0.16 : 0,
    });
  }

  private transitionTo(
    state: FpsPistolAnimationState,
    options: {
      fadeSeconds: number;
      restart?: boolean;
      startAtNormalized?: number;
    },
  ): boolean {
    const clip = this.stateClips.get(state);
    if (!clip) {
      return false;
    }

    const action = this.actions.get(clip.name);
    if (!action) {
      return false;
    }

    const loop = LOOPING_WEAPON_STATES.has(state);
    const isSameAction = action === this.currentAction;
    const shouldRestart = options.restart ?? false;

    if (isSameAction && !shouldRestart && this.state === state) {
      this.state = state;
      this.stateRemaining = loop ? Infinity : Math.max(0.05, clip.duration);
      this.currentAnimation = clip.name;
      return true;
    }

    action.reset();
    action.time =
      clip.duration *
      Math.min(0.9, Math.max(0, options.startAtNormalized ?? 0));
    action.enabled = true;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.play();

    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, options.fadeSeconds, false);
    } else if (options.fadeSeconds > 0) {
      action.fadeIn(options.fadeSeconds);
    }

    this.currentAction = action;
    this.state = state;
    this.currentAnimation = clip.name;
    this.stateRemaining = loop ? Infinity : Math.max(0.05, clip.duration);
    return true;
  }

  private resolveStateClips(): void {
    for (const state of Object.keys(
      STATE_KEYWORDS,
    ) as FpsPistolAnimationState[]) {
      const clip = this.findClipForState(state);
      if (clip) {
        this.stateClips.set(state, clip);
      }
    }

    const idleClip = this.stateClips.get("Idle");
    if (idleClip && !this.stateClips.has("Equip")) {
      this.stateClips.set("Equip", idleClip);
    }

    if (idleClip && !this.stateClips.has("Empty")) {
      this.stateClips.set("Empty", idleClip);
    }

    for (const jumpState of [
      "JumpStart",
      "JumpAirborne",
      "JumpLand",
    ] as const) {
      if (idleClip && !this.stateClips.has(jumpState)) {
        this.stateClips.set(jumpState, idleClip);
      }
    }
  }

  private findClipForState(
    state: FpsPistolAnimationState,
  ): AnimationClip | null {
    return this.findClip(STATE_KEYWORDS[state], {
      preferEmpty: state === "Empty",
      avoidEmpty: state !== "Empty",
      avoidMagnum: state === "Fire",
    });
  }

  private findClip(
    keywords: string[],
    options: {
      preferEmpty?: boolean;
      avoidEmpty?: boolean;
      avoidMagnum?: boolean;
    } = {},
  ): AnimationClip | null {
    let best: { clip: AnimationClip; score: number } | null = null;

    for (const clip of this.clips) {
      const name = clip.name.toLowerCase();
      let score = 0;
      for (const keyword of keywords) {
        if (name.includes(keyword)) {
          score += 100;
        }
      }

      if (options.preferEmpty && name.includes("empty")) {
        score += 80;
      }

      if (options.avoidEmpty && name.includes("empty")) {
        score -= 80;
      }

      if (options.avoidMagnum && name.includes("magnum")) {
        score -= 20;
      }

      if (!best || score > best.score) {
        best = { clip, score };
      }
    }

    return best && best.score > 0 ? best.clip : null;
  }

  private resolveDesiredMovementState(
    movementState: FpsPistolMovementState,
  ): FpsPistolAnimationState {
    switch (movementState) {
      case "JumpStart":
        return "JumpStart";
      case "JumpAirborne":
        return "JumpAirborne";
      case "JumpLand":
        return "JumpLand";
      default:
        return "Idle";
    }
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
