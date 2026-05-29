import { Object3D, Vector2 } from 'three';
import { shouldLoopClip } from './AnimationController';
import { InputAction } from './InputManager';
import { Player } from './Player';
import { PlayerStateMachine } from './PlayerStateMachine';
import type { PlayerStateFrame } from './PlayerStateMachine';

export interface PlayerControllerStatus extends PlayerStateFrame {
  debugOverride: boolean;
  grounded: boolean;
  sprinting: boolean;
  crouching: boolean;
  velocity: { x: number; y: number; z: number };
}

export class PlayerController {
  private readonly stateMachine: PlayerStateMachine;
  private readonly emptyMove = new Vector2();
  private debugOverrideActive = false;
  private debugOverrideRemaining = 0;
  private lastFrame: PlayerStateFrame;

  constructor(private readonly player: Player) {
    this.stateMachine = new PlayerStateMachine(player);
    this.lastFrame = {
      state: this.stateMachine.state,
      speedMode: 'none',
      animationClip: this.player.animations.currentAnimationName,
      matchedClip: 'None',
      verticalOffset: 0,
    };
  }

  update(
    deltaSeconds: number,
    moveInput: Vector2,
    sprinting: boolean,
    crouching: boolean,
    actions: InputAction[],
    ground: Object3D | null,
  ): PlayerControllerStatus {
    const gameplayActions = actions.filter(isGameplayAction);
    const hasGameplayInput = gameplayActions.length > 0 || moveInput.lengthSq() > 0.0001;

    if (hasGameplayInput) {
      this.debugOverrideActive = false;
      this.debugOverrideRemaining = 0;
    }

    this.stateMachine.setInputSnapshot(moveInput, sprinting, crouching);

    for (const action of gameplayActions) {
      this.stateMachine.handleAction(action);
    }

    if (this.debugOverrideActive) {
      this.debugOverrideRemaining -= deltaSeconds;
      if (this.debugOverrideRemaining <= 0) {
        this.debugOverrideActive = false;
      }
    }

    if (this.debugOverrideActive && !hasGameplayInput) {
      this.player.update(deltaSeconds, this.emptyMove, ground, 0);
      return {
        ...this.lastFrame,
        animationClip: this.player.animations.currentAnimationName,
        debugOverride: true,
        grounded: this.player.isGrounded(),
        sprinting,
        crouching,
        velocity: this.getVelocitySnapshot(),
      };
    }

    this.lastFrame = this.stateMachine.update(deltaSeconds, moveInput, sprinting, crouching);
    this.player.update(
      deltaSeconds,
      moveInput,
      ground,
      this.player.getSpeed(this.lastFrame.speedMode),
    );

    return {
      ...this.lastFrame,
      animationClip: this.player.animations.currentAnimationName,
      debugOverride: false,
      grounded: this.player.isGrounded(),
      sprinting,
      crouching,
      velocity: this.getVelocitySnapshot(),
    };
  }

  playDebugAnimation(clipName: string): void {
    const loop = shouldLoopClip(clipName);
    this.player.playAnimation(clipName, {
      fadeSeconds: 0.16,
      loop,
      returnToIdle: !loop,
    });

    this.debugOverrideActive = true;
    this.debugOverrideRemaining = loop
      ? 4
      : Math.max(0.5, this.player.animations.getClipDuration(clipName));
  }

  private getVelocitySnapshot(): { x: number; y: number; z: number } {
    return {
      x: this.player.velocity.x,
      y: this.player.velocity.y,
      z: this.player.velocity.z,
    };
  }
}

function isGameplayAction(action: InputAction): boolean {
  return action.type === 'jump';
}
