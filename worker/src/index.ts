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
import { handleAiChat } from './handlers/ai';

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

		// AI Assistant endpoint (legacy, for standalone AI)
		if (url.pathname === '/api/ai/chat' && request.method === 'POST') {
			const response = await handleAiChat(request, env);
			return addCorsHeaders(response);
		}

		// AI Proactive Embedding endpoint - starts embedding in background
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/start-embedding') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				
				// Call the startEmbedding RPC method (non-blocking for user)
				const result = await (stub as any).startEmbedding(conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Proactive embedding error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ success: false, error: 'Failed to start embedding' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
			}
		}

		// AI RAG endpoint - calls Durable Object's askAI RPC method
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/ask-ai') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { query: string; userId: string };
				
				if (!body.query || !body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'query and userId are required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				// Get DO stub and call RPC method
				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				
				// Call the askAI RPC method (cast to any for RPC methods)
				const result = await (stub as any).askAI(body.query, body.userId, conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('AI RAG request error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ 
						success: false, 
						error: error instanceof Error ? error.message : 'Unknown error' 
					}),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
			}
		}

		// AI Thread Summarization endpoint
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/summarize') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { userId: string; messageLimit?: number };
				
				if (!body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'userId is required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				const result = await (stub as any).summarizeThread(body.userId, conversationId, body.messageLimit || 100);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Summarize thread error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
			}
		}

		// AI Action Items endpoint
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/action-items') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { userId: string };
				
				if (!body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'userId is required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				const result = await (stub as any).extractActionItems(body.userId, conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Extract action items error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
			}
		}

		// AI Priority Detection endpoint
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/priority-messages') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { userId: string };
				
				if (!body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'userId is required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				const result = await (stub as any).detectPriorityMessages(body.userId, conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Detect priority messages error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
			}
		}

		// AI Decision Tracking endpoint
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/decisions') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { userId: string };
				
				if (!body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'userId is required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				const result = await (stub as any).trackDecisions(body.userId, conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Track decisions error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
			}
		}

		// AI Smart Search endpoint
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/smart-search') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { query: string; userId: string };
				
				if (!body.query || !body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'query and userId are required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				const result = await (stub as any).smartSearch(body.query, body.userId, conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Smart search error:', error);
				return addCorsHeaders(new Response(
					JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
					{ status: 500, headers: { 'Content-Type': 'application/json' } }
				));
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
