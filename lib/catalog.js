// The only transitions and effects the planner, the AI and the editor may use.
// Every ID here has a renderer in reel/presentations.js or reel/Shot.js.

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
export const MIN_SECONDS = 60;
export const MAX_SECONDS = 120;

export const TRANSITIONS = {
  cut: { label: 'Cut', frames: 0 },
  fade: { label: 'Cross dissolve', frames: 10 },
  dip_black: { label: 'Dip to black', frames: 14 },
  dip_white: { label: 'Flash (dip to white)', frames: 8 },
  push_left: { label: 'Push left', frames: 9 },
  push_up: { label: 'Push up', frames: 9 },
  whip: { label: 'Whip pan', frames: 7 },
  zoom: { label: 'Zoom through', frames: 8 },
  circle: { label: 'Circle reveal', frames: 12 },
  wipe: { label: 'Wipe', frames: 10 },
};

export const EFFECTS = {
  none: { label: 'None' },
  ken_burns: { label: 'Slow zoom (Ken Burns)' },
  punch_in: { label: 'Punch-in' },
  shake: { label: 'Impact shake' },
  slow_push: { label: 'Slow push-in' },
};

export const TRANSITION_IDS = Object.keys(TRANSITIONS);
export const EFFECT_IDS = Object.keys(EFFECTS);
