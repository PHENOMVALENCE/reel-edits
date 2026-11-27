// Structured-output schemas for the Claude editorial agent.
// They stay inside the subset the API supports: no numeric or length constraints
// (bounds are checked in code by the planner), every object closed with additionalProperties:false.

import { TRANSITION_IDS, EFFECT_IDS, CAPTION_STYLE_IDS } from '../catalog.js';

const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });

export const ANALYSIS_SCHEMA = obj({
  summary: str,
  story: str,
  hookCandidates: arr(obj({ asset: str, time: num, why: str })),
  assets: arr(obj({
    asset: str,
    description: str,
    subjects: arr(str),
    quality: { type: 'string', enum: ['strong', 'usable', 'weak'] },
    moments: arr(obj({ start: num, end: num, label: str, energy: { type: 'string', enum: ['low', 'medium', 'high'] } })),
    speech: str,
  })),
  musicFit: str,
  risks: arr(str),
});

export const SHOT_SCHEMA = obj({
  asset: str,
  start: num,
  length: num,
  transition: { type: 'string', enum: TRANSITION_IDS },
  effect: { type: 'string', enum: EFFECT_IDS },
  reason: str,
});

export const SECTION_SCHEMA = obj({
  id: str,
  purpose: str,
  shots: arr(SHOT_SCHEMA),
});

export const CAPTIONS_SCHEMA = obj({
  style: { type: 'string', enum: CAPTION_STYLE_IDS },
  emphasis: arr(str),
  maxWordsPerLine: { type: 'integer' },
  position: { type: 'string', enum: ['lower', 'middle'] },
});

export const AUDIO_SCHEMA = obj({
  musicVolume: num,
  clipVolume: num,
  speechVolume: num,
  duckUnderSpeech: bool,
});

export const PLAN_SCHEMA = obj({
  title: str,
  endText: str,
  sections: arr(SECTION_SCHEMA),
  captions: CAPTIONS_SCHEMA,
  audio: AUDIO_SCHEMA,
  notes: str,
});

export const REVIEW_SCHEMA = obj({
  ...PLAN_SCHEMA.properties,
  changes: arr(str),
});
REVIEW_SCHEMA.required = Object.keys(REVIEW_SCHEMA.properties);

export const SECTION_RESULT_SCHEMA = obj({
  section: SECTION_SCHEMA,
  notes: str,
});
