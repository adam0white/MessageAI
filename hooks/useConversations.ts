/**
 * useConversations Hook
 * 
 * React Query hook for managing conversations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext } from 'expo-sqlite';
import { useUser } from '@clerk/clerk-expo';
import type { Conversation, CreateConversationRequest } from '../lib/api/types';
import { 
	getConversationPreviews, 
	upsertConversation,
	upsertUser 
} from '../lib/db/queries';
import { useAuthStore } from '../lib/stores/auth';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || 'http://localhost:8787';

/**
 * Hook for fetching user's conversations
 */
export function useConversations() {
	const db = useSQLiteContext();
	const { userId } = useAuthStore();

	const conversationsQuery = useQuery({
		queryKey: ['conversations', userId],
		queryFn: async () => {
			const localConversations = await getConversationPreviews(db);

			if (userId) {
				try {
					const response = await fetch(`${WORKER_URL}/api/conversations?userId=${userId}`);
					if (response.ok) {
						const data = await response.json();
						const serverConversations: Conversation[] = data.conversations;

						for (const conv of serverConversations) {
							await upsertConversation(db, conv);
						}

						const updated = await getConversationPreviews(db);
						return updated.sort((a, b) => {
							const aTime = a.lastMessage?.createdAt || a.id;
							const bTime = b.lastMessage?.createdAt || b.id;
							return bTime.localeCompare(aTime);
						});
					}
				} catch (error) {
					// Offline - use local data
				}
			}

			return localConversations.sort((a, b) => {
				const aTime = a.lastMessage?.createdAt || a.id;
				const bTime = b.lastMessage?.createdAt || b.id;
				return bTime.localeCompare(aTime);
			});
		},
		enabled: !!userId,
		staleTime: 1000 * 10, // 10 seconds
		refetchOnWindowFocus: true,
		refetchInterval: 5000, // Poll every 5 seconds for new messages/conversations
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

