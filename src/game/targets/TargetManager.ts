import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  AnimationUtils,
  Box3,
  CanvasTexture,
  Group,
  LoopOnce,
  LoopRepeat,
  Mesh,
  Object3D,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface TargetHitResult {
  hit: boolean;
  destroyed: boolean;
}

type MonsterState = "patrol" | "chase" | "attack" | "fall" | "down" | "rise";
type MonsterAnimationKey = "idle" | "walk" | "attack" | "fall" | "rise";

interface MonsterPlacement {
  x: number;
  z: number;
  phase: number;
}

interface Monster {
  id: string;
  root: Group;
  model: Object3D;
  mixer: AnimationMixer;
  actions: Record<MonsterAnimationKey, AnimationAction>;
  currentAction: AnimationAction | null;
  state: MonsterState;
  stateTime: number;
  baseY: number;
  spawnX: number;
  spawnZ: number;
  patrolPhase: number;
  yaw: number;
  health: number;
  attackDamageDone: boolean;
  healthBar: Sprite;
  healthTexture: CanvasTexture;
}

interface FloatingDamage {
  sprite: Sprite;
  material: SpriteMaterial;
  texture: CanvasTexture;
  age: number;
  lifetime: number;
}

const MONSTER_PLACEMENTS: MonsterPlacement[] = [
  { x: -8.2, z: -12.5, phase: 0 },
  { x: -8.2, z: -9.5, phase: Math.PI },
];

const FALLEN_RECOVERY_SECONDS = 3;

export class TargetManager {
  readonly root = new Group();
  readonly raycastRoot = new Group();

  private readonly monsters: Monster[] = [];
  private readonly floatingDamages: FloatingDamage[] = [];
  private readonly raycaster = new Raycaster();
  private readonly monsterAnimations: Record<
    MonsterAnimationKey,
    AnimationClip
  >;
  private readonly toPlayer = new Vector3();
  private readonly forward = new Vector3();
  private readonly lineStart = new Vector3();
  private readonly lineEnd = new Vector3();
  private readonly lineDirection = new Vector3();
  private readonly candidatePosition = new Vector3();
  private readonly horizontalDirection = new Vector3();
  private readonly rayOrigin = new Vector3();
  private readonly down = new Vector3(0, -1, 0);
  private readonly box = new Box3();
  private readonly size = new Vector3();
  private readonly center = new Vector3();
  private readonly damagePerShot = 34;
  private readonly monsterMaxHealth = 102;
  private readonly monsterHeight = 1.35;
  private readonly monsterHoverHeight = 0.02;
  private readonly patrolRadius = 2.2;
  private readonly patrolSpeed = 0.42;
  private readonly chaseSpeed = 2.25;
  private readonly turnSpeed = 9;
  private readonly maxStepUp = 0.55;
  private readonly bodyRadius = 0.45;
  private readonly visionDistance = 28;
  private readonly visionHalfAngle = Math.PI / 4;
  private readonly attackRange = 1.25;
  private readonly attackDamage = 24;
  private elapsedTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly ground: Object3D,
    private readonly baseGroundY: number,
    private readonly monsterTemplate: Object3D,
    monsterClips: AnimationClip[],
  ) {
    this.monsterAnimations = this.createAnimationSet(monsterClips);
    this.root.name = "MonsterManager";
    this.raycastRoot.name = "MonsterRaycastRoot";
    this.root.add(this.raycastRoot);
    this.scene.add(this.root);
    this.spawnMonsters();
  }

  update(
    deltaSeconds: number,
    playerPosition: Vector3 | null,
    playerAlive: boolean,
  ): number {
    this.elapsedTime += deltaSeconds;
    let playerDamage = 0;

    for (const monster of this.monsters) {
      monster.mixer.update(deltaSeconds);
      monster.root.position.y = monster.baseY;

      if (playerPosition && playerAlive) {
        playerDamage += this.updateMonster(
          monster,
          deltaSeconds,
          playerPosition,
        );
      } else {
        this.updatePatrol(monster, deltaSeconds);
      }
    }

    for (let index = this.floatingDamages.length - 1; index >= 0; index -= 1) {
      const damage = this.floatingDamages[index];
      damage.age += deltaSeconds;
      damage.sprite.position.y += deltaSeconds * 0.95;
      damage.material.opacity = Math.max(0, 1 - damage.age / damage.lifetime);

      if (damage.age >= damage.lifetime) {
        this.removeFloatingDamage(index);
      }
    }

    return playerDamage;
  }

  handleHit(object: Object3D, point: Vector3): TargetHitResult {
    const monster = this.findMonsterForObject(object);
    if (
      !monster ||
      monster.state === "fall" ||
      monster.state === "down" ||
      monster.state === "rise"
    ) {
      return { hit: false, destroyed: false };
    }

    monster.health = Math.max(0, monster.health - this.damagePerShot);
    this.updateHealthBar(monster);
    this.spawnFloatingDamage(point, this.damagePerShot);

    if (monster.health <= 0) {
      this.enterState(monster, "fall");
    }

    return { hit: true, destroyed: false };
  }

  setGroundAnchor(groundY: number): void {
    const baseY = groundY + this.monsterHoverHeight;
    for (const monster of this.monsters) {
      monster.baseY = baseY;
    }
  }

  dispose(): void {
    for (const monster of this.monsters) {
      monster.mixer.stopAllAction();
      monster.healthTexture.dispose();
      const healthMaterial = monster.healthBar.material;
      if (Array.isArray(healthMaterial)) {
        healthMaterial.forEach((material) => material.dispose());
      } else {
        healthMaterial.dispose();
      }
    }

    for (let index = this.floatingDamages.length - 1; index >= 0; index -= 1) {
      this.removeFloatingDamage(index);
    }

    this.root.removeFromParent();
  }

  private spawnMonsters(): void {
    MONSTER_PLACEMENTS.forEach((placement, index) => {
      const id = `pincher-${index}`;
      const root = new Group();
      const model = cloneSkeleton(this.monsterTemplate) as Object3D;
      const mixer = new AnimationMixer(root);
      const actions = this.createActions(mixer);
      const baseY = this.baseGroundY + this.monsterHoverHeight;
      const healthTexture = this.createHealthTexture(1);
      const healthBar = new Sprite(
        new SpriteMaterial({
          map: healthTexture,
          transparent: true,
          depthTest: true,
          depthWrite: false,
        }),
      );

      root.name = `PincherMonster_${index}`;
      root.position.set(placement.x, baseY, placement.z);
      model.name = `${id}_model`;
      this.normalizeModel(model);
      this.markRaycastTarget(model, id);

      healthBar.name = `${id}_health`;
      healthBar.raycast = () => {};
      healthBar.position.set(0, this.monsterHeight + 0.32, 0);
      healthBar.scale.set(1.35, 0.25, 1);

      root.add(model, healthBar);
      this.raycastRoot.add(root);

      const monster: Monster = {
        id,
        root,
        model,
        mixer,
        actions,
        currentAction: null,
        state: "patrol",
        stateTime: 0,
        baseY,
        spawnX: placement.x,
        spawnZ: placement.z,
        patrolPhase: placement.phase,
        yaw: placement.phase,
        health: this.monsterMaxHealth,
        attackDamageDone: false,
        healthBar,
        healthTexture,
      };

      this.monsters.push(monster);
      this.playAnimation(monster, "walk", true);
    });
  }

  private updateMonster(
    monster: Monster,
    deltaSeconds: number,
    playerPosition: Vector3,
  ): number {
    monster.stateTime += deltaSeconds;

    switch (monster.state) {
      case "fall":
        if (monster.stateTime >= this.monsterAnimations.fall.duration) {
          this.enterState(monster, "down");
        }
        return 0;
      case "down":
        if (monster.stateTime >= FALLEN_RECOVERY_SECONDS) {
          this.enterState(monster, "rise");
        }
        return 0;
      case "rise":
        if (monster.stateTime >= this.monsterAnimations.rise.duration) {
          monster.health = this.monsterMaxHealth;
          this.updateHealthBar(monster);
          this.enterState(monster, "patrol");
        }
        return 0;
      case "attack":
        return this.updateAttack(monster, playerPosition);
      case "chase":
        return this.updateChase(monster, deltaSeconds, playerPosition);
      case "patrol":
      default:
        return this.updatePatrol(monster, deltaSeconds, playerPosition);
    }
  }

  private updatePatrol(
    monster: Monster,
    deltaSeconds: number,
    playerPosition: Vector3 | null = null,
  ): number {
    const phase = this.elapsedTime * this.patrolSpeed + monster.patrolPhase;
    const targetX = monster.spawnX + Math.cos(phase) * this.patrolRadius;
    const targetZ = monster.spawnZ + Math.sin(phase) * this.patrolRadius;
    this.moveToward(
      monster,
      targetX,
      targetZ,
      this.patrolSpeed * 3.2,
      deltaSeconds,
    );

    if (monster.state !== "patrol") {
      this.enterState(monster, "patrol");
    }

    if (playerPosition && this.canDetectPlayer(monster, playerPosition)) {
      this.enterState(monster, "chase");
    }

    return 0;
  }

  private updateChase(
    monster: Monster,
    deltaSeconds: number,
    playerPosition: Vector3,
  ): number {
    this.toPlayer.copy(playerPosition).sub(monster.root.position).setY(0);
    const distance = this.toPlayer.length();

    if (distance <= this.attackRange) {
      this.enterState(monster, "attack");
      return 0;
    }

    this.moveToward(
      monster,
      playerPosition.x,
      playerPosition.z,
      this.chaseSpeed,
      deltaSeconds,
    );
    if (
      !this.canDetectPlayer(monster, playerPosition) &&
      distance > this.visionDistance * 1.15
    ) {
      this.enterState(monster, "patrol");
    }

    return 0;
  }

  private updateAttack(monster: Monster, playerPosition: Vector3): number {
    this.facePosition(monster, playerPosition, 1);
    const attackClipDuration = this.monsterAnimations.attack.duration;
    const distance = monster.root.position.distanceTo(playerPosition);
    const impactTime = attackClipDuration * 0.48;

    if (
      !monster.attackDamageDone &&
      monster.stateTime >= impactTime &&
      distance <= this.attackRange + 0.55
    ) {
      monster.attackDamageDone = true;
      return this.attackDamage;
    }

    if (monster.stateTime >= attackClipDuration) {
      this.enterState(
        monster,
        distance <= this.attackRange + 0.4 ? "attack" : "chase",
      );
    }

    return 0;
  }

  private enterState(monster: Monster, state: MonsterState): void {
    if (monster.state === state && state !== "attack") {
      return;
    }

    monster.state = state;
    monster.stateTime = 0;
    monster.attackDamageDone = false;

    switch (state) {
      case "patrol":
      case "chase":
        this.playAnimation(monster, "walk", true);
        break;
      case "attack":
        this.playAnimation(monster, "attack", false);
        break;
      case "fall":
        this.playAnimation(monster, "fall", false);
        break;
      case "down":
        break;
      case "rise":
        this.playAnimation(monster, "rise", false);
        break;
    }
  }

  private moveToward(
    monster: Monster,
    targetX: number,
    targetZ: number,
    speed: number,
    deltaSeconds: number,
  ): void {
    this.toPlayer.set(
      targetX - monster.root.position.x,
      0,
      targetZ - monster.root.position.z,
    );
    const distance = this.toPlayer.length();
    if (distance < 0.05) {
      return;
    }

    this.toPlayer.normalize();
    const moveDistance = Math.min(distance, speed * deltaSeconds);

    if (!this.canMoveMonster(monster, this.toPlayer, moveDistance)) {
      this.faceDirection(monster, this.toPlayer, deltaSeconds);
      return;
    }

    monster.root.position.x = this.candidatePosition.x;
    monster.root.position.z = this.candidatePosition.z;
    monster.baseY =
      this.sampleGroundY(this.candidatePosition) + this.monsterHoverHeight;
    this.faceDirection(monster, this.toPlayer, deltaSeconds);
  }

  private canMoveMonster(
    monster: Monster,
    direction: Vector3,
    moveDistance: number,
  ): boolean {
    this.candidatePosition.copy(monster.root.position);
    this.candidatePosition.addScaledVector(direction, moveDistance);

    const currentGroundY = monster.baseY - this.monsterHoverHeight;
    const sampledGroundY = this.sampleGroundY(this.candidatePosition);
    if (sampledGroundY > currentGroundY + this.maxStepUp) {
      return false;
    }

    return !this.hasHorizontalCollision(monster, direction, moveDistance);
  }

  private sampleGroundY(position: Vector3): number {
    this.rayOrigin.copy(position);
    this.rayOrigin.y = position.y + 1.8;
    this.raycaster.set(this.rayOrigin, this.down);
    this.raycaster.far = 3.8;

    const [hit] = this.raycaster.intersectObject(this.ground, true);
    return hit?.point.y ?? this.baseGroundY;
  }

  private hasHorizontalCollision(
    monster: Monster,
    direction: Vector3,
    moveDistance: number,
  ): boolean {
    if (moveDistance <= 0) {
      return false;
    }

    this.horizontalDirection.copy(direction).setY(0);
    if (this.horizontalDirection.lengthSq() < 0.001) {
      return false;
    }

    this.horizontalDirection.normalize();
    this.raycaster.far = moveDistance + this.bodyRadius;

    const groundY = monster.baseY - this.monsterHoverHeight;
    for (const height of [0.35, 0.9]) {
      this.rayOrigin.copy(monster.root.position);
      this.rayOrigin.y = groundY + height;
      this.raycaster.set(this.rayOrigin, this.horizontalDirection);

      const [hit] = this.raycaster.intersectObject(this.ground, true);
      if (hit && hit.point.y > groundY + this.maxStepUp * 0.5) {
        return true;
      }
    }

    return false;
  }

  private canDetectPlayer(monster: Monster, playerPosition: Vector3): boolean {
    this.toPlayer.copy(playerPosition).sub(monster.root.position).setY(0);
    const distance = this.toPlayer.length();
    if (distance < 0.001 || distance > this.visionDistance) {
      return false;
    }

    this.toPlayer.normalize();
    this.forward.set(Math.sin(monster.yaw), 0, Math.cos(monster.yaw));
    const dot = Math.max(-1, Math.min(1, this.forward.dot(this.toPlayer)));
    if (Math.acos(dot) > this.visionHalfAngle) {
      return false;
    }

    this.lineStart.copy(monster.root.position).add(new Vector3(0, 0.75, 0));
    this.lineEnd.copy(playerPosition).add(new Vector3(0, 1.1, 0));
    return !this.isLineBlocked(this.lineStart, this.lineEnd);
  }

  private facePosition(
    monster: Monster,
    position: Vector3,
    alpha: number,
  ): void {
    this.toPlayer.copy(position).sub(monster.root.position).setY(0);
    if (this.toPlayer.lengthSq() < 0.001) {
      return;
    }

    this.toPlayer.normalize();
    this.faceDirection(monster, this.toPlayer, alpha);
  }

  private faceDirection(
    monster: Monster,
    direction: Vector3,
    deltaOrAlpha: number,
  ): void {
    const desiredYaw = Math.atan2(direction.x, direction.z);
    const alpha =
      deltaOrAlpha <= 1
        ? deltaOrAlpha
        : 1 - Math.exp(-this.turnSpeed * deltaOrAlpha);
    monster.yaw = this.lerpAngle(monster.yaw, desiredYaw, alpha);
    monster.root.rotation.y = monster.yaw;
  }

  private isLineBlocked(start: Vector3, end: Vector3): boolean {
    this.lineDirection.copy(end).sub(start);
    const distance = this.lineDirection.length();
    if (distance < 0.001) {
      return false;
    }

    this.lineDirection.normalize();
    this.raycaster.set(start, this.lineDirection);
    this.raycaster.far = Math.max(0.1, distance - 0.25);
    const [blocker] = this.raycaster.intersectObject(this.ground, true);
    return Boolean(blocker);
  }

  private playAnimation(
    monster: Monster,
    key: MonsterAnimationKey,
    loop: boolean,
  ): void {
    const action = monster.actions[key];
    if (monster.currentAction === action && loop) {
      return;
    }

    action.enabled = true;
    action.clampWhenFinished = !loop;
    action.setLoop(
      loop ? LoopRepeat : LoopOnce,
      loop ? Number.POSITIVE_INFINITY : 1,
    );
    action.reset();

    if (monster.currentAction && monster.currentAction !== action) {
      monster.currentAction.fadeOut(0.18);
    }

    action.fadeIn(0.18).play();
    monster.currentAction = action;
  }

  private createActions(
    mixer: AnimationMixer,
  ): Record<MonsterAnimationKey, AnimationAction> {
    return {
      idle: mixer.clipAction(this.monsterAnimations.idle),
      walk: mixer.clipAction(this.monsterAnimations.walk),
      attack: mixer.clipAction(this.monsterAnimations.attack),
      fall: mixer.clipAction(this.monsterAnimations.fall),
      rise: mixer.clipAction(this.monsterAnimations.rise),
    };
  }

  private createAnimationSet(
    clips: AnimationClip[],
  ): Record<MonsterAnimationKey, AnimationClip> {
    const sourceClip = clips[0];
    if (!sourceClip) {
      throw new Error("Pincher monster asset has no animation clip.");
    }

    const fps = 30;
    return {
      idle: AnimationUtils.subclip(sourceClip, "Pincher_Idle", 0, 70, fps),
      walk: AnimationUtils.subclip(sourceClip, "Pincher_Walk", 71, 170, fps),
      attack: AnimationUtils.subclip(
        sourceClip,
        "Pincher_Attack",
        171,
        265,
        fps,
      ),
      fall: AnimationUtils.subclip(sourceClip, "Pincher_Fall", 266, 360, fps),
      rise: AnimationUtils.subclip(sourceClip, "Pincher_Rise", 361, 455, fps),
    };
  }

  private normalizeModel(model: Object3D): void {
    this.box.setFromObject(model);
    this.box.getSize(this.size);
    const scale = this.monsterHeight / Math.max(this.size.y, 0.001);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    this.box.setFromObject(model);
    this.box.getCenter(this.center);
    model.position.x -= this.center.x;
    model.position.z -= this.center.z;
    model.position.y -= this.box.min.y;

    model.traverse((child) => {
      child.frustumCulled = false;
    });
  }

  private markRaycastTarget(model: Object3D, id: string): void {
    model.traverse((child) => {
      child.userData.targetId = id;
    });
  }

  private findMonsterForObject(object: Object3D): Monster | null {
    let current: Object3D | null = object;
    while (current) {
      const targetId = current.userData.targetId as string | undefined;
      if (targetId) {
        return this.monsters.find((monster) => monster.id === targetId) ?? null;
      }

      current = current.parent;
    }

    return null;
  }

  private createHealthTexture(fillRatio: number): CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 40;
    const texture = new CanvasTexture(canvas);
    this.drawHealth(canvas, fillRatio);
    texture.needsUpdate = true;
    return texture;
  }

  private updateHealthBar(monster: Monster): void {
    const canvas = monster.healthTexture.image as HTMLCanvasElement;
    this.drawHealth(canvas, monster.health / this.monsterMaxHealth);
    monster.healthTexture.needsUpdate = true;
  }

  private drawHealth(canvas: HTMLCanvasElement, fillRatio: number): void {
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const clamped = Math.max(0, Math.min(1, fillRatio));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(255, 255, 255, 0.82)";
    context.lineWidth = 4;
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    context.fillStyle = clamped > 0.35 ? "#43f07a" : "#ffcc4d";
    context.fillRect(8, 8, (canvas.width - 16) * clamped, canvas.height - 16);
  }

  private spawnFloatingDamage(point: Vector3, amount: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = "800 34px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 6;
      context.strokeStyle = "rgba(0, 0, 0, 0.72)";
      context.strokeText(`-${amount}`, canvas.width / 2, canvas.height / 2);
      context.fillStyle = "#fff0a6";
      context.fillText(`-${amount}`, canvas.width / 2, canvas.height / 2);
    }

    const texture = new CanvasTexture(canvas);
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.name = "FloatingDamage";
    sprite.position.copy(point).add(new Vector3(0, 0.55, 0));
    sprite.scale.set(0.75, 0.38, 1);
    this.root.add(sprite);
    this.floatingDamages.push({
      sprite,
      material,
      texture,
      age: 0,
      lifetime: 0.85,
    });
  }

  private removeFloatingDamage(index: number): void {
    const [damage] = this.floatingDamages.splice(index, 1);
    damage.sprite.removeFromParent();
    damage.texture.dispose();
    damage.material.dispose();
  }

  private lerpAngle(current: number, target: number, alpha: number): number {
    const delta = Math.atan2(
      Math.sin(target - current),
      Math.cos(target - current),
    );
    return current + delta * alpha;
  }
}
