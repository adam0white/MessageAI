/**
 * Backend types - re-exports from shared types
 * 
 * This file re-exports all shared types for use in the Cloudflare Worker.
 * It also adds any backend-specific types.
 */

export * from '../../../shared/types';

// ============================================================================
// Backend-Specific Types
// ============================================================================

/**
 * Clerk webhook event types
 */
export interface ClerkWebhookEvent {
	type: 'user.created' | 'user.updated' | 'user.deleted';
	data: {
		id: string;
		email_addresses: Array<{
			email_address: string;
			id: string;
		}>;
		first_name?: string;
		last_name?: string;
		image_url?: string;
		created_at: number;
		updated_at: number;
	};
}

/**
 * Expo push notification payload
 */
export interface ExpoPushNotification {
	to: string; // Expo push token
	title: string;
	body: string;
	data?: {
		conversationId: string;
		messageId: string;
		senderId: string;
	};
	badge?: number;
	sound?: 'default' | null;
	priority?: 'default' | 'normal' | 'high';
}

/**
 * WebSocket connection metadata
 */
export interface ConnectionMetadata {
	userId: string;
	conversationId: string;
	connectedAt: string;
}

