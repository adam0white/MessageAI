/**
 * Frontend types - re-exports from shared types
 * 
 * This file re-exports all shared types for use in the Expo app.
 * It also adds any frontend-specific types.
 */

export * from '../../shared/types';

// ============================================================================
// Frontend-Specific Types
// ============================================================================

/**
 * WebSocket connection state
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * Network state
 */
export interface NetworkState {
	isConnected: boolean;
	isInternetReachable: boolean | null;
	type: string | null;
}

/**
 * Optimistic message for UI updates
 */
export interface OptimisticMessage {
	clientId: string;
	content: string;
	senderId: string;
	conversationId: string;
	createdAt: string;
	status: 'sending';
}

/**
 * AI Assistant Request
 */
export interface AiChatRequest {
	query: string;
	conversationId?: string;
}

/**
 * AI Assistant Response
 */
export interface AiChatResponse {
	success: boolean;
	response?: string;
	error?: string;
	model?: string;
}

