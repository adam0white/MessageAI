/**
 * useConversations Hook
 * 
 * React Query hook for managing conversations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext } from 'expo-sqlite';
import { useUser } from '@clerk/clerk-expo';
import type { Conversation, CreateConversationRequest } from '../lib/api/types';
import type { ConversationPreview } from '../shared/types';
import { 
	getConversationPreviews, 
	upsertConversation,
	upsertUser 
} from '../lib/db/queries';
import { useAuthStore } from '../lib/stores/auth';
import { config } from '../lib/config';

const WORKER_URL = config.workerUrl;

/**
 * Hook for fetching user's conversations
 */
export function useConversations() {
	const db = useSQLiteContext();
	const { userId } = useAuthStore();

	const conversationsQuery = useQuery({
		queryKey: ['conversations', userId],
		queryFn: async () => {
			if (userId) {
				try {
					const response = await fetch(`${WORKER_URL}/api/conversations?userId=${userId}`);
					if (response.ok) {
						const data = await response.json();
						// Backend returns conversations that match ConversationPreview shape
						const serverConversations = data.conversations as ConversationPreview[];

						// Sync participant user data to local database for name display
						for (const conv of serverConversations) {
							for (const participant of conv.participants) {
								if (participant.id && (participant.name || participant.avatarUrl)) {
									// Upsert participant user data to local DB
									await upsertUser(db, {
										id: participant.id,
										clerkId: participant.id, // We don't have clerk_id here, use id as fallback
										email: `${participant.id}@unknown.local`, // Placeholder
										name: participant.name,
										avatarUrl: participant.avatarUrl,
										createdAt: new Date().toISOString(),
										updatedAt: new Date().toISOString(),
									}).catch(() => {
										// Silently fail if user already exists or other error
									});
								}
							}
						}

						// Return server data directly (includes fresh lastMessage previews)
						return serverConversations.sort((a, b) => {
							const aTime = a.lastMessage?.createdAt || a.id;
							const bTime = b.lastMessage?.createdAt || b.id;
							return bTime.localeCompare(aTime);
						});
					}
				} catch (error) {
					// Offline - use local data
					console.log('📵 Offline: using local conversations');
				}
			}

			// Fallback to local DB when offline or no userId
			const localConversations = await getConversationPreviews(db, userId || undefined);
			return localConversations.sort((a, b) => {
				const aTime = a.lastMessage?.createdAt || a.id;
				const bTime = b.lastMessage?.createdAt || b.id;
				return bTime.localeCompare(aTime);
			});
		},
		enabled: !!userId,
		staleTime: 0, // Always consider stale so invalidation works immediately
		refetchOnWindowFocus: true,
		refetchInterval: false, // Disable auto-polling, we handle it in useGlobalMessages
	});

	return {
		conversations: conversationsQuery.data || [],
		isLoading: conversationsQuery.isLoading,
		isError: conversationsQuery.isError,
		error: conversationsQuery.error,
		refetch: conversationsQuery.refetch,
	};
}

/**
 * Hook for creating a new conversation
 */
export function useCreateConversation() {
	const db = useSQLiteContext();
	const queryClient = useQueryClient();
	const { userId } = useAuthStore();
	const { user } = useUser();

	const createMutation = useMutation({
		mutationFn: async (request: CreateConversationRequest) => {
			const response = await fetch(`${WORKER_URL}/api/conversations`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(request),
			});

			if (!response.ok) {
				const error = await response.json();
				throw new Error(error.details || error.error || 'Failed to create conversation');
			}

			const data = await response.json();
			return data.conversation as Conversation;
		},
		onSuccess: async (conversation) => {
			try {
				if (user && userId) {
					await upsertUser(db, {
						id: userId,
						clerkId: user.id,
						email: user.emailAddresses[0]?.emailAddress || `${userId}@temp.local`,
						name: user.fullName || user.firstName || undefined,
						avatarUrl: user.imageUrl,
						createdAt: user.createdAt?.toISOString() || new Date().toISOString(),
						updatedAt: user.updatedAt?.toISOString() || new Date().toISOString(),
					});
				}

				await upsertConversation(db, conversation);
				queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
			} catch (error) {
				console.error('useConversations: Failed to save locally:', error);
			}
		},
	});

	return {
		createConversation: createMutation.mutate,
		createConversationAsync: createMutation.mutateAsync,
		isCreating: createMutation.isPending,
		error: createMutation.error,
	};
}

/**
 * Hook for fetching a single conversation by ID
 */
export function useConversation(conversationId: string) {
	const db = useSQLiteContext();

	const conversationQuery = useQuery({
		queryKey: ['conversation', conversationId],
		queryFn: async () => {
			// Fetch from server
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}`);
			
			if (!response.ok) {
				throw new Error('Conversation not found');
			}

			const data = await response.json();
			const conversation: Conversation = data.conversation;

			// Sync participant user data to local DB (for name display)
			for (const participant of conversation.participants) {
				if (participant.userId && (participant.user?.name || participant.user?.email)) {
					await upsertUser(db, {
						id: participant.userId,
						clerkId: participant.userId,
						email: participant.user.email,
						name: participant.user.name,
						avatarUrl: participant.user?.avatarUrl,
						createdAt: participant.user?.createdAt || new Date().toISOString(),
						updatedAt: participant.user?.updatedAt || new Date().toISOString(),
					}).catch(() => {
						// Silently fail
					});
				}
			}

			// Sync to local database
			await upsertConversation(db, conversation);

			return conversation;
		},
		enabled: !!conversationId,
		staleTime: 1000 * 60 * 5, // 5 minutes
	});

	return {
		conversation: conversationQuery.data,
		isLoading: conversationQuery.isLoading,
		isError: conversationQuery.isError,
		error: conversationQuery.error,
	};
}

