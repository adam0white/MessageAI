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

	// Don't insert preview messages (they have ID starting with "preview_")
	// Only insert real messages that were fetched from the DO
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
	db: SQLite.SQLiteDatabase,
	currentUserId?: string
): Promise<ConversationPreview[]> {
	// If currentUserId is provided, only get conversations where user is a participant
	let query = `SELECT c.* FROM conversations c`;
	const params: any[] = [];
	
	if (currentUserId) {
		// IMPORTANT: currentUserId might be Clerk ID, but conversation_participants stores database IDs
		// First, try to get the database ID from the users table
		const user = await db.getFirstAsync<{ id: string }>(
			'SELECT id FROM users WHERE clerk_id = ? OR id = ?',
			[currentUserId, currentUserId]
		);
		const dbUserId = user?.id || currentUserId;
		
		query += `
			INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
			WHERE cp.user_id = ?`;
		params.push(dbUserId);
	}
	
	query += ` ORDER BY c.last_message_at DESC NULLS LAST`;
	
	const conversations = await db.getAllAsync<DBConversation>(query, params);

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
	// CRITICAL: Ensure sender exists as user first to prevent FK errors
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

	// CRITICAL: Ensure conversation exists to prevent FK errors
	const existingConv = await db.getFirstAsync(
		'SELECT 1 FROM conversations WHERE id = ?',
		[message.conversationId]
	);
	if (!existingConv) {
		// Create placeholder conversation - will be updated when conversation list refreshes
		await db.runAsync(
			`INSERT OR IGNORE INTO conversations (id, type, created_at, updated_at)
			VALUES (?, ?, ?, ?)`,
			[
				message.conversationId,
				'direct', // Placeholder type
				new Date().toISOString(),
				new Date().toISOString()
			]
		);
	}

	await db.runAsync(
		`INSERT INTO messages (
			id, conversation_id, sender_id, content, type, status,
			media_url, media_type, media_size, link_preview, created_at, updated_at,
			client_id, local_only
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			message.linkPreview ? JSON.stringify(message.linkPreview) : null,
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

	// Save reactions if they exist
	if (message.reactions) {
		for (const [emoji, userIds] of Object.entries(message.reactions)) {
			for (const userId of userIds) {
				await db.runAsync(
					`INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji, created_at)
					VALUES (?, ?, ?, ?)`,
					[message.id, userId, emoji, message.createdAt]
				);
			}
		}
	}
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
	// Use UPSERT to avoid UNIQUE constraint errors in case message already exists with server ID
	// This can happen if new_message arrives before message_status
	const message = await db.getFirstAsync<DBMessage>(
		'SELECT * FROM messages WHERE client_id = ?',
		[clientId]
	);
	
	if (!message) return; // Message not found, nothing to update
	
	// Delete old message if ID is changing
	if (message.id !== updates.id) {
		await db.runAsync('DELETE FROM messages WHERE id = ?', [message.id]);
	}
	
	// Insert with new ID (or update if ID unchanged)
	await db.runAsync(
		`INSERT OR REPLACE INTO messages (
			id, conversation_id, sender_id, content, type, status,
			media_url, media_type, media_size, link_preview, created_at, updated_at,
			client_id, local_only
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			updates.id,
			message.conversation_id,
			message.sender_id,
			message.content,
			message.type,
			updates.status,
			message.media_url,
			message.media_type,
			message.media_size,
			message.link_preview,
			message.created_at,
			new Date().toISOString(),
			clientId,
			0 // local_only = false
		]
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
	const messages = results.map(dbMessageToMessage).reverse(); // Reverse to get chronological order

	// Load reactions for all messages
	if (messages.length > 0) {
		const messageIds = messages.map(m => m.id);
		const reactionsByMessage: Record<string, Record<string, string[]>> = {};

		// Batch reactions query to avoid SQLite variable limit
		const BATCH_SIZE = 100;
		for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
			const batch = messageIds.slice(i, i + BATCH_SIZE);
			const placeholders = batch.map(() => '?').join(',');

			const reactionRows = await db.getAllAsync<{
				message_id: string;
				user_id: string;
				emoji: string;
			}>(
				`SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`,
				batch
			);

			// Group reactions by message ID and emoji
			for (const row of reactionRows) {
				if (!reactionsByMessage[row.message_id]) {
					reactionsByMessage[row.message_id] = {};
				}
				if (!reactionsByMessage[row.message_id][row.emoji]) {
					reactionsByMessage[row.message_id][row.emoji] = [];
				}
				reactionsByMessage[row.message_id][row.emoji].push(row.user_id);
			}
		}

		// Attach reactions to messages
		messages.forEach(msg => {
			if (reactionsByMessage[msg.id]) {
				(msg as any).reactions = reactionsByMessage[msg.id];
			}
		});
	}

	return messages;
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
	// CASCADE will handle deleting reactions automatically due to foreign key constraint
	await db.runAsync('DELETE FROM messages WHERE id = ?', [messageId]);
}

export async function deleteConversation(
	db: SQLite.SQLiteDatabase,
	conversationId: string
): Promise<void> {
	// CASCADE will handle deleting messages and participants
	await db.runAsync('DELETE FROM conversations WHERE id = ?', [conversationId]);
}

// ============================================================================
// Reaction Queries
// ============================================================================

/**
 * Add a reaction to a message in local database
 */
export async function addReaction(
	db: SQLite.SQLiteDatabase,
	messageId: string,
	userId: string,
	emoji: string
): Promise<void> {
	await db.runAsync(
		`INSERT OR REPLACE INTO message_reactions (message_id, user_id, emoji, created_at)
		VALUES (?, ?, ?, ?)`,
		[messageId, userId, emoji, new Date().toISOString()]
	);
}

/**
 * Remove a reaction from a message in local database
 */
export async function removeReaction(
	db: SQLite.SQLiteDatabase,
	messageId: string,
	userId: string,
	emoji: string
): Promise<void> {
	await db.runAsync(
		'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
		[messageId, userId, emoji]
	);
}

/**
 * Get all reactions for messages in a conversation
 */
export async function getReactionsByMessageIds(
	db: SQLite.SQLiteDatabase,
	messageIds: string[]
): Promise<Record<string, Record<string, string[]>>> {
	if (messageIds.length === 0) {
		return {};
	}

	const placeholders = messageIds.map(() => '?').join(',');
	const reactionRows = await db.getAllAsync<{
		message_id: string;
		user_id: string;
		emoji: string;
	}>(
		`SELECT message_id, user_id, emoji FROM message_reactions WHERE message_id IN (${placeholders})`,
		messageIds
	);

	const reactionsByMessage: Record<string, Record<string, string[]>> = {};

	// Group reactions by message ID and emoji
	for (const row of reactionRows) {
		if (!reactionsByMessage[row.message_id]) {
			reactionsByMessage[row.message_id] = {};
		}
		if (!reactionsByMessage[row.message_id][row.emoji]) {
			reactionsByMessage[row.message_id][row.emoji] = [];
		}
		reactionsByMessage[row.message_id][row.emoji].push(row.user_id);
	}

	return reactionsByMessage;
}

// ============================================================================
// Database Cleanup Functions
// ============================================================================

/**
 * Clear all user data from local database (call on logout)
 */
export async function clearAllData(db: SQLite.SQLiteDatabase): Promise<void> {
	console.log('🗑️ Clearing all local database data...');
	
	// Ensure all tables exist before deleting (handle old schema versions)
	try {
		await db.execAsync(`
			CREATE TABLE IF NOT EXISTS user_presence (
				user_id TEXT PRIMARY KEY,
				status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'away')),
				last_seen_at TEXT NOT NULL
			);
		`);
	} catch (error) {
		console.log('Note: user_presence table creation skipped');
	}
	
	// Delete in reverse order of foreign key dependencies
	await db.runAsync('DELETE FROM user_presence');
	await db.runAsync('DELETE FROM read_receipts');
	await db.runAsync('DELETE FROM message_reactions');
	await db.runAsync('DELETE FROM messages');
	await db.runAsync('DELETE FROM conversation_participants');
	await db.runAsync('DELETE FROM conversations');
	await db.runAsync('DELETE FROM users');
	
	console.log('✅ Local database cleared');
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
		linkPreview: db.link_preview ? JSON.parse(db.link_preview) : undefined,
		clientId: db.client_id || undefined,
		localOnly: db.local_only === 1
	};
}

