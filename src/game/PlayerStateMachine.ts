import { Vector2 } from 'three';
import { InputAction } from './InputManager';
import { GameplayAnimationKey } from './PlayerAnimations';
import type { Player } from './Player';

export type PlayerState =
  | 'idle'
  | 'walking'
  | 'running'
  | 'sprinting'
  | 'crouchIdle'
  | 'crouchWalk'
  | 'jumpingStart'
  | 'jumpingLoop'
  | 'jumpingLand'
  | 'rolling'
  | 'sittingEnter'
  | 'sittingIdle'
  | 'sittingExit'
  | 'interacting';

export type MovementSpeedMode = 'walk' | 'run' | 'sprint' | 'crouch' | 'none';

export interface PlayerStateFrame {
  state: PlayerState;
  speedMode: MovementSpeedMode;
  animationClip: string;
  matchedClip: string;
  verticalOffset: number;
}

const STATE_ANIMATIONS: Partial<Record<PlayerState, GameplayAnimationKey>> = {
  idle: 'idle',
  walking: 'walking',
  running: 'running',
  sprinting: 'sprinting',
  crouchIdle: 'crouchIdle',
  crouchWalk: 'crouchWalk',
  jumpingStart: 'jumpStart',
  jumpingLoop: 'jumpLoop',
  jumpingLand: 'jumpLand',
  rolling: 'roll',
  sittingEnter: 'sittingEnter',
  sittingIdle: 'sittingIdle',
  sittingExit: 'sittingExit',
  interacting: 'interact',
};

const LOOPING_STATES = new Set<PlayerState>([
  'idle',
  'walking',
  'running',
  'sprinting',
  'crouchIdle',
  'crouchWalk',
  'jumpingLoop',
  'sittingIdle',
]);

export class PlayerStateMachine {
  state: PlayerState = 'idle';

  private elapsedInState = 0;
  private oneShotDuration = 0.2;
  private crouched = false;
  private lastMoving = false;
  private lastSprinting = false;
  private jumpElapsed = 0;
  private readonly jumpTotalDuration: number;
  private readonly jumpLoopDuration = 0.24;
  private readonly jumpHeight = 1.18;
  private lastMatchedClip = 'None';

  constructor(private readonly player: Player) {
    this.jumpTotalDuration =
      this.durationFor('jumpingStart') + this.jumpLoopDuration + this.durationFor('jumpingLand');
    this.enterLocomotion(false, false, true);
  }

  handleAction(action: InputAction): void {
    if (action.type === 'jump') {
      this.tryJump();
    }
  }

  update(
    deltaSeconds: number,
    moveInput: Vector2,
    sprinting: boolean,
    crouching: boolean,
  ): PlayerStateFrame {
    this.elapsedInState += deltaSeconds;
    this.lastMoving = moveInput.lengthSq() > 0.0001;
    this.lastSprinting = sprinting;
    this.crouched = crouching;

    this.updateStateTransitions();
    const verticalOffset = this.updateJumpArc(deltaSeconds);

    return {
      state: this.state,
      speedMode: this.getSpeedMode(),
      animationClip: this.player.animations.currentAnimationName,
      matchedClip: this.lastMatchedClip,
      verticalOffset,
    };
  }

  private updateStateTransitions(): void {
    if (this.state === 'sittingIdle' && this.lastMoving) {
      this.enter('sittingExit');
      return;
    }

    if (this.state === 'sittingEnter' && this.elapsedInState >= this.oneShotDuration) {
      this.enter('sittingIdle');
      return;
    }

    if (this.state === 'sittingExit' && this.elapsedInState >= this.oneShotDuration) {
      this.enterLocomotion(this.lastMoving, this.lastSprinting);
      return;
    }

    if (this.state === 'rolling' && this.elapsedInState >= this.oneShotDuration) {
      this.enterLocomotion(this.lastMoving, this.lastSprinting);
      return;
    }

    if (this.state === 'interacting' && this.elapsedInState >= this.oneShotDuration) {
      this.enterLocomotion(this.lastMoving, this.lastSprinting);
      return;
    }

    if (this.state === 'jumpingStart' && this.elapsedInState >= this.oneShotDuration) {
      this.enter('jumpingLoop');
      return;
    }

    if (this.state === 'jumpingLoop' && this.elapsedInState >= this.jumpLoopDuration) {
      this.enter('jumpingLand');
      return;
    }

    if (this.state === 'jumpingLand' && this.elapsedInState >= this.oneShotDuration) {
      this.jumpElapsed = 0;
      this.player.setVerticalOffset(0);
      this.enterLocomotion(this.lastMoving, this.lastSprinting);
      return;
    }

    if (this.isLocomotionState()) {
      this.enterLocomotion(this.lastMoving, this.lastSprinting);
    }
  }

  private tryJump(): void {
    if (this.isLockedState() || this.isJumpingState() || this.crouched) {
      return;
    }

    this.jumpElapsed = 0;
    this.enter('jumpingStart');
  }

  private enterLocomotion(isMoving: boolean, sprinting: boolean, force = false): void {
    let nextState: PlayerState;

    if (this.crouched) {
      nextState = isMoving ? 'crouchWalk' : 'crouchIdle';
    } else if (!isMoving) {
      nextState = 'idle';
    } else if (sprinting) {
      nextState = 'sprinting';
    } else {
      nextState = 'walking';
    }

    if (force || nextState !== this.state) {
      this.enter(nextState);
    }
  }

  private enter(state: PlayerState): void {
    this.state = state;
    this.elapsedInState = 0;

    const animationKey = STATE_ANIMATIONS[state];
    if (!animationKey) {
      return;
    }

    const loop = LOOPING_STATES.has(state);
    const match = this.player.playGameplayAnimation(animationKey, {
      fadeSeconds: loop ? 0.2 : 0.12,
      loop,
      restart: !loop,
      returnToIdle: false,
    });

    this.lastMatchedClip = match?.clipName ?? 'No clip';
    this.oneShotDuration = loop ? Infinity : this.durationFor(state);
  }

  private updateJumpArc(deltaSeconds: number): number {
    if (!this.isJumpingState()) {
      this.player.setVerticalOffset(0);
      return 0;
    }

    this.jumpElapsed += deltaSeconds;
    const progress = Math.min(1, this.jumpElapsed / Math.max(this.jumpTotalDuration, 0.1));
    const offset = Math.sin(progress * Math.PI) * this.jumpHeight;
    this.player.setVerticalOffset(offset);
    return offset;
  }

  private durationFor(state: PlayerState): number {
    const animationKey = STATE_ANIMATIONS[state];
    if (!animationKey) {
      return 0.2;
    }

    return Math.min(1.15, Math.max(0.18, this.player.getGameplayAnimationDuration(animationKey)));
  }

  private getSpeedMode(): MovementSpeedMode {
    switch (this.state) {
      case 'walking':
        return 'walk';
      case 'running':
      case 'jumpingStart':
      case 'jumpingLoop':
      case 'jumpingLand':
      case 'rolling':
        return this.lastMoving ? 'walk' : 'none';
      case 'sprinting':
        return 'sprint';
      case 'crouchWalk':
        return 'crouch';
      default:
        return 'none';
    }
  }

  private isLocomotionState(): boolean {
    return (
      this.state === 'idle' ||
      this.state === 'walking' ||
      this.state === 'running' ||
      this.state === 'sprinting' ||
      this.state === 'crouchIdle' ||
      this.state === 'crouchWalk'
    );
  }

  private isJumpingState(): boolean {
    return (
      this.state === 'jumpingStart' ||
      this.state === 'jumpingLoop' ||
      this.state === 'jumpingLand'
    );
  }

  private isLockedState(): boolean {
    return (
      this.state === 'sittingEnter' ||
      this.state === 'sittingIdle' ||
      this.state === 'sittingExit' ||
      this.state === 'interacting'
    );
  }
}
