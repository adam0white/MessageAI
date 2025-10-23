/**
 * usePresence Hook
 * 
 * Manages user presence tracking (online/offline status)
 */

import { useState, useEffect } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import type { ServerMessage } from '../lib/api/types';
import { wsClient } from '../lib/api/websocket';

/**
 * Hook for tracking online users in a conversation
 */
export function usePresence(conversationId: string) {
	const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
	const db = useSQLiteContext();

	useEffect(() => {
		// Reset presence state when conversation changes
		setOnlineUserIds(new Set());
		
		// Handle all WebSocket messages
		const unsubscribeMessage = wsClient.onMessage((message: ServerMessage) => {
			// Handle initial connection - receive list of already online users
			if (message.type === 'connected' && message.onlineUserIds) {
				setOnlineUserIds(new Set(message.onlineUserIds));
			}
			
			// Handle presence updates
			if (message.type === 'presence_update') {
				setOnlineUserIds(prev => {
					const newSet = new Set(prev);
					
					if (message.status === 'online') {
						newSet.add(message.userId);
					} else if (message.status === 'offline') {
						newSet.delete(message.userId);
					}
					
					return newSet;
				});

				// Optionally persist to SQLite for offline viewing
				updatePresenceInDB(db, message.userId, message.status, message.timestamp)
					.catch(err => console.error('Failed to update presence in DB:', err));
			}
		});
		
		// Reset presence on disconnect
		const unsubscribeDisconnect = wsClient.onDisconnected(() => {
			setOnlineUserIds(new Set());
		});

		// Clean up on unmount
		return () => {
			unsubscribeMessage();
			unsubscribeDisconnect();
		};
	}, [conversationId, db]);

	return {
		onlineUserIds: Array.from(onlineUserIds),
		isUserOnline: (userId: string) => onlineUserIds.has(userId),
		onlineCount: onlineUserIds.size,
	};
}

/**
 * Update presence status in local SQLite database
 */
async function updatePresenceInDB(
	db: any,
	userId: string,
	status: 'online' | 'offline' | 'away',
	lastSeenAt: string
): Promise<void> {
	try {
		// Ensure table exists (for old database schemas)
		await db.execAsync(`
			CREATE TABLE IF NOT EXISTS user_presence (
				user_id TEXT PRIMARY KEY,
				status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'away')),
				last_seen_at TEXT NOT NULL
			);
		`);
		
		await db.runAsync(
			`INSERT INTO user_presence (user_id, status, last_seen_at)
			VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET
				status = excluded.status,
				last_seen_at = excluded.last_seen_at`,
			[userId, status, lastSeenAt]
		);
	} catch (error) {
		// Silently fail - presence is not critical
	}
}

/**
 * Get presence status from local database (for offline viewing)
 */
export async function getPresenceFromDB(
	db: any,
	userId: string
): Promise<{ status: 'online' | 'offline' | 'away'; lastSeenAt: string } | null> {
	const result = await db.getFirstAsync<{ status: string; last_seen_at: string }>(
		`SELECT status, last_seen_at FROM user_presence WHERE user_id = ?`,
		[userId]
	);

	if (!result) return null;

	return {
		status: result.status as 'online' | 'offline' | 'away',
		lastSeenAt: result.last_seen_at,
	};
}

