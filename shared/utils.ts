/**
 * Shared utility functions
 */

/**
 * Generate a deterministic conversation ID from participant IDs
 * Same participants = same conversation ID (prevents duplicates)
 * 
 * @param participantIds - Array of user IDs
 * @returns Deterministic conversation ID
 */
export function generateConversationId(participantIds: string[]): string {
	// Sort participant IDs to ensure consistent ordering
	const sorted = [...participantIds].sort();
	
	// Create a stable string representation
	const key = sorted.join('::');
	
	// Generate a simple hash (we could use crypto.subtle.digest in production)
	// For now, use a prefix + sorted IDs
	const hash = `conv_${sorted.join('_')}`;
	
	return hash;
}

/**
 * Check if a conversation ID is deterministic (vs random UUID)
 */
export function isDeterministicId(conversationId: string): boolean {
	return conversationId.startsWith('conv_');
}

