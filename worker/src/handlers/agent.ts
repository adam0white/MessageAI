/**
 * Multi-Step Agent for Team Event Planning
 * 
 * Implements an autonomous agent that can:
 * - Analyze conversation for availability
 * - Suggest venues based on preferences
 * - Create polls for team decisions
 * - Confirm and finalize plans
 * 
 * Uses Workers AI with tool calling for decision-making
 * and state management in Durable Object SQLite.
 */

import { AI_MODELS } from './ai';

/**
 * Agent Workflow Steps
 * 
 * The agent follows a sequential workflow for event planning:
 * 1. INIT - Parse user request and extract event details
 * 2. AVAILABILITY - Analyze messages for team availability
 * 3. PREFERENCES - Extract food/location preferences
 * 4. VENUES - Suggest venues based on preferences
 * 5. POLL - Create poll for team vote
 * 6. CONFIRM - Finalize plan with consensus
 * 7. COMPLETE - Agent finished successfully
 * 8. FAILED - Agent encountered unrecoverable error
 */
export enum AgentWorkflowStep {
	INIT = 'init',
	AVAILABILITY = 'availability',
	PREFERENCES = 'preferences',
	VENUES = 'venues',
	POLL = 'poll',
	CONFIRM = 'confirm',
	COMPLETE = 'complete',
	FAILED = 'failed',
}

/**
 * Agent State
 * 
 * Stores the current state of the agent workflow
 */
export interface AgentState {
	id: string; // Unique agent execution ID
	conversationId: string;
	userId: string; // User who initiated the agent
	currentStep: AgentWorkflowStep;
	goal: string; // Natural language goal (e.g., "Plan team lunch next Friday")
	createdAt: string;
	updatedAt: string;
	
	// Extracted information
	eventType?: string; // lunch, meeting, happy hour, etc.
	eventDate?: string; // Proposed date
	eventTime?: string; // Proposed time
	
	// Analysis results
	availability?: TeamAvailability;
	preferences?: TeamPreferences;
	venueOptions?: VenueOption[];
	pollResults?: PollResults;
	finalPlan?: FinalPlan;
	
	// Agent memory
	stepHistory: StepHistory[];
	errors: AgentError[];
}

/**
 * Team Availability Analysis
 */
export interface TeamAvailability {
	availableMembers: string[]; // User IDs who are available
	unavailableMembers: string[]; // User IDs who are unavailable
	maybeMembers: string[]; // User IDs who are tentative
	suggestedTimes: string[]; // Time slots with most availability
	conflicts: string[]; // Known scheduling conflicts
	confidence: number; // 0-1 confidence in analysis
}

/**
 * Team Preferences Analysis
 */
export interface TeamPreferences {
	cuisineTypes: { type: string; count: number }[]; // Italian, Mexican, etc.
	locations: { location: string; count: number }[]; // Downtown, Near office, etc.
	priceRange: 'budget' | 'moderate' | 'upscale' | 'any';
	dietaryRestrictions: string[]; // Vegetarian, gluten-free, etc.
	confidence: number; // 0-1 confidence in analysis
}

/**
 * Venue Option
 */
export interface VenueOption {
	name: string;
	location: string;
	cuisineType: string;
	priceRange: string;
	matchScore: number; // 0-1 how well it matches preferences
	reason: string; // Why this venue was suggested
}

/**
 * Poll Results
 */
export interface PollResults {
	pollId: string;
	question: string;
	options: PollOption[];
	votes: { [userId: string]: string }; // userId -> optionId
	winner?: string; // Winning option
	createdAt: string;
}

export interface PollOption {
	id: string;
	text: string;
	votes: number;
}

/**
 * Final Plan
 */
export interface FinalPlan {
	eventType: string;
	date: string;
	time: string;
	venue: string;
	location: string;
	attendees: string[];
	confirmedAt: string;
}

/**
 * Step History
 * 
 * Tracks what happened at each workflow step
 */
export interface StepHistory {
	step: AgentWorkflowStep;
	timestamp: string;
	result: 'success' | 'partial' | 'failed';
	data?: any; // Step-specific data
	message?: string; // Human-readable description
}

/**
 * Agent Error
 */
export interface AgentError {
	step: AgentWorkflowStep;
	timestamp: string;
	error: string;
	recoveryAttempted: boolean;
}

/**
 * Tool Definitions for Agent
 * 
 * These tools are available to the agent for execution.
 * The agent decides which tools to call based on the current workflow step.
 */
export interface AgentTool {
	name: string;
	description: string;
	parameters: ToolParameter[];
}

export interface ToolParameter {
	name: string;
	type: 'string' | 'number' | 'boolean' | 'array' | 'object';
	description: string;
	required: boolean;
}

/**
 * Available Tools
 */
export const AGENT_TOOLS: AgentTool[] = [
	{
		name: 'analyze_availability',
		description: 'Analyze conversation messages to extract team member availability for an event',
		parameters: [
			{
				name: 'eventDate',
				type: 'string',
				description: 'The proposed date for the event (e.g., "next Friday", "Dec 15")',
				required: true,
			},
			{
				name: 'messageLimit',
				type: 'number',
				description: 'Number of recent messages to analyze (default: 50)',
				required: false,
			}
		]
	},
	{
		name: 'extract_preferences',
		description: 'Extract team preferences for food, location, price range from conversation',
		parameters: [
			{
				name: 'messageLimit',
				type: 'number',
				description: 'Number of recent messages to analyze (default: 100)',
				required: false,
			}
		]
	},
	{
		name: 'suggest_venues',
		description: 'Generate venue suggestions based on team preferences and availability',
		parameters: [
			{
				name: 'cuisineType',
				type: 'string',
				description: 'Preferred cuisine type (e.g., "Italian", "Mexican", "Any")',
				required: false,
			},
			{
				name: 'location',
				type: 'string',
				description: 'Preferred location (e.g., "Downtown", "Near office")',
				required: false,
			},
			{
				name: 'priceRange',
				type: 'string',
				description: 'Price range: budget, moderate, upscale',
				required: false,
			},
			{
				name: 'count',
				type: 'number',
				description: 'Number of venue suggestions to generate (default: 3)',
				required: false,
			}
		]
	},
	{
		name: 'create_poll',
		description: 'Create a poll for team members to vote on options (venues, times, etc.)',
		parameters: [
			{
				name: 'question',
				type: 'string',
				description: 'The poll question',
				required: true,
			},
			{
				name: 'options',
				type: 'array',
				description: 'Array of poll options (strings)',
				required: true,
			}
		]
	},
	{
		name: 'analyze_poll_results',
		description: 'Analyze poll votes and determine the winning option',
		parameters: [
			{
				name: 'pollId',
				type: 'string',
				description: 'ID of the poll to analyze',
				required: true,
			}
		]
	},
	{
		name: 'finalize_plan',
		description: 'Create and confirm the final event plan',
		parameters: [
			{
				name: 'eventType',
				type: 'string',
				description: 'Type of event (lunch, meeting, etc.)',
				required: true,
			},
			{
				name: 'date',
				type: 'string',
				description: 'Event date',
				required: true,
			},
			{
				name: 'time',
				type: 'string',
				description: 'Event time',
				required: true,
			},
			{
				name: 'venue',
				type: 'string',
				description: 'Selected venue name',
				required: true,
			},
			{
				name: 'location',
				type: 'string',
				description: 'Venue location/address',
				required: true,
			}
		]
	}
];

/**
 * System Prompt for Agent
 */
export const AGENT_SYSTEM_PROMPT = `You are an intelligent event planning assistant helping remote teams coordinate gatherings.

Your capabilities:
- Analyze team conversations to extract availability and preferences
- Suggest appropriate venues based on team preferences
- Create polls for democratic decision-making
- Finalize event plans with all necessary details

You work step-by-step through a workflow:
1. Understand the event request (type, date, attendees)
2. Check team availability from conversation history
3. Extract preferences (food, location, budget)
4. Suggest 3 venue options
5. Create a poll for the team to vote
6. Finalize the plan based on poll results

Guidelines:
- Be proactive but ask for clarification when needed
- Consider all team members' preferences equally
- Handle conflicts gracefully (suggest alternatives)
- Provide clear, actionable updates at each step
- If you encounter issues, explain them clearly and suggest solutions

Output format: JSON with structured data for each tool call.
Be concise and focus on actionable information.`;

/**
 * Workflow State Machine
 * 
 * Defines valid transitions between workflow steps
 */
export const WORKFLOW_TRANSITIONS: Record<AgentWorkflowStep, AgentWorkflowStep[]> = {
	[AgentWorkflowStep.INIT]: [AgentWorkflowStep.AVAILABILITY, AgentWorkflowStep.FAILED],
	[AgentWorkflowStep.AVAILABILITY]: [AgentWorkflowStep.PREFERENCES, AgentWorkflowStep.FAILED],
	[AgentWorkflowStep.PREFERENCES]: [AgentWorkflowStep.VENUES, AgentWorkflowStep.FAILED],
	[AgentWorkflowStep.VENUES]: [AgentWorkflowStep.POLL, AgentWorkflowStep.FAILED],
	[AgentWorkflowStep.POLL]: [AgentWorkflowStep.CONFIRM, AgentWorkflowStep.FAILED],
	[AgentWorkflowStep.CONFIRM]: [AgentWorkflowStep.COMPLETE, AgentWorkflowStep.FAILED],
	[AgentWorkflowStep.COMPLETE]: [],
	[AgentWorkflowStep.FAILED]: [],
};

/**
 * Tool Call Request
 * 
 * Represents a request to execute a tool
 */
export interface ToolCallRequest {
	toolName: string;
	parameters: Record<string, any>;
}

/**
 * Tool Call Result
 */
export interface ToolCallResult {
	success: boolean;
	data?: any;
	error?: string;
}

/**
 * Agent Response
 * 
 * What the agent returns after executing a workflow step
 */
export interface AgentResponse {
	success: boolean;
	currentStep: AgentWorkflowStep;
	nextStep?: AgentWorkflowStep;
	message: string; // Human-readable progress update
	data?: any; // Step-specific data
	toolCalls?: ToolCallRequest[]; // Tools the agent wants to call
	error?: string;
	completed?: boolean; // True if workflow is complete
}

