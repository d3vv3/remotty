import type { WebSocket } from "ws"
import type { PushSubscription } from "web-push"

export type PushRegistration = {
  subscription: PushSubscription
  brokerUrl: string
}

export type Room = {
  relay?: WebSocket
  clients: Set<WebSocket>
  latestSnapshot?: string
  pushSubscriptions: Map<string, PushRegistration>
}

export class RelayRooms {
  private readonly rooms = new Map<string, Room>()

  get(code: string): Room {
    let room = this.rooms.get(code)
    if (!room) {
      room = { clients: new Set(), pushSubscriptions: new Map() }
      this.rooms.set(code, room)
    }
    return room
  }

  removeIfEmpty(code: string): void {
    const room = this.rooms.get(code)
    if (room && !room.relay && room.clients.size === 0 && room.pushSubscriptions.size === 0) {
      this.rooms.delete(code)
    }
  }

  get size(): number {
    return this.rooms.size
  }
}
