import { Vector2 } from 'three';
import type { InputAction } from './InputManager';
import type { WeaponDebugSnapshot } from './weapons/WeaponController';

export class MobileHud {
  readonly element = document.createElement('div');

  private readonly leftZone = document.createElement('div');
  private readonly lookZone = document.createElement('div');
  private readonly joystick = document.createElement('div');
  private readonly joystickKnob = document.createElement('div');
  private readonly fireButton = this.createButton('Fire', 'mobile-fire');
  private readonly reloadButton = this.createButton('R', 'mobile-reload');
  private readonly jumpButton = this.createButton('Jump', 'mobile-jump');
  private readonly crouchButton = this.createButton('Crouch', 'mobile-crouch');
  private readonly pauseButton = this.createButton('Pause', 'mobile-pause');
  private readonly weaponInfo = document.createElement('div');
  private readonly moveInput = new Vector2();
  private readonly lookDelta = new Vector2();
  private readonly queuedActions: InputAction[] = [];
  private joystickPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private joystickOriginX = 0;
  private joystickOriginY = 0;
  private lastLookX = 0;
  private lastLookY = 0;
  private sprintActive = false;
  private crouchActive = false;
  private fireHeld = false;
  private connected = false;
  private readonly joystickRadius = 62;
  private readonly sprintThreshold = 0.82;
  private readonly lookSensitivityPixels = 1.38;

  constructor(parent: HTMLElement) {
    this.element.className = 'mobile-hud';
    this.leftZone.className = 'mobile-left-zone';
    this.lookZone.className = 'mobile-look-zone';
    this.joystick.className = 'mobile-joystick';
    this.joystickKnob.className = 'mobile-joystick__knob';
    this.weaponInfo.className = 'mobile-weapon-info';
    this.weaponInfo.innerHTML = this.renderWeaponInfo('0 / 0', '100/100');

    this.joystick.append(this.joystickKnob);
    this.element.append(
      this.leftZone,
      this.lookZone,
      this.joystick,
      this.fireButton,
      this.reloadButton,
      this.jumpButton,
      this.crouchButton,
      this.pauseButton,
      this.weaponInfo,
    );
    parent.append(this.element);

    this.handleJoystickDown = this.handleJoystickDown.bind(this);
    this.handleJoystickMove = this.handleJoystickMove.bind(this);
    this.handleJoystickUp = this.handleJoystickUp.bind(this);
    this.handleLookDown = this.handleLookDown.bind(this);
    this.handleLookMove = this.handleLookMove.bind(this);
    this.handleLookUp = this.handleLookUp.bind(this);
  }

  connect(): void {
    if (this.connected) {
      return;
    }

    this.leftZone.addEventListener('pointerdown', this.handleJoystickDown);
    this.leftZone.addEventListener('pointermove', this.handleJoystickMove);
    this.leftZone.addEventListener('pointerup', this.handleJoystickUp);
    this.leftZone.addEventListener('pointercancel', this.handleJoystickUp);
    this.lookZone.addEventListener('pointerdown', this.handleLookDown);
    this.lookZone.addEventListener('pointermove', this.handleLookMove);
    this.lookZone.addEventListener('pointerup', this.handleLookUp);
    this.lookZone.addEventListener('pointercancel', this.handleLookUp);
    this.bindActionButton(this.fireButton, 'shoot', true);
    this.bindActionButton(this.reloadButton, 'reload');
    this.bindActionButton(this.jumpButton, 'jump');
    this.bindActionButton(this.pauseButton, 'pause-toggle');
    this.bindCrouchButton();
    this.connected = true;
  }

  dispose(): void {
    this.leftZone.removeEventListener('pointerdown', this.handleJoystickDown);
    this.leftZone.removeEventListener('pointermove', this.handleJoystickMove);
    this.leftZone.removeEventListener('pointerup', this.handleJoystickUp);
    this.leftZone.removeEventListener('pointercancel', this.handleJoystickUp);
    this.lookZone.removeEventListener('pointerdown', this.handleLookDown);
    this.lookZone.removeEventListener('pointermove', this.handleLookMove);
    this.lookZone.removeEventListener('pointerup', this.handleLookUp);
    this.lookZone.removeEventListener('pointercancel', this.handleLookUp);
    this.element.remove();
  }

  update(weapon: WeaponDebugSnapshot | null, playerHealth: number, playerMaxHealth: number): void {
    if (this.fireHeld) {
      this.queuedActions.push({ type: 'shoot' });
    }

    const ammo = weapon ? `${weapon.ammoInMagazine} / ${weapon.magazineSize}` : '0 / 0';
    const ammoRatio = weapon ? weapon.ammoInMagazine / weapon.magazineSize : 0;
    const health = `${Math.max(0, Math.ceil(playerHealth))}/${playerMaxHealth}`;
    const healthRatio = Math.max(0, Math.min(1, playerHealth / playerMaxHealth));
    this.weaponInfo.style.setProperty('--mobile-health-ratio', healthRatio.toFixed(3));
    this.weaponInfo.style.setProperty('--mobile-ammo-ratio', Math.max(0, Math.min(1, ammoRatio)).toFixed(3));
    this.weaponInfo.innerHTML = this.renderWeaponInfo(ammo, health);
    this.crouchButton.classList.toggle('is-active', this.crouchActive);
  }

  getMoveInput(): Vector2 {
    return this.moveInput;
  }

  consumeLookDelta(): Vector2 {
    const delta = this.lookDelta.clone();
    this.lookDelta.set(0, 0);
    return delta;
  }

  consumeActions(): InputAction[] {
    return this.queuedActions.splice(0);
  }

  isSprintActive(): boolean {
    return this.sprintActive;
  }

  isCrouchActive(): boolean {
    return this.crouchActive;
  }

  private handleJoystickDown(event: PointerEvent): void {
    if (this.joystickPointerId !== null) {
      return;
    }

    this.joystickPointerId = event.pointerId;
    this.leftZone.setPointerCapture(event.pointerId);
    this.joystickOriginX = event.clientX;
    this.joystickOriginY = event.clientY;
    this.joystick.style.left = `${event.clientX}px`;
    this.joystick.style.top = `${event.clientY}px`;
    this.joystick.classList.add('is-active');
    this.updateJoystick(event.clientX, event.clientY);
    event.preventDefault();
  }

  private handleJoystickMove(event: PointerEvent): void {
    if (event.pointerId !== this.joystickPointerId) {
      return;
    }

    this.updateJoystick(event.clientX, event.clientY);
    event.preventDefault();
  }

  private handleJoystickUp(event: PointerEvent): void {
    if (event.pointerId !== this.joystickPointerId) {
      return;
    }

    this.joystickPointerId = null;
    this.moveInput.set(0, 0);
    this.sprintActive = false;
    this.joystick.classList.remove('is-active');
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
    event.preventDefault();
  }

  private updateJoystick(clientX: number, clientY: number): void {
    const dx = clientX - this.joystickOriginX;
    const dy = clientY - this.joystickOriginY;
    const distance = Math.hypot(dx, dy);
    const clampedDistance = Math.min(distance, this.joystickRadius);
    const angle = Math.atan2(dy, dx);
    const knobX = Math.cos(angle) * clampedDistance;
    const knobY = Math.sin(angle) * clampedDistance;
    const strength = clampedDistance / this.joystickRadius;

    this.moveInput.set(
      Math.cos(angle) * strength,
      -Math.sin(angle) * strength,
    );
    if (distance < 4) {
      this.moveInput.set(0, 0);
    }

    this.sprintActive = strength >= this.sprintThreshold;
    this.joystickKnob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
  }

  private handleLookDown(event: PointerEvent): void {
    if (this.lookPointerId !== null) {
      return;
    }

    this.lookPointerId = event.pointerId;
    this.lookZone.setPointerCapture(event.pointerId);
    this.lastLookX = event.clientX;
    this.lastLookY = event.clientY;
    event.preventDefault();
  }

  private handleLookMove(event: PointerEvent): void {
    if (event.pointerId !== this.lookPointerId) {
      return;
    }

    this.lookDelta.x += (event.clientX - this.lastLookX) * this.lookSensitivityPixels;
    this.lookDelta.y += (event.clientY - this.lastLookY) * this.lookSensitivityPixels;
    this.lastLookX = event.clientX;
    this.lastLookY = event.clientY;
    event.preventDefault();
  }

  private handleLookUp(event: PointerEvent): void {
    if (event.pointerId !== this.lookPointerId) {
      return;
    }

    this.lookPointerId = null;
    event.preventDefault();
  }

  private bindActionButton(
    button: HTMLButtonElement,
    type: Extract<InputAction['type'], 'shoot' | 'reload' | 'jump' | 'pause-toggle'>,
    hold = false,
  ): void {
    button.addEventListener('pointerdown', (event) => {
      button.setPointerCapture(event.pointerId);
      button.classList.add('is-active');
      this.queuedActions.push({ type });
      if (hold && type === 'shoot') {
        this.fireHeld = true;
      }

      event.preventDefault();
      event.stopPropagation();
    });

    const release = (event: PointerEvent) => {
      button.classList.remove('is-active');
      if (hold && type === 'shoot') {
        this.fireHeld = false;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
  }

  private bindCrouchButton(): void {
    this.crouchButton.addEventListener('pointerdown', (event) => {
      this.crouchActive = !this.crouchActive;
      this.crouchButton.classList.toggle('is-active', this.crouchActive);
      event.preventDefault();
      event.stopPropagation();
    });
  }

  private createButton(label: string, className: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = `mobile-button ${className}`;
    button.type = 'button';
    button.textContent = label;
    return button;
  }

  private renderWeaponInfo(ammo: string, health: string): string {
    return `
      <div class="mobile-weapon-info__mode">Single</div>
      <div class="mobile-weapon-info__weapon">Pistol</div>
      <div class="mobile-weapon-info__ammo"><strong>${ammo}</strong><span>Ammo</span></div>
      <div class="mobile-weapon-info__hp"><strong>${health}</strong><span>HP</span></div>
      <i class="mobile-weapon-info__ammo-bar"></i>
      <i class="mobile-weapon-info__health-bar"></i>
    `;
  }
}
