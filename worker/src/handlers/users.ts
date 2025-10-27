/**
 * User Profile Handlers
 * 
 * Direct REST endpoints for syncing user profile data without webhooks
 */

import { updateUser, createUser, getUserByClerkId } from '../db/schema';

/**
 * Sync user profile data directly from frontend
 * POST /api/users/sync
 */
export async function handleSyncUserProfile(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const data = await request.json() as {
			clerkId: string;
			email: string;
			firstName?: string;
			lastName?: string;
			imageUrl?: string;
		};

		if (!data.clerkId || !data.email) {
			return new Response(
				JSON.stringify({ error: 'clerkId and email are required' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const name =
			data.firstName && data.lastName
				? `${data.firstName} ${data.lastName}`
				: data.firstName || data.lastName || undefined;

		// Check if user exists
		const existingUser = await getUserByClerkId(env.DB, data.clerkId);

		if (existingUser) {
			// Update existing user
			await updateUser(env.DB, data.clerkId, {
				email: data.email,
				name,
				avatarUrl: data.imageUrl,
			});
		} else {
			// Create new user
			await createUser(env.DB, {
				clerkId: data.clerkId,
				email: data.email,
				name,
				avatarUrl: data.imageUrl,
			});
		}

		return new Response(
			JSON.stringify({ success: true, name }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('❌ Error syncing user profile:', error);
		return new Response(
			JSON.stringify({
				error: 'Failed to sync user profile',
				details: error instanceof Error ? error.message : 'Unknown error',
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

/**
 * Get user profile by Clerk ID
 * GET /api/users/:clerkId
 */
export async function handleGetUserProfile(
	request: Request,
	env: Env,
	clerkId: string
): Promise<Response> {
	try {
		const user = await getUserByClerkId(env.DB, clerkId);

		if (!user) {
			return new Response(
				JSON.stringify({ error: 'User not found' }),
				{ status: 404, headers: { 'Content-Type': 'application/json' } }
			);
		}

		return new Response(
			JSON.stringify({ user }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error fetching user profile:', error);
		return new Response(
			JSON.stringify({ error: 'Failed to fetch user profile' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

/**
 * Look up users by email addresses
 * POST /api/users/lookup-by-email
 */
export async function handleLookupUsersByEmail(request: Request, env: Env): Promise<Response> {
	try {
		const body = await request.json() as { emails: string[] };
		
		if (!body.emails || !Array.isArray(body.emails) || body.emails.length === 0) {
			return new Response(
				JSON.stringify({ error: 'emails array is required' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Query users by email
		const placeholders = body.emails.map(() => '?').join(',');
		const result = await env.DB
			.prepare(`SELECT id, email, name FROM users WHERE email IN (${placeholders})`)
			.bind(...body.emails)
			.all<{ id: string; email: string; name: string | null }>();

		const users = result.results || [];
		
		// Return map of email -> userId
		const emailToUserId: Record<string, string> = {};
		users.forEach(user => {
			emailToUserId[user.email] = user.id;
		});

		return new Response(
			JSON.stringify({ users: emailToUserId }),
			{ headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Lookup users by email error:', error);
		return new Response(
			JSON.stringify({ error: 'Failed to lookup users' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}
