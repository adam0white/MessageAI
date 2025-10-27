/**
 * Deletion API
 * 
 * Handles message and conversation deletion with backend sync
 */

import { config } from '../config';

const API_BASE_URL = config.workerUrl;

/**
 * Delete a conversation (backend + local)
 */
export async function deleteConversationAPI(
	conversationId: string,
	token: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const response = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}`, {
			method: 'DELETE',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			const error = await response.text();
			throw new Error(error || `HTTP ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		console.error('Delete conversation API error:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to delete conversation',
		};
	}
}

/**
 * Delete a message (backend + local)
 */
export async function deleteMessageAPI(
	conversationId: string,
	messageId: string,
	token: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const response = await fetch(
			`${API_BASE_URL}/api/conversations/${conversationId}/messages/${messageId}`,
			{
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
			}
		);

		if (!response.ok) {
			const error = await response.text();
			throw new Error(error || `HTTP ${response.status}`);
		}

		return await response.json();
	} catch (error) {
		console.error('Delete message API error:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : 'Failed to delete message',
		};
	}
}

