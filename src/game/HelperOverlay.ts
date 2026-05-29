import type { CameraDebugSnapshot } from './CameraController';
import type { PlayerControllerStatus } from './PlayerController';
import type { WeaponDebugSnapshot } from './weapons/WeaponController';

export interface HelperOverlaySnapshot {
  visible: boolean;
  debugVisible: boolean;
  fps: number;
  pointerLocked: boolean;
  playerPosition: { x: number; y: number; z: number } | null;
  playerStatus: PlayerControllerStatus | null;
  camera: CameraDebugSnapshot;
  weapon: WeaponDebugSnapshot | null;
}

export class HelperOverlay {
  readonly element = document.createElement('section');

  private readonly title = document.createElement('div');
  private readonly controlList = document.createElement('div');
  private readonly debugBlock = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly crosshair = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.element.className = 'helper-overlay';
    this.crosshair.className = 'crosshair';
    this.title.className = 'helper-overlay__title';
    this.controlList.className = 'helper-overlay__controls';
    this.debugBlock.className = 'helper-overlay__debug';
    this.hint.className = 'helper-overlay__hint';
    this.title.textContent = 'ArenaShooter';
    this.hint.textContent = 'Tab: Toggle helper';

    this.element.append(this.title, this.controlList, this.debugBlock, this.hint);
    parent.append(this.crosshair, this.element);
  }

  update(snapshot: HelperOverlaySnapshot): void {
    this.element.classList.toggle('is-hidden', !snapshot.visible);
    this.controlList.replaceChildren(
      this.row('Arrows / ZQSD / WASD', 'Move'),
      this.row('Mouse', 'Look'),
      this.row('Left click', snapshot.pointerLocked ? 'Shoot' : 'Lock mouse'),
      this.row('R', 'Reload'),
      this.row('Shift', 'Sprint'),
      this.row('Ctrl', 'Crouch'),
      this.row('Space', 'Jump'),
      this.row('Tab', 'Toggle helper'),
      this.row('F1', 'Debug panel'),
      this.row('[ / ]', 'Mouse sensitivity'),
    );

    this.debugBlock.replaceChildren();
    this.debugBlock.classList.toggle('is-hidden', !snapshot.debugVisible);

    if (snapshot.debugVisible) {
      const status = snapshot.playerStatus;
      const position = snapshot.playerPosition;
      this.debugBlock.append(
        this.meta('FPS', snapshot.fps.toFixed(0)),
        this.meta(
          'Position',
          position
            ? `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`
            : '0.00, 0.00, 0.00',
        ),
        this.meta(
          'Velocity',
          status
            ? `${status.velocity.x.toFixed(2)}, ${status.velocity.y.toFixed(2)}, ${status.velocity.z.toFixed(2)}`
            : '0.00, 0.00, 0.00',
        ),
        this.meta('Grounded', status?.grounded ? 'true' : 'false'),
        this.meta('Sprint', status?.sprinting ? 'true' : 'false'),
        this.meta('Crouch', status?.crouching ? 'true' : 'false'),
        this.meta('Player state', status?.state ?? 'None'),
        this.meta('Animation clip', status?.animationClip ?? 'None'),
        this.meta('Camera yaw', `${snapshot.camera.yawDegrees.toFixed(1)} deg`),
        this.meta('Camera pitch', `${snapshot.camera.pitchDegrees.toFixed(1)} deg`),
        this.meta('Sensitivity', snapshot.camera.sensitivity.toFixed(4)),
        this.meta('Weapon position', snapshot.weapon?.positionOffset ?? 'None'),
        this.meta('Weapon rotation', snapshot.weapon?.rotationOffset ?? 'None'),
        this.meta('Weapon scale', snapshot.weapon?.scale.toFixed(4) ?? '0.0000'),
        this.meta('Fire cooldown', snapshot.weapon?.fireCooldown.toFixed(3) ?? '0.000'),
        this.meta('Weapon recoil', snapshot.weapon?.recoil.toFixed(3) ?? '0.000'),
        this.meta('Weapon animation', snapshot.weapon?.currentAnimation ?? 'None'),
        this.meta('Muzzle offset', snapshot.weapon?.muzzleLocalOffset ?? 'None'),
        this.meta('Last hit distance', snapshot.weapon?.lastHitDistance.toFixed(2) ?? '0.00'),
      );
    }
  }

  private row(keyText: string, actionText: string): HTMLElement {
    const row = document.createElement('div');
    const key = document.createElement('span');
    const action = document.createElement('span');

    row.className = 'helper-overlay__row';
    key.className = 'helper-overlay__key';
    action.className = 'helper-overlay__action';
    key.textContent = keyText;
    action.textContent = actionText;
    row.append(key, action);
    return row;
  }

  private meta(labelText: string, valueText: string): HTMLElement {
    const row = document.createElement('div');
    const label = document.createElement('span');
    const value = document.createElement('span');

    row.className = 'helper-overlay__meta';
    label.textContent = labelText;
    value.textContent = valueText;
    row.append(label, value);
    return row;
  }
}
