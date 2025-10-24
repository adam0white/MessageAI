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

		// Landing page
		if (url.pathname === '/') {
			const html = `
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>MessageAI Backend</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			padding: 20px;
		}
		.container {
			background: white;
			border-radius: 12px;
			padding: 40px;
			max-width: 600px;
			box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		}
		h1 {
			color: #333;
			margin-bottom: 10px;
			font-size: 2em;
		}
		.subtitle {
			color: #666;
			margin-bottom: 30px;
			font-size: 1.1em;
		}
		.status {
			background: #10b981;
			color: white;
			padding: 8px 16px;
			border-radius: 20px;
			display: inline-block;
			font-size: 0.9em;
			margin-bottom: 20px;
		}
		.info {
			background: #f3f4f6;
			padding: 20px;
			border-radius: 8px;
			margin: 20px 0;
		}
		.info h3 {
			color: #333;
			margin-bottom: 10px;
		}
		.info p {
			color: #666;
			line-height: 1.6;
		}
		a {
			color: #667eea;
			text-decoration: none;
			font-weight: 600;
		}
		a:hover {
			text-decoration: underline;
		}
		.github-link {
			display: inline-flex;
			align-items: center;
			gap: 8px;
			background: #24292e;
			color: white;
			padding: 12px 24px;
			border-radius: 6px;
			margin-top: 20px;
			transition: background 0.2s;
		}
		.github-link:hover {
			background: #333;
			text-decoration: none;
		}
		.endpoints {
			margin-top: 30px;
		}
		.endpoints h3 {
			color: #333;
			margin-bottom: 15px;
		}
		.endpoint {
			background: #f9fafb;
			padding: 12px;
			border-left: 3px solid #667eea;
			margin-bottom: 10px;
			font-family: 'Courier New', monospace;
			font-size: 0.9em;
			color: #333;
		}
	</style>
</head>
<body>
	<div class="container">
		<span class="status">✓ Online</span>
		<h1>🤖 MessageAI Backend</h1>
		<p class="subtitle">Real-time messaging with AI capabilities</p>
		
		<div class="info">
			<h3>About This Service</h3>
			<p>
				This is the backend API for MessageAI, a production-quality messaging application
				built with Cloudflare Workers, Durable Objects, and Workers AI.
			</p>
		</div>

		<div class="info">
			<h3>Features</h3>
			<p>
				• Real-time WebSocket messaging<br>
				• Durable Objects for message persistence<br>
				• AI-powered chat assistance (RAG)<br>
				• Thread summarization & action items<br>
				• Smart semantic search<br>
				• Multi-step AI agent for event planning
			</p>
		</div>

		<a href="https://github.com/adam0white/MessageAI" class="github-link" target="_blank">
			<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
				<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
			</svg>
			View Source on GitHub
		</a>
	</div>
</body>
</html>
			`.trim();
			
			return new Response(html, {
				headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
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

		// Multi-Step Agent endpoint
		if (url.pathname.startsWith('/api/conversations/') && url.pathname.endsWith('/run-agent') && request.method === 'POST') {
			const conversationId = url.pathname.split('/')[3];
			
			if (!conversationId) {
				return new Response('Conversation ID required', { status: 400 });
			}

			try {
				const body = await request.json() as { goal: string; userId: string };
				
				if (!body.goal || !body.userId) {
					return new Response(
						JSON.stringify({ success: false, error: 'goal and userId are required' }),
						{ status: 400, headers: { 'Content-Type': 'application/json' } }
					);
				}

				const doId = env.CONVERSATION.idFromName(conversationId);
				const stub = env.CONVERSATION.get(doId);
				
				// Call the runAgent RPC method - this executes ONE step
				const result = await (stub as any).runAgent(body.goal, body.userId, conversationId);
				
				return addCorsHeaders(new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' }
				}));
			} catch (error) {
				console.error('Run agent error:', error);
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
