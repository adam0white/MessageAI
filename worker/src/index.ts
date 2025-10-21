/**
 * MessageAI Worker
 * 
 * Main entry point for the MessageAI backend.
 * Handles WebSocket upgrades, webhooks, and routes to Durable Objects.
 */

import { Conversation } from './durable-objects/Conversation';
import { handleClerkWebhook } from './handlers/auth';

export { Conversation };

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// Health check endpoint
		if (url.pathname === '/') {
			return new Response('MessageAI Worker is running!', {
				headers: { 'Content-Type': 'text/plain' },
			});
		}

		// Clerk webhook endpoint
		if (url.pathname === '/webhooks/clerk' && request.method === 'POST') {
			return handleClerkWebhook(request, env);
		}

		// Route to Conversation Durable Object
		if (url.pathname.startsWith('/conversation/')) {
			const conversationId = url.pathname.split('/')[2];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			// Get Durable Object stub
			const id = env.CONVERSATION.idFromName(conversationId);
			const stub = env.CONVERSATION.get(id);
			
			// Forward request to Durable Object
			return stub.fetch(request);
		}

		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
