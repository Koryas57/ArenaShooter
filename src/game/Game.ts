import { Clock, Object3D, Vector2, Vector3 } from 'three';
import { AssetLoader, MonsterAsset } from './AssetLoader';
import { CameraController } from './CameraController';
import { HelperOverlay } from './HelperOverlay';
import { InputAction, InputManager } from './InputManager';
import { MobileHud } from './MobileHud';
import { Player } from './Player';
import { PlayerController, PlayerControllerStatus } from './PlayerController';
import { SceneManager } from './SceneManager';
import { TargetManager } from './targets/TargetManager';
import type { TargetHitResult } from './targets/TargetManager';
import { WeaponController } from './weapons/WeaponController';

export class Game {
  private readonly root = document.createElement('div');
  private readonly hud = document.createElement('div');
  private readonly sceneManager: SceneManager;
  private readonly cameraController: CameraController;
  private readonly helperOverlay: HelperOverlay;
  private readonly mobileHud: MobileHud;
  private readonly input = new InputManager();
  private readonly loader = new AssetLoader();
  private readonly clock = new Clock();
  private readonly noMovement = new Vector2();
  private readonly combinedMovement = new Vector2();
  private readonly shotOrigin = new Vector3();
  private readonly shotDirection = new Vector3();
  private readonly backgroundMusic = new Audio('/assets/music/BackgroundMusic.mp3');

  private map: Object3D | null = null;
  private monsterAsset: MonsterAsset | null = null;
  private player: Player | null = null;
  private playerController: PlayerController | null = null;
  private targetManager: TargetManager | null = null;
  private weaponController: WeaponController | null = null;
  private playerStatus: PlayerControllerStatus | null = null;
  private animationFrame = 0;
  private helperVisible = false;
  private debugVisible = false;
  private fps = 0;
  private playerHealth = 100;
  private readonly playerMaxHealth = 100;
  private playerDead = false;
  private paused = false;
  private damageFlash = 0;
  private targetAnchorWarmup = 0;
  private running = false;

  constructor(container: HTMLElement) {
    this.root.className = 'game-root';
    this.hud.className = 'hud';
    container.append(this.root);

    this.sceneManager = new SceneManager(this.root);
    this.cameraController = new CameraController(this.sceneManager.camera);
    this.weaponController = new WeaponController(
      this.sceneManager.scene,
      this.sceneManager.camera,
      () => [this.map, this.targetManager?.raycastRoot].filter((object): object is Object3D => Boolean(object)),
      (object, point): TargetHitResult =>
        this.targetManager?.handleHit(object, point) ?? { hit: false, destroyed: false },
    );
    this.input.setPointerLockElement(this.sceneManager.renderer.domElement);
    this.root.append(this.hud);
    this.helperOverlay = new HelperOverlay(this.hud);
    this.mobileHud = new MobileHud(this.hud);
    this.backgroundMusic.loop = true;
    this.backgroundMusic.volume = 0.42;
    this.backgroundMusic.preload = 'auto';

    this.handleResize = this.handleResize.bind(this);
    this.handleRestartRequest = this.handleRestartRequest.bind(this);
    this.tryStartBackgroundMusic = this.tryStartBackgroundMusic.bind(this);
    this.tick = this.tick.bind(this);
  }

  async start(): Promise<void> {
    this.input.connect();
    this.mobileHud.connect();
    window.addEventListener('arena-restart', this.handleRestartRequest);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();

    try {
      await this.loadWorld();
      this.tryStartBackgroundMusic();
      this.running = true;
      this.clock.start();
      this.tick();
    } catch (error) {
      this.showError(error);
    }
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.animationFrame);
    this.input.dispose();
    this.mobileHud.dispose();
    this.weaponController?.dispose();
    this.targetManager?.dispose();
    this.backgroundMusic.pause();
    window.removeEventListener('pointerdown', this.tryStartBackgroundMusic);
    window.removeEventListener('keydown', this.tryStartBackgroundMusic);
    window.removeEventListener('arena-restart', this.handleRestartRequest);
    window.removeEventListener('resize', this.handleResize);
    this.sceneManager.dispose();
    this.root.remove();
  }

  private async loadWorld(): Promise<void> {
    const [map, playerModel, animationClips, monsterAsset] = await Promise.all([
      this.loader.loadMap(),
      this.loader.loadPlayer(),
      this.loader.loadAnimationClips(),
      this.loader.loadPincherMonster(),
      this.weaponController?.load(),
    ]);

    console.group('UAL1_Standard animation clips');
    animationClips.forEach((clip, index) => {
      console.log(`${index + 1}. ${clip.name}`);
    });
    console.groupEnd();

    map.name = 'FruzerCity';
    map.position.set(0, 0, 0);
    this.map = map;
    this.monsterAsset = monsterAsset;
    this.sceneManager.scene.add(map);

    this.player = new Player(playerModel, animationClips);
    this.player.position.set(0, 0.15, 0);
    this.player.setModelVisible(false);
    this.playerController = new PlayerController(this.player);
    this.sceneManager.scene.add(this.player.root);
    this.cameraController.update(1, this.player.position, false);
    this.updateHelper();
  }

  private tick(): void {
    if (!this.running) {
      return;
    }

    const deltaSeconds = Math.min(this.clock.getDelta(), 1 / 30);
    this.fps = 1 / Math.max(deltaSeconds, 0.001);
    this.damageFlash = Math.max(0, this.damageFlash - deltaSeconds * 1.6);
    const actions = [...this.input.consumeActions(), ...this.mobileHud.consumeActions()];
    this.handleSystemActions(actions);

    const mouseDelta = this.input.consumeMouseDelta().add(this.mobileHud.consumeLookDelta());
    this.combinedMovement
      .copy(this.input.getMoveInput())
      .add(this.mobileHud.getMoveInput());
    if (this.combinedMovement.lengthSq() > 1) {
      this.combinedMovement.normalize();
    }

    const movement = this.playerDead
      ? this.cameraController.toCameraRelativeMovement(this.noMovement)
      : this.cameraController.toCameraRelativeMovement(this.combinedMovement);

    if (this.paused && !this.playerDead) {
      this.mobileHud.update(
        this.weaponController?.getDebug() ?? null,
        this.playerHealth,
        this.playerMaxHealth,
      );
      this.updateHelper();
      this.sceneManager.render();
      this.animationFrame = requestAnimationFrame(this.tick);
      return;
    }

    if (!this.playerDead) {
      this.cameraController.applyMouseLook(mouseDelta);
    }

    if (this.playerController && this.player && !this.playerDead) {
      this.playerStatus = this.playerController.update(
        deltaSeconds,
        movement,
        this.isSprintActive(),
        this.isCrouchActive(),
        actions,
        this.map,
      );
    }

    this.ensureTargetsSpawned();
    if (this.targetManager && this.player && this.targetAnchorWarmup > 0) {
      this.targetManager.setGroundAnchor(this.player.position.y);
      this.targetAnchorWarmup -= deltaSeconds;
    }

    if (this.player) {
      if (this.playerDead) {
        this.cameraController.updateDeath(deltaSeconds, this.player.position);
      } else {
        this.cameraController.update(
          deltaSeconds,
          this.player.position,
          this.playerStatus?.crouching ?? false,
        );
      }
    }

    if (!this.playerDead) {
      this.handleShootActions(actions);
      this.handleReloadActions(actions);
    }

    const damageTaken = this.targetManager?.update(
      deltaSeconds,
      this.player?.position ?? null,
      !this.playerDead,
    ) ?? 0;
    if (damageTaken > 0) {
      this.applyPlayerDamage(damageTaken);
    }

    this.weaponController?.update(
      deltaSeconds,
      mouseDelta,
      !this.playerDead && movement.lengthSq() > 0.0001,
      !this.playerDead && this.isSprintActive(),
      this.playerStatus?.state ?? null,
    );
    this.mobileHud.update(
      this.weaponController?.getDebug() ?? null,
      this.playerHealth,
      this.playerMaxHealth,
    );
    this.updateHelper();
    this.sceneManager.render();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  private handleSystemActions(actions: InputAction[]): void {
    for (const action of actions) {
      switch (action.type) {
        case 'helper-toggle':
          this.helperVisible = !this.helperVisible;
          break;
        case 'debug-toggle':
          this.debugVisible = !this.debugVisible;
          if (this.debugVisible) {
            this.helperVisible = true;
          }
          break;
        case 'pause-toggle':
          if (!this.playerDead) {
            this.paused = !this.paused;
          }
          break;
        case 'restart':
          this.handleRestartRequest();
          break;
        case 'sensitivity-down':
          this.cameraController.adjustSensitivity(-1);
          break;
        case 'sensitivity-up':
          this.cameraController.adjustSensitivity(1);
          break;
      }
    }
  }

  private handleShootActions(actions: InputAction[]): void {
    if (!actions.some((action) => action.type === 'shoot')) {
      return;
    }

    this.weaponController?.shoot(
      this.cameraController.getCameraPosition(this.shotOrigin),
      this.cameraController.getForwardDirection(this.shotDirection),
    );
  }

  private ensureTargetsSpawned(): void {
    if (this.targetManager || !this.map || !this.player || !this.monsterAsset) {
      return;
    }

    this.targetManager = new TargetManager(
      this.sceneManager.scene,
      this.map,
      this.player.position.y,
      this.monsterAsset.scene,
      this.monsterAsset.animations,
    );
    this.targetAnchorWarmup = 1.2;
  }

  private handleReloadActions(actions: InputAction[]): void {
    if (actions.some((action) => action.type === 'reload')) {
      this.weaponController?.reload();
    }
  }

  private isSprintActive(): boolean {
    return this.input.isSprintActive() || this.mobileHud.isSprintActive();
  }

  private isCrouchActive(): boolean {
    return this.input.isCrouchActive() || this.mobileHud.isCrouchActive();
  }

  private tryStartBackgroundMusic(): void {
    if (!this.backgroundMusic.paused) {
      return;
    }

    void this.backgroundMusic.play().then(
      () => {
        window.removeEventListener('pointerdown', this.tryStartBackgroundMusic);
        window.removeEventListener('keydown', this.tryStartBackgroundMusic);
      },
      () => {
        window.addEventListener('pointerdown', this.tryStartBackgroundMusic, { once: true });
        window.addEventListener('keydown', this.tryStartBackgroundMusic, { once: true });
      },
    );
  }

  private handleRestartRequest(): void {
    window.location.reload();
  }

  private updateHelper(): void {
    const position = this.player?.position;

    this.helperOverlay.update({
      visible: this.helperVisible,
      debugVisible: this.debugVisible,
      fps: this.fps,
      pointerLocked: this.input.isPointerLocked(),
      playerHealth: this.playerHealth,
      playerMaxHealth: this.playerMaxHealth,
      damageFlash: this.damageFlash,
      gameOver: this.playerDead,
      paused: this.paused,
      playerPosition: position
        ? {
            x: position.x,
            y: position.y,
            z: position.z,
          }
        : null,
      playerStatus: this.playerStatus,
      camera: this.cameraController.getDebugSnapshot(),
      weapon: this.weaponController?.getDebug() ?? null,
    });
  }

  private applyPlayerDamage(amount: number): void {
    if (this.playerDead) {
      return;
    }

    this.playerHealth = Math.max(0, this.playerHealth - amount);
    this.damageFlash = Math.min(1, this.damageFlash + 0.68);
    if (this.playerHealth <= 0) {
      this.playerDead = true;
      this.helperVisible = false;
      this.weaponController?.setVisible(false);
      document.exitPointerLock?.();
    }
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const panel = document.createElement('section');
    const title = document.createElement('h1');
    const body = document.createElement('p');

    panel.className = 'error-panel';
    title.textContent = 'Asset loading failed';
    body.textContent = message;
    panel.append(title, body);
    this.hud.append(panel);
    console.error(error);
  }

  private handleResize(): void {
    this.sceneManager.resize();
    this.cameraController.resize(
      Math.max(1, this.root.clientWidth),
      Math.max(1, this.root.clientHeight),
    );
  }
}
