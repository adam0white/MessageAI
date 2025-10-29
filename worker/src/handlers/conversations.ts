/**
 * Conversation Handlers
 * 
 * REST endpoints for managing conversations
 */

import type { CreateConversationRequest, Conversation, ConversationPreview } from '../types';
import { getConversations, createConversation, getConversationById } from '../db/schema';

/**
 * Create a new conversation
 * POST /api/conversations
 */
export async function handleCreateConversation(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		// Check if request has body
		if (!request.body) {
			return new Response(
				JSON.stringify({ error: 'Request body required' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const data: CreateConversationRequest = await request.json();
		
		// Validation
		if (!data.participantIds || data.participantIds.length < 1) {
			return new Response(
				JSON.stringify({ error: 'At least 1 participant required' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Name is optional for all conversation types

		// Create conversation in D1
		const conversation = await createConversation(env.DB, data);

		return new Response(
			JSON.stringify({ conversation }),
			{ 
				status: 201, 
				headers: { 'Content-Type': 'application/json' } 
			}
		);
	} catch (error) {
		console.error('Error creating conversation:', error);
		const errorMessage = error instanceof Error ? error.message : 'Unknown error';
		return new Response(
			JSON.stringify({ 
				error: 'Failed to create conversation',
				details: errorMessage 
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

/**
 * Get user's conversations
 * GET /api/conversations?userId=xxx
 */
export async function handleGetConversations(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const url = new URL(request.url);
		const clerkId = url.searchParams.get('userId'); // This is actually the Clerk ID from frontend

		if (!clerkId) {
			return new Response(
				JSON.stringify({ error: 'userId query parameter required' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Convert Clerk ID to database ID
		const { getUserByClerkId } = await import('../db/schema');
		const user = await getUserByClerkId(env.DB, clerkId);
		
		if (!user) {
			// User not found - return empty conversations list (they might not be synced yet)
			return new Response(
				JSON.stringify({ conversations: [] }),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		}

		const conversations = await getConversations(env.DB, user.id);

		return new Response(
			JSON.stringify({ conversations }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error fetching conversations:', error);
		return new Response(
			JSON.stringify({ error: 'Failed to fetch conversations' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

/**
 * Get conversation by ID
 * GET /api/conversations/:id
 */
export async function handleGetConversation(
	request: Request,
	env: Env,
	conversationId: string
): Promise<Response> {
	try {
		const conversation = await getConversationById(env.DB, conversationId);

		if (!conversation) {
			return new Response(
				JSON.stringify({ error: 'Conversation not found' }),
				{ status: 404, headers: { 'Content-Type': 'application/json' } }
			);
		}

		return new Response(
			JSON.stringify({ conversation }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error fetching conversation:', error);
		return new Response(
			JSON.stringify({ error: 'Failed to fetch conversation' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

