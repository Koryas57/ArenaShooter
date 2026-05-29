import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Scene,
  Vector3,
} from 'three';

interface Tracer {
  line: Line;
  material: LineBasicMaterial;
  age: number;
}

export class ProjectileTracer {
  private readonly tracers: Tracer[] = [];
  private readonly lifetime = 0.08;

  constructor(private readonly scene: Scene) {}

  spawn(start: Vector3, end: Vector3): void {
    const geometry = new BufferGeometry().setFromPoints([start, end]);
    const material = new LineBasicMaterial({
      color: 0xfff1a8,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const line = new Line(geometry, material);
    line.name = 'BulletTracer';
    this.scene.add(line);
    this.tracers.push({ line, material, age: 0 });
  }

  update(deltaSeconds: number): void {
    for (let index = this.tracers.length - 1; index >= 0; index -= 1) {
      const tracer = this.tracers[index];
      tracer.age += deltaSeconds;
      tracer.material.opacity = Math.max(0, 1 - tracer.age / this.lifetime);

      if (tracer.age >= this.lifetime) {
        this.remove(index);
      }
    }
  }

  dispose(): void {
    for (let index = this.tracers.length - 1; index >= 0; index -= 1) {
      this.remove(index);
    }
  }

  private remove(index: number): void {
    const [tracer] = this.tracers.splice(index, 1);
    tracer.line.geometry.dispose();
    tracer.material.dispose();
    tracer.line.removeFromParent();
  }
}
