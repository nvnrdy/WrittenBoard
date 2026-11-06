/**
 * Official OBS WebSocket v5 protocol identifiers.
 * Values match obsproject/obs-websocket protocol.md (ObsMediaInputAction / mediaState).
 * Do not invent alternate spellings.
 */

/** TriggerMediaInputAction.mediaAction */
export const ObsMediaInputAction = {
  NONE: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NONE',
  PLAY: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY',
  PAUSE: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE',
  STOP: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP',
  RESTART: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART',
  NEXT: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT',
  PREVIOUS: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS',
} as const

/** GetMediaInputStatus.mediaState */
export const ObsMediaState = {
  NONE: 'OBS_MEDIA_STATE_NONE',
  PLAYING: 'OBS_MEDIA_STATE_PLAYING',
  OPENING: 'OBS_MEDIA_STATE_OPENING',
  BUFFERING: 'OBS_MEDIA_STATE_BUFFERING',
  PAUSED: 'OBS_MEDIA_STATE_PAUSED',
  STOPPED: 'OBS_MEDIA_STATE_STOPPED',
  ENDED: 'OBS_MEDIA_STATE_ENDED',
  ERROR: 'OBS_MEDIA_STATE_ERROR',
} as const

export type ObsMediaInputActionId = (typeof ObsMediaInputAction)[keyof typeof ObsMediaInputAction]
export type ObsMediaStateId = (typeof ObsMediaState)[keyof typeof ObsMediaState]

/** Default WrittenBoard scene/source contract (operator must create these; Stage 1 does not mutate OBS). */
export const DEFAULT_OBS_SCENES = {
  holding: 'WB Holding',
  content: 'WB Content',
} as const

export const DEFAULT_OBS_SOURCES = {
  holdingBg: 'WB Holding BG',
  contentBg: 'WB Content BG',
  text: 'WB Text',
  image: 'WB Image',
  video: 'WB Video',
} as const

export const DEFAULT_OBS_WEBSOCKET_URL = 'ws://127.0.0.1:4455'
