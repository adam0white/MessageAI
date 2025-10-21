/**
 * Clerk Webhook Handler
 * 
 * Syncs user data from Clerk to D1 database when users sign up/update.
 */

import { createUser, updateUser, getUserByClerkId } from '../db/schema';
import type { ClerkWebhookEvent } from '../types';

/**
 * Verify Clerk webhook signature
 * Note: For MVP, we're trusting the webhook. In production, verify the signature.
 * See: https://clerk.com/docs/integrations/webhooks/overview
 */
function verifyWebhookSignature(request: Request, secret: string): boolean {
	// TODO: Implement signature verification for production
	// For now, we'll skip verification in development
	return true;
}

/**
 * Handle Clerk webhook events
 */
export async function handleClerkWebhook(
	request: Request,
	env: Env
): Promise<Response> {
	try {
		// Verify webhook signature (skipped for MVP)
		const webhookSecret = env.CLERK_WEBHOOK_SECRET || '';
		if (webhookSecret && !verifyWebhookSignature(request, webhookSecret)) {
			return new Response('Unauthorized', { status: 401 });
		}

		const event: ClerkWebhookEvent = await request.json();

		console.log('Clerk webhook event:', event.type);

		switch (event.type) {
			case 'user.created':
				await handleUserCreated(event, env);
				break;

			case 'user.updated':
				await handleUserUpdated(event, env);
				break;

			case 'user.deleted':
				// TODO: Handle user deletion if needed
				console.log('User deleted:', event.data.id);
				break;

			default:
				console.log('Unhandled event type:', event.type);
		}

		return new Response(JSON.stringify({ received: true }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (error) {
		console.error('Webhook error:', error);
		return new Response(
			JSON.stringify({
				error: 'Webhook processing failed',
				details: error instanceof Error ? error.message : 'Unknown error',
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
}

/**
 * Handle user created event
 */
async function handleUserCreated(
	event: ClerkWebhookEvent,
	env: Env
): Promise<void> {
	const { id, email_addresses, first_name, last_name, image_url } = event.data;

	const email = email_addresses[0]?.email_address;
	if (!email) {
		throw new Error('No email address found for user');
	}

	const name =
		first_name && last_name
			? `${first_name} ${last_name}`
			: first_name || last_name || undefined;

	await createUser(env.DB, {
		clerkId: id,
		email,
		name,
		avatarUrl: image_url,
	});

	console.log('User created in D1:', { clerkId: id, email });
}

/**
 * Handle user updated event
 */
async function handleUserUpdated(
	event: ClerkWebhookEvent,
	env: Env
): Promise<void> {
	const { id, email_addresses, first_name, last_name, image_url } = event.data;

	// Check if user exists
	const existingUser = await getUserByClerkId(env.DB, id);
	if (!existingUser) {
		console.log('User not found, creating instead');
		await handleUserCreated(event, env);
		return;
	}

	const email = email_addresses[0]?.email_address;
	const name =
		first_name && last_name
			? `${first_name} ${last_name}`
			: first_name || last_name || undefined;

	await updateUser(env.DB, id, {
		email,
		name,
		avatarUrl: image_url,
	});

	console.log('User updated in D1:', { clerkId: id });
}

