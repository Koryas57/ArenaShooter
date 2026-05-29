export type GameplayAnimationKey =
  | 'idle'
  | 'walking'
  | 'running'
  | 'sprinting'
  | 'crouchIdle'
  | 'crouchWalk'
  | 'sittingEnter'
  | 'sittingIdle'
  | 'sittingExit'
  | 'jumpStart'
  | 'jumpLoop'
  | 'jumpLand'
  | 'roll'
  | 'interact';

export const GAMEPLAY_ANIMATION_QUERIES: Record<GameplayAnimationKey, string[]> = {
  idle: ['Idle Normal', 'Idle'],
  walking: ['Walk Normal', 'Walk'],
  running: ['Jog Forward', 'Jog Fwd', 'Jog', 'Sprint', 'Walk'],
  sprinting: ['Sprint', 'Run', 'Jog Forward'],
  crouchIdle: ['Crouch Idle'],
  crouchWalk: ['Crouch Fwd', 'Crouch Forward'],
  sittingEnter: ['Sitting Enter'],
  sittingIdle: ['Sitting Idle'],
  sittingExit: ['Sitting Exit'],
  jumpStart: ['Jump Start'],
  jumpLoop: ['Jump Loop'],
  jumpLand: ['Jump Land'],
  roll: ['Roll'],
  interact: ['Interact'],
};
