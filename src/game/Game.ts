import { Clock, Object3D, Vector3 } from 'three';
import { AssetLoader } from './AssetLoader';
import { CameraController } from './CameraController';
import { HelperOverlay } from './HelperOverlay';
import { InputAction, InputManager } from './InputManager';
import { Player } from './Player';
import { PlayerController, PlayerControllerStatus } from './PlayerController';
import { SceneManager } from './SceneManager';
import { WeaponController } from './weapons/WeaponController';

export class Game {
  private readonly root = document.createElement('div');
  private readonly hud = document.createElement('div');
  private readonly sceneManager: SceneManager;
  private readonly cameraController: CameraController;
  private readonly helperOverlay: HelperOverlay;
  private readonly input = new InputManager();
  private readonly loader = new AssetLoader();
  private readonly clock = new Clock();
  private readonly shotOrigin = new Vector3();
  private readonly shotDirection = new Vector3();

  private map: Object3D | null = null;
  private player: Player | null = null;
  private playerController: PlayerController | null = null;
  private weaponController: WeaponController | null = null;
  private playerStatus: PlayerControllerStatus | null = null;
  private animationFrame = 0;
  private helperVisible = true;
  private debugVisible = false;
  private fps = 0;
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
      () => this.map,
    );
    this.input.setPointerLockElement(this.sceneManager.renderer.domElement);
    this.root.append(this.hud);
    this.helperOverlay = new HelperOverlay(this.hud);

    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);
  }

  async start(): Promise<void> {
    this.input.connect();
    window.addEventListener('resize', this.handleResize);
    this.handleResize();

    try {
      await this.loadWorld();
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
    this.weaponController?.dispose();
    window.removeEventListener('resize', this.handleResize);
    this.sceneManager.dispose();
    this.root.remove();
  }

  private async loadWorld(): Promise<void> {
    const [map, playerModel, animationClips] = await Promise.all([
      this.loader.loadMap(),
      this.loader.loadPlayer(),
      this.loader.loadAnimationClips(),
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
    const actions = this.input.consumeActions();
    this.handleSystemActions(actions);

    const mouseDelta = this.input.consumeMouseDelta();
    this.cameraController.applyMouseLook(mouseDelta);
    const movement = this.cameraController.toCameraRelativeMovement(this.input.getMoveInput());

    if (this.playerController && this.player) {
      this.playerStatus = this.playerController.update(
        deltaSeconds,
        movement,
        this.input.isSprintActive(),
        this.input.isCrouchActive(),
        actions,
        this.map,
      );
      this.cameraController.update(
        deltaSeconds,
        this.player.position,
        this.playerStatus.crouching,
      );
    }

    this.handleShootActions(actions);
    this.handleReloadActions(actions);
    this.weaponController?.update(
      deltaSeconds,
      mouseDelta,
      movement.lengthSq() > 0.0001,
      this.input.isSprintActive(),
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

  private handleReloadActions(actions: InputAction[]): void {
    if (actions.some((action) => action.type === 'reload')) {
      this.weaponController?.reload();
    }
  }

  private updateHelper(): void {
    const position = this.player?.position;

    this.helperOverlay.update({
      visible: this.helperVisible,
      debugVisible: this.debugVisible,
      fps: this.fps,
      pointerLocked: this.input.isPointerLocked(),
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
