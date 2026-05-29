import {
  Mesh,
  MeshBasicMaterial,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';

interface Impact {
  mesh: Mesh;
  material: MeshBasicMaterial;
  age: number;
}

export class ImpactMarker {
  private readonly geometry = new SphereGeometry(0.055, 8, 8);
  private readonly impacts: Impact[] = [];
  private readonly lifetime = 1.5;

  constructor(private readonly scene: Scene) {}

  spawn(position: Vector3, normal?: Vector3): void {
    const material = new MeshBasicMaterial({
      color: 0xffc56f,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.name = 'ImpactMarker';
    mesh.position.copy(position);

    if (normal) {
      mesh.position.addScaledVector(normal, 0.035);
    }

    this.scene.add(mesh);
    this.impacts.push({ mesh, material, age: 0 });
  }

  update(deltaSeconds: number): void {
    for (let index = this.impacts.length - 1; index >= 0; index -= 1) {
      const impact = this.impacts[index];
      impact.age += deltaSeconds;
      impact.material.opacity = Math.max(0, 1 - impact.age / this.lifetime);
      impact.mesh.scale.setScalar(1 + impact.age * 0.65);

      if (impact.age >= this.lifetime) {
        this.remove(index);
      }
    }
  }

  dispose(): void {
    for (let index = this.impacts.length - 1; index >= 0; index -= 1) {
      this.remove(index);
    }

    this.geometry.dispose();
  }

  private remove(index: number): void {
    const [impact] = this.impacts.splice(index, 1);
    impact.material.dispose();
    impact.mesh.removeFromParent();
  }
}
