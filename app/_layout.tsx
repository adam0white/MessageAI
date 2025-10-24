/**
 * Root Layout
 * 
 * Sets up:
 * - Clerk authentication provider
 * - React Query for server state
 * - SQLite database provider
 * - Navigation structure
 */

import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-expo';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Slot } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { SQLiteProvider } from 'expo-sqlite';
import { View, Text, ActivityIndicator } from 'react-native';
import { DB_NAME } from '../lib/db/schema';
import { config } from '../lib/config';
import React from 'react';

// Create a client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: 2,
			staleTime: 1000 * 60 * 5, // 5 minutes
		},
	},
});

const CLERK_PUBLISHABLE_KEY = config.clerkPublishableKey;

/**
 * Token cache for Clerk using Expo Secure Store
 */
const tokenCache = {
	async getToken(key: string) {
		try {
			return await SecureStore.getItemAsync(key);
		} catch (error) {
			console.error('Error getting token:', error);
			return null;
		}
	},
	async saveToken(key: string, value: string) {
		try {
			return await SecureStore.setItemAsync(key, value);
		} catch (error) {
			console.error('Error saving token:', error);
		}
	},
};

export default function RootLayout() {
	if (!CLERK_PUBLISHABLE_KEY) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
				<Text style={{ fontSize: 16, color: 'red', textAlign: 'center' }}>
					Missing clerkPublishableKey in config.ts
				</Text>
				<Text style={{ fontSize: 14, color: '#666', marginTop: 10, textAlign: 'center' }}>
					Please add your Clerk publishable key to config.ts
				</Text>
			</View>
		);
	}

	return (
		<SQLiteProvider 
			databaseName={DB_NAME}
			onInit={migrateDbIfNeeded}
		>
			<ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={tokenCache}>
				<ClerkLoaded>
					<QueryClientProvider client={queryClient}>
						<Slot />
					</QueryClientProvider>
				</ClerkLoaded>
			</ClerkProvider>
		</SQLiteProvider>
	);
}

/**
 * Initialize database schema on first launch
 */
async function migrateDbIfNeeded(db: any) {
	try {
		// Enable foreign keys
		await db.execAsync('PRAGMA foreign_keys = ON;');

		// Create tables (using the schema from lib/db/schema.ts)
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

			-- Conversation participants
			CREATE TABLE IF NOT EXISTS conversation_participants (
				conversation_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				joined_at TEXT NOT NULL,
				role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
				PRIMARY KEY (conversation_id, user_id),
				FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_conversation_participants_user_id 
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

			CREATE INDEX IF NOT EXISTS idx_messages_conversation_id 
				ON messages(conversation_id, created_at DESC);
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

			CREATE INDEX IF NOT EXISTS idx_read_receipts_message_id 
				ON read_receipts(message_id);

			-- Presence table (for online/offline status)
			CREATE TABLE IF NOT EXISTS presence (
				user_id TEXT PRIMARY KEY,
				status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'away')),
				last_seen_at TEXT NOT NULL,
				FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
			);
		`);
	} catch (error) {
		console.error('Error initializing database:', error);
		throw error;
	}
}

