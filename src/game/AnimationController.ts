import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Object3D,
} from 'three';

export interface AnimationMatch {
  requestedName: string;
  clipName: string | null;
  score: number;
}

export interface PlayAnimationOptions {
  fadeSeconds?: number;
  loop?: boolean;
  restart?: boolean;
  returnToIdle?: boolean;
}

interface ClipCandidate {
  clip: AnimationClip;
  normalizedName: string;
  tokens: string[];
}

const IGNORED_QUERY_TOKENS = new Set(['normal', 'loop', 'animation', 'anim']);

const TOKEN_ALIASES: Record<string, string[]> = {
  forward: ['fwd'],
  fwd: ['forward'],
  run: ['sprint', 'jog'],
  sprint: ['run'],
  pickup: ['pick', 'up'],
  pick: ['pickup'],
};

export class AnimationController {
  readonly clipNames: string[];
  readonly registry = new Map<string, AnimationClip>();

  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private readonly candidates: ClipCandidate[];
  private currentAction: AnimationAction | null = null;
  private currentClip: AnimationClip | null = null;
  private currentLooping = false;
  private idleClipName: string | null = null;
  private oneShotReturnToIdle = false;

  constructor(root: Object3D, clips: AnimationClip[]) {
    this.mixer = new AnimationMixer(root);
    this.clipNames = clips.map((clip) => clip.name);
    this.candidates = clips.map((clip) => {
      const normalizedName = normalizeAnimationName(clip.name);
      this.registry.set(normalizedName, clip);
      return {
        clip,
        normalizedName,
        tokens: tokenizeAnimationName(clip.name),
      };
    });

    this.mixer.addEventListener('finished', (event) => {
      const finishedAction = (event as { action?: AnimationAction }).action;
      if (finishedAction === this.currentAction && this.oneShotReturnToIdle) {
        this.playIdle();
      }
    });
  }

  get currentAnimationName(): string {
    return this.currentClip?.name ?? 'None';
  }

  get currentMatch(): AnimationMatch {
    return {
      requestedName: this.currentClip?.name ?? 'None',
      clipName: this.currentClip?.name ?? null,
      score: this.currentClip ? 1 : 0,
    };
  }

  get isOneShotPlaying(): boolean {
    return Boolean(this.currentAction && !this.currentLooping);
  }

  setIdleClipName(clipName: string | null): void {
    this.idleClipName = clipName;
  }

  getClipDuration(clipName: string | null): number {
    if (!clipName) {
      return 0;
    }

    return this.registry.get(normalizeAnimationName(clipName))?.duration ?? 0;
  }

  update(deltaSeconds: number): void {
    this.mixer.update(deltaSeconds);
  }

  playIdle(): AnimationMatch | null {
    if (!this.idleClipName) {
      return null;
    }

    return this.play(this.idleClipName, {
      fadeSeconds: 0.22,
      loop: true,
      returnToIdle: false,
    });
  }

  play(requestedName: string, options: PlayAnimationOptions = {}): AnimationMatch | null {
    const match = this.findClosest(requestedName);
    const clip = match.clipName ? this.registry.get(normalizeAnimationName(match.clipName)) : null;

    if (!clip) {
      return match;
    }

    const loop = options.loop ?? shouldLoopClip(clip.name);
    const fadeSeconds = options.fadeSeconds ?? 0.18;
    const nextAction = this.getAction(clip);

    if (this.currentAction === nextAction && !options.restart) {
      return match;
    }

    for (const action of this.actions.values()) {
      if (action !== this.currentAction && action !== nextAction) {
        action.stop();
      }
    }

    nextAction.enabled = true;
    nextAction.reset();
    nextAction.setEffectiveTimeScale(1);
    nextAction.setEffectiveWeight(1);
    nextAction.setLoop(loop ? LoopRepeat : LoopOnce, loop ? Infinity : 1);
    nextAction.clampWhenFinished = !loop;

    if (this.currentAction && this.currentAction !== nextAction) {
      this.currentAction.fadeOut(fadeSeconds);
      nextAction.fadeIn(fadeSeconds).play();
    } else {
      nextAction.play();
    }

    this.currentAction = nextAction;
    this.currentClip = clip;
    this.currentLooping = loop;
    this.oneShotReturnToIdle = !loop && (options.returnToIdle ?? true);

    return match;
  }

  findClosest(requestedName: string): AnimationMatch {
    const requestedTokens = tokenizeAnimationName(requestedName).filter(
      (token) => !IGNORED_QUERY_TOKENS.has(token),
    );
    const normalizedRequest = normalizeAnimationName(requestedName);
    let best: { candidate: ClipCandidate; score: number } | null = null;

    for (const candidate of this.candidates) {
      const score = scoreCandidate(candidate, requestedTokens, normalizedRequest);
      if (!best || score > best.score) {
        best = { candidate, score };
        continue;
      }

      if (score === best.score && candidate.clip.name.length < best.candidate.clip.name.length) {
        best = { candidate, score };
      }
    }

    return {
      requestedName,
      clipName: best?.candidate.clip.name ?? null,
      score: best?.score ?? 0,
    };
  }

  findFirstClosest(requestedNames: string[]): AnimationMatch | null {
    let best: AnimationMatch | null = null;

    for (const requestedName of requestedNames) {
      const match = this.findClosest(requestedName);
      if (!best || match.score > best.score) {
        best = match;
      }
    }

    return best;
  }

  private getAction(clip: AnimationClip): AnimationAction {
    const existing = this.actions.get(clip.name);
    if (existing) {
      return existing;
    }

    const action = this.mixer.clipAction(clip);
    this.actions.set(clip.name, action);
    return action;
  }
}

export function shouldLoopClip(clipName: string): boolean {
  const normalized = normalizeAnimationName(clipName);
  return normalized.includes('loop') || normalized.includes('idle') || normalized.includes('aim');
}

export function normalizeAnimationName(name: string): string {
  return name
    .toLowerCase()
    .replace(/0+(\d)/g, '$1')
    .replace(/[^a-z0-9]+/g, '');
}

function tokenizeAnimationName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((token) => [token, ...(TOKEN_ALIASES[token] ?? [])]);
}

function scoreCandidate(
  candidate: ClipCandidate,
  requestedTokens: string[],
  normalizedRequest: string,
): number {
  let score = 0;

  if (candidate.normalizedName === normalizedRequest) {
    score += 1000;
  } else if (candidate.normalizedName.includes(normalizedRequest)) {
    score += 400;
  } else if (normalizedRequest.includes(candidate.normalizedName)) {
    score += 250;
  }

  for (const token of requestedTokens) {
    if (candidate.tokens.includes(token)) {
      score += 80;
    } else if (candidate.normalizedName.includes(token)) {
      score += 35;
    }
  }

  if (candidate.tokens.includes('rm') && !requestedTokens.includes('rm')) {
    score -= 25;
  }

  score -= Math.max(0, candidate.tokens.length - requestedTokens.length) * 2;
  return score;
}
