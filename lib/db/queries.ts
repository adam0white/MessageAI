/**
 * SQLite Database Query Helpers
 * 
 * Type-safe query functions for all database operations
 */

import * as SQLite from 'expo-sqlite';
import type { 
	Message, 
	Conversation, 
	User, 
	ReadReceipt,
	DBMessage,
	DBConversation,
	DBUser,
	DBReadReceipt,
	DBConversationParticipant,
	ConversationPreview
} from '../api/types';

// ============================================================================
// User Queries
// ============================================================================

export async function upsertUser(
	db: SQLite.SQLiteDatabase,
	user: User
): Promise<void> {
	await db.runAsync(
		`INSERT INTO users (id, clerk_id, email, name, avatar_url, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			email = excluded.email,
			name = excluded.name,
			avatar_url = excluded.avatar_url,
			updated_at = excluded.updated_at`,
		[user.id, user.clerkId, user.email, user.name || null, user.avatarUrl || null, user.createdAt, user.updatedAt]
	);
}

export async function getUserById(
	db: SQLite.SQLiteDatabase,
	userId: string
): Promise<User | null> {
	const result = await db.getFirstAsync<DBUser>(
		'SELECT * FROM users WHERE id = ?',
		[userId]
	);

	if (!result) return null;

	return dbUserToUser(result);
}

export async function getUsersByIds(
	db: SQLite.SQLiteDatabase,
	userIds: string[]
): Promise<User[]> {
	if (userIds.length === 0) return [];

	const placeholders = userIds.map(() => '?').join(',');
	const results = await db.getAllAsync<DBUser>(
		`SELECT * FROM users WHERE id IN (${placeholders})`,
		userIds
	);

	return results.map(dbUserToUser);
}

// ============================================================================
// Conversation Queries
// ============================================================================

export async function upsertConversation(
	db: SQLite.SQLiteDatabase,
	conversation: Conversation
): Promise<void> {
	// CRITICAL: Ensure all participants exist as users first to prevent foreign key errors
	for (const participant of conversation.participants) {
		// Check if user exists
		const existingUser = await getUserById(db, participant.userId);
		if (!existingUser) {
			// Create placeholder user - will be updated when that user signs in
			await db.runAsync(
				`INSERT OR IGNORE INTO users (id, clerk_id, email, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?)`,
				[
					participant.userId,
					participant.userId,
					`${participant.userId}@placeholder.local`,
					new Date().toISOString(),
					new Date().toISOString()
				]
			);
		}
	}

	await db.runAsync(
		`INSERT INTO conversations (id, type, name, created_at, updated_at, last_message_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			updated_at = excluded.updated_at,
			last_message_at = excluded.last_message_at`,
		[
			conversation.id,
			conversation.type,
			conversation.name || null,
			conversation.createdAt,
			conversation.updatedAt,
			conversation.lastMessageAt || null
		]
	);

	// Insert participants
	for (const participant of conversation.participants) {
		await db.runAsync(
			`INSERT INTO conversation_participants (conversation_id, user_id, joined_at, role)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(conversation_id, user_id) DO UPDATE SET
				role = excluded.role`,
			[conversation.id, participant.userId, participant.joinedAt, participant.role]
		);
	}
}

export async function getConversationById(
	db: SQLite.SQLiteDatabase,
	conversationId: string
): Promise<Conversation | null> {
	const conv = await db.getFirstAsync<DBConversation>(
		'SELECT * FROM conversations WHERE id = ?',
		[conversationId]
	);

	if (!conv) return null;

	const participants = await db.getAllAsync<DBConversationParticipant>(
		'SELECT * FROM conversation_participants WHERE conversation_id = ?',
		[conversationId]
	);

	return dbConversationToConversation(conv, participants);
}

export async function getConversationPreviews(
	db: SQLite.SQLiteDatabase
): Promise<ConversationPreview[]> {
	const conversations = await db.getAllAsync<DBConversation>(
		`SELECT * FROM conversations 
		ORDER BY last_message_at DESC NULLS LAST`
	);

	const previews: ConversationPreview[] = [];

	for (const conv of conversations) {
		// Get participants
		const participants = await db.getAllAsync<DBConversationParticipant & { name: string | null; avatar_url: string | null }>(
			`SELECT cp.*, u.name, u.avatar_url
			FROM conversation_participants cp
			LEFT JOIN users u ON cp.user_id = u.id
			WHERE cp.conversation_id = ?`,
			[conv.id]
		);

		// Get last message
		const lastMessage = await db.getFirstAsync<DBMessage>(
			`SELECT * FROM messages 
			WHERE conversation_id = ? 
			ORDER BY created_at DESC 
			LIMIT 1`,
			[conv.id]
		);

		previews.push({
			id: conv.id,
			type: conv.type as 'direct' | 'group',
			name: conv.name || undefined,
			lastMessage: lastMessage ? {
				content: lastMessage.content,
				senderId: lastMessage.sender_id,
				createdAt: lastMessage.created_at
			} : undefined,
			unreadCount: conv.unread_count || 0,
			participants: participants.map(p => ({
				id: p.user_id,
				name: p.name || undefined,
				avatarUrl: p.avatar_url || undefined
			}))
		});
	}

	return previews;
}

export async function incrementUnreadCount(
	db: SQLite.SQLiteDatabase,
	conversationId: string
): Promise<void> {
	await db.runAsync(
		'UPDATE conversations SET unread_count = unread_count + 1 WHERE id = ?',
		[conversationId]
	);
}

export async function resetUnreadCount(
	db: SQLite.SQLiteDatabase,
	conversationId: string
): Promise<void> {
	await db.runAsync(
		'UPDATE conversations SET unread_count = 0 WHERE id = ?',
		[conversationId]
	);
}

// ============================================================================
// Message Queries
// ============================================================================

export async function insertMessage(
	db: SQLite.SQLiteDatabase,
	message: Message
): Promise<void> {
	// CRITICAL: Ensure sender exists as user first to prevent foreign key errors
	const existingUser = await getUserById(db, message.senderId);
	if (!existingUser) {
		await db.runAsync(
			`INSERT OR IGNORE INTO users (id, clerk_id, email, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)`,
			[
				message.senderId,
				message.senderId,
				`${message.senderId}@placeholder.local`,
				new Date().toISOString(),
				new Date().toISOString()
			]
		);
	}

	await db.runAsync(
		`INSERT INTO messages (
			id, conversation_id, sender_id, content, type, status,
			media_url, media_type, media_size, created_at, updated_at,
			client_id, local_only
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
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
			message.updatedAt,
			message.clientId || null,
			message.localOnly ? 1 : 0
		]
	);

	// Update conversation's last_message_at
	await db.runAsync(
		`UPDATE conversations 
		SET last_message_at = ?, updated_at = ?
		WHERE id = ?`,
		[message.createdAt, message.updatedAt, message.conversationId]
	);
}

export async function updateMessageStatus(
	db: SQLite.SQLiteDatabase,
	messageId: string,
	status: Message['status']
): Promise<void> {
	await db.runAsync(
		'UPDATE messages SET status = ?, updated_at = ? WHERE id = ?',
		[status, new Date().toISOString(), messageId]
	);
}

export async function updateMessageByClientId(
	db: SQLite.SQLiteDatabase,
	clientId: string,
	updates: { id: string; status: Message['status'] }
): Promise<void> {
	await db.runAsync(
		'UPDATE messages SET id = ?, status = ?, local_only = 0, updated_at = ? WHERE client_id = ?',
		[updates.id, updates.status, new Date().toISOString(), clientId]
	);
}

export async function getMessagesByConversation(
	db: SQLite.SQLiteDatabase,
	conversationId: string,
	limit: number = 50,
	before?: string
): Promise<Message[]> {
	let query = `
		SELECT * FROM messages 
		WHERE conversation_id = ?
	`;
	const params: any[] = [conversationId];

	if (before) {
		query += ' AND created_at < (SELECT created_at FROM messages WHERE id = ?)';
		params.push(before);
	}

	query += ' ORDER BY created_at DESC LIMIT ?';
	params.push(limit);

	const results = await db.getAllAsync<DBMessage>(query, params);
	return results.map(dbMessageToMessage).reverse(); // Reverse to get chronological order
}

export async function getLocalOnlyMessages(
	db: SQLite.SQLiteDatabase
): Promise<Message[]> {
	const results = await db.getAllAsync<DBMessage>(
		'SELECT * FROM messages WHERE local_only = 1 ORDER BY created_at ASC'
	);
	return results.map(dbMessageToMessage);
}

export async function deleteMessage(
	db: SQLite.SQLiteDatabase,
	messageId: string
): Promise<void> {
	await db.runAsync('DELETE FROM messages WHERE id = ?', [messageId]);
}

// ============================================================================
// Read Receipt Queries
// ============================================================================

export async function insertReadReceipt(
	db: SQLite.SQLiteDatabase,
	receipt: ReadReceipt
): Promise<void> {
	await db.runAsync(
		`INSERT INTO read_receipts (message_id, user_id, read_at)
		VALUES (?, ?, ?)
		ON CONFLICT(message_id, user_id) DO UPDATE SET
			read_at = excluded.read_at`,
		[receipt.messageId, receipt.userId, receipt.readAt]
	);
}

export async function getReadReceiptsByMessage(
	db: SQLite.SQLiteDatabase,
	messageId: string
): Promise<ReadReceipt[]> {
	const results = await db.getAllAsync<DBReadReceipt>(
		'SELECT * FROM read_receipts WHERE message_id = ?',
		[messageId]
	);

	return results.map(r => ({
		messageId: r.message_id,
		userId: r.user_id,
		readAt: r.read_at
	}));
}

// ============================================================================
// Helper Functions: DB to App Types
// ============================================================================

function dbUserToUser(db: DBUser): User {
	return {
		id: db.id,
		clerkId: db.clerk_id,
		email: db.email,
		name: db.name || undefined,
		avatarUrl: db.avatar_url || undefined,
		createdAt: db.created_at,
		updatedAt: db.updated_at
	};
}

function dbConversationToConversation(
	db: DBConversation,
	participants: DBConversationParticipant[]
): Conversation {
	return {
		id: db.id,
		type: db.type as 'direct' | 'group',
		name: db.name || undefined,
		createdAt: db.created_at,
		updatedAt: db.updated_at,
		lastMessageAt: db.last_message_at || undefined,
		participants: participants.map(p => ({
			conversationId: p.conversation_id,
			userId: p.user_id,
			joinedAt: p.joined_at,
			role: p.role as 'admin' | 'member'
		}))
	};
}

function dbMessageToMessage(db: DBMessage): Message {
	return {
		id: db.id,
		conversationId: db.conversation_id,
		senderId: db.sender_id,
		content: db.content,
		type: db.type as 'text' | 'image' | 'file',
		status: db.status as Message['status'],
		createdAt: db.created_at,
		updatedAt: db.updated_at,
		mediaUrl: db.media_url || undefined,
		mediaType: db.media_type || undefined,
		mediaSize: db.media_size || undefined,
		clientId: db.client_id || undefined,
		localOnly: db.local_only === 1
	};
}

