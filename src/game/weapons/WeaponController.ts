import { Object3D, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { FpsPistolDebugSnapshot, FpsPistolViewModel } from './FpsPistolViewModel';
import { ImpactMarker } from './ImpactMarker';
import { ProjectileTracer } from './ProjectileTracer';

export interface WeaponDebugSnapshot extends FpsPistolDebugSnapshot {
  fireCooldown: number;
  lastHitDistance: number;
}

export class WeaponController {
  readonly viewModel: FpsPistolViewModel;

  private readonly tracer: ProjectileTracer;
  private readonly impactMarker: ImpactMarker;
  private readonly raycaster = new Raycaster();
  private readonly muzzlePosition = new Vector3();
  private readonly endPoint = new Vector3();
  private cooldownRemaining = 0;
  private lastHitDistance = 0;
  private readonly fireCooldown = 0.14;
  private readonly maxDistance = 120;

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    private readonly getWorld: () => Object3D | null,
  ) {
    this.viewModel = new FpsPistolViewModel(camera);
    this.tracer = new ProjectileTracer(scene);
    this.impactMarker = new ImpactMarker(scene);
  }

  load(): Promise<void> {
    return this.viewModel.load();
  }

  update(
    deltaSeconds: number,
    mouseDelta: Vector2,
    moving: boolean,
    sprinting: boolean,
  ): void {
    this.cooldownRemaining = Math.max(0, this.cooldownRemaining - deltaSeconds);
    this.viewModel.update(deltaSeconds, mouseDelta, moving, sprinting);
    this.tracer.update(deltaSeconds);
    this.impactMarker.update(deltaSeconds);
  }

  shoot(origin: Vector3, direction: Vector3): boolean {
    if (this.cooldownRemaining > 0) {
      return false;
    }

    this.cooldownRemaining = this.fireCooldown;
    this.viewModel.shoot();

    this.raycaster.set(origin, direction);
    this.raycaster.far = this.maxDistance;

    const world = this.getWorld();
    const [hit] = world ? this.raycaster.intersectObject(world, true) : [];
    const endPoint = hit
      ? this.endPoint.copy(hit.point)
      : this.endPoint.copy(origin).addScaledVector(direction, this.maxDistance);

    this.viewModel.getMuzzleWorldPosition(this.muzzlePosition);
    this.tracer.spawn(this.muzzlePosition, endPoint);
    this.lastHitDistance = hit ? origin.distanceTo(hit.point) : this.maxDistance;

    if (hit) {
      this.impactMarker.spawn(hit.point, hit.face?.normal);
    }

    return true;
  }

  reload(): void {
    this.viewModel.reload();
  }

  getDebug(): WeaponDebugSnapshot {
    return {
      ...this.viewModel.getDebug(),
      fireCooldown: this.cooldownRemaining,
      lastHitDistance: this.lastHitDistance,
    };
  }

  dispose(): void {
    this.viewModel.dispose();
    this.tracer.dispose();
    this.impactMarker.dispose();
  }
}
