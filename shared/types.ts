/**
 * Shared TypeScript types for MessageAI
 * 
 * These types are used by both the Expo frontend and Cloudflare Worker backend
 * to ensure type-safe communication.
 */

// ============================================================================
// User Models
// ============================================================================

export interface User {
	id: string;
	clerkId: string;
	email: string;
	name?: string;
	avatarUrl?: string;
	createdAt: string;
	updatedAt: string;
}

export interface UserPresence {
	userId: string;
	status: 'online' | 'offline' | 'away';
	lastSeenAt: string;
}

// ============================================================================
// Message Models
// ============================================================================

export interface Message {
	id: string;
	conversationId: string;
	senderId: string;
	content: string;
	type: 'text' | 'image' | 'file';
	status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
	createdAt: string;
	updatedAt: string;
	
	// Optional fields for media messages (post-MVP)
	mediaUrl?: string;
	mediaType?: string;
	mediaSize?: number;
	
	// Client-side only fields (not persisted on server)
	clientId?: string; // For optimistic updates
	localOnly?: boolean; // For offline queue
}

export interface ReadReceipt {
	messageId: string;
	userId: string;
	readAt: string;
}

// ============================================================================
// Conversation Models
// ============================================================================

export interface Conversation {
	id: string;
	type: 'direct' | 'group';
	name?: string; // For group chats
	createdAt: string;
	updatedAt: string;
	lastMessageAt?: string;
	
	// Computed fields
	participants: ConversationParticipant[];
	lastMessage?: Message;
}

export interface ConversationParticipant {
	conversationId: string;
	userId: string;
	joinedAt: string;
	role: 'admin' | 'member';
	
	// Populated when fetched
	user?: User;
}

export interface ConversationPreview {
	id: string;
	type: 'direct' | 'group';
	name?: string;
	avatarUrl?: string;
	lastMessage?: {
		content: string;
		senderId: string;
		createdAt: string;
	};
	unreadCount: number;
	participants: Array<{
		id: string;
		name?: string;
		avatarUrl?: string;
	}>;
}

// ============================================================================
// WebSocket Message Protocol
// ============================================================================

/**
 * Client -> Server Messages
 */
export type ClientMessage =
	| SubscribeMessage
	| SendMessage
	| MarkReadMessage
	| GetHistoryMessage
	| TypingMessage;

export interface SubscribeMessage {
	type: 'subscribe';
	conversationId: string;
	userId: string;
	token: string; // Auth token
}

export interface SendMessage {
	type: 'send_message';
	clientId: string; // Client-generated ID for optimistic updates
	conversationId: string;
	content: string;
	messageType: 'text' | 'image' | 'file';
	mediaUrl?: string;
}

export interface MarkReadMessage {
	type: 'mark_read';
	messageId: string;
	userId: string;
}

export interface GetHistoryMessage {
	type: 'get_history';
	conversationId: string;
	limit?: number;
	before?: string; // Message ID for pagination
}

export interface TypingMessage {
	type: 'typing';
	conversationId: string;
	userId: string;
	isTyping: boolean;
}

/**
 * Server -> Client Messages
 */
export type ServerMessage =
	| ConnectedEvent
	| NewMessageEvent
	| MessageStatusEvent
	| MessageReadEvent
	| PresenceUpdateEvent
	| TypingEvent
	| HistoryResponseEvent
	| ErrorEvent
	| AckEvent;

export interface ConnectedEvent {
	type: 'connected';
	timestamp: string;
}

export interface NewMessageEvent {
	type: 'new_message';
	message: Message;
}

export interface MessageStatusEvent {
	type: 'message_status';
	clientId?: string; // Maps to optimistic message
	messageId: string;
	status: 'sent' | 'delivered' | 'failed';
	serverTimestamp: string;
}

export interface MessageReadEvent {
	type: 'message_read';
	messageId: string;
	userId: string;
	readAt: string;
}

export interface PresenceUpdateEvent {
	type: 'presence_update';
	userId: string;
	status: 'online' | 'offline' | 'away';
	timestamp: string;
}

export interface TypingEvent {
	type: 'typing';
	conversationId: string;
	userId: string;
	isTyping: boolean;
}

export interface HistoryResponseEvent {
	type: 'history_response';
	messages: Message[];
	hasMore: boolean;
	nextCursor?: string;
}

export interface ErrorEvent {
	type: 'error';
	code: string;
	message: string;
	details?: unknown;
}

export interface AckEvent {
	type: 'ack';
	messageType: string;
	success: boolean;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateConversationRequest {
	type: 'direct' | 'group';
	participantIds: string[];
	name?: string; // Required for group chats
}

export interface CreateConversationResponse {
	conversation: Conversation;
}

export interface GetConversationsResponse {
	conversations: ConversationPreview[];
}

export interface GetMessagesRequest {
	conversationId: string;
	limit?: number;
	before?: string; // Message ID for pagination
}

export interface GetMessagesResponse {
	messages: Message[];
	hasMore: boolean;
	nextCursor?: string;
}

// ============================================================================
// Database Schema Types (for SQLite and D1)
// ============================================================================

/**
 * SQLite (Frontend) and D1 (Backend) table schemas
 * These match the actual database structure
 */

export interface DBUser {
	id: string;
	clerk_id: string;
	email: string;
	name: string | null;
	avatar_url: string | null;
	created_at: string;
	updated_at: string;
}

export interface DBConversation {
	id: string;
	type: 'direct' | 'group';
	name: string | null;
	created_at: string;
	updated_at: string;
	last_message_at: string | null;
	unread_count: number;
}

export interface DBConversationParticipant {
	conversation_id: string;
	user_id: string;
	joined_at: string;
	role: 'admin' | 'member';
}

export interface DBMessage {
	id: string;
	conversation_id: string;
	sender_id: string;
	content: string;
	type: 'text' | 'image' | 'file';
	status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
	media_url: string | null;
	media_type: string | null;
	media_size: number | null;
	created_at: string;
	updated_at: string;
	client_id: string | null;
	local_only: number; // SQLite boolean (0 or 1)
}

export interface DBReadReceipt {
	message_id: string;
	user_id: string;
	read_at: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export type MessageStatus = Message['status'];
export type ConversationType = Conversation['type'];
export type UserStatus = UserPresence['status'];

/**
 * Helper to convert snake_case DB fields to camelCase
 */
export type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
	? `${Lowercase<P1>}${Uppercase<P2>}${CamelCase<P3>}`
	: Lowercase<S>;

