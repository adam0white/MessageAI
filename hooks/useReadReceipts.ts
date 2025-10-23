/**
 * useReadReceipts Hook
 * 
 * Manages read receipts for messages
 */

import { useState, useEffect, useCallback } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import type { ServerMessage } from '../lib/api/types';
import { wsClient } from '../lib/api/websocket';
import { useAuthStore } from '../lib/stores/auth';

export interface ReadReceiptInfo {
	messageId: string;
	userId: string;
	readAt: string;
	userName?: string;
}

/**
 * Hook for tracking read receipts for messages in a conversation
 */
export function useReadReceipts(conversationId: string) {
	const [readReceipts, setReadReceipts] = useState<Map<string, ReadReceiptInfo[]>>(new Map());
	const db = useSQLiteContext();

	useEffect(() => {
		// Load existing read receipts from database
		loadReadReceipts();

		// Listen for new read receipt events
		const unsubscribe = wsClient.onMessage((message: ServerMessage) => {
			if (message.type === 'message_read') {
				setReadReceipts(prev => {
					const newMap = new Map(prev);
					const existing = newMap.get(message.messageId) || [];
					
					// Check if this user already has a read receipt for this message
					if (!existing.some(r => r.userId === message.userId)) {
						newMap.set(message.messageId, [
							...existing,
							{
								messageId: message.messageId,
								userId: message.userId,
								readAt: message.readAt,
							}
						]);
					}
					
					return newMap;
				});

				// Persist to database
				saveReadReceipt(db, message.messageId, message.userId, message.readAt)
					.catch(err => console.error('Failed to save read receipt:', err));
			}
		});

		return () => {
			unsubscribe();
		};
	}, [conversationId, db]);

	const loadReadReceipts = async () => {
		try {
			const receipts = await getReadReceiptsFromDB(db, conversationId);
			const receiptMap = new Map<string, ReadReceiptInfo[]>();
			
			receipts.forEach(receipt => {
				const existing = receiptMap.get(receipt.messageId) || [];
				receiptMap.set(receipt.messageId, [...existing, receipt]);
			});
			
			setReadReceipts(receiptMap);
		} catch (error) {
			console.error('Failed to load read receipts:', error);
		}
	};

	const markAsRead = useCallback((messageId: string) => {
		const { userId } = useAuthStore.getState();
		if (!userId) return;

		// Send mark_read message to server
		wsClient.send({
			type: 'mark_read',
			messageId,
			userId,
		});
	}, []);

	return {
		getReadReceipts: (messageId: string) => readReceipts.get(messageId) || [],
		getReadCount: (messageId: string) => readReceipts.get(messageId)?.length || 0,
		isReadBy: (messageId: string, userId: string) => {
			const receipts = readReceipts.get(messageId) || [];
			return receipts.some(r => r.userId === userId);
		},
		markAsRead,
	};
}

/**
 * Save read receipt to local database
 */
async function saveReadReceipt(
	db: any,
	messageId: string,
	userId: string,
	readAt: string
): Promise<void> {
	await db.runAsync(
		`INSERT OR IGNORE INTO read_receipts (message_id, user_id, read_at)
		VALUES (?, ?, ?)`,
		[messageId, userId, readAt]
	);
}

/**
 * Get read receipts from local database for a conversation
 */
async function getReadReceiptsFromDB(
	db: any,
	conversationId: string
): Promise<ReadReceiptInfo[]> {
	const results = await db.getAllAsync(
		`SELECT rr.message_id, rr.user_id, rr.read_at
		FROM read_receipts rr
		INNER JOIN messages m ON rr.message_id = m.id
		WHERE m.conversation_id = ?`,
		[conversationId]
	) as Array<{
		message_id: string;
		user_id: string;
		read_at: string;
	}>;

	return results.map((r: { message_id: string; user_id: string; read_at: string }) => ({
		messageId: r.message_id,
		userId: r.user_id,
		readAt: r.read_at,
	}));
}

