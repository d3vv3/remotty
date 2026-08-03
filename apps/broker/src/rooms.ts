import type { WebSocket } from "ws"
import type { PushSubscription } from "web-push"
import type { RelayInfo, RelayMessage } from "@remotty/protocol"

export type RelaySnapshot = Extract<RelayMessage, { type: "relay.snapshot" }>

export type RelayConnection = {
  socket: WebSocket
  relay: RelayInfo
  snapshot?: RelaySnapshot
}

export type PushRegistration = {
  subscription: PushSubscription
  brokerUrl: string
  closeNotifications: boolean
}

export type Room = {
  relays: Map<string, RelayConnection>
  clients: Set<WebSocket>
  pushSubscriptions: Map<string, PushRegistration>
}

export class RelayRooms {
  private readonly rooms = new Map<string, Room>()

  get(code: string): Room {
    let room = this.rooms.get(code)
    if (!room) {
      room = { relays: new Map(), clients: new Set(), pushSubscriptions: new Map() }
      this.rooms.set(code, room)
    }
    return room
  }

  removeIfEmpty(code: string): void {
    const room = this.rooms.get(code)
    if (room && room.relays.size === 0 && room.clients.size === 0 && room.pushSubscriptions.size === 0) {
      this.rooms.delete(code)
    }
  }

  get size(): number {
    return this.rooms.size
  }
}
