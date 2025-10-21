/**
 * SQLite Database Schema for MessageAI
 * 
 * Local-first database for offline support and instant UI updates.
 * This is the source of truth for the UI.
 */

import * as SQLite from 'expo-sqlite';

export const DB_NAME = 'messageai.db';
export const DB_VERSION = 1;

/**
 * Initialize the database and create tables
 */
export async function initializeDatabase(): Promise<SQLite.SQLiteDatabase> {
	const db = await SQLite.openDatabaseAsync(DB_NAME);

	// Enable foreign keys
	await db.execAsync('PRAGMA foreign_keys = ON;');

	// Create tables
	await createTables(db);

	return db;
}

/**
 * Create all database tables
 */
async function createTables(db: SQLite.SQLiteDatabase): Promise<void> {
	await db.execAsync(`
		-- Users table (synced from backend)
		CREATE TABLE IF NOT EXISTS users (
			id TEXT PRIMARY KEY,
			clerk_id TEXT NOT NULL UNIQUE,
			email TEXT NOT NULL,
			name TEXT,
			avatar_url TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);

		CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);
		CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

		-- Conversations table
		CREATE TABLE IF NOT EXISTS conversations (
			id TEXT PRIMARY KEY,
			type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
			name TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			last_message_at TEXT,
			unread_count INTEGER DEFAULT 0
		);

		CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at 
			ON conversations(last_message_at DESC);

		-- Conversation participants (junction table)
		CREATE TABLE IF NOT EXISTS conversation_participants (
			conversation_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			joined_at TEXT NOT NULL,
			role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
			PRIMARY KEY (conversation_id, user_id),
			FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_participants_conversation 
			ON conversation_participants(conversation_id);
		CREATE INDEX IF NOT EXISTS idx_participants_user 
			ON conversation_participants(user_id);

		-- Messages table
		CREATE TABLE IF NOT EXISTS messages (
			id TEXT PRIMARY KEY,
			conversation_id TEXT NOT NULL,
			sender_id TEXT NOT NULL,
			content TEXT NOT NULL,
			type TEXT NOT NULL CHECK(type IN ('text', 'image', 'file')),
			status TEXT NOT NULL CHECK(status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
			media_url TEXT,
			media_type TEXT,
			media_size INTEGER,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			client_id TEXT,
			local_only INTEGER DEFAULT 0,
			FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
			FOREIGN KEY (sender_id) REFERENCES users(id)
		);

		CREATE INDEX IF NOT EXISTS idx_messages_conversation 
			ON messages(conversation_id, created_at DESC);
		CREATE INDEX IF NOT EXISTS idx_messages_sender 
			ON messages(sender_id);
		CREATE INDEX IF NOT EXISTS idx_messages_client_id 
			ON messages(client_id) WHERE client_id IS NOT NULL;
		CREATE INDEX IF NOT EXISTS idx_messages_local_only 
			ON messages(local_only) WHERE local_only = 1;

		-- Read receipts table
		CREATE TABLE IF NOT EXISTS read_receipts (
			message_id TEXT NOT NULL,
			user_id TEXT NOT NULL,
			read_at TEXT NOT NULL,
			PRIMARY KEY (message_id, user_id),
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_read_receipts_message 
			ON read_receipts(message_id);
		CREATE INDEX IF NOT EXISTS idx_read_receipts_user 
			ON read_receipts(user_id);

		-- User presence (volatile, cleared on app restart)
		CREATE TABLE IF NOT EXISTS user_presence (
			user_id TEXT PRIMARY KEY,
			status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'away')),
			last_seen_at TEXT NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		);

		CREATE INDEX IF NOT EXISTS idx_presence_status 
			ON user_presence(status);
	`);
}

/**
 * Drop all tables (for development/testing)
 */
export async function dropAllTables(db: SQLite.SQLiteDatabase): Promise<void> {
	await db.execAsync(`
		DROP TABLE IF EXISTS user_presence;
		DROP TABLE IF EXISTS read_receipts;
		DROP TABLE IF EXISTS messages;
		DROP TABLE IF EXISTS conversation_participants;
		DROP TABLE IF EXISTS conversations;
		DROP TABLE IF EXISTS users;
	`);
}

/**
 * Clear all data but keep tables (for testing)
 */
export async function clearAllData(db: SQLite.SQLiteDatabase): Promise<void> {
	await db.execAsync(`
		DELETE FROM user_presence;
		DELETE FROM read_receipts;
		DELETE FROM messages;
		DELETE FROM conversation_participants;
		DELETE FROM conversations;
		DELETE FROM users;
	`);
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(db: SQLite.SQLiteDatabase): Promise<{
	users: number;
	conversations: number;
	messages: number;
	readReceipts: number;
}> {
	const result = await db.getAllAsync<{ 
		users: number; 
		conversations: number; 
		messages: number; 
		readReceipts: number;
	}>(`
		SELECT 
			(SELECT COUNT(*) FROM users) as users,
			(SELECT COUNT(*) FROM conversations) as conversations,
			(SELECT COUNT(*) FROM messages) as messages,
			(SELECT COUNT(*) FROM read_receipts) as readReceipts
	`);

	return result[0] || { users: 0, conversations: 0, messages: 0, readReceipts: 0 };
}

