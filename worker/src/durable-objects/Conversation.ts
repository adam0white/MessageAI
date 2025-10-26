import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, ServerMessage, Message } from '../types';
import { getPushTokensByUserId, updateConversationLastMessage, updateUserLastRead, getLastReadTimestamps } from '../db/schema';
import { sendMessageNotification, sendReadReceiptNotification } from '../handlers/notifications';
import { generateEmbedding, AI_MODELS } from '../handlers/ai';
import {
	AgentState,
	AgentWorkflowStep,
	AgentResponse,
	ToolCallRequest,
	ToolCallResult,
	TeamAvailability,
	TeamPreferences,
	VenueOption,
	PollResults,
	FinalPlan,
	AGENT_SYSTEM_PROMPT,
	WORKFLOW_TRANSITIONS,
	AGENT_TOOLS,
} from '../handlers/agent';

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

		// Agent state table for multi-step workflows
		await this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS agent_state (
				id TEXT PRIMARY KEY,
				conversation_id TEXT NOT NULL,
				user_id TEXT NOT NULL,
				current_step TEXT NOT NULL,
				goal TEXT NOT NULL,
				state_json TEXT NOT NULL,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)
		`);

		await this.ctx.storage.sql.exec(`
			CREATE INDEX IF NOT EXISTS idx_agent_conversation
			ON agent_state(conversation_id, created_at DESC)
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
		
		// Active call management endpoints
		if (url.pathname === '/active-call') {
			if (request.method === 'GET') {
				const meetingId = await this.ctx.storage.get<string>('activeCallMeetingId');
				return Response.json({ meetingId: meetingId || null });
			}
			
			if (request.method === 'PUT') {
				const body = await request.json() as { meetingId: string };
				await this.ctx.storage.put('activeCallMeetingId', body.meetingId);
				return Response.json({ success: true });
			}
			
			if (request.method === 'DELETE') {
				await this.ctx.storage.delete('activeCallMeetingId');
				return Response.json({ success: true });
			}
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
	 * RPC Method: Run Multi-Step Agent
	 * 
	 * Executes an autonomous agent for team event planning.
	 * The agent follows a multi-step workflow:
	 * 1. Parse user request (event type, date)
	 * 2. Analyze team availability
	 * 3. Extract preferences (food, location, budget)
	 * 4. Suggest venue options
	 * 5. Create poll for team vote
	 * 6. Finalize plan based on results
	 * 
	 * @param goal - Natural language goal (e.g., "Plan team lunch next Friday")
	 * @param userId - User who initiated the agent
	 * @param conversationId - Current conversation
	 * @returns Agent response with current step and progress
	 */
	async runAgent(goal: string, userId: string, conversationId: string): Promise<AgentResponse> {
		try {
			await this.initializeSQL();

			// Check if there's an existing agent state for this conversation
			let agentState = await this.getAgentState(conversationId, goal);

			// If no existing state, create new agent
			if (!agentState) {
				agentState = await this.createAgentState(conversationId, userId, goal);
			}

			// Execute the current workflow step
			const response = await this.executeAgentStep(agentState);

			// Save updated agent state
			await this.saveAgentState(agentState);

			// Broadcast agent progress to all participants
			await this.broadcastAgentProgress(agentState, response);

			return response;

		} catch (error) {
			return {
				success: false,
				currentStep: AgentWorkflowStep.FAILED,
				message: 'Agent encountered an unexpected error',
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	/**
	 * Get existing agent state from SQLite
	 */
	private async getAgentState(conversationId: string, newGoal?: string): Promise<AgentState | null> {
		const cursor = this.ctx.storage.sql.exec(
			`SELECT * FROM agent_state WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1`,
			conversationId
		);
		const rows = await cursor.toArray() as any[];

		if (rows.length === 0) {
			return null;
		}

		const row = rows[0];
		const stateJson = JSON.parse(row.state_json);
		const currentStep = row.current_step as AgentWorkflowStep;
		
		// If completed/failed or different goal, delete old state and return null
		if (currentStep === AgentWorkflowStep.COMPLETE || 
		    currentStep === AgentWorkflowStep.FAILED ||
		    (newGoal && row.goal !== newGoal)) {
			await this.ctx.storage.sql.exec(
				`DELETE FROM agent_state WHERE id = ?`,
				row.id
			);
			return null;
		}

		return {
			id: row.id,
			conversationId: row.conversation_id,
			userId: row.user_id,
			currentStep: currentStep,
			goal: row.goal,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			...stateJson,
		};
	}

	/**
	 * Create new agent state
	 */
	private async createAgentState(conversationId: string, userId: string, goal: string): Promise<AgentState> {
		const now = new Date().toISOString();
		const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		const agentState: AgentState = {
			id: agentId,
			conversationId,
			userId,
			currentStep: AgentWorkflowStep.INIT,
			goal,
			createdAt: now,
			updatedAt: now,
			stepHistory: [],
			errors: [],
		};

		return agentState;
	}

	/**
	 * Save agent state to SQLite
	 */
	private async saveAgentState(state: AgentState): Promise<void> {
		const now = new Date().toISOString();
		state.updatedAt = now;

		// Separate core fields from JSON state
		const { id, conversationId, userId, currentStep, goal, createdAt, updatedAt, ...jsonState } = state;

		await this.ctx.storage.sql.exec(
			`INSERT OR REPLACE INTO agent_state (id, conversation_id, user_id, current_step, goal, state_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id,
			conversationId,
			userId,
			currentStep,
			goal,
			JSON.stringify(jsonState),
			createdAt,
			updatedAt
		);
	}

	/**
	 * Execute current agent workflow step
	 */
	private async executeAgentStep(state: AgentState): Promise<AgentResponse> {

		try {
			switch (state.currentStep) {
				case AgentWorkflowStep.INIT:
					return await this.agentStepInit(state);
				
				case AgentWorkflowStep.AVAILABILITY:
					return await this.agentStepAvailability(state);
				
				case AgentWorkflowStep.PREFERENCES:
					return await this.agentStepPreferences(state);
				
				case AgentWorkflowStep.VENUES:
					return await this.agentStepVenues(state);
				
				case AgentWorkflowStep.POLL:
					return await this.agentStepPoll(state);
				
				case AgentWorkflowStep.CONFIRM:
					return await this.agentStepConfirm(state);
				
				case AgentWorkflowStep.COMPLETE:
					// Already completed - return final plan
					return {
						success: true,
						currentStep: AgentWorkflowStep.COMPLETE,
						message: state.finalPlan ? 'Event planning complete!' : 'Workflow finished',
						data: state.finalPlan,
						completed: true,
					};
				
				case AgentWorkflowStep.FAILED:
					// Already failed - return error state
					const lastError = state.errors[state.errors.length - 1];
					return {
						success: false,
						currentStep: AgentWorkflowStep.FAILED,
						message: 'Agent workflow failed',
						error: lastError?.error || 'Unknown error',
						completed: true,
					};
				
				default:
					return {
						success: false,
						currentStep: state.currentStep,
						message: `Unknown workflow step: ${state.currentStep}`,
						error: 'Invalid state',
					};
			}
		} catch (error) {
			console.error(`[Agent] Step ${state.currentStep} failed:`, error);
			
			// Record error
			state.errors.push({
				step: state.currentStep,
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : 'Unknown error',
				recoveryAttempted: false,
			});

			// Attempt recovery (retry once)
			const canRetry = state.errors.filter(e => e.step === state.currentStep).length < 2;
			
			if (canRetry) {
				state.errors[state.errors.length - 1].recoveryAttempted = true;
				return await this.executeAgentStep(state);
			}

			// Failed after retry
			state.currentStep = AgentWorkflowStep.FAILED;
			return {
				success: false,
				currentStep: AgentWorkflowStep.FAILED,
				message: `Step ${state.currentStep} failed after retry`,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	/**
	 * Step 1: INIT - Parse user request and extract event details
	 */
	private async agentStepInit(state: AgentState): Promise<AgentResponse> {

		// Get recent messages for context
		const messages = await this.getMessages(state.conversationId, 20);
		const recentContext = messages.slice(-10)
			.map(msg => `${msg.senderId}: ${msg.content}`)
			.join('\n');

		const systemPrompt = `You are analyzing a team event planning request.
Extract the following information:
- eventType: "meeting", "lunch", "dinner", "coffee", etc. (use "meeting" if unclear or just scheduling time)
- needsVenue: true if food/venue is involved, false for simple meetings/calls
- eventDate: proposed date (convert relative dates to ISO format YYYY-MM-DD, or "flexible" if not specified)
- eventTime: proposed time (or "flexible" if not specified)

Output JSON format:
{
  "eventType": "meeting",
  "needsVenue": false,
  "eventDate": "2025-10-31",
  "eventTime": "2:00 PM"
}

Be specific. If someone says "quick meeting" or "when can we meet", set needsVenue to false.
Only set needsVenue to true for food events (lunch, dinner, coffee, etc.).`;

		const userPrompt = `Recent conversation context:
${recentContext}

User's request: "${state.goal}"

Extract the event details from this request.`;

		// Call Workers AI
		const aiResponse: any = await (this.env.AI as any).run(
			AI_MODELS.LLAMA_8B,
			{
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				],
				max_tokens: 256,
				temperature: 0.2,
			},
			{
				gateway: {
					id: 'aw-cf-ai',
					metadata: {
						conversationId: state.conversationId,
						operation: 'agent-init',
					}
				}
			}
		);

		const responseText = aiResponse.response as string;
		
		let needsVenue = false;
		
		// Parse JSON response
		try {
			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				state.eventType = parsed.eventType || 'meeting';
				state.eventDate = parsed.eventDate || 'flexible';
				state.eventTime = parsed.eventTime || 'flexible';
				needsVenue = parsed.needsVenue || false;
			}
		} catch (parseError) {
			// Fallback extraction
			const goalLower = state.goal.toLowerCase();
			if (goalLower.includes('lunch') || goalLower.includes('dinner') || goalLower.includes('coffee')) {
				state.eventType = goalLower.includes('lunch') ? 'lunch' : goalLower.includes('dinner') ? 'dinner' : 'coffee';
				needsVenue = true;
			} else {
				state.eventType = 'meeting';
				needsVenue = false;
			}
			state.eventDate = 'flexible';
			state.eventTime = 'flexible';
		}

		// Update state with venue flag
		(state as any).needsVenue = needsVenue;

		// Update state
		state.currentStep = AgentWorkflowStep.AVAILABILITY;
		state.stepHistory.push({
			step: AgentWorkflowStep.INIT,
			timestamp: new Date().toISOString(),
			result: 'success',
			data: { eventType: state.eventType, eventDate: state.eventDate, eventTime: state.eventTime, needsVenue },
			message: `Planning ${state.eventType}${state.eventDate !== 'flexible' ? ` for ${state.eventDate}` : ''}`,
		});

		const dateInfo = state.eventDate !== 'flexible' ? ` on ${state.eventDate}` : '';
		const timeInfo = state.eventTime !== 'flexible' ? ` at ${state.eventTime}` : '';

		return {
			success: true,
			currentStep: AgentWorkflowStep.AVAILABILITY,
			nextStep: AgentWorkflowStep.AVAILABILITY,
			message: `🎯 Planning ${state.eventType}${dateInfo}${timeInfo}. Analyzing team availability...`,
		};
	}

	/**
	 * Step 2: AVAILABILITY - Analyze conversation for team availability
	 */
	private async agentStepAvailability(state: AgentState): Promise<AgentResponse> {

		// Get recent messages
		const messages = await this.getMessages(state.conversationId, 50);
		
		// Format messages for AI analysis
		const conversationText = messages
			.map(msg => `[${msg.senderId}]: ${msg.content}`)
			.join('\n');

		const systemPrompt = `Analyze team availability from conversation messages.
Look for:
- Proposed times/dates ("2pm works", "I'm free Thursday", "tomorrow at 3", "earliest I can do is Friday")
- Availability phrases: "I'm free", "I can make it", "works for me" → available
- Busy indicators: "I'm busy", "I can't", "not available" → unavailable
- Tentative: "maybe", "might work", "I'll try" → tentative

Output JSON:
{
  "availableMembers": ["user1", "user2"],
  "unavailableMembers": ["user3"],
  "maybeMembers": ["user4"],
  "suggestedTimes": ["2:00 PM Thursday", "Friday 3:00 PM"],
  "suggestedDates": ["2025-10-30", "2025-10-31"],
  "conflicts": ["user3 has meeting"],
  "confidence": 0.8
}

Extract actual dates/times mentioned in the conversation. Be specific.`;

		const userPrompt = `Analyze availability for "${state.eventType}":\n\n${conversationText.substring(0, 3000)}`;

		const aiResponse: any = await (this.env.AI as any).run(
			AI_MODELS.LLAMA_8B,
			{
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				],
				max_tokens: 512,
				temperature: 0.2,
			},
			{
				gateway: {
					id: 'aw-cf-ai',
					metadata: {
						conversationId: state.conversationId,
						operation: 'agent-availability',
					}
				}
			}
		);

		const responseText = aiResponse.response as string;
		
		// Parse availability
		try {
			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				state.availability = JSON.parse(jsonMatch[0]);
			}
		} catch (parseError) {
			// Fallback
			state.availability = {
				availableMembers: [],
				unavailableMembers: [],
				maybeMembers: [],
				suggestedTimes: [],
				conflicts: [],
				confidence: 0.3,
			};
		}

		// Extract availability for use
		const availability = state.availability!;
		
		// Determine next step based on event type
		const needsVenue = (state as any).needsVenue || false;
		const nextStep = needsVenue ? AgentWorkflowStep.PREFERENCES : AgentWorkflowStep.CONFIRM;
		
		state.currentStep = nextStep;
		state.stepHistory.push({
			step: AgentWorkflowStep.AVAILABILITY,
			timestamp: new Date().toISOString(),
			result: 'success',
			data: availability,
			message: `Analyzed availability: ${availability.suggestedTimes.length} time slots found`,
		});

		// Build message
		let message = '';
		if (availability.suggestedTimes.length > 0) {
			message = `✅ Found ${availability.suggestedTimes.length} possible time${availability.suggestedTimes.length > 1 ? 's' : ''}: ${availability.suggestedTimes.slice(0, 2).join(', ')}. `;
		} else {
			message = `⚠️ No specific times mentioned yet. `;
		}
		
		if (needsVenue) {
			message += 'Analyzing venue preferences...';
		} else {
			message += 'Finalizing meeting details...';
		}

		return {
			success: true,
			currentStep: nextStep,
			nextStep: nextStep,
			message,
			data: availability,
		};
	}

	/**
	 * Step 3: PREFERENCES - Extract team preferences for food, location, etc.
	 */
	private async agentStepPreferences(state: AgentState): Promise<AgentResponse> {

		// Get more messages for preference analysis
		const messages = await this.getMessages(state.conversationId, 100);
		
		const conversationText = messages
			.map(msg => `[${msg.senderId}]: ${msg.content}`)
			.join('\n');

		const systemPrompt = `Extract team preferences from conversation messages.
Look for mentions of:
- Cuisine types (Italian, Mexican, sushi, etc.)
- Locations (downtown, near office, specific neighborhoods)
- Price preferences (cheap, moderate, nice place, etc.)
- Dietary restrictions (vegetarian, vegan, gluten-free, allergies)

Output JSON:
{
  "cuisineTypes": [{"type": "Italian", "count": 2}, {"type": "Mexican", "count": 1}],
  "locations": [{"location": "Downtown", "count": 3}],
  "priceRange": "moderate",
  "dietaryRestrictions": ["vegetarian", "gluten-free"],
  "confidence": 0.7
}`;

		const userPrompt = `Extract preferences for team ${state.eventType}:\n\n${conversationText.substring(0, 3000)}`;

		const aiResponse: any = await (this.env.AI as any).run(
			AI_MODELS.LLAMA_8B,
			{
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				],
				max_tokens: 512,
				temperature: 0.2,
			},
			{
				gateway: {
					id: 'aw-cf-ai',
					metadata: {
						conversationId: state.conversationId,
						operation: 'agent-preferences',
					}
				}
			}
		);

		const responseText = aiResponse.response as string;
		
		// Parse preferences
		try {
			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				state.preferences = JSON.parse(jsonMatch[0]);
			}
		} catch (parseError) {
			// Fallback
			state.preferences = {
				cuisineTypes: [{ type: 'Any', count: 1 }],
				locations: [{ location: 'Nearby', count: 1 }],
				priceRange: 'moderate',
				dietaryRestrictions: [],
				confidence: 0.3,
			};
		}

		// Extract preferences for use (guaranteed to be set above)
		const preferences = state.preferences!;
		
		// Decide whether to suggest venues or just use top preference
		const hasStrongPreferences = preferences.cuisineTypes.length > 0 && 
		                             preferences.cuisineTypes[0].count > 1;
		
		// Skip poll step - just pick top 2 venues and let team decide via messages
		// Move directly to VENUES step
		state.currentStep = AgentWorkflowStep.VENUES;
		
		state.stepHistory.push({
			step: AgentWorkflowStep.PREFERENCES,
			timestamp: new Date().toISOString(),
			result: 'success',
			data: preferences,
			message: `Preferences analyzed: ${preferences.cuisineTypes.map(c => c.type).join(', ')}`,
		});

		const topCuisine = preferences.cuisineTypes[0]?.type || 'various';
		const topLocation = preferences.locations[0]?.location || 'nearby';

		return {
			success: true,
			currentStep: AgentWorkflowStep.VENUES,
			nextStep: AgentWorkflowStep.VENUES,
			message: `🍽️ Team prefers ${topCuisine} food in ${topLocation}. Finding venue options...`,
			data: preferences,
		};
	}

	/**
	 * Step 4: VENUES - Suggest venue options based on preferences
	 */
	private async agentStepVenues(state: AgentState): Promise<AgentResponse> {

		const preferences = state.preferences || {
			cuisineTypes: [{ type: 'Any', count: 1 }],
			locations: [{ location: 'Nearby', count: 1 }],
			priceRange: 'moderate',
			dietaryRestrictions: [],
			confidence: 0.3,
		};

		const topCuisine = preferences.cuisineTypes[0]?.type || 'Any';
		const topLocation = preferences.locations[0]?.location || 'Nearby';
		const priceRange = preferences.priceRange || 'moderate';
		const restrictions = preferences.dietaryRestrictions.join(', ') || 'none';

		const systemPrompt = `You are a restaurant recommendation expert.
Generate 2 realistic venue suggestions based on team preferences.

Output JSON (REQUIRED):
{
  "venues": [
    {
      "name": "Restaurant Name",
      "location": "Area/neighborhood only (NOT full address)",
      "cuisineType": "Italian",
      "priceRange": "moderate",
      "matchScore": 0.9,
      "reason": "Short reason why this fits the team"
    }
  ]
}

IMPORTANT: 
- Use location like "Downtown", "Mission District", "Near Financial District" - NOT full addresses
- Generate diverse but realistic restaurant names
- Provide 2 options only`;

		const userPrompt = `Suggest 2 venues for team ${state.eventType}:
- Cuisine: ${topCuisine}
- Location: ${topLocation}
- Budget: ${priceRange}
- Dietary needs: ${restrictions}

Generate realistic venue names (no fake addresses).`;

		const aiResponse: any = await (this.env.AI as any).run(
			AI_MODELS.LLAMA_8B,
			{
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				],
				max_tokens: 600,
				temperature: 0.7, // Higher temperature for creative venue names
			},
			{
				gateway: {
					id: 'aw-cf-ai',
					metadata: {
						conversationId: state.conversationId,
						operation: 'agent-venues',
					}
				}
			}
		);

		const responseText = aiResponse.response as string;
		
		// Parse venues
		let venues: VenueOption[] = [];
		try {
			const jsonMatch = responseText.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]);
				venues = parsed.venues || [];
			}
		} catch (parseError) {
			console.error('Failed to parse venues:', parseError);
		}

		// Fallback if no venues generated - provide generic options
		if (venues.length === 0) {
			venues = [
				{
					name: `${topCuisine} Restaurant`,
					location: topLocation,
					cuisineType: topCuisine,
					priceRange: priceRange,
					matchScore: 0.8,
					reason: 'Matches team preferences',
				},
				{
					name: `${topLocation} Cafe`,
					location: topLocation,
					cuisineType: 'Casual',
					priceRange: priceRange,
					matchScore: 0.7,
					reason: 'Convenient location',
				},
			];
		}

		// Keep only top 2
		state.venueOptions = venues.slice(0, 2);

		// Skip POLL step - go directly to CONFIRM
		state.currentStep = AgentWorkflowStep.CONFIRM;
		state.stepHistory.push({
			step: AgentWorkflowStep.VENUES,
			timestamp: new Date().toISOString(),
			result: 'success',
			data: { venues: state.venueOptions },
			message: `Generated ${state.venueOptions.length} venue options`,
		});

		// Build message listing venues
		const venueList = state.venueOptions.map((v, i) => 
			`${i + 1}. ${v.name} (${v.cuisineType} in ${v.location}) - ${v.reason}`
		).join('\n');

		return {
			success: true,
			currentStep: AgentWorkflowStep.CONFIRM,
			nextStep: AgentWorkflowStep.CONFIRM,
			message: `🏪 Here are 2 venue options:\n${venueList}\n\nSelecting top match...`,
			data: { venues: state.venueOptions },
		};
	}

	/**
	 * Step 5: POLL - Create poll for team to vote on venues
	 */
	private async agentStepPoll(state: AgentState): Promise<AgentResponse> {

		const venues = state.venueOptions || [];
		
		if (venues.length === 0) {
			throw new Error('No venue options available for poll');
		}

		// Create poll (simplified - in production would use actual poll system)
		const pollId = `poll_${Date.now()}`;
		const pollQuestion = `Where should we go for ${state.eventType} on ${state.eventDate}?`;
		
		const pollOptions = venues.map((venue, idx) => ({
			id: `option_${idx}`,
			text: `${venue.name} - ${venue.cuisineType} (${venue.priceRange})`,
			votes: 0,
		}));

		state.pollResults = {
			pollId,
			question: pollQuestion,
			options: pollOptions,
			votes: {},
			createdAt: new Date().toISOString(),
		};

		// For demo, auto-select the highest match score venue as "winner"
		const winnerVenue = venues.reduce((best, current) => 
			current.matchScore > best.matchScore ? current : best
		);
		const winnerOption = pollOptions.find(opt => opt.text.includes(winnerVenue.name));
		state.pollResults.winner = winnerOption?.id;

		// Move to next step
		state.currentStep = AgentWorkflowStep.CONFIRM;
		state.stepHistory.push({
			step: AgentWorkflowStep.POLL,
			timestamp: new Date().toISOString(),
			result: 'success',
			data: state.pollResults,
			message: `Poll created with ${pollOptions.length} options`,
		});

		return {
			success: true,
			currentStep: AgentWorkflowStep.CONFIRM,
			nextStep: AgentWorkflowStep.CONFIRM,
			message: `📊 Poll created! Top choice: ${winnerVenue.name}. Finalizing plan...`,
			data: state.pollResults,
		};
	}

	/**
	 * Step 6: CONFIRM - Finalize the event plan
	 */
	private async agentStepConfirm(state: AgentState): Promise<AgentResponse> {

		const needsVenue = (state as any).needsVenue || false;
		const availability = state.availability || {
			availableMembers: [],
			unavailableMembers: [],
			maybeMembers: [],
			suggestedTimes: [],
			conflicts: [],
			confidence: 0,
		};

		// Determine best time from availability or state
		let finalDate: string = (state.eventDate && state.eventDate !== 'flexible') ? state.eventDate : 'To be decided';
		let finalTime: string = (state.eventTime && state.eventTime !== 'flexible') ? state.eventTime : 'To be decided';
		
		// Use suggested times from availability if available
		if (availability.suggestedTimes && availability.suggestedTimes.length > 0) {
			const firstSuggestion = availability.suggestedTimes[0];
			// Parse out date if it's in the suggestion
			if (finalDate === 'To be decided' && firstSuggestion.match(/\d{4}-\d{2}-\d{2}/)) {
				const dateMatch = firstSuggestion.match(/\d{4}-\d{2}-\d{2}/);
				if (dateMatch) finalDate = dateMatch[0];
			}
			// Parse out time
			if (finalTime === 'To be decided') {
				finalTime = firstSuggestion.replace(/\d{4}-\d{2}-\d{2}/, '').trim() || firstSuggestion;
			}
		}

		// Create final plan
		const eventType = state.eventType || 'event';
		
		if (needsVenue) {
			// Food event - include venue
			const venues = state.venueOptions || [];
			const selectedVenue = venues.length > 0 ? venues[0] : null;

			if (!selectedVenue) {
				throw new Error('No venue selected for food event');
			}

			const finalPlan: FinalPlan = {
				eventType: eventType,
				date: finalDate,
				time: finalTime,
				venue: selectedVenue.name,
				location: selectedVenue.location,
				attendees: [],
				confirmedAt: new Date().toISOString(),
			};
			
			state.finalPlan = finalPlan;

			// Broadcast final message BEFORE transitioning to COMPLETE
			const finalMessage = `✅ ${eventType.toUpperCase()} Confirmed!\n\n⏰ ${finalPlan.date} at ${finalPlan.time}\n🏪 ${finalPlan.venue}\n📍 ${finalPlan.location}\n\nLooking forward to it!`;
			
			// Save and broadcast now while still in CONFIRM state
			await this.broadcastAgentMessage(state.conversationId, finalMessage);

			// Mark workflow as complete AFTER broadcasting
			state.currentStep = AgentWorkflowStep.COMPLETE;
			state.stepHistory.push({
				step: AgentWorkflowStep.CONFIRM,
				timestamp: new Date().toISOString(),
				result: 'success',
				data: finalPlan,
				message: 'Event plan finalized with venue',
			});

			return {
				success: true,
				currentStep: AgentWorkflowStep.COMPLETE,
				message: finalMessage,
				data: finalPlan,
				completed: true,
			};
		} else {
			// Simple meeting - no venue needed
			const finalPlan: FinalPlan = {
				eventType: eventType,
				date: finalDate,
				time: finalTime,
				venue: 'N/A',
				location: 'Virtual/TBD',
				attendees: [],
				confirmedAt: new Date().toISOString(),
			};
			
			state.finalPlan = finalPlan;

			// Build summary message
			let summary = `✅ ${eventType.toUpperCase()} Scheduled!\n\n`;
			
			if (finalDate !== 'To be decided' && finalTime !== 'To be decided') {
				summary += `⏰ ${finalDate} at ${finalTime}\n\n`;
			} else if (availability.suggestedTimes.length > 0) {
				summary += `⏰ Suggested times:\n${availability.suggestedTimes.slice(0, 3).map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n`;
			} else {
				summary += `⏰ Time: ${finalDate} at ${finalTime}\n\n`;
			}
			
			summary += `Team can coordinate the final time in this chat.`;

			// Broadcast final message BEFORE transitioning to COMPLETE
			await this.broadcastAgentMessage(state.conversationId, summary);

			// Mark workflow as complete AFTER broadcasting
			state.currentStep = AgentWorkflowStep.COMPLETE;
			state.stepHistory.push({
				step: AgentWorkflowStep.CONFIRM,
				timestamp: new Date().toISOString(),
				result: 'success',
				data: finalPlan,
				message: 'Meeting scheduled',
			});

			return {
				success: true,
				currentStep: AgentWorkflowStep.COMPLETE,
				message: summary,
				data: finalPlan,
				completed: true,
			};
		}
	}

	/**
	 * Helper: Broadcast agent message to conversation
	 */
	private async broadcastAgentMessage(conversationId: string, messageContent: string): Promise<void> {
		const agentMessageId = `msg_agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const now = new Date().toISOString();

		// Save agent message to DO
		await this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, conversation_id, sender_id, content, type, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			agentMessageId,
			conversationId,
			'agent-planner',
			messageContent,
			'text',
			'sent',
			now,
			now
		);

		// Update D1 conversation last message
		try {
			await updateConversationLastMessage(
				this.env.DB,
				conversationId,
				now,
				messageContent.substring(0, 200),
				'agent-planner'
			);
		} catch (error) {
			console.error('Failed to update D1 last message:', error);
		}

		// Broadcast to all participants
		const agentMessage: ServerMessage = {
			type: 'new_message',
			message: {
				id: agentMessageId,
				conversationId: conversationId,
				senderId: 'agent-planner',
				content: messageContent,
				type: 'text',
				status: 'sent',
				createdAt: now,
				updatedAt: now,
			}
		};
		this.broadcast(agentMessage);
	}

	/**
	 * Broadcast agent progress as a message to the conversation
	 */
	private async broadcastAgentProgress(state: AgentState, response: AgentResponse): Promise<void> {
		// Don't broadcast error messages or completion states (already handled in step)
		if (!response.success || state.currentStep === AgentWorkflowStep.COMPLETE || state.currentStep === AgentWorkflowStep.FAILED) {
			return;
		}
		
		// Broadcast progress message
		await this.broadcastAgentMessage(state.conversationId, response.message);
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
					try {
						if (ws.readyState === WebSocket.OPEN) {
							const errorResponse: ServerMessage = {
								type: 'error',
								code: 'UNKNOWN_MESSAGE_TYPE',
								message: `Unknown message type: ${(data as any).type}`,
							};
							ws.send(JSON.stringify(errorResponse));
						}
					} catch (e) {
						// Connection closed
					}
				}
		} catch (error) {
			console.error('Failed to parse message:', error);
			try {
				if (ws.readyState === WebSocket.OPEN) {
					const errorResponse: ServerMessage = {
						type: 'error',
						code: 'PARSE_ERROR',
						message: 'Failed to parse message',
						details: error
					};
					ws.send(JSON.stringify(errorResponse));
				}
			} catch (e) {
				// Connection closed - can't send error
			}
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

			// Send confirmation to sender (check if still connected)
			const confirmationResponse: ServerMessage = {
				type: 'message_status',
				clientId: data.clientId,
				messageId,
				status: 'sent',
				serverTimestamp: now,
			};
			
			try {
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify(confirmationResponse));
				}
			} catch (e) {
				// Sender disconnected before confirmation - message still saved
			}

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
				// Send to sender (if still connected) and broadcast to all
				try {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify(deliveredStatus));
					}
				} catch (e) {
					// Sender disconnected - status will sync on reconnect
				}
				this.broadcast(deliveredStatus);
			}

		} catch (error) {
			console.error('Error handling send_message:', error);
			
			// Try to send error response if connection still open
			try {
				if (ws.readyState === WebSocket.OPEN) {
					const errorResponse: ServerMessage = {
						type: 'error',
						code: 'SEND_MESSAGE_FAILED',
						message: 'Failed to send message',
						details: error,
					};
					ws.send(JSON.stringify(errorResponse));
				}
			} catch (e) {
				// Connection closed - can't notify client
			}
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
		const toRemove: WebSocket[] = [];

		for (const [ws, session] of this.sessions.entries()) {
			// Skip sender if excludeUserId is provided
			if (excludeUserId && session.userId === excludeUserId) {
				continue;
			}

			try {
				// Check if WebSocket is still open before sending
				if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
					ws.send(serialized);
					sentCount++;
				} else {
					// Connection is closing or closed, mark for removal
					toRemove.push(ws);
				}
			} catch (error) {
				// Silently handle closed connections - this is normal during high volume
				if (!(error as Error).toString().includes('after close')) {
					console.error(`Failed to send to user ${session.userId}:`, error);
				}
				toRemove.push(ws);
			}
		}

		// Clean up broken connections
		toRemove.forEach(ws => this.sessions.delete(ws));

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
				return;
			}
			
			// Get push tokens for all offline participants
			const allTokens: string[] = [];
			for (const userId of offlineParticipants) {
				const tokens = await getPushTokensByUserId(this.env.DB, userId);
				allTokens.push(...tokens.map(t => t.token));
			}
		
		if (allTokens.length === 0) {
			return;
		}
		
		// Get sender info for notification
		const senderInfo = await this.getUserInfo(senderId);
		const senderName = senderInfo?.name || 'Someone';
		
		// Send push notifications
		await sendMessageNotification(allTokens, message, senderName);
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
			return;
		}
		
		// Check if sender is online
		const connectedUserIds = new Set(this.getConnectedUserIds());
		if (connectedUserIds.has(message.senderId)) {
			return;
		}
		
		// Get push tokens for the sender
		const tokens = await getPushTokensByUserId(this.env.DB, message.senderId);
		
		if (tokens.length === 0) {
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

