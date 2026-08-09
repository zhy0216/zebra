import type { ServerWebSocket } from "bun";
import type { WsData } from "zebra";

// ---------------------------------------------------------------------------
// LiveFeed bridges HTTP and WebSocket: POST /topics/:id/posts publishes an
// event to every socket subscribed to that topic (opened via
// WS /topics/:id/live), so browsers get new posts in real time.
//
// It is registered on the container with injectValue(...) — the same instance
// is therefore available as a named route dependency ({ feed: LiveFeed }) and
// captured by the WebSocket handler at registration time.
// ---------------------------------------------------------------------------

export interface FeedEvent {
  type: "post_created";
  topicId: number;
  post: {
    id: number;
    author: string;
    content: string;
    createdAt: number;
  };
}

export class LiveFeed {
  private rooms = new Map<number, Set<ServerWebSocket<WsData>>>();

  subscribe(topicId: number, ws: ServerWebSocket<WsData>): void {
    let room = this.rooms.get(topicId);
    if (room === undefined) {
      room = new Set();
      this.rooms.set(topicId, room);
    }
    room.add(ws);
  }

  unsubscribe(topicId: number, ws: ServerWebSocket<WsData>): void {
    this.rooms.get(topicId)?.delete(ws);
  }

  /** Fan-out to every socket currently watching the topic. */
  publish(topicId: number, event: FeedEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.rooms.get(topicId) ?? []) {
      if (ws.readyState === 1) ws.send(payload);
    }
  }

  dispose(): void {
    this.rooms.clear();
  }
}
