import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage } from '../types';

/**
 * Conversation Durable Object
 * 
 * Manages a single conversation room with:
 * - WebSocket connections for real-time messaging
 * - Message persistence in SQLite storage
 * - Presence tracking (online/offline status)
 * - Read receipts
 */
export class Conversation extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	/**
	 * Handle incoming HTTP requests (WebSocket upgrades and REST endpoints)
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// WebSocket upgrade for real-time connection
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketUpgrade(request);
		}

		// REST endpoints
		if (url.pathname === '/messages') {
			return this.handleGetMessages(request);
		}

		return new Response('Not found', { status: 404 });
	}

	/**
	 * Handle WebSocket upgrade and connection
	 * Uses WebSocket hibernation for memory efficiency
	 */
	private async handleWebSocketUpgrade(request: Request): Promise<Response> {
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Accept the WebSocket connection with hibernation support
		// This allows the DO to be evicted from memory during inactivity
		this.ctx.acceptWebSocket(server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	/**
	 * Handle WebSocket messages
	 */
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message === 'string') {
			// Parse and handle message
			try {
				const data: ClientMessage = JSON.parse(message);
				console.log('Received message:', data);
				
				// Echo back for now (will be implemented in later tasks)
				const response: ServerMessage = { 
					type: 'ack', 
					messageType: data.type,
					success: true 
				};
				ws.send(JSON.stringify(response));
			} catch (error) {
				console.error('Failed to parse message:', error);
				const errorResponse: ServerMessage = {
					type: 'error',
					code: 'PARSE_ERROR',
					message: 'Failed to parse message',
					details: error
				};
				ws.send(JSON.stringify(errorResponse));
			}
		}
	}

	/**
	 * Handle WebSocket close
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		console.log('WebSocket closed:', { code, reason, wasClean });
		ws.close(code, reason);
	}

	/**
	 * Handle WebSocket errors
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error('WebSocket error:', error);
	}

	/**
	 * Get message history (REST endpoint)
	 */
	private async handleGetMessages(request: Request): Promise<Response> {
		// Placeholder for message history retrieval
		return new Response(JSON.stringify({ messages: [] }), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

