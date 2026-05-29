import {
  AmbientLight,
  AxesHelper,
  Color,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

export class SceneManager {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(55, 1, 0.1, 1200);
  readonly renderer: WebGLRenderer;

  private readonly grid = new GridHelper(160, 160, 0x89a7c7, 0x26384a);
  private readonly axes = new AxesHelper(3);

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new Color(0x070a0f);

    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = 'srgb';
    this.renderer.domElement.className = 'game-canvas';
    this.container.append(this.renderer.domElement);

    this.scene.add(this.camera);
    this.setupLights();
    this.setupDebugHelpers();
    this.resize();
  }

  resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  setDebugVisible(visible: boolean): void {
    this.grid.visible = visible;
    this.axes.visible = visible;
  }

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private setupLights(): void {
    const ambient = new AmbientLight(0xffffff, 1.7);
    this.scene.add(ambient);

    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(12, 20, 9);
    key.target.position.copy(new Vector3(0, 0, 0));
    this.scene.add(key, key.target);

    const fill = new DirectionalLight(0xb8d8ff, 0.9);
    fill.position.set(-12, 8, -10);
    this.scene.add(fill);
  }

  private setupDebugHelpers(): void {
    this.grid.position.y = 0.01;
    this.axes.position.y = 0.02;
    this.scene.add(this.grid, this.axes);
    this.setDebugVisible(false);
  }
}
