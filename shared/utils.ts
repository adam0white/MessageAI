/**
 * Shared utility functions
 */

/**
 * Generate a deterministic conversation ID from participant IDs using SHA-256
 * Same participants = same conversation ID (prevents duplicates)
 * 
 * Strategy:
 * - 1-2 participants: Use simple "conv_user1_user2" format (backward compatible)
 * - 3+ participants: Use SHA-256 hash "conv_sha256hash" (scalable for groups)
 * 
 * @param participantIds - Array of user IDs
 * @returns Deterministic conversation ID
 */
export async function generateConversationId(participantIds: string[]): Promise<string> {
	// Sort participant IDs to ensure consistent ordering
	const sorted = [...participantIds].sort();
	
	// For small groups (1-2 people), use simple concatenation for readability
	// This maintains backward compatibility with existing conversations
	if (sorted.length <= 2) {
		return `conv_${sorted.join('_')}`;
	}
	
	// For larger groups (3+), use SHA-256 to keep IDs manageable
	const key = sorted.join('::');
	const hash = await sha256(key);
	
	// Take first 16 chars of hash for reasonable length
	return `conv_${hash.substring(0, 16)}`;
}

/**
 * Synchronous version for backward compatibility
 * Only works for 1-2 participants (no hashing needed)
 */
export function generateConversationIdSync(participantIds: string[]): string {
	const sorted = [...participantIds].sort();
	
	if (sorted.length > 2) {
		throw new Error('Use generateConversationId (async) for groups of 3+ participants');
	}
	
	return `conv_${sorted.join('_')}`;
}

/**
 * SHA-256 hash function that works in both Node.js and browser environments
 */
export async function sha256(message: string): Promise<string> {
	// Check if we're in a browser/Cloudflare Workers environment
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const msgBuffer = new TextEncoder().encode(message);
		const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
		return hashHex;
	}
	
	// Fallback for Node.js (if needed for testing)
	if (typeof require !== 'undefined') {
		try {
			const nodeCrypto = require('crypto');
			return nodeCrypto.createHash('sha256').update(message).digest('hex');
		} catch {
			throw new Error('SHA-256 not available in this environment');
		}
	}
	
	throw new Error('SHA-256 not available in this environment');
}

/**
 * Check if a conversation ID is deterministic (vs random UUID)
 */
export function isDeterministicId(conversationId: string): boolean {
	return conversationId.startsWith('conv_');
}

/**
 * Extract participant IDs from a simple conversation ID (1-2 participants only)
 * Returns null if the ID is hashed
 */
export function parseSimpleConversationId(conversationId: string): string[] | null {
	if (!conversationId.startsWith('conv_')) return null;
	
	const parts = conversationId.substring(5).split('_');
	
	// If parts contain hex characters only, it's likely a hash
	if (parts.length === 1 && /^[0-9a-f]+$/i.test(parts[0])) {
		return null; // Hashed ID
	}
	
	return parts;
}

