import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage, Message } from '../types';

/**
 * Session metadata for each connected WebSocket
 */
interface Session {
	webSocket: WebSocket;
	userId: string;
	conversationId: string;
	connectedAt: number;
}

/**
 * Database row for messages
 */
interface MessageRow {
	id: string;
	conversation_id: string;
	sender_id: string;
	content: string;
	type: string;
	status: string;
	media_url: string | null;
	media_type: string | null;
	media_size: number | null;
	created_at: string;
	updated_at: string;
}

/**
 * Database row for read receipts
 */
interface ReadReceiptRow {
	message_id: string;
	user_id: string;
	read_at: string;
}

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
	// In-memory connection tracking
	private sessions: Map<WebSocket, Session>;
	private sqlInitialized = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sessions = new Map();
		
		this.ctx.getWebSockets().forEach((ws) => {
			const meta = ws.deserializeAttachment();
			if (meta && typeof meta === 'object' && 'userId' in meta && 'conversationId' in meta) {
				this.sessions.set(ws, meta as Session);
			}
		});
		
		console.log(`DO initialized with ${this.sessions.size} connections`);
	}

	/**
	 * Initialize SQLite storage schema
	 */
	private async initializeSQL(): Promise<void> {
		if (this.sqlInitialized) return;

		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY,
				conversation_id TEXT NOT NULL,
				sender_id TEXT NOT NULL,
				content TEXT NOT NULL,
				type TEXT NOT NULL DEFAULT 'text',
				status TEXT NOT NULL DEFAULT 'sent',
				media_url TEXT,
				media_type TEXT,
				media_size INTEGER,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
			ON messages(conversation_id, created_at DESC)
		`);

		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS read_receipts (
				message_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				read_at TEXT NOT NULL,
				PRIMARY KEY (message_id, user_id)
			)
		`);

		this.sqlInitialized = true;
	}

	/**
	 * Handle incoming HTTP requests (WebSocket upgrades and REST endpoints)
	 */
	async fetch(request: Request): Promise<Response> {
		await this.initializeSQL();

		const url = new URL(request.url);

		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketUpgrade(request);
		}

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
		// Extract user authentication from URL query params
		const url = new URL(request.url);
		const userId = url.searchParams.get('userId');
		
		// Extract conversation ID from URL path
		const pathParts = url.pathname.split('/');
		const conversationId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

		if (!userId || !conversationId) {
			return new Response('Missing userId or conversationId', { status: 400 });
		}

		// Create WebSocket pair
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Create session metadata
		const session: Session = {
			webSocket: server,
			userId,
			conversationId,
			connectedAt: Date.now(),
		};

		// Accept the WebSocket connection with hibernation support
		this.ctx.acceptWebSocket(server);
		
		// Serialize session metadata to WebSocket for hibernation recovery
		// This allows the session to be restored after the DO wakes from hibernation
		server.serializeAttachment({
			userId,
			conversationId,
			connectedAt: session.connectedAt,
		});

		// Store session in memory map
		this.sessions.set(server, session);

		console.log(`User ${userId} connected to conversation ${conversationId}. Total connections: ${this.sessions.size}`);

		// Get list of currently connected users (before adding the new user)
		const onlineUserIds = this.getConnectedUserIds();

		// Send initial connection acknowledgment with online users list
		const welcomeMessage: ServerMessage = {
			type: 'connected',
			timestamp: new Date().toISOString(),
			onlineUserIds: onlineUserIds, // Send list of currently online users
		};
		server.send(JSON.stringify(welcomeMessage));

		// Broadcast presence update to all other participants (that user just came online)
		const presenceUpdate: ServerMessage = {
			type: 'presence_update',
			userId,
			status: 'online',
			timestamp: new Date().toISOString(),
		};
		this.broadcast(presenceUpdate, userId);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	/**
	 * Handle WebSocket messages
	 */
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		let session = this.sessions.get(ws);
		
		// If session not in map (after hibernation), recreate from serialized attachment
		if (!session) {
			const meta = ws.deserializeAttachment();
			
			if (meta && typeof meta === 'object' && 'userId' in meta && 'conversationId' in meta) {
				session = {
					webSocket: ws,
					userId: meta.userId as string,
					conversationId: meta.conversationId as string,
					connectedAt: (meta.connectedAt as number) || Date.now(),
				};
				this.sessions.set(ws, session);
				console.log(`Session recreated for user ${session.userId} after hibernation`);
			} else {
				console.error('Received message from unknown session and no metadata available');
				return;
			}
		}

		if (typeof message === 'string') {
			// Parse and handle message
			try {
				const data: ClientMessage = JSON.parse(message);
				
				// Handle different message types
				switch (data.type) {
					case 'send_message':
						await this.handleSendMessage(ws, session, data);
						break;
					
					case 'mark_read':
						await this.handleMarkRead(ws, session, data);
						break;
					
					case 'get_history':
						await this.handleGetHistory(ws, session, data);
						break;
					
					case 'typing':
						await this.handleTyping(ws, session, data);
						break;
					
					default:
						console.warn(`Unknown message type: ${(data as any).type}`);
						const errorResponse: ServerMessage = {
							type: 'error',
							code: 'UNKNOWN_MESSAGE_TYPE',
							message: `Unknown message type: ${(data as any).type}`,
						};
						ws.send(JSON.stringify(errorResponse));
				}
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
	 * Handle send_message request
	 */
	private async handleSendMessage(ws: WebSocket, session: Session, data: ClientMessage & { type: 'send_message' }): Promise<void> {
		try {
			// Generate server message ID
			const messageId = `msg_${Date.now()}_${crypto.randomUUID()}`;
			const now = new Date().toISOString();

			// Create message object
			const newMessage: Message = {
				id: messageId,
				conversationId: session.conversationId,
				senderId: session.userId,
				content: data.content,
				type: data.messageType,
				status: 'sent',
				mediaUrl: data.mediaUrl,
				createdAt: now,
				updatedAt: now,
			};

			// Save to SQLite storage
			await this.saveMessage(newMessage);

			// Send confirmation to sender
			const confirmationResponse: ServerMessage = {
				type: 'message_status',
				clientId: data.clientId,
				messageId,
				status: 'sent',
				serverTimestamp: now,
			};
			ws.send(JSON.stringify(confirmationResponse));

			// Broadcast to all other participants
			const broadcastMessage: ServerMessage = {
				type: 'new_message',
				message: newMessage,
			};
			const recipientsCount = this.broadcast(broadcastMessage, session.userId);
			
			// If message was successfully delivered to at least one recipient, mark as delivered
			if (recipientsCount > 0) {
				console.log(`✓ Message ${messageId} delivered to ${recipientsCount} recipient(s)`);
				const deliveredStatus: ServerMessage = {
					type: 'message_status',
					messageId,
					status: 'delivered',
					serverTimestamp: now,
				};
				ws.send(JSON.stringify(deliveredStatus));
			} else {
				console.log(`⚠️ Message ${messageId} not delivered (no connected recipients)`);
			}

		} catch (error) {
			console.error('Error handling send_message:', error);
			const errorResponse: ServerMessage = {
				type: 'error',
				code: 'SEND_MESSAGE_FAILED',
				message: 'Failed to send message',
				details: error,
			};
			ws.send(JSON.stringify(errorResponse));
		}
	}

	/**
	 * Handle mark_read request
	 */
	private async handleMarkRead(ws: WebSocket, session: Session, data: ClientMessage & { type: 'mark_read' }): Promise<void> {
		try {
			// Save read receipt
			await this.saveReadReceipt(data.messageId, data.userId);

			// Update message status to read
			await this.updateMessageStatus(data.messageId, 'read');

			// Broadcast read receipt to all participants
			const readEvent: ServerMessage = {
				type: 'message_read',
				messageId: data.messageId,
				userId: data.userId,
				readAt: new Date().toISOString(),
			};
			this.broadcast(readEvent);

			console.log(`Read receipt for message ${data.messageId} by user ${data.userId}`);
		} catch (error) {
			console.error('Error handling mark_read:', error);
		}
	}

	/**
	 * Handle get_history request
	 */
	private async handleGetHistory(ws: WebSocket, session: Session, data: ClientMessage & { type: 'get_history' }): Promise<void> {
		try {
			const messages = await this.getMessages(
				data.conversationId,
				data.limit || 50,
				data.before
			);

			const response: ServerMessage = {
				type: 'history_response',
				messages,
				hasMore: messages.length === (data.limit || 50),
			};
			ws.send(JSON.stringify(response));

			// Notify senders that their undelivered messages are now delivered
			// Find all messages in history that were sent by others but not yet marked as delivered
			const undeliveredToMe = messages.filter(msg => 
				msg.senderId !== session.userId && 
				msg.status === 'sent'
			);

			if (undeliveredToMe.length > 0) {
				console.log(`📬 Marking ${undeliveredToMe.length} messages as delivered to ${session.userId}`);
				
				// Send delivered status to all senders
				for (const msg of undeliveredToMe) {
					const deliveredNotification: ServerMessage = {
						type: 'message_status',
						messageId: msg.id,
						status: 'delivered',
						serverTimestamp: new Date().toISOString(),
					};
					
					// Broadcast to everyone (senders will update their UI)
					this.broadcast(deliveredNotification);
				}
			}
		} catch (error) {
			console.error('Error handling get_history:', error);
			const errorResponse: ServerMessage = {
				type: 'error',
				code: 'GET_HISTORY_FAILED',
				message: 'Failed to get message history',
				details: error,
			};
			ws.send(JSON.stringify(errorResponse));
		}
	}

	/**
	 * Handle typing indicator
	 */
	private async handleTyping(ws: WebSocket, session: Session, data: ClientMessage & { type: 'typing' }): Promise<void> {
		// Broadcast typing indicator to all participants except sender
		const typingEvent: ServerMessage = {
			type: 'typing',
			conversationId: data.conversationId,
			userId: data.userId,
			isTyping: data.isTyping,
		};
		this.broadcast(typingEvent, session.userId);
	}

	/**
	 * Handle WebSocket close
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		const session = this.sessions.get(ws);
		if (session) {
			console.log(`User ${session.userId} disconnected from conversation ${session.conversationId}. Code: ${code}, Reason: ${reason}`);
			
			// Broadcast offline status to remaining participants
			const presenceUpdate: ServerMessage = {
				type: 'presence_update',
				userId: session.userId,
				status: 'offline',
				timestamp: new Date().toISOString(),
			};
			this.broadcast(presenceUpdate);
			
			this.sessions.delete(ws);
			console.log(`Total connections remaining: ${this.sessions.size}`);
		}
		ws.close(code, reason);
	}

	/**
	 * Handle WebSocket errors
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		const session = this.sessions.get(ws);
		console.error(`WebSocket error for user ${session?.userId || 'unknown'}:`, error);
		
		// Clean up errored connection
		if (session) {
			this.sessions.delete(ws);
		}
	}

	/**
	 * Broadcast a message to all connected clients in this conversation
	 * Excludes the sender by default
	 * Returns the number of clients the message was successfully sent to
	 */
	private broadcast(message: ServerMessage, excludeUserId?: string): number {
		const serialized = JSON.stringify(message);
		let sentCount = 0;

		for (const [ws, session] of this.sessions.entries()) {
			// Skip sender if excludeUserId is provided
			if (excludeUserId && session.userId === excludeUserId) {
				continue;
			}

			try {
				ws.send(serialized);
				sentCount++;
			} catch (error) {
				console.error(`Failed to send to user ${session.userId}:`, error);
				// Remove broken connections
				this.sessions.delete(ws);
			}
		}

		console.log(`Broadcasted message to ${sentCount} clients`);
		return sentCount;
	}

	/**
	 * Get list of currently connected user IDs
	 */
	private getConnectedUserIds(): string[] {
		return Array.from(this.sessions.values()).map(session => session.userId);
	}

	/**
	 * Save a message to SQLite storage
	 */
	private async saveMessage(message: Message): Promise<void> {
		const stmt = await this.ctx.storage.sql.exec(`
			INSERT INTO messages (
				id, conversation_id, sender_id, content, type, status,
				media_url, media_type, media_size, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, 
			message.id,
			message.conversationId,
			message.senderId,
			message.content,
			message.type,
			message.status,
			message.mediaUrl || null,
			message.mediaType || null,
			message.mediaSize || null,
			message.createdAt,
			message.updatedAt
		);

	}

	/**
	 * Get messages from SQLite storage
	 */
	private async getMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
		let query = `
			SELECT * FROM messages 
			WHERE conversation_id = ?
		`;
		const params: (string | number)[] = [conversationId];

		if (before) {
			query += ` AND created_at < (SELECT created_at FROM messages WHERE id = ?)`;
			params.push(before);
		}

		query += ` ORDER BY created_at DESC LIMIT ?`;
		params.push(limit);

		const cursor = this.ctx.storage.sql.exec(query, ...params);
		const rows: MessageRow[] = await cursor.toArray() as unknown as MessageRow[];

		// Convert DB rows to Message objects
		const messages: Message[] = rows.map(row => ({
			id: row.id,
			conversationId: row.conversation_id,
			senderId: row.sender_id,
			content: row.content,
			type: row.type as 'text' | 'image' | 'file',
			status: row.status as Message['status'],
			mediaUrl: row.media_url || undefined,
			mediaType: row.media_type || undefined,
			mediaSize: row.media_size || undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));

		return messages.reverse(); // Return in chronological order
	}

	/**
	 * Update message status
	 */
	private async updateMessageStatus(messageId: string, status: Message['status']): Promise<void> {
		await this.ctx.storage.sql.exec(
			`UPDATE messages SET status = ?, updated_at = ? WHERE id = ?`,
			status,
			new Date().toISOString(),
			messageId
		);
	}

	/**
	 * Save a read receipt
	 */
	private async saveReadReceipt(messageId: string, userId: string): Promise<void> {
		const readAt = new Date().toISOString();
		
		await this.ctx.storage.sql.exec(`
			INSERT OR REPLACE INTO read_receipts (message_id, user_id, read_at)
			VALUES (?, ?, ?)
		`, messageId, userId, readAt);

	}

	/**
	 * Get read receipts for a message
	 */
	private async getReadReceipts(messageId: string): Promise<ReadReceiptRow[]> {
		const cursor = this.ctx.storage.sql.exec(
			`SELECT * FROM read_receipts WHERE message_id = ?`,
			messageId
		);
		return await cursor.toArray() as unknown as ReadReceiptRow[];
	}

	/**
	 * Get message history (REST endpoint)
	 */
	private async handleGetMessages(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const conversationId = url.searchParams.get('conversationId');
		const limitStr = url.searchParams.get('limit');
		const before = url.searchParams.get('before') || undefined;

		if (!conversationId) {
			return new Response('conversationId required', { status: 400 });
		}

		const limit = limitStr ? parseInt(limitStr, 10) : 50;
		const messages = await this.getMessages(conversationId, limit, before);

		return new Response(JSON.stringify({ 
			messages,
			hasMore: messages.length === limit,
		}), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

