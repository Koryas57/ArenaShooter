import { Vector2 } from 'three';

export type InputAction =
  | { type: 'jump' }
  | { type: 'shoot' }
  | { type: 'reload' }
  | { type: 'helper-toggle' }
  | { type: 'debug-toggle' }
  | { type: 'sensitivity-down' }
  | { type: 'sensitivity-up' };

const MOVE_KEYS: Record<string, Vector2> = {
  KeyW: new Vector2(0, 1),
  KeyZ: new Vector2(0, 1),
  ArrowUp: new Vector2(0, 1),
  KeyS: new Vector2(0, -1),
  ArrowDown: new Vector2(0, -1),
  KeyA: new Vector2(-1, 0),
  KeyQ: new Vector2(-1, 0),
  ArrowLeft: new Vector2(-1, 0),
  KeyD: new Vector2(1, 0),
  ArrowRight: new Vector2(1, 0),
};

export class InputManager {
  private readonly pressed = new Set<string>();
  private readonly queuedActions: InputAction[] = [];
  private readonly movement = new Vector2();
  private readonly mouseDelta = new Vector2();
  private lockElement: HTMLElement | null = null;
  private pointerLocked = false;

  constructor(private readonly target: Window = window) {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handlePointerLockChange = this.handlePointerLockChange.bind(this);
  }

  setPointerLockElement(element: HTMLElement): void {
    if (this.lockElement) {
      this.lockElement.removeEventListener('mousedown', this.handleMouseDown);
    }

    this.lockElement = element;
    this.lockElement.addEventListener('mousedown', this.handleMouseDown);
  }

  connect(): void {
    this.target.addEventListener('keydown', this.handleKeyDown);
    this.target.addEventListener('keyup', this.handleKeyUp);
    this.target.addEventListener('mousemove', this.handleMouseMove);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown);
    this.target.removeEventListener('keyup', this.handleKeyUp);
    this.target.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.lockElement?.removeEventListener('mousedown', this.handleMouseDown);
    this.pressed.clear();
  }

  getMoveInput(): Vector2 {
    this.movement.set(0, 0);

    for (const code of this.pressed) {
      const contribution = MOVE_KEYS[code];
      if (contribution) {
        this.movement.add(contribution);
      }
    }

    if (this.movement.lengthSq() > 1) {
      this.movement.normalize();
    }

    return this.movement;
  }

  consumeMouseDelta(): Vector2 {
    const delta = this.mouseDelta.clone();
    this.mouseDelta.set(0, 0);
    return delta;
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  isSprintActive(): boolean {
    return this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
  }

  isCrouchActive(): boolean {
    return this.pressed.has('ControlLeft') || this.pressed.has('ControlRight');
  }

  consumeActions(): InputAction[] {
    return this.queuedActions.splice(0);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (!event.repeat) {
      this.queueDiscreteAction(event);
    }

    if (
      MOVE_KEYS[event.code] ||
      event.code === 'ShiftLeft' ||
      event.code === 'ShiftRight' ||
      event.code === 'ControlLeft' ||
      event.code === 'ControlRight'
    ) {
      this.pressed.add(event.code);
      event.preventDefault();
      return;
    }

    if (event.code === 'Tab' || event.code === 'Space' || event.code === 'F1') {
      event.preventDefault();
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.pressed.delete(event.code);
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.pointerLocked) {
      return;
    }

    this.mouseDelta.x += event.movementX;
    this.mouseDelta.y += event.movementY;
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button !== 0) {
      return;
    }

    if (!this.pointerLocked) {
      this.lockElement?.requestPointerLock();
    }

    this.queuedActions.push({ type: 'shoot' });
  }

  private handlePointerLockChange(): void {
    this.pointerLocked = document.pointerLockElement === this.lockElement;
  }

  private queueDiscreteAction(event: KeyboardEvent): void {
    if (event.code === 'F1') {
      this.queuedActions.push({ type: 'debug-toggle' });
      return;
    }

    if (event.code === 'Tab') {
      this.queuedActions.push({ type: 'helper-toggle' });
      return;
    }

    if (event.code === 'Space') {
      this.queuedActions.push({ type: 'jump' });
      return;
    }

    if (event.code === 'KeyR') {
      this.queuedActions.push({ type: 'reload' });
      return;
    }

    if (event.code === 'BracketLeft') {
      this.queuedActions.push({ type: 'sensitivity-down' });
      return;
    }

    if (event.code === 'BracketRight') {
      this.queuedActions.push({ type: 'sensitivity-up' });
    }
  }
}
