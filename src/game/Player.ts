import {
  AnimationClip,
  Box3,
  Group,
  Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import { AnimationController, AnimationMatch } from './AnimationController';
import { GameplayAnimationKey, GAMEPLAY_ANIMATION_QUERIES } from './PlayerAnimations';

export class Player {
  readonly root = new Group();
  readonly position = this.root.position;
  readonly animations: AnimationController;
  readonly velocity = new Vector3();

  private readonly raycaster = new Raycaster();
  private readonly down = new Vector3(0, -1, 0);
  private readonly horizontalDirection = new Vector3();
  private readonly rayOrigin = new Vector3();
  private readonly previousPosition = new Vector3();
  private readonly moveDirection = new Vector3();
  private readonly forwardDirection = new Vector3(0, 0, -1);
  private readonly candidatePosition = new Vector3();
  private readonly groundSamplePoint = new Vector3();
  private readonly targetQuaternion = new Quaternion();
  private readonly speeds = {
    walk: 2.85,
    run: 5.9,
    sprint: 6.7,
    crouch: 1.85,
  };
  private readonly groundRayHeight = 24;
  private readonly fallbackGroundY = 0;
  private readonly maxStepUp = 0.55;
  private readonly bodyRadius = 0.36;
  private readonly groundSnapSpeed = 18;
  private grounded = true;
  private groundY = 0;
  private verticalOffset = 0;

  constructor(private readonly model: Object3D, animationClips: AnimationClip[]) {
    this.root.name = 'PlayerRoot';
    this.root.add(model);
    this.normalizeModel(model);
    this.animations = new AnimationController(this.root, animationClips);
    this.animations.setIdleClipName(this.resolveGameplayClip('idle')?.clipName ?? null);
    this.playGameplayAnimation('idle', { loop: true });
  }

  update(deltaSeconds: number, input: Vector2, ground: Object3D | null, speed: number): void {
    this.previousPosition.copy(this.root.position);
    this.moveDirection.set(input.x, 0, -input.y);

    if (speed > 0 && this.moveDirection.lengthSq() > 0) {
      this.moveDirection.normalize();
      this.tryMove(deltaSeconds, ground, speed);
    }

    this.snapToGround(deltaSeconds, ground);
    this.velocity.copy(this.root.position).sub(this.previousPosition).divideScalar(
      Math.max(deltaSeconds, 0.001),
    );

    this.animations.update(deltaSeconds);
  }

  getForwardDirection(target = new Vector3()): Vector3 {
    return target.copy(this.forwardDirection);
  }

  setModelVisible(visible: boolean): void {
    this.model.visible = visible;
  }

  getSpeed(mode: 'walk' | 'run' | 'sprint' | 'crouch' | 'none'): number {
    return mode === 'none' ? 0 : this.speeds[mode];
  }

  isGrounded(): boolean {
    return this.grounded;
  }

  setVerticalOffset(offset: number): void {
    this.verticalOffset = Math.max(0, offset);
  }

  playGameplayAnimation(
    key: GameplayAnimationKey,
    options: { loop: boolean; restart?: boolean; returnToIdle?: boolean; fadeSeconds?: number },
  ): AnimationMatch | null {
    const match = this.resolveGameplayClip(key);
    if (!match?.clipName) {
      return match;
    }

    return this.animations.play(match.clipName, options);
  }

  resolveGameplayClip(key: GameplayAnimationKey): AnimationMatch | null {
    return this.animations.findFirstClosest(GAMEPLAY_ANIMATION_QUERIES[key]);
  }

  getGameplayAnimationDuration(key: GameplayAnimationKey): number {
    const match = this.resolveGameplayClip(key);
    return Math.max(0.2, this.animations.getClipDuration(match?.clipName ?? null));
  }

  playAnimation(
    requestedName: string,
    options: { loop: boolean; returnToIdle?: boolean; fadeSeconds?: number },
  ): AnimationMatch | null {
    return this.animations.play(requestedName, options);
  }

  private rotateToward(direction: Vector3, deltaSeconds: number): void {
    this.forwardDirection.copy(direction).normalize();
    const angle = Math.atan2(direction.x, direction.z);
    this.targetQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), angle);
    this.root.quaternion.slerp(this.targetQuaternion, 1 - Math.exp(-14 * deltaSeconds));
  }

  private tryMove(deltaSeconds: number, ground: Object3D | null, speed: number): void {
    this.candidatePosition.copy(this.root.position);
    this.candidatePosition.addScaledVector(this.moveDirection, speed * deltaSeconds);

    const sampledGroundY = this.sampleGroundY(this.candidatePosition, ground);
    const isStepTooHigh = sampledGroundY > this.groundY + this.maxStepUp;

    if (!isStepTooHigh && !this.hasHorizontalCollision(ground, this.moveDirection, speed * deltaSeconds)) {
      this.root.position.x = this.candidatePosition.x;
      this.root.position.z = this.candidatePosition.z;
    }

    this.rotateToward(this.moveDirection, deltaSeconds);
  }

  private snapToGround(deltaSeconds: number, ground: Object3D | null): void {
    const targetGroundY = this.sampleGroundY(this.root.position, ground);
    const smoothing = targetGroundY < this.groundY ? 1 - Math.exp(-this.groundSnapSpeed * deltaSeconds) : 1;
    this.groundY += (targetGroundY - this.groundY) * smoothing;
    this.root.position.y = this.groundY + this.verticalOffset;
    this.grounded = this.verticalOffset <= 0.03 && Math.abs(this.root.position.y - this.groundY) < 0.08;
  }

  private sampleGroundY(position: Vector3, ground: Object3D | null): number {
    if (!ground) {
      return this.fallbackGroundY;
    }

    this.rayOrigin
      .copy(position)
      .setY(Math.max(this.groundY, position.y) + this.groundRayHeight);

    this.raycaster.set(this.rayOrigin, this.down);
    this.raycaster.far = this.groundRayHeight * 2;

    const [hit] = this.raycaster.intersectObject(ground, true);
    if (hit) {
      this.groundSamplePoint.copy(hit.point);
      return this.groundSamplePoint.y;
    }

    return this.fallbackGroundY;
  }

  private hasHorizontalCollision(
    ground: Object3D | null,
    direction: Vector3,
    moveDistance: number,
  ): boolean {
    if (!ground || moveDistance <= 0) {
      return false;
    }

    this.horizontalDirection.copy(direction).setY(0);
    if (this.horizontalDirection.lengthSq() < 0.001) {
      return false;
    }

    this.horizontalDirection.normalize();
    this.raycaster.far = moveDistance + this.bodyRadius;

    for (const height of [0.45, 1.1]) {
      this.rayOrigin.copy(this.root.position);
      this.rayOrigin.y = this.groundY + height;
      this.raycaster.set(this.rayOrigin, this.horizontalDirection);

      const [hit] = this.raycaster.intersectObject(ground, true);
      if (hit && hit.point.y > this.groundY + this.maxStepUp * 0.5) {
        return true;
      }
    }

    return false;
  }

  private normalizeModel(model: Object3D): void {
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    const center = bounds.getCenter(new Vector3());
    const height = Math.max(size.y, 0.001);
    const targetHeight = 1.85;
    const scale = targetHeight / height;

    model.position.sub(center);
    model.position.y += size.y / 2;
    model.scale.setScalar(scale);

    model.traverse((child) => {
      child.frustumCulled = false;
    });
  }
}
