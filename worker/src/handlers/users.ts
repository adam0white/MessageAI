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


