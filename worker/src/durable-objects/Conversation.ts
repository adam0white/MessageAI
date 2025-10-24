import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage, Message } from '../types';
import { getPushTokensByUserId, updateConversationLastMessage, updateUserLastRead, getLastReadTimestamps } from '../db/schema';
import { sendMessageNotification, sendReadReceiptNotification } from '../handlers/notifications';
import { generateEmbedding, AI_MODELS } from '../handlers/ai';

/**
 * Session metadata for each connected WebSocket
 */
interface Session {
	webSocket: WebSocket;
	userId: string;
	conversationId: string;
	connectedAt: number;
}

/**
 * Database row for messages
 */
interface MessageRow {
	id: string;
	conversation_id: string;
	sender_id: string;
	content: string;
	type: string;
	status: string;
	media_url: string | null;
	media_type: string | null;
	media_size: number | null;
	created_at: string;
	updated_at: string;
}

/**
 * Database row for read receipts
 */
interface ReadReceiptRow {
	message_id: string;
	user_id: string;
	read_at: string;
}

/**
 * Conversation Durable Object
 * 
 * Manages a single conversation room with:
 * - WebSocket connections for real-time messaging
 * - Message persistence in SQLite storage
 * - Presence tracking (online/offline status)
 * - Read receipts
 */
export class Conversation extends DurableObject<Env> {
	// In-memory connection tracking
	private sessions: Map<WebSocket, Session>;
	private sqlInitialized = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sessions = new Map();
		
		this.ctx.getWebSockets().forEach((ws) => {
			const meta = ws.deserializeAttachment();
			if (meta && typeof meta === 'object' && 'userId' in meta && 'conversationId' in meta) {
				this.sessions.set(ws, meta as Session);
			}
		});
	}

	/**
	 * Initialize SQLite storage schema
	 */
	private async initializeSQL(): Promise<void> {
		if (this.sqlInitialized) return;

		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id TEXT PRIMARY KEY,
				conversation_id TEXT NOT NULL,
				sender_id TEXT NOT NULL,
				content TEXT NOT NULL,
				type TEXT NOT NULL DEFAULT 'text',
				status TEXT NOT NULL DEFAULT 'sent',
				media_url TEXT,
				media_type TEXT,
				media_size INTEGER,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
			ON messages(conversation_id, created_at DESC)
		`);

		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS read_receipts (
				message_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				read_at TEXT NOT NULL,
				PRIMARY KEY (message_id, user_id)
			)
		`);

		this.sqlInitialized = true;
	}

	/**
	 * Handle incoming HTTP requests (WebSocket upgrades and REST endpoints)
	 */
	async fetch(request: Request): Promise<Response> {
		await this.initializeSQL();

		const url = new URL(request.url);

		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketUpgrade(request);
		}

		if (url.pathname === '/messages') {
			return this.handleGetMessages(request);
		}

		return new Response('Not found', { status: 404 });
	}

	/**
	 * RPC Method: Proactive Embedding
	 * 
	 * Starts embedding messages in the background when user opens AI panel.
	 * This makes the actual query feel instant since embeddings are already cached.
	 * 
	 * @param conversationId - The conversation to embed
	 * @returns Status of embedding process
	 */
	async startEmbedding(conversationId: string): Promise<{
		success: boolean;
		embeddedCount?: number;
		totalMessages?: number;
		error?: string;
	}> {
		try {
			await this.initializeSQL();

			const allMessages = await this.getMessages(conversationId, 1000);
			
			if (allMessages.length === 0) {
				return { success: true, embeddedCount: 0, totalMessages: 0 };
			}

			console.log(`[AI Proactive] Starting background embedding for ${allMessages.length} messages`);

		// Embed messages in batches (parallel within batch, rate limits disabled)
		const BATCH_SIZE = 50; // Large batches for maximum speed
		const BATCH_DELAY_MS = 0; // No delay needed
		const vectors = [];
		let successCount = 0;

		for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
			const batch = allMessages.slice(i, i + BATCH_SIZE);
			
			// Process batch in parallel
			const batchResults = await Promise.allSettled(
				batch.map(async (msg) => {
					const embedding = await generateEmbedding(
						this.env,
						msg.content,
						{
							conversationId: msg.conversationId,
							messageId: msg.id,
							userId: msg.senderId,
						}
					);

					return {
						id: msg.id,
						values: embedding,
						metadata: {
							conversationId: msg.conversationId,
							senderId: msg.senderId,
							content: msg.content,
							timestamp: msg.createdAt,
						}
					};
				})
			);

			// Collect successful results
			for (const result of batchResults) {
				if (result.status === 'fulfilled') {
					vectors.push(result.value);
					successCount++;
				} else if (successCount === 0) {
					console.error('Background embedding error:', result.reason);
				}
			}

			// No delay needed - process all batches as fast as possible
		}

			if (vectors.length > 0) {
				await this.env.VECTORIZE.upsert(vectors);
			}

			console.log(`[AI Proactive] Embedded ${successCount}/${allMessages.length} messages`);

			return {
				success: true,
				embeddedCount: successCount,
				totalMessages: allMessages.length,
			};

		} catch (error) {
			console.error('[AI Proactive] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

 	/**
	 * RPC Method: Summarize Thread
	 * 
	 * Analyzes the conversation and generates a concise 3-bullet summary.
	 * Useful for catching up on long discussions.
	 * 
	 * @param userId - The user requesting the summary
	 * @param conversationId - The conversation to summarize
	 * @param messageLimit - Number of recent messages to include (default: 100)
	 * @returns Summary with key points
	 */
	async summarizeThread(userId: string, conversationId: string, messageLimit: number = 100): Promise<{
		success: boolean;
		summary?: string;
		bulletPoints?: string[];
		messageCount?: number;
		error?: string;
	}> {
		try {
			await this.initializeSQL();

			// Get recent messages
			const messages = await this.getMessages(conversationId, messageLimit);
			
			if (messages.length === 0) {
				return { success: false, error: 'No messages to summarize' };
			}

			// Format conversation for AI
			const conversationText = messages
				.map(msg => `[${new Date(msg.createdAt).toLocaleString()}] ${msg.senderId}: ${msg.content}`)
				.join('\n');

			// Create summarization prompt
			const systemPrompt = `You are an AI assistant helping remote teams stay productive. 
Your task is to summarize conversations concisely.

Output format (REQUIRED):
{
  "keyPoints": ["point 1", "point 2", "point 3"],
  "summary": "One-sentence overview of the discussion"
}

Guidelines:
- Focus on actionable information and key decisions
- Keep each point under 15 words
- Prioritize what remote team members need to know
- Be specific (mention names, dates, decisions)`;

			const userPrompt = `Summarize this conversation into 3 key points:

${conversationText}`;

			// Call Workers AI
			const aiResponse: any = await (this.env.AI as any).run(
				AI_MODELS.LLAMA_8B,
				{
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					],
					max_tokens: 512,
					temperature: 0.3, // Lower temp for consistent output
				},
				{
					gateway: {
						id: 'aw-cf-ai',
						metadata: {
							conversationId,
							userId,
							operation: 'summarize-thread',
							messageCount: messages.length,
						}
					}
				}
			);

			const responseText = aiResponse.response as string;
			
			if (!responseText) {
				return { success: false, error: 'AI did not generate a summary' };
			}

			// Try to parse structured output (JSON)
			let bulletPoints: string[] = [];
			let summary = responseText;
			
			try {
				// Look for JSON in the response
				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					bulletPoints = parsed.keyPoints || [];
					summary = parsed.summary || responseText;
				} else {
					// Fallback: extract bullet points from text
					const lines = responseText.split('\n').filter(line => line.trim());
					bulletPoints = lines.slice(0, 3);
					summary = bulletPoints.join(' • ');
				}
			} catch (parseError) {
				// If parsing fails, use the raw response
				const lines = responseText.split('\n').filter(line => line.trim());
				bulletPoints = lines.slice(0, 3);
			}

			return {
				success: true,
				summary,
				bulletPoints,
				messageCount: messages.length,
			};

		} catch (error) {
			console.error('[AI Summarize] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * RPC Method: Extract Action Items
	 * 
	 * Identifies tasks, assignees, and due dates from the conversation.
	 * Uses structured output to return actionable items.
	 * 
	 * @param userId - The user requesting action items
	 * @param conversationId - The conversation to analyze
	 * @returns List of action items with metadata
	 */
	async extractActionItems(userId: string, conversationId: string): Promise<{
		success: boolean;
		actionItems?: Array<{
			task: string;
			assignee?: string;
			dueDate?: string;
			mentioned?: string;
		}>;
		error?: string;
	}> {
		try {
			await this.initializeSQL();

			const messages = await this.getMessages(conversationId, 100);
			
			if (messages.length === 0) {
				return { success: false, error: 'No messages to analyze' };
			}

			const conversationText = messages
				.map(msg => `[${new Date(msg.createdAt).toLocaleString()}] ${msg.senderId}: ${msg.content}`)
				.join('\n');

			const systemPrompt = `You are an AI assistant that extracts action items from team conversations.

Output format (REQUIRED JSON):
{
  "actionItems": [
    {
      "task": "Description of the task",
      "assignee": "person mentioned or null",
      "dueDate": "date mentioned or null",
      "mentioned": "relevant context"
    }
  ]
}

Guidelines:
- Look for phrases like "can you", "please", "we need to", "I'll", "let's"
- Identify explicit task assignments
- Extract mentioned dates and deadlines
- Return empty array if no action items found`;

			const userPrompt = `Extract all action items from this conversation:

${conversationText}`;

			const aiResponse: any = await (this.env.AI as any).run(
				AI_MODELS.LLAMA_8B,
				{
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					],
					max_tokens: 800,
					temperature: 0.2,
				},
				{
					gateway: {
						id: 'aw-cf-ai',
						metadata: {
							conversationId,
							userId,
							operation: 'extract-action-items',
						}
					}
				}
			);

			const responseText = aiResponse.response as string;
			
			// Parse structured output
			let actionItems: any[] = [];
			try {
				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					actionItems = parsed.actionItems || [];
				}
			} catch (parseError) {
				console.error('Failed to parse action items JSON:', parseError);
				// Return empty array instead of error
				actionItems = [];
			}

			return {
				success: true,
				actionItems,
			};

		} catch (error) {
			console.error('[AI Action Items] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * RPC Method: Detect Priority Messages
	 * 
	 * Analyzes messages for urgency indicators and sentiment.
	 * Returns messages that require immediate attention.
	 * 
	 * @param userId - The user requesting priority detection
	 * @param conversationId - The conversation to analyze
	 * @returns List of priority messages with scores
	 */
	async detectPriorityMessages(userId: string, conversationId: string): Promise<{
		success: boolean;
		priorityMessages?: Array<{
			messageId: string;
			content: string;
			sender: string;
			timestamp: string;
			priority: 'high' | 'medium';
			reason: string;
		}>;
		error?: string;
	}> {
		try {
			await this.initializeSQL();

			const messages = await this.getMessages(conversationId, 50);
			
			if (messages.length === 0) {
				return { success: false, error: 'No messages to analyze' };
			}

			// Build message list with IDs for reference
			const messageList = messages
				.map((msg, idx) => `[MSG_${idx}] [${new Date(msg.createdAt).toLocaleString()}] ${msg.senderId}: ${msg.content}`)
				.join('\n');

			const systemPrompt = `You are an AI assistant that identifies priority messages requiring immediate attention.

Output format (REQUIRED JSON):
{
  "priorityMessages": [
    {
      "messageIndex": 0,
      "priority": "high",
      "reason": "Contains urgent deadline"
    }
  ]
}

Priority indicators:
- HIGH: "urgent", "ASAP", "immediately", "critical", "emergency", deadlines within 24h
- MEDIUM: "soon", "important", "please review", time-sensitive questions

Return empty array if no priority messages found.`;

			const userPrompt = `Identify priority messages:

${messageList}`;

			const aiResponse: any = await (this.env.AI as any).run(
				AI_MODELS.LLAMA_8B,
				{
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					],
					max_tokens: 600,
					temperature: 0.2,
				},
				{
					gateway: {
						id: 'aw-cf-ai',
						metadata: {
							conversationId,
							userId,
							operation: 'detect-priority',
						}
					}
				}
			);

			const responseText = aiResponse.response as string;
			
			// Parse and map back to actual messages
			let priorityMessages: any[] = [];
			try {
				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					const detectedPriority = parsed.priorityMessages || [];
					
					priorityMessages = detectedPriority
						.filter((item: any) => item.messageIndex < messages.length)
						.map((item: any) => {
							const msg = messages[item.messageIndex];
							return {
								messageId: msg.id,
								content: msg.content,
								sender: msg.senderId,
								timestamp: msg.createdAt,
								priority: item.priority || 'medium',
								reason: item.reason || 'Priority detected',
							};
						});
				}
			} catch (parseError) {
				console.error('Failed to parse priority messages JSON:', parseError);
			}

			return {
				success: true,
				priorityMessages,
			};

		} catch (error) {
			console.error('[AI Priority] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * RPC Method: Track Decisions
	 * 
	 * Identifies consensus phrases and extracts decisions made in the conversation.
	 * Returns a timeline of agreed-upon points.
	 * 
	 * @param userId - The user requesting decision tracking
	 * @param conversationId - The conversation to analyze
	 * @returns List of decisions with timestamps
	 */
	async trackDecisions(userId: string, conversationId: string): Promise<{
		success: boolean;
		decisions?: Array<{
			decision: string;
			timestamp: string;
			participants: string[];
			context: string;
		}>;
		error?: string;
	}> {
		try {
			await this.initializeSQL();

			const messages = await this.getMessages(conversationId, 100);
			
			if (messages.length === 0) {
				return { success: false, error: 'No messages to analyze' };
			}

			const conversationText = messages
				.map(msg => `[${new Date(msg.createdAt).toLocaleString()}] ${msg.senderId}: ${msg.content}`)
				.join('\n');

			const systemPrompt = `You are an AI assistant that tracks decisions made in team conversations.

Output format (REQUIRED JSON):
{
  "decisions": [
    {
      "decision": "Clear description of what was decided",
      "timestamp": "timestamp from conversation",
      "participants": ["person1", "person2"],
      "context": "Brief context or reason"
    }
  ]
}

Decision indicators:
- "we decided", "let's go with", "agreed", "confirmed", "final decision"
- Consensus phrases like "sounds good", "that works", "let's do it"
- Explicit commitments like "I'll proceed with", "we're moving forward"

Return empty array if no clear decisions found.`;

			const userPrompt = `Extract all decisions made in this conversation:

${conversationText}`;

			const aiResponse: any = await (this.env.AI as any).run(
				AI_MODELS.LLAMA_8B,
				{
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					],
					max_tokens: 800,
					temperature: 0.2,
				},
				{
					gateway: {
						id: 'aw-cf-ai',
						metadata: {
							conversationId,
							userId,
							operation: 'track-decisions',
						}
					}
				}
			);

			const responseText = aiResponse.response as string;
			
			let decisions: any[] = [];
			try {
				const jsonMatch = responseText.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					decisions = parsed.decisions || [];
				}
			} catch (parseError) {
				console.error('Failed to parse decisions JSON:', parseError);
			}

			return {
				success: true,
				decisions,
			};

		} catch (error) {
			console.error('[AI Decisions] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * RPC Method: Smart Search
	 * 
	 * Implements semantic search using RAG embeddings + LLM re-ranking.
	 * More powerful than keyword search for finding relevant context.
	 * 
	 * @param query - The search query
	 * @param userId - The user performing the search
	 * @param conversationId - The conversation to search
	 * @returns Ranked search results
	 */
	async smartSearch(query: string, userId: string, conversationId: string): Promise<{
		success: boolean;
		results?: Array<{
			messageId: string;
			content: string;
			sender: string;
			timestamp: string;
			relevanceScore: number;
			snippet: string;
		}>;
		error?: string;
	}> {
		try {
			await this.initializeSQL();

			const allMessages = await this.getMessages(conversationId, 200);
			
			if (allMessages.length === 0) {
				return { success: false, error: 'No messages to search' };
			}

			// Ensure messages are embedded (reuse existing logic)
			let embeddingsExist = false;
			if (allMessages.length > 0) {
				try {
					const firstMessageId = allMessages[0].id;
					const existingVectors = await this.env.VECTORIZE.getByIds([firstMessageId]);
					embeddingsExist = existingVectors.length > 0;
				} catch (error) {
					console.log('[Smart Search] Will create embeddings');
				}
			}

			// Embed if needed (same logic as askAI)
			if (!embeddingsExist) {
				const BATCH_SIZE = 50;
				const vectors = [];

				for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
					const batch = allMessages.slice(i, i + BATCH_SIZE);
					
					const batchResults = await Promise.allSettled(
						batch.map(async (msg) => {
							const embedding = await generateEmbedding(
								this.env,
								msg.content,
								{ conversationId: msg.conversationId, messageId: msg.id }
							);

							return {
								id: msg.id,
								values: embedding,
								metadata: {
									conversationId: msg.conversationId,
									senderId: msg.senderId,
									content: msg.content,
									timestamp: msg.createdAt,
								}
							};
						})
					);

					for (const result of batchResults) {
						if (result.status === 'fulfilled') {
							vectors.push(result.value);
						}
					}
				}

				if (vectors.length > 0) {
					await this.env.VECTORIZE.upsert(vectors);
				}
			}

			// Generate query embedding
			const queryEmbedding = await generateEmbedding(
				this.env,
				query,
				{ conversationId, userId, operation: 'search' }
			);

			// Semantic search
			const searchResults = await this.env.VECTORIZE.query(queryEmbedding, {
				topK: 10,
				returnMetadata: 'all',
			});

			// Filter by conversation
			const filteredMatches = searchResults.matches.filter(
				match => match.metadata && (match.metadata as any).conversationId === conversationId
			);

			// Map to response format
			const results = filteredMatches.map(match => ({
				messageId: match.id,
				content: (match.metadata as any).content as string,
				sender: (match.metadata as any).senderId as string,
				timestamp: (match.metadata as any).timestamp as string,
				relevanceScore: match.score || 0,
				snippet: ((match.metadata as any).content as string).substring(0, 100) + '...',
			}));

			return {
				success: true,
				results,
			};

		} catch (error) {
			console.error('[Smart Search] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			};
		}
	}

	/**
	 * RPC Method: Ask AI with RAG
	 * 
	 * This method implements Retrieval-Augmented Generation:
	 * 1. Embeds all messages in the conversation (on-demand, cached in Vectorize)
	 * 2. Queries Vectorize for top-K most relevant messages to the query
	 * 3. Calls Workers AI with both retrieved messages and recent context
	 * 4. Saves AI response as a message in the conversation (visible to all)
	 * 5. Broadcasts the AI message to all connected participants
	 * 
	 * @param query - The user's question to the AI
	 * @param userId - The user asking the question
	 * @returns AI response with metadata
	 */
	async askAI(query: string, userId: string, conversationId: string): Promise<{
		success: boolean;
		response?: string;
		error?: string;
		messageId?: string;
		retrievedCount?: number;
	}> {
		try {
			await this.initializeSQL();

			console.log(`[AI RAG] User ${userId} asking: "${query.substring(0, 50)}..."`);

			// Step 1: Get all messages from this conversation
			const allMessages = await this.getMessages(conversationId, 1000);
			
			if (allMessages.length === 0) {
				return {
					success: false,
					error: 'No messages in conversation to provide context'
				};
			}

			console.log(`[AI RAG] Found ${allMessages.length} messages in conversation`);

			// Step 2: Check if embeddings already exist (proactive embedding may have done this)
			// Check by trying to get the first message by ID
			let embeddingsExist = false;
			if (allMessages.length > 0) {
				try {
					const firstMessageId = allMessages[0].id;
					const existingVectors = await this.env.VECTORIZE.getByIds([firstMessageId]);
					embeddingsExist = existingVectors.length > 0;
					console.log(`[AI RAG] Embeddings ${embeddingsExist ? `already exist (${existingVectors.length} found)` : 'need to be created'}`);
				} catch (error) {
					console.log(`[AI RAG] Couldn't check existing embeddings (will create): ${error instanceof Error ? error.message : error}`);
				}
			}

			// Only embed if embeddings don't exist
			if (!embeddingsExist) {
			console.log(`[AI RAG] Starting embedding for ${allMessages.length} messages...`);
			const embeddingStartTime = Date.now();
			const BATCH_SIZE = 50; // Large batches for maximum speed
			const BATCH_DELAY_MS = 0; // No delay needed
			const vectors = [];
			let successCount = 0;
			let failCount = 0;

			for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
				const batch = allMessages.slice(i, i + BATCH_SIZE);
				
				// Process batch in parallel
				const batchResults = await Promise.allSettled(
					batch.map(async (msg) => {
						const embedding = await generateEmbedding(
							this.env,
							msg.content,
							{
								conversationId: msg.conversationId,
								messageId: msg.id,
								userId: msg.senderId,
							}
						);

						return {
							id: msg.id,
							values: embedding,
							metadata: {
								conversationId: msg.conversationId,
								senderId: msg.senderId,
								content: msg.content,
								timestamp: msg.createdAt,
							}
						};
					})
				);

				// Collect results
				for (const result of batchResults) {
					if (result.status === 'fulfilled') {
						vectors.push(result.value);
						successCount++;
					} else {
						failCount++;
						if (failCount <= 3) {
							console.error(`Failed to embed message:`, result.reason instanceof Error ? result.reason.message : result.reason);
						}
					}
				}

				// No delay needed - process all batches as fast as possible
			}
			
			const embeddingDuration = Date.now() - embeddingStartTime;
			console.log(`[AI RAG] Embedded ${successCount}/${allMessages.length} messages in ${embeddingDuration}ms (${failCount} failed)`);

				if (vectors.length === 0) {
					return {
						success: false,
						error: `Failed to embed messages. Rate limit or AI Gateway issue. Try again in a minute.`
					};
				}

				try {
					await this.env.VECTORIZE.upsert(vectors);
					console.log(`[AI RAG] Successfully upserted ${vectors.length} vectors to Vectorize`);
				} catch (upsertError) {
					console.error('[AI RAG] Vectorize upsert failed:', upsertError);
					return {
						success: false,
						error: 'Failed to store embeddings in Vectorize'
					};
				}
			}

			// Step 3: Generate embedding for the user's query
			let queryEmbedding: number[];
			try {
				queryEmbedding = await generateEmbedding(
					this.env,
					query,
					{ conversationId, userId, operation: 'query' }
				);
			} catch (queryEmbedError) {
				console.error('[AI RAG] Failed to embed query:', queryEmbedError);
				return {
					success: false,
					error: 'Failed to process your question. Please try again in a moment.'
				};
			}

			// Step 4: Query Vectorize for top-5 most relevant messages
			// Note: Try without filter first to debug, Vectorize may have indexing delay
			let searchResults;
			try {
				searchResults = await this.env.VECTORIZE.query(queryEmbedding, {
					topK: 5,
					returnMetadata: 'all',
				});
				console.log(`[AI RAG] Retrieved ${searchResults.matches.length} relevant messages (no filter)`);
				
				// Filter results by conversationId in code
				const filteredMatches = searchResults.matches.filter(
					match => match.metadata && (match.metadata as any).conversationId === conversationId
				);
				searchResults = { ...searchResults, matches: filteredMatches };
				console.log(`[AI RAG] After filtering: ${searchResults.matches.length} messages from this conversation`);
			} catch (queryError) {
				console.error('[AI RAG] Vectorize query failed:', queryError);
				searchResults = { matches: [] };
			}

			// Step 5: Build context from retrieved messages + recent messages
			const retrievedMessages = searchResults.matches
				.filter(match => match.metadata)
				.map(match => ({
					content: (match.metadata as any).content as string,
					sender: (match.metadata as any).senderId as string,
					timestamp: (match.metadata as any).timestamp as string,
					relevanceScore: match.score,
				}));

			const recentMessages = allMessages.slice(-10); // Last 10 messages (most recent)

			// Format context for AI
			const ragContext = retrievedMessages.map(msg => 
				`[Relevant - Score: ${msg.relevanceScore?.toFixed(3)}] ${msg.sender}: ${msg.content}`
			).join('\n');

			const recentContext = recentMessages.map(msg =>
				`[Recent] ${msg.senderId}: ${msg.content}`
			).join('\n');

			const fullContext = `MOST RELEVANT MESSAGES (RAG):\n${ragContext}\n\nRECENT MESSAGES:\n${recentContext}`;

			// Step 6: Call Workers AI with RAG context
			const systemPrompt = `You are an AI assistant helping with this conversation. You have access to the most relevant messages (via semantic search) and recent messages. Provide a helpful, concise answer.`;

			const userPrompt = `Context from conversation:\n${fullContext}\n\nUser Question: ${query}`;

			const aiResponse: any = await (this.env.AI as any).run(
				'@cf/meta/llama-3.1-8b-instruct-fast',
				{
					messages: [
						{ role: 'system', content: systemPrompt },
						{ role: 'user', content: userPrompt }
					],
					max_tokens: 512,
					temperature: 0.7,
				},
				{
					gateway: {
						id: 'aw-cf-ai',
						metadata: {
							conversationId,
							userId,
							operation: 'rag-query',
							retrievedCount: retrievedMessages.length,
							totalMessages: allMessages.length,
						}
					}
				}
			);

			const responseText = aiResponse.response as string;

			if (!responseText) {
				return {
					success: false,
					error: 'AI did not generate a response'
				};
			}

			// Step 7: Save AI response as a message in the conversation
			const aiMessageId = `msg_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			const now = new Date().toISOString();

			await this.ctx.storage.sql.exec(
				`INSERT INTO messages (id, conversation_id, sender_id, content, type, status, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				aiMessageId,
				conversationId,
				'ai-assistant', // Special sender ID for AI
				responseText,
				'text', // Message type
				'sent',
				now,
				now
			);

			// Update D1 conversation last message
			try {
				await updateConversationLastMessage(
					this.env.DB, 
					conversationId, 
					now, // timestamp
					responseText, // messageContent
					'ai-assistant' // senderId
				);
			} catch (error) {
				console.error('Failed to update D1 last message:', error);
			}

			// Step 8: Broadcast AI message to all connected participants
			const aiMessage: ServerMessage = {
				type: 'new_message',
				message: {
					id: aiMessageId,
					conversationId,
					senderId: 'ai-assistant',
					content: responseText,
					type: 'text',
					status: 'sent',
					createdAt: now,
					updatedAt: now,
				}
			};
			this.broadcast(aiMessage);

			console.log(`[AI RAG] AI response saved to DO, D1, and broadcast (${responseText.length} chars)`);

			return {
				success: true,
				response: responseText,
				messageId: aiMessageId,
				retrievedCount: retrievedMessages.length,
			};

		} catch (error) {
			console.error('[AI RAG] Error:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error occurred'
			};
		}
	}

	/**
	 * Handle WebSocket upgrade and connection
	 * Uses WebSocket hibernation for memory efficiency
	 */
	private async handleWebSocketUpgrade(request: Request): Promise<Response> {
		// Extract user authentication from URL query params
		const url = new URL(request.url);
		const userId = url.searchParams.get('userId');
		
		// Extract conversation ID from URL path
		const pathParts = url.pathname.split('/');
		const conversationId = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

		if (!userId || !conversationId) {
			return new Response('Missing userId or conversationId', { status: 400 });
		}

		// Create WebSocket pair
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		// Create session metadata
		const session: Session = {
			webSocket: server,
			userId,
			conversationId,
			connectedAt: Date.now(),
		};

		// Accept the WebSocket connection with hibernation support
		this.ctx.acceptWebSocket(server);
		
		// Serialize session metadata to WebSocket for hibernation recovery
		// This allows the session to be restored after the DO wakes from hibernation
		server.serializeAttachment({
			userId,
			conversationId,
			connectedAt: session.connectedAt,
		});

		// Store session in memory map
		this.sessions.set(server, session);

		// Get list of currently connected users (before adding the new user)
		const onlineUserIds = this.getConnectedUserIds();

		// Send initial connection acknowledgment with online users list
		const welcomeMessage: ServerMessage = {
			type: 'connected',
			timestamp: new Date().toISOString(),
			onlineUserIds: onlineUserIds, // Send list of currently online users
		};
		server.send(JSON.stringify(welcomeMessage));

		// Broadcast presence update to all other participants (that user just came online)
		const presenceUpdate: ServerMessage = {
			type: 'presence_update',
			userId,
			status: 'online',
			timestamp: new Date().toISOString(),
		};
		this.broadcast(presenceUpdate, userId);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	/**
	 * Handle WebSocket messages
	 */
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		let session = this.sessions.get(ws);
		
		// If session not in map (after hibernation), recreate from serialized attachment
		if (!session) {
			const meta = ws.deserializeAttachment();
			
			if (meta && typeof meta === 'object' && 'userId' in meta && 'conversationId' in meta) {
				session = {
					webSocket: ws,
					userId: meta.userId as string,
					conversationId: meta.conversationId as string,
					connectedAt: (meta.connectedAt as number) || Date.now(),
				};
				this.sessions.set(ws, session);
				console.log(`Session recreated for user ${session.userId} after hibernation`);
			} else {
				console.error('Received message from unknown session and no metadata available');
				return;
			}
		}

		if (typeof message === 'string') {
			// Parse and handle message
			try {
				const data: ClientMessage = JSON.parse(message);
				
				// Handle different message types
				switch (data.type) {
					case 'send_message':
						await this.handleSendMessage(ws, session, data);
						break;
					
					case 'mark_read':
						await this.handleMarkRead(ws, session, data);
						break;
					
					case 'get_history':
						await this.handleGetHistory(ws, session, data);
						break;
					
					case 'typing':
						await this.handleTyping(ws, session, data);
						break;
					
					default:
						console.warn(`Unknown message type: ${(data as any).type}`);
						const errorResponse: ServerMessage = {
							type: 'error',
							code: 'UNKNOWN_MESSAGE_TYPE',
							message: `Unknown message type: ${(data as any).type}`,
						};
						ws.send(JSON.stringify(errorResponse));
				}
			} catch (error) {
				console.error('Failed to parse message:', error);
				const errorResponse: ServerMessage = {
					type: 'error',
					code: 'PARSE_ERROR',
					message: 'Failed to parse message',
					details: error
				};
				ws.send(JSON.stringify(errorResponse));
			}
		}
	}

	/**
	 * Handle send_message request
	 */
	private async handleSendMessage(ws: WebSocket, session: Session, data: ClientMessage & { type: 'send_message' }): Promise<void> {
		try {
			// Generate server message ID
			const messageId = `msg_${Date.now()}_${crypto.randomUUID()}`;
			const now = new Date().toISOString();

			// Create message object
			const newMessage: Message = {
				id: messageId,
				conversationId: session.conversationId,
				senderId: session.userId,
				content: data.content,
				type: data.messageType,
				status: 'sent',
				mediaUrl: data.mediaUrl,
				createdAt: now,
				updatedAt: now,
			};

			// Save to SQLite storage
			await this.saveMessage(newMessage);

			// Update lastMessageAt and preview in D1 for conversation list polling
			await updateConversationLastMessage(
				this.env.DB, 
				session.conversationId, 
				now,
				data.content, // Message content for preview
				session.userId // Sender ID
			);

			// Send confirmation to sender
			const confirmationResponse: ServerMessage = {
				type: 'message_status',
				clientId: data.clientId,
				messageId,
				status: 'sent',
				serverTimestamp: now,
			};
			ws.send(JSON.stringify(confirmationResponse));

			// Broadcast to all other participants
			const broadcastMessage: ServerMessage = {
				type: 'new_message',
				message: newMessage,
			};
			const recipientsCount = this.broadcast(broadcastMessage, session.userId);
			
			// Send push notifications to offline participants
			await this.sendPushNotificationsForMessage(newMessage, session.userId);
			
			// If message was successfully delivered to at least one recipient, mark as delivered
			if (recipientsCount > 0) {
				// Update message status in storage so it persists
				await this.updateMessageStatus(messageId, 'delivered');
				
				const deliveredStatus: ServerMessage = {
					type: 'message_status',
					messageId,
					status: 'delivered',
					serverTimestamp: now,
				};
				// Send to sender and broadcast to all (in case sender reconnects later)
				ws.send(JSON.stringify(deliveredStatus));
				this.broadcast(deliveredStatus);
			}

		} catch (error) {
			console.error('Error handling send_message:', error);
			const errorResponse: ServerMessage = {
				type: 'error',
				code: 'SEND_MESSAGE_FAILED',
				message: 'Failed to send message',
				details: error,
			};
			ws.send(JSON.stringify(errorResponse));
		}
	}

	/**
	 * Handle mark_read request
	 */
	private async handleMarkRead(ws: WebSocket, session: Session, data: ClientMessage & { type: 'mark_read' }): Promise<void> {
		try {
			const now = new Date().toISOString();

			// Save read receipt in Durable Object storage
			await this.saveReadReceipt(data.messageId, data.userId);

			// Update message status to read
			await this.updateMessageStatus(data.messageId, 'read');

			// Track read timestamp in D1 for offline users
			await updateUserLastRead(this.env.DB, session.conversationId, data.userId, now);

			// Broadcast read receipt to all participants
			const readEvent: ServerMessage = {
				type: 'message_read',
				messageId: data.messageId,
				userId: data.userId,
				readAt: now,
			};
			this.broadcast(readEvent);

			// Send push notification to offline message sender
			await this.sendPushNotificationsForReadReceipt(data.messageId, data.userId, session.conversationId);

			console.log(`Read receipt for message ${data.messageId} by user ${data.userId}`);
		} catch (error) {
			console.error('Error handling mark_read:', error);
		}
	}

	/**
	 * Handle get_history request
	 */
	private async handleGetHistory(ws: WebSocket, session: Session, data: ClientMessage & { type: 'get_history' }): Promise<void> {
		try {
			const messages = await this.getMessages(
				data.conversationId,
				data.limit || 50,
				data.before
			);

			// Get read timestamps from D1 to compute accurate statuses for offline users
			const lastReadTimestamps = await getLastReadTimestamps(this.env.DB, data.conversationId);

			// Update message statuses based on D1 read timestamps
			const messagesWithStatus = messages.map(msg => {
				// If someone read messages after this one was sent, mark as read
				let finalStatus = msg.status;
				
				// Check each participant's last read timestamp
				for (const [userId, readTimestamp] of Object.entries(lastReadTimestamps)) {
					// Don't check sender's own read status
					if (userId === msg.senderId) continue;
					
					// If this message was created before user's last read time, it's been read
					if (new Date(msg.createdAt) <= new Date(readTimestamp)) {
						finalStatus = 'read';
						break; // At least one person read it
					}
				}
				
				return { ...msg, status: finalStatus };
			});

			const response: ServerMessage = {
				type: 'history_response',
				messages: messagesWithStatus,
				hasMore: messages.length === (data.limit || 50),
			};
			ws.send(JSON.stringify(response));

			// Notify senders that their undelivered messages are now delivered
			// Find all messages in history that were sent by others but not yet marked as delivered
			const undeliveredToMe = messages.filter(msg => 
				msg.senderId !== session.userId && 
				msg.status === 'sent'
			);

			if (undeliveredToMe.length > 0) {
				console.log(`📬 Marking ${undeliveredToMe.length} messages as delivered to ${session.userId}`);
				
				// Send delivered status to all senders
				for (const msg of undeliveredToMe) {
					const deliveredNotification: ServerMessage = {
						type: 'message_status',
						messageId: msg.id,
						status: 'delivered',
						serverTimestamp: new Date().toISOString(),
					};
					
					// Broadcast to everyone (senders will update their UI)
					this.broadcast(deliveredNotification);
				}
			}
		} catch (error) {
			console.error('Error handling get_history:', error);
			const errorResponse: ServerMessage = {
				type: 'error',
				code: 'GET_HISTORY_FAILED',
				message: 'Failed to get message history',
				details: error,
			};
			ws.send(JSON.stringify(errorResponse));
		}
	}

	/**
	 * Handle typing indicator
	 */
	private async handleTyping(ws: WebSocket, session: Session, data: ClientMessage & { type: 'typing' }): Promise<void> {
		// Broadcast typing indicator to all participants except sender
		const typingEvent: ServerMessage = {
			type: 'typing',
			conversationId: data.conversationId,
			userId: data.userId,
			isTyping: data.isTyping,
		};
		this.broadcast(typingEvent, session.userId);
	}

	/**
	 * Handle WebSocket close
	 */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		const session = this.sessions.get(ws);
		if (session) {
			// Broadcast offline status to remaining participants
			const presenceUpdate: ServerMessage = {
				type: 'presence_update',
				userId: session.userId,
				status: 'offline',
				timestamp: new Date().toISOString(),
			};
			this.broadcast(presenceUpdate);
			
			this.sessions.delete(ws);
		}
		ws.close(code, reason);
	}

	/**
	 * Handle WebSocket errors
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		const session = this.sessions.get(ws);
		console.error(`WebSocket error for user ${session?.userId || 'unknown'}:`, error);
		
		// Clean up errored connection
		if (session) {
			this.sessions.delete(ws);
		}
	}

	/**
	 * Broadcast a message to all connected clients in this conversation
	 * Excludes the sender by default
	 * Returns the number of clients the message was successfully sent to
	 */
	private broadcast(message: ServerMessage, excludeUserId?: string): number {
		const serialized = JSON.stringify(message);
		let sentCount = 0;

		for (const [ws, session] of this.sessions.entries()) {
			// Skip sender if excludeUserId is provided
			if (excludeUserId && session.userId === excludeUserId) {
				continue;
			}

			try {
				ws.send(serialized);
				sentCount++;
			} catch (error) {
				console.error(`Failed to send to user ${session.userId}:`, error);
				// Remove broken connections
				this.sessions.delete(ws);
			}
		}

		return sentCount;
	}

	/**
	 * Get list of currently connected user IDs
	 */
	private getConnectedUserIds(): string[] {
		return Array.from(this.sessions.values()).map(session => session.userId);
	}

	/**
	 * Save a message to SQLite storage
	 */
	private async saveMessage(message: Message): Promise<void> {
		const stmt = await this.ctx.storage.sql.exec(`
			INSERT INTO messages (
				id, conversation_id, sender_id, content, type, status,
				media_url, media_type, media_size, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, 
			message.id,
			message.conversationId,
			message.senderId,
			message.content,
			message.type,
			message.status,
			message.mediaUrl || null,
			message.mediaType || null,
			message.mediaSize || null,
			message.createdAt,
			message.updatedAt
		);

	}

	/**
	 * Get messages from SQLite storage
	 */
	private async getMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
		let query = `
			SELECT * FROM messages 
			WHERE conversation_id = ?
		`;
		const params: (string | number)[] = [conversationId];

		if (before) {
			query += ` AND created_at < (SELECT created_at FROM messages WHERE id = ?)`;
			params.push(before);
		}

		query += ` ORDER BY created_at DESC LIMIT ?`;
		params.push(limit);

		const cursor = this.ctx.storage.sql.exec(query, ...params);
		const rows: MessageRow[] = await cursor.toArray() as unknown as MessageRow[];

		// Convert DB rows to Message objects
		const messages: Message[] = rows.map(row => ({
			id: row.id,
			conversationId: row.conversation_id,
			senderId: row.sender_id,
			content: row.content,
			type: row.type as 'text' | 'image' | 'file',
			status: row.status as Message['status'],
			mediaUrl: row.media_url || undefined,
			mediaType: row.media_type || undefined,
			mediaSize: row.media_size || undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));

		return messages.reverse(); // Return in chronological order
	}

	/**
	 * Update message status
	 */
	private async updateMessageStatus(messageId: string, status: Message['status']): Promise<void> {
		await this.ctx.storage.sql.exec(
			`UPDATE messages SET status = ?, updated_at = ? WHERE id = ?`,
			status,
			new Date().toISOString(),
			messageId
		);
	}

	/**
	 * Save a read receipt
	 */
	private async saveReadReceipt(messageId: string, userId: string): Promise<void> {
		const readAt = new Date().toISOString();
		
		await this.ctx.storage.sql.exec(`
			INSERT OR REPLACE INTO read_receipts (message_id, user_id, read_at)
			VALUES (?, ?, ?)
		`, messageId, userId, readAt);

	}

	/**
	 * Get read receipts for a message
	 */
	private async getReadReceipts(messageId: string): Promise<ReadReceiptRow[]> {
		const cursor = this.ctx.storage.sql.exec(
			`SELECT * FROM read_receipts WHERE message_id = ?`,
			messageId
		);
		return await cursor.toArray() as unknown as ReadReceiptRow[];
	}

	/**
	 * Send push notifications to offline participants for new message
	 */
	private async sendPushNotificationsForMessage(message: Message, senderId: string): Promise<void> {
		try {
			// Get all participants from D1
			const participants = await this.getConversationParticipants(message.conversationId);
			
			// Get currently connected user IDs
			const connectedUserIds = new Set(this.getConnectedUserIds());
			
			// Find offline participants (excluding the sender)
			const offlineParticipants = participants.filter(
				p => p !== senderId && !connectedUserIds.has(p)
			);
			
			if (offlineParticipants.length === 0) {
				console.log('📱 No offline participants to notify');
				return;
			}
			
			console.log(`📱 Sending push notifications to ${offlineParticipants.length} offline participant(s)`);
			
			// Get push tokens for all offline participants
			const allTokens: string[] = [];
			for (const userId of offlineParticipants) {
				const tokens = await getPushTokensByUserId(this.env.DB, userId);
				allTokens.push(...tokens.map(t => t.token));
			}
			
			if (allTokens.length === 0) {
				console.log('📱 No push tokens found for offline participants');
				return;
			}
			
			// Get sender info for notification
			const senderInfo = await this.getUserInfo(senderId);
			const senderName = senderInfo?.name || 'Someone';
			
			// Send push notifications
			await sendMessageNotification(allTokens, message, senderName);
			console.log(`✅ Sent push notifications to ${allTokens.length} device(s)`);
		} catch (error) {
			console.error('❌ Failed to send push notifications for message:', error);
			// Don't throw - push notification failures shouldn't break message sending
		}
	}
	
	/**
	 * Send push notifications for read receipt to offline message sender
	 */
	private async sendPushNotificationsForReadReceipt(
		messageId: string, 
		readerId: string, 
		conversationId: string
	): Promise<void> {
		try {
			// Get the message to find the sender
			const messages = await this.getMessages(conversationId, 100);
			const message = messages.find(m => m.id === messageId);
			
			if (!message) {
				console.log('Message not found for read receipt notification');
				return;
			}
			
			// Check if sender is online
			const connectedUserIds = new Set(this.getConnectedUserIds());
			if (connectedUserIds.has(message.senderId)) {
				console.log('📱 Sender is online, skipping read receipt push notification');
				return;
			}
			
			console.log(`📱 Sending read receipt push notification to offline sender ${message.senderId}`);
			
			// Get push tokens for the sender
			const tokens = await getPushTokensByUserId(this.env.DB, message.senderId);
			
			if (tokens.length === 0) {
				console.log('📱 No push tokens found for message sender');
				return;
			}
			
			// Get reader info
			const readerInfo = await this.getUserInfo(readerId);
			const readerName = readerInfo?.name || 'Someone';
			
			// Send push notifications
			await sendReadReceiptNotification(
				tokens.map(t => t.token),
				messageId,
				conversationId,
				readerName
			);
			console.log(`✅ Sent read receipt notification to ${tokens.length} device(s)`);
		} catch (error) {
			console.error('❌ Failed to send push notifications for read receipt:', error);
			// Don't throw - push notification failures shouldn't break read receipt flow
		}
	}
	
	/**
	 * Get conversation participants from D1
	 */
	private async getConversationParticipants(conversationId: string): Promise<string[]> {
		try {
			const result = await this.env.DB
				.prepare('SELECT user_id FROM conversation_participants WHERE conversation_id = ?')
				.bind(conversationId)
				.all<{ user_id: string }>();
			
			return (result.results || []).map(row => row.user_id);
		} catch (error) {
			console.error('Failed to get conversation participants:', error);
			return [];
		}
	}
	
	/**
	 * Get user info from D1 (for notification display names)
	 */
	private async getUserInfo(userId: string): Promise<{ name?: string } | null> {
		try {
			const result = await this.env.DB
				.prepare('SELECT name FROM users WHERE id = ?')
				.bind(userId)
				.first<{ name: string | null }>();
			
			return result ? { name: result.name || undefined } : null;
		} catch (error) {
			console.error('Failed to get user info:', error);
			return null;
		}
	}

	/**
	 * Get message history (REST endpoint)
	 */
	private async handleGetMessages(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const conversationId = url.searchParams.get('conversationId');
		const limitStr = url.searchParams.get('limit');
		const before = url.searchParams.get('before') || undefined;

		if (!conversationId) {
			return new Response('conversationId required', { status: 400 });
		}

		const limit = limitStr ? parseInt(limitStr, 10) : 50;
		const messages = await this.getMessages(conversationId, limit, before);

		return new Response(JSON.stringify({ 
			messages,
			hasMore: messages.length === limit,
		}), {
			headers: { 'Content-Type': 'application/json' },
		});
	}
}

