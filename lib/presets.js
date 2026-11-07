// Style presets. Each is a set of numbers the rules planner follows.
// A reference reel can later be measured into one of these.

export const PRESETS = {
  hype: {
    label: 'Hype',
    description: 'Fast cuts on the beat, pushes and flashes.',
    shotSeconds: [0.8, 1.8],
    photoSeconds: 1.6,
    transitionEvery: 3,
    transitions: ['push_left', 'dip_white', 'whip', 'zoom', 'push_up'],
    clipEffects: ['punch_in', 'none', 'shake', 'none'],
    photoEffect: 'ken_burns',
    titleSeconds: 2,
    clipVolumeWithMusic: 0.15,
    musicVolume: 0.9,
  },
  cinematic: {
    label: 'Cinematic',
    description: 'Medium pacing, dissolves and slow push-ins.',
    shotSeconds: [2, 3.5],
    photoSeconds: 3,
    transitionEvery: 2,
    transitions: ['fade', 'dip_black', 'fade', 'wipe'],
    clipEffects: ['slow_push', 'none'],
    photoEffect: 'ken_burns',
    titleSeconds: 3,
    clipVolumeWithMusic: 0.2,
    musicVolume: 0.8,
  },
  vlog: {
    label: 'Vlog',
    description: 'Natural pacing that keeps more of each moment.',
    shotSeconds: [2.5, 4.5],
    photoSeconds: 2.5,
    transitionEvery: 4,
    transitions: ['fade', 'push_left', 'circle'],
    clipEffects: ['none', 'none', 'punch_in'],
    photoEffect: 'ken_burns',
    titleSeconds: 2.5,
    clipVolumeWithMusic: 0.5,
    musicVolume: 0.5,
  },
};

export const PRESET_IDS = Object.keys(PRESETS);
