import { MathUtils, PerspectiveCamera, Vector2, Vector3 } from 'three';

export interface CameraDebugSnapshot {
  yawDegrees: number;
  pitchDegrees: number;
  sensitivity: number;
}

export class CameraController {
  private readonly movementInput = new Vector2();
  private readonly movementForward = new Vector2(0, -1);
  private readonly movementRight = new Vector2(1, 0);
  private readonly lookTarget = new Vector3();
  private readonly smoothedForward = new Vector3(0, 0, -1);
  private readonly lastPlayerPosition = new Vector3();
  private headBobPhase = 0;
  private hasLastPlayerPosition = false;
  private targetYaw = 0;
  private targetPitch = 0;
  private yaw = 0;
  private pitch = 0;
  private sensitivity = 0.002;
  private readonly eyeHeight = 1.62;
  private readonly crouchEyeHeight = 1.1;
  private readonly lookAhead = 10;

  constructor(private readonly camera: PerspectiveCamera) {
    this.camera.fov = 72;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(0, this.eyeHeight, 0);
    this.camera.lookAt(0, this.eyeHeight, -1);
  }

  applyMouseLook(mouseDelta: Vector2): void {
    this.targetYaw -= mouseDelta.x * this.sensitivity;
    this.targetPitch -= mouseDelta.y * this.sensitivity;
    this.targetPitch = MathUtils.clamp(this.targetPitch, -1.35, 1.25);
  }

  adjustSensitivity(direction: -1 | 1): void {
    this.sensitivity = MathUtils.clamp(this.sensitivity + direction * 0.0002, 0.0006, 0.006);
  }

  update(deltaSeconds: number, playerPosition: Vector3, crouching: boolean): void {
    this.yaw = MathUtils.lerp(this.yaw, this.targetYaw, 1 - Math.exp(-28 * deltaSeconds));
    this.pitch = MathUtils.lerp(this.pitch, this.targetPitch, 1 - Math.exp(-28 * deltaSeconds));

    this.smoothedForward.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();

    const horizontalSpeed = this.measureHorizontalSpeed(deltaSeconds, playerPosition);
    const bobIntensity = Math.min(horizontalSpeed / 6, 1);
    this.headBobPhase += horizontalSpeed * deltaSeconds * 6.2;

    const bobY = Math.sin(this.headBobPhase) * 0.026 * bobIntensity;
    const bobX = Math.sin(this.headBobPhase * 0.5) * 0.014 * bobIntensity;
    const targetEyeHeight = crouching ? this.crouchEyeHeight : this.eyeHeight;

    this.camera.position.copy(playerPosition);
    this.camera.position.y += targetEyeHeight + bobY;
    this.camera.position.x += bobX * Math.cos(this.yaw);
    this.camera.position.z += bobX * Math.sin(this.yaw);

    this.lookTarget.copy(this.camera.position).addScaledVector(this.smoothedForward, this.lookAhead);
    this.camera.lookAt(this.lookTarget);
  }

  updateDeath(deltaSeconds: number, playerPosition: Vector3): void {
    const targetPosition = this.lookTarget.set(
      playerPosition.x,
      playerPosition.y + 0.28,
      playerPosition.z + 0.35,
    );
    this.camera.position.lerp(targetPosition, 1 - Math.exp(-5 * deltaSeconds));
    this.lookTarget
      .copy(this.camera.position)
      .add(new Vector3(0, 8, -1.4));
    this.camera.lookAt(this.lookTarget);
  }

  toCameraRelativeMovement(input: Vector2): Vector2 {
    this.movementForward.set(-Math.sin(this.yaw), -Math.cos(this.yaw));

    if (this.movementForward.lengthSq() < 0.001) {
      this.movementForward.set(0, -1);
    } else {
      this.movementForward.normalize();
    }

    this.movementRight.set(-this.movementForward.y, this.movementForward.x);
    this.movementInput
      .copy(this.movementRight)
      .multiplyScalar(input.x)
      .addScaledVector(this.movementForward, input.y);

    if (this.movementInput.lengthSq() > 1) {
      this.movementInput.normalize();
    }

    this.movementInput.y *= -1;
    return this.movementInput;
  }

  getForwardDirection(target = new Vector3()): Vector3 {
    return target.copy(this.smoothedForward).normalize();
  }

  getHorizontalForwardDirection(target = new Vector3()): Vector3 {
    target.set(this.smoothedForward.x, 0, this.smoothedForward.z);
    if (target.lengthSq() < 0.001) {
      target.set(0, 0, -1);
    }

    return target.normalize();
  }

  getCameraPosition(target = new Vector3()): Vector3 {
    return target.copy(this.camera.position);
  }

  getDebugSnapshot(): CameraDebugSnapshot {
    return {
      yawDegrees: MathUtils.radToDeg(this.yaw),
      pitchDegrees: MathUtils.radToDeg(this.pitch),
      sensitivity: this.sensitivity,
    };
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private measureHorizontalSpeed(deltaSeconds: number, playerPosition: Vector3): number {
    if (!this.hasLastPlayerPosition) {
      this.lastPlayerPosition.copy(playerPosition);
      this.hasLastPlayerPosition = true;
      return 0;
    }

    const dx = playerPosition.x - this.lastPlayerPosition.x;
    const dz = playerPosition.z - this.lastPlayerPosition.z;
    this.lastPlayerPosition.copy(playerPosition);
    return Math.sqrt(dx * dx + dz * dz) / Math.max(deltaSeconds, 0.001);
  }
}
