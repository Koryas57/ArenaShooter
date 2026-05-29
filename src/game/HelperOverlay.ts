import type { CameraDebugSnapshot } from './CameraController';
import type { PlayerControllerStatus } from './PlayerController';
import type { WeaponDebugSnapshot } from './weapons/WeaponController';

export interface HelperOverlaySnapshot {
  visible: boolean;
  debugVisible: boolean;
  fps: number;
  pointerLocked: boolean;
  playerHealth: number;
  playerMaxHealth: number;
  damageFlash: number;
  gameOver: boolean;
  paused: boolean;
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
  private readonly ammoCounter = document.createElement('div');
  private readonly combatStats = document.createElement('div');
  private readonly healthPanel = document.createElement('div');
  private readonly damageIndicator = document.createElement('div');
  private readonly reloadPrompt = document.createElement('div');
  private readonly gameOverPanel = document.createElement('div');
  private readonly restartButton = document.createElement('button');
  private readonly pausePanel = document.createElement('div');

  constructor(parent: HTMLElement) {
    this.element.className = 'helper-overlay';
    this.crosshair.className = 'crosshair';
    this.ammoCounter.className = 'ammo-counter';
    this.combatStats.className = 'combat-stats';
    this.healthPanel.className = 'health-panel';
    this.damageIndicator.className = 'damage-indicator';
    this.reloadPrompt.className = 'reload-prompt';
    this.gameOverPanel.className = 'game-over-panel is-hidden';
    this.restartButton.className = 'restart-button';
    this.restartButton.type = 'button';
    this.restartButton.textContent = 'Restart';
    this.restartButton.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('arena-restart'));
    });
    this.gameOverPanel.innerHTML = '<strong>GAME OVER</strong><span>You were eliminated</span>';
    this.gameOverPanel.append(this.restartButton);
    this.pausePanel.className = 'pause-panel is-hidden';
    this.pausePanel.innerHTML = '<strong>Paused</strong><span>Press Escape or Pause to resume</span>';
    this.title.className = 'helper-overlay__title';
    this.controlList.className = 'helper-overlay__controls';
    this.debugBlock.className = 'helper-overlay__debug';
    this.hint.className = 'helper-overlay__hint';
    this.title.textContent = 'ArenaShooter';
    this.hint.textContent = 'Tab: Toggle helper';

    this.element.append(this.title, this.controlList, this.debugBlock, this.hint);
    parent.append(
      this.crosshair,
      this.ammoCounter,
      this.combatStats,
      this.healthPanel,
      this.damageIndicator,
      this.reloadPrompt,
      this.gameOverPanel,
      this.pausePanel,
      this.element,
    );
  }

  update(snapshot: HelperOverlaySnapshot): void {
    this.element.classList.toggle('is-hidden', !snapshot.debugVisible);
    this.ammoCounter.textContent = snapshot.weapon
      ? `${snapshot.weapon.ammoInMagazine} / ${snapshot.weapon.magazineSize}`
      : '0 / 0';
    this.combatStats.replaceChildren();
    this.healthPanel.style.setProperty(
      '--health-ratio',
      String(Math.max(0, Math.min(1, snapshot.playerHealth / snapshot.playerMaxHealth))),
    );
    this.healthPanel.replaceChildren(
      this.healthText(snapshot.playerHealth, snapshot.playerMaxHealth),
      this.healthBar(),
    );
    this.damageIndicator.style.setProperty(
      '--damage-opacity',
      Math.max(0, Math.min(1, snapshot.damageFlash)).toFixed(3),
    );
    this.damageIndicator.classList.toggle('is-active', snapshot.damageFlash > 0.02);
    this.gameOverPanel.classList.toggle('is-hidden', !snapshot.gameOver);
    this.pausePanel.classList.toggle('is-hidden', !snapshot.paused || snapshot.gameOver);
    this.reloadPrompt.textContent = 'Press R to reload';
    this.reloadPrompt.classList.toggle(
      'is-hidden',
      !(snapshot.weapon?.reloadPromptVisible ?? false),
    );
    this.controlList.replaceChildren();

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
        this.meta('Ammo', snapshot.weapon ? `${snapshot.weapon.ammoInMagazine}/${snapshot.weapon.magazineSize}` : '0/0'),
        this.meta('Reserve ammo', snapshot.weapon?.reserveAmmo ?? 'None'),
        this.meta('Weapon state', snapshot.weapon?.weaponState ?? 'None'),
        this.meta('Weapon state time', snapshot.weapon?.stateRemaining.toFixed(3) ?? '0.000'),
        this.meta('Reload pending', snapshot.weapon?.reloadPending ? 'true' : 'false'),
        this.meta('Weapon recoil', snapshot.weapon?.recoil.toFixed(3) ?? '0.000'),
        this.meta('Weapon animation', snapshot.weapon?.currentAnimation ?? 'None'),
        this.meta('Muzzle offset', snapshot.weapon?.muzzleLocalOffset ?? 'None'),
        this.meta('Last hit distance', snapshot.weapon?.lastHitDistance.toFixed(2) ?? '0.00'),
        this.meta('Player health', `${snapshot.playerHealth}/${snapshot.playerMaxHealth}`),
        this.meta('Paused', snapshot.paused ? 'true' : 'false'),
      );
    }
  }

  private healthText(health: number, maxHealth: number): HTMLElement {
    const label = document.createElement('div');
    label.className = 'health-panel__label';
    label.textContent = `HP ${Math.max(0, Math.ceil(health))} / ${maxHealth}`;
    return label;
  }

  private healthBar(): HTMLElement {
    const bar = document.createElement('div');
    const fill = document.createElement('div');
    bar.className = 'health-panel__bar';
    fill.className = 'health-panel__fill';
    bar.append(fill);
    return bar;
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
