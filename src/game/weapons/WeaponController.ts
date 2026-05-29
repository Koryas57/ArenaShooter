import { Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import {
  FpsPistolDebugSnapshot,
  FpsPistolMovementState,
  FpsPistolViewModel,
} from './FpsPistolViewModel';
import { ImpactMarker } from './ImpactMarker';
import { ProjectileTracer } from './ProjectileTracer';
import type { PlayerState } from '../PlayerStateMachine';
import type { TargetHitResult } from '../targets/TargetManager';

export interface WeaponDebugSnapshot extends FpsPistolDebugSnapshot {
  fireCooldown: number;
  lastHitDistance: number;
  ammoInMagazine: number;
  magazineSize: number;
  reserveAmmo: string;
  reloadPending: boolean;
  reloadPromptVisible: boolean;
  shotsFired: number;
  targetHits: number;
  targetsKilled: number;
  accuracyPercent: number;
}

export class WeaponController {
  readonly viewModel: FpsPistolViewModel;

  private readonly tracer: ProjectileTracer;
  private readonly impactMarker: ImpactMarker;
  private readonly raycaster = new Raycaster();
  private readonly muzzlePosition = new Vector3();
  private readonly endPoint = new Vector3();
  private readonly fireSound = new Audio('/assets/weapons/fps-pistol/PistolFireSfx.mp3');
  private readonly reloadSound = new Audio('/assets/weapons/fps-pistol/PistolReloadSfx.mp3');
  private readonly emptySound = new Audio('/assets/weapons/fps-pistol/PistolEmpty.mp3');
  private cooldownRemaining = 0;
  private lastHitDistance = 0;
  private ammoInMagazine = 12;
  private reloadPending = false;
  private shotsFired = 0;
  private targetHits = 0;
  private targetsKilled = 0;
  private readonly fireCooldown = 0.14;
  private readonly maxDistance = 120;
  private readonly magazineSize = 12;

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    private readonly getShootables: () => Object3D[],
    private readonly handleHit: (object: Object3D, point: Vector3) => TargetHitResult,
  ) {
    this.viewModel = new FpsPistolViewModel(camera);
    this.tracer = new ProjectileTracer(scene);
    this.impactMarker = new ImpactMarker(scene);
    this.configureAudio();
  }

  load(): Promise<void> {
    return this.viewModel.load();
  }

  update(
    deltaSeconds: number,
    mouseDelta: Vector2,
    moving: boolean,
    sprinting: boolean,
    playerState: PlayerState | null,
  ): void {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);
    this.viewModel.update(
      deltaSeconds,
      mouseDelta,
      moving,
      sprinting,
      this.toWeaponMovementState(playerState),
    );

    if (this.reloadPending && !this.viewModel.isReloading()) {
      this.ammoInMagazine = this.magazineSize;
      this.reloadPending = false;
    }

    this.tracer.update(deltaSeconds);
    this.impactMarker.update(deltaSeconds);
  }

  shoot(origin: Vector3, direction: Vector3): boolean {
    if (this.cooldownRemaining > 0 || !this.viewModel.canFire()) {
      return false;
    }

    if (this.ammoInMagazine <= 0) {
      this.viewModel.showEmpty();
      this.playAudio(this.emptySound);
      return false;
    }

    const willBeEmpty = this.ammoInMagazine === 1;
    if (!this.viewModel.shoot(willBeEmpty)) {
      return false;
    }

    this.ammoInMagazine -= 1;
    this.shotsFired += 1;
    this.cooldownRemaining = this.fireCooldown;
    this.playAudio(this.fireSound);

    this.viewModel.getMuzzleWorldPosition(this.muzzlePosition);
    this.raycaster.set(origin, direction);
    this.raycaster.far = this.maxDistance;

    const [hit] = this.raycaster.intersectObjects(this.getShootables(), true);
    const endPoint = hit
      ? this.endPoint.copy(hit.point)
      : this.endPoint.copy(origin).addScaledVector(direction, this.maxDistance);

    this.tracer.spawn(this.muzzlePosition, endPoint);
    this.lastHitDistance = hit ? origin.distanceTo(hit.point) : this.maxDistance;

    if (hit) {
      const targetHit = this.handleHit(hit.object, hit.point);
      if (targetHit.hit) {
        this.targetHits += 1;
        if (targetHit.destroyed) {
          this.targetsKilled += 1;
        }
      } else {
        this.impactMarker.spawn(hit.point, hit.face?.normal);
      }
    }

    return true;
  }

  reload(): boolean {
    if (
      this.reloadPending ||
      this.ammoInMagazine >= this.magazineSize ||
      !this.viewModel.canReload()
    ) {
      return false;
    }

    const started = this.viewModel.reload();
    this.reloadPending = started;
    if (started) {
      this.playAudio(this.reloadSound);
    }
    return started;
  }

  setVisible(visible: boolean): void {
    this.viewModel.setVisible(visible);
  }

  getDebug(): WeaponDebugSnapshot {
    return {
      ...this.viewModel.getDebug(),
      fireCooldown: this.cooldownRemaining,
      lastHitDistance: this.lastHitDistance,
      ammoInMagazine: this.ammoInMagazine,
      magazineSize: this.magazineSize,
      reserveAmmo: 'Infinite',
      reloadPending: this.reloadPending,
      reloadPromptVisible: this.ammoInMagazine <= 0 && !this.reloadPending,
      shotsFired: this.shotsFired,
      targetHits: this.targetHits,
      targetsKilled: this.targetsKilled,
      accuracyPercent:
        this.shotsFired > 0 ? (this.targetHits / this.shotsFired) * 100 : 0,
    };
  }

  dispose(): void {
    this.viewModel.dispose();
    this.tracer.dispose();
    this.impactMarker.dispose();
  }

  private configureAudio(): void {
    for (const sound of [this.fireSound, this.reloadSound, this.emptySound]) {
      sound.preload = 'auto';
      sound.volume = 0.72;
    }

    this.reloadSound.volume = 0.82;
    this.emptySound.volume = 0.65;
  }

  private playAudio(sound: HTMLAudioElement): void {
    sound.pause();
    sound.currentTime = 0;
    void sound.play().catch(() => {
      // Browsers may block audio before the first user gesture; gameplay continues.
    });
  }

  private toWeaponMovementState(playerState: PlayerState | null): FpsPistolMovementState {
    switch (playerState) {
      case 'jumpingStart':
        return 'JumpStart';
      case 'jumpingLoop':
        return 'JumpAirborne';
      case 'jumpingLand':
        return 'JumpLand';
      default:
        return 'Grounded';
    }
  }
}
