/**
 * Thin OBS WebSocket v5 adapter.
 * Password is accepted only for connect(); never logged or returned from this module.
 */
import OBSWebSocket, { EventSubscription, type OBSEventTypes, type OBSRequestTypes, type OBSResponseTypes } from 'obs-websocket-js'
import { EventEmitter } from 'node:events'

export type ObsRequestName = keyof OBSRequestTypes
export type ObsCall = <T extends ObsRequestName>(
  requestType: T,
  requestData?: OBSRequestTypes[T],
) => Promise<OBSResponseTypes[T]>

type DisconnectListener = (err?: Error) => void
type MediaEndedListener = (payload: OBSEventTypes['MediaInputPlaybackEnded']) => void

/** Minimal surface the presenter needs — real socket or test mock. */
export interface ObsClient {
  readonly connected: boolean
  connect(url: string, password: string): Promise<void>
  disconnect(): Promise<void>
  call: ObsCall
  on(event: 'ConnectionClosed' | 'ConnectionError', listener: DisconnectListener): void
  on(event: 'MediaInputPlaybackEnded', listener: MediaEndedListener): void
  off(event: 'ConnectionClosed' | 'ConnectionError', listener: DisconnectListener): void
  off(event: 'MediaInputPlaybackEnded', listener: MediaEndedListener): void
}

/**
 * Production adapter around obs-websocket-js.
 * Subscribes to MediaInputs so MediaInputPlaybackEnded is delivered.
 */
export class ObsWebSocketClient implements ObsClient {
  private readonly socket = new OBSWebSocket()
  private readonly bus = new EventEmitter()
  private _connected = false

  get connected() {
    return this._connected
  }

  constructor() {
    this.socket.on('ConnectionClosed', (err) => {
      this._connected = false
      const error = err instanceof Error ? err : new Error(String((err as { message?: string })?.message || 'OBS connection closed'))
      this.bus.emit('ConnectionClosed', error)
    })
    this.socket.on('ConnectionError', (err) => {
      this._connected = false
      const error = err instanceof Error ? err : new Error(String(err))
      this.bus.emit('ConnectionError', error)
    })
    this.socket.on('MediaInputPlaybackEnded', (payload) => {
      this.bus.emit('MediaInputPlaybackEnded', payload)
    })
  }

  async connect(url: string, password: string): Promise<void> {
    // Password is passed only to the library identify handshake — never stored on this instance.
    try {
      await this.socket.connect(url, password, {
        eventSubscriptions:
          EventSubscription.General
          | EventSubscription.Scenes
          | EventSubscription.Inputs
          | EventSubscription.MediaInputs,
      })
      this._connected = true
    } catch (err) {
      this._connected = false
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`OBS WebSocket connect/auth failed: ${message}`)
    }
  }

  async disconnect(): Promise<void> {
    this._connected = false
    try {
      await this.socket.disconnect()
    } catch {
      // already closed
    }
  }

  call: ObsCall = (requestType, requestData) => {
    if (!this._connected) return Promise.reject(new Error('OBS WebSocket is not connected'))
    return this.socket.call(requestType, requestData)
  }

  on(event: 'ConnectionClosed' | 'ConnectionError', listener: DisconnectListener): void
  on(event: 'MediaInputPlaybackEnded', listener: MediaEndedListener): void
  on(event: string, listener: (...args: never[]) => void): void {
    this.bus.on(event, listener as (...args: unknown[]) => void)
  }

  off(event: 'ConnectionClosed' | 'ConnectionError', listener: DisconnectListener): void
  off(event: 'MediaInputPlaybackEnded', listener: MediaEndedListener): void
  off(event: string, listener: (...args: never[]) => void): void {
    this.bus.off(event, listener as (...args: unknown[]) => void)
  }
}

export function createObsClient(): ObsClient {
  return new ObsWebSocketClient()
}
