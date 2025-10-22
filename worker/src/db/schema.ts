/**
 * D1 Database Schema and Query Helpers
 * 
 * Backend database for user profiles, conversation metadata, and push tokens.
 * Messages and read receipts are stored in Durable Object SQLite storage.
 */

import type { 
	User, 
	Conversation, 
	ConversationParticipant,
	DBUser,
	DBConversation,
	DBConversationParticipant 
} from '../types';

// ============================================================================
// User Queries
// ============================================================================

export async function createUser(
	db: D1Database,
	user: { clerkId: string; email: string; name?: string; avatarUrl?: string }
): Promise<User> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO users (id, clerk_id, email, name, avatar_url, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(id, user.clerkId, user.email, user.name || null, user.avatarUrl || null, now, now)
		.run();

	return {
		id,
		clerkId: user.clerkId,
		email: user.email,
		name: user.name,
		avatarUrl: user.avatarUrl,
		createdAt: now,
		updatedAt: now
	};
}

export async function updateUser(
	db: D1Database,
	clerkId: string,
	updates: { email?: string; name?: string; avatarUrl?: string }
): Promise<void> {
	const now = new Date().toISOString();

	await db
		.prepare(
			`UPDATE users 
			SET email = COALESCE(?, email),
				name = COALESCE(?, name),
				avatar_url = COALESCE(?, avatar_url),
				updated_at = ?
			WHERE clerk_id = ?`
		)
		.bind(updates.email || null, updates.name || null, updates.avatarUrl || null, now, clerkId)
		.run();
}

export async function getUserByClerkId(
	db: D1Database,
	clerkId: string
): Promise<User | null> {
	const result = await db
		.prepare('SELECT * FROM users WHERE clerk_id = ?')
		.bind(clerkId)
		.first<DBUser>();

	if (!result) return null;

	return dbUserToUser(result);
}

export async function getUserById(
	db: D1Database,
	userId: string
): Promise<User | null> {
	const result = await db
		.prepare('SELECT * FROM users WHERE id = ?')
		.bind(userId)
		.first<DBUser>();

	if (!result) return null;

	return dbUserToUser(result);
}

export async function getUsersByIds(
	db: D1Database,
	userIds: string[]
): Promise<User[]> {
	if (userIds.length === 0) return [];

	// D1 doesn't support IN clauses with prepared statements well
	// Use multiple ORs or batch queries
	const placeholders = userIds.map(() => '?').join(',');
	const result = await db
		.prepare(`SELECT * FROM users WHERE id IN (${placeholders})`)
		.bind(...userIds)
		.all<DBUser>();

	return (result.results || []).map(dbUserToUser);
}

// ============================================================================
// Conversation Queries
// ============================================================================

export async function createConversation(
	db: D1Database,
	conversation: {
		type: 'direct' | 'group';
		name?: string;
		participantIds: string[];
	}
): Promise<Conversation> {
	// Generate deterministic ID based on sorted participant IDs
	// This prevents creating duplicate conversations with same participants
	const sortedParticipants = [...conversation.participantIds].sort();
	const id = `conv_${sortedParticipants.join('_')}`;
	const now = new Date().toISOString();

	// Check if conversation already exists
	const existing = await getConversationById(db, id);
	if (existing) {
		console.log(`Conversation ${id} already exists, returning existing`);
		return existing;
	}

	// Ensure all participants exist in the users table
	// If they don't, create placeholder users (they'll be updated by Clerk webhook later)
	for (const participantId of conversation.participantIds) {
		const existingUser = await getUserById(db, participantId);
		if (!existingUser) {
			console.log(`User ${participantId} not found in D1, creating placeholder`);
			// Create a placeholder user - will be updated by Clerk webhook
			await db
				.prepare(
					`INSERT OR IGNORE INTO users (id, clerk_id, email, created_at, updated_at)
					VALUES (?, ?, ?, ?, ?)`
				)
				.bind(
					participantId,
					participantId, // Use same ID as clerk_id for now
					`${participantId}@placeholder.local`,
					now,
					now
				)
				.run();
		}
	}

	// Insert conversation
	await db
		.prepare(
			`INSERT INTO conversations (id, type, name, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?)`
		)
		.bind(id, conversation.type, conversation.name || null, now, now)
		.run();

	// Insert participants
	const participants: ConversationParticipant[] = [];
	for (let i = 0; i < conversation.participantIds.length; i++) {
		const userId = conversation.participantIds[i];
		const role = i === 0 ? 'admin' : 'member'; // First user is admin

		await db
			.prepare(
				`INSERT INTO conversation_participants (conversation_id, user_id, joined_at, role)
				VALUES (?, ?, ?, ?)`
			)
			.bind(id, userId, now, role)
			.run();

		participants.push({
			conversationId: id,
			userId,
			joinedAt: now,
			role
		});
	}

	return {
		id,
		type: conversation.type,
		name: conversation.name,
		createdAt: now,
		updatedAt: now,
		participants
	};
}

export async function getConversationById(
	db: D1Database,
	conversationId: string
): Promise<Conversation | null> {
	const conv = await db
		.prepare('SELECT * FROM conversations WHERE id = ?')
		.bind(conversationId)
		.first<DBConversation>();

	if (!conv) return null;

	const participantsResult = await db
		.prepare('SELECT * FROM conversation_participants WHERE conversation_id = ?')
		.bind(conversationId)
		.all<DBConversationParticipant>();

	const participants = (participantsResult.results || []).map(p => ({
		conversationId: p.conversation_id,
		userId: p.user_id,
		joinedAt: p.joined_at,
		role: p.role as 'admin' | 'member'
	}));

	return {
		id: conv.id,
		type: conv.type as 'direct' | 'group',
		name: conv.name || undefined,
		createdAt: conv.created_at,
		updatedAt: conv.updated_at,
		lastMessageAt: conv.last_message_at || undefined,
		participants
	};
}

export async function getConversationsByUserId(
	db: D1Database,
	userId: string
): Promise<Conversation[]> {
	const result = await db
		.prepare(
			`SELECT c.* FROM conversations c
			INNER JOIN conversation_participants cp ON c.id = cp.conversation_id
			WHERE cp.user_id = ?
			ORDER BY c.last_message_at DESC NULLS LAST`
		)
		.bind(userId)
		.all<DBConversation>();

	const conversations: Conversation[] = [];

	for (const conv of result.results || []) {
		const participantsResult = await db
			.prepare('SELECT * FROM conversation_participants WHERE conversation_id = ?')
			.bind(conv.id)
			.all<DBConversationParticipant>();

		const participants = (participantsResult.results || []).map(p => ({
			conversationId: p.conversation_id,
			userId: p.user_id,
			joinedAt: p.joined_at,
			role: p.role as 'admin' | 'member'
		}));

		conversations.push({
			id: conv.id,
			type: conv.type as 'direct' | 'group',
			name: conv.name || undefined,
			createdAt: conv.created_at,
			updatedAt: conv.updated_at,
			lastMessageAt: conv.last_message_at || undefined,
			participants
		});
	}

	return conversations;
}

// Alias for consistency with API naming
export const getConversations = getConversationsByUserId;

export async function updateConversationLastMessage(
	db: D1Database,
	conversationId: string,
	timestamp: string
): Promise<void> {
	await db
		.prepare(
			`UPDATE conversations 
			SET last_message_at = ?, updated_at = ?
			WHERE id = ?`
		)
		.bind(timestamp, new Date().toISOString(), conversationId)
		.run();
}

// ============================================================================
// Push Token Queries
// ============================================================================

export async function savePushToken(
	db: D1Database,
	userId: string,
	token: string,
	platform: 'ios' | 'android' | 'web'
): Promise<void> {
	const id = crypto.randomUUID();
	const now = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO push_tokens (id, user_id, token, platform, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(token) DO UPDATE SET
				user_id = excluded.user_id,
				updated_at = excluded.updated_at`
		)
		.bind(id, userId, token, platform, now, now)
		.run();
}

export async function getPushTokensByUserId(
	db: D1Database,
	userId: string
): Promise<Array<{ token: string; platform: string }>> {
	const result = await db
		.prepare('SELECT token, platform FROM push_tokens WHERE user_id = ?')
		.bind(userId)
		.all<{ token: string; platform: string }>();

	return result.results || [];
}

export async function deletePushToken(
	db: D1Database,
	token: string
): Promise<void> {
	await db
		.prepare('DELETE FROM push_tokens WHERE token = ?')
		.bind(token)
		.run();
}

// ============================================================================
// Helper Functions
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

