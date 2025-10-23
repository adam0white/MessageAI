/**
 * Push Token Handlers
 * 
 * API endpoints for registering and managing Expo push notification tokens
 */

import { savePushToken, deletePushToken } from '../db/schema';

interface RegisterTokenRequest {
	userId: string;
	token: string;
	platform: 'ios' | 'android' | 'web';
}

/**
 * POST /api/push-tokens
 * Register a push notification token for a user
 */
export async function handleRegisterPushToken(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		const body = await request.json() as RegisterTokenRequest;

		// Validate request
		if (!body.userId || !body.token || !body.platform) {
			return new Response(
				JSON.stringify({ error: 'Missing required fields: userId, token, platform' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Validate platform
		if (!['ios', 'android', 'web'].includes(body.platform)) {
			return new Response(
				JSON.stringify({ error: 'Invalid platform. Must be ios, android, or web' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Ensure user exists (create placeholder if needed)
		const now = new Date().toISOString();
		await env.DB
			.prepare(
				`INSERT OR IGNORE INTO users (id, clerk_id, email, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?)`
			)
			.bind(
				body.userId,
				body.userId,
				`${body.userId}@placeholder.local`,
				now,
				now
			)
			.run();

		// Save token to D1
		await savePushToken(env.DB, body.userId, body.token, body.platform);

		console.log(`✅ Registered push token for user ${body.userId} on ${body.platform}`);

		return new Response(
			JSON.stringify({ success: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error registering push token:', error);
		return new Response(
			JSON.stringify({ error: 'Internal server error' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

/**
 * DELETE /api/push-tokens/:token
 * Delete a push notification token (on logout)
 */
export async function handleDeletePushToken(
	token: string,
	env: Env
): Promise<Response> {
	try {
		if (!token) {
			return new Response(
				JSON.stringify({ error: 'Missing token parameter' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			);
		}

		// Delete token from D1
		await deletePushToken(env.DB, token);

		console.log(`✅ Deleted push token: ${token}`);

		return new Response(
			JSON.stringify({ success: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		);
	} catch (error) {
		console.error('Error deleting push token:', error);
		return new Response(
			JSON.stringify({ error: 'Internal server error' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
}

