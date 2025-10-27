/**
 * Push Notification Sender
 * 
 * Sends push notifications via Expo Push API
 * Used when users are offline or not actively viewing a conversation
 */

import type { Message } from '../types';

interface ExpoPushMessage {
	to: string | string[];
	sound?: 'default' | null;
	title?: string;
	body?: string;
	data?: Record<string, unknown>;
	badge?: number;
	channelId?: string;
	priority?: 'default' | 'normal' | 'high';
}

interface ExpoPushTicket {
	status: 'ok' | 'error';
	id?: string;
	message?: string;
	details?: {
		error?: string;
	};
}

interface ExpoPushResponse {
	data: ExpoPushTicket[];
}

const EXPO_PUSH_API = 'https://exp.host/--/api/v2/push/send';

/**
 * Send push notification for a new message
 */
export async function sendMessageNotification(
	tokens: string[],
	message: Message,
	senderName?: string
): Promise<void> {
	if (tokens.length === 0) {
		return;
	}

	const pushMessages: ExpoPushMessage[] = tokens.map(token => ({
		to: token,
		sound: 'default',
		title: senderName || 'New Message',
		body: message.content,
		data: {
			conversationId: message.conversationId,
			messageId: message.id,
			type: 'new_message',
		},
		channelId: 'default',
		priority: 'high',
	}));

	await sendPushNotifications(pushMessages);
}

/**
 * Send push notification for a read receipt update
 */
export async function sendReadReceiptNotification(
	tokens: string[],
	messageId: string,
	conversationId: string,
	readerName?: string
): Promise<void> {
	if (tokens.length === 0) {
		return;
	}

	const pushMessages: ExpoPushMessage[] = tokens.map(token => ({
		to: token,
		sound: null, // Silent notification for read receipts
		title: 'Message Read',
		body: readerName ? `${readerName} read your message` : 'Your message was read',
		data: {
			conversationId,
			messageId,
			type: 'read_receipt',
		},
		channelId: 'default',
		priority: 'default',
	}));

	await sendPushNotifications(pushMessages);
}

/**
 * Send push notifications via Expo Push API
 */
async function sendPushNotifications(messages: ExpoPushMessage[]): Promise<void> {
	try {
		const response = await fetch(EXPO_PUSH_API, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Accept-encoding': 'gzip, deflate',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(messages),
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(`❌ Expo Push API error (${response.status}):`, errorText);
			throw new Error(`Push notification failed: ${response.status}`);
		}

		const result: ExpoPushResponse = await response.json();

		// Log results
		result.data.forEach((ticket, index) => {
			if (ticket.status === 'error') {
				console.error(`❌ Push notification failed for token ${messages[index].to}:`, ticket.message, ticket.details);
			}
		});
	} catch (error) {
		console.error('❌ Failed to send push notifications:', error);
		// Don't throw - push notification failures shouldn't break message sending
	}
}

/**
 * Helper to send a single notification
 */
export async function sendSingleNotification(
	token: string,
	title: string,
	body: string,
	data?: Record<string, unknown>
): Promise<void> {
	await sendPushNotifications([{
		to: token,
		sound: 'default',
		title,
		body,
		data,
		channelId: 'default',
		priority: 'high',
	}]);
}

