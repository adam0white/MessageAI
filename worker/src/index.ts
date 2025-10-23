/**
 * MessageAI Worker
 * 
 * Main entry point for the MessageAI backend.
 * Handles WebSocket upgrades, webhooks, and routes to Durable Objects.
 */

import { Conversation } from './durable-objects/Conversation';
import { handleClerkWebhook } from './handlers/auth';
import { 
	handleCreateConversation, 
	handleGetConversations, 
	handleGetConversation 
} from './handlers/conversations';
import { 
	handleRegisterPushToken, 
	handleDeletePushToken 
} from './handlers/push-tokens';

export { Conversation };

// Helper to add CORS headers to any response
function addCorsHeaders(response: Response): Response {
	const newResponse = new Response(response.body, response);
	newResponse.headers.set('Access-Control-Allow-Origin', '*');
	newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
	newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	return newResponse;
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// CORS headers for development
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		};

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		// Health check endpoint
		if (url.pathname === '/') {
			return new Response('MessageAI Worker is running!', {
				headers: { 'Content-Type': 'text/plain', ...corsHeaders },
			});
		}

		// Clerk webhook endpoint
		if (url.pathname === '/webhooks/clerk' && request.method === 'POST') {
			return handleClerkWebhook(request, env);
		}

		// Conversation API endpoints
		if (url.pathname === '/api/conversations') {
			if (request.method === 'POST') {
				const response = await handleCreateConversation(request, env);
				return addCorsHeaders(response);
			} else if (request.method === 'GET') {
				const response = await handleGetConversations(request, env);
				return addCorsHeaders(response);
			}
		}

		if (url.pathname.startsWith('/api/conversations/')) {
			const conversationId = url.pathname.split('/')[3];
			if (conversationId && request.method === 'GET') {
				const response = await handleGetConversation(request, env, conversationId);
				return addCorsHeaders(response);
			}
		}

		// Push token endpoints
		if (url.pathname === '/api/push-tokens' && request.method === 'POST') {
			const response = await handleRegisterPushToken(request, env);
			return addCorsHeaders(response);
		}

		if (url.pathname.startsWith('/api/push-tokens/')) {
			const token = decodeURIComponent(url.pathname.split('/')[3]);
			if (token && request.method === 'DELETE') {
				const response = await handleDeletePushToken(token, env);
				return addCorsHeaders(response);
			}
		}

		// WebSocket upgrade endpoint - routes to Conversation Durable Object
		if (url.pathname.startsWith('/conversation/')) {
			const conversationId = url.pathname.split('/')[2];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			// Validate required query parameters for WebSocket connections
			if (request.headers.get('Upgrade') === 'websocket') {
				const userId = url.searchParams.get('userId');
				if (!userId) {
					return new Response('userId query parameter required for WebSocket connections', { 
						status: 400 
					});
				}
			}

			// Get Durable Object stub using conversation ID as the name
			// This ensures one unique DO instance per conversation globally
			const id = env.CONVERSATION.idFromName(conversationId);
			const stub = env.CONVERSATION.get(id);
			
			// Forward request to Durable Object (WebSocket upgrade or REST)
			return stub.fetch(request);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
