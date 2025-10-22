/**
 * useMessages Hook
 * 
 * React Query hook for managing messages with optimistic updates
 * Implements: optimistic SQLite write → UI update → WebSocket send → server confirmation → status update
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useCallback } from 'react';
import type { Message, ServerMessage } from '../lib/api/types';
import { wsClient } from '../lib/api/websocket';
import { 
	getMessagesByConversation, 
	insertMessage, 
	updateMessageByClientId,
	updateMessageStatus as updateMessageStatusQuery 
} from '../lib/db/queries';
import { useAuthStore } from '../lib/stores/auth';

/**
 * Generate a client-side message ID
 */
function generateClientId(): string {
	return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Hook for managing messages in a conversation
 */
export function useMessages(conversationId: string) {
	const db = useSQLiteContext();
	const queryClient = useQueryClient();
	const { userId } = useAuthStore();

	// Query for fetching messages
	const messagesQuery = useQuery({
		queryKey: ['messages', conversationId],
		queryFn: async () => {
			// Just return local cache - history request is separate
			return await getMessagesByConversation(db, conversationId, 50);
		},
		staleTime: 0, // Always consider stale to refresh on focus
		refetchOnWindowFocus: true,
	});

	useEffect(() => {
		const requestHistory = () => {
			if (wsClient.isConnected()) {
				wsClient.send({
					type: 'get_history',
					conversationId,
					limit: 50,
				});
			}
		};

		const unsubscribeConnected = wsClient.onConnected(requestHistory);
		const unsubscribeReconnected = wsClient.onReconnected(requestHistory);

		if (wsClient.isConnected()) {
			requestHistory();
		}

		return () => {
			unsubscribeConnected();
			unsubscribeReconnected();
		};
	}, [conversationId]);

	// Mutation for sending messages with optimistic updates
	const sendMessageMutation = useMutation({
		mutationFn: async ({ content, type = 'text' }: { content: string; type?: 'text' | 'image' | 'file' }) => {
			if (!userId) {
				throw new Error('User not authenticated');
			}

			const clientId = generateClientId();
			const now = new Date().toISOString();

			const optimisticMessage: Message = {
				id: clientId,
				conversationId,
				senderId: userId,
				content,
				type,
				status: 'sending',
				createdAt: now,
				updatedAt: now,
				clientId,
				localOnly: true,
			};

			await insertMessage(db, optimisticMessage);
			return { optimisticMessage, clientId };
		},
		onMutate: async ({ content, type }) => {
			await queryClient.cancelQueries({ queryKey: ['messages', conversationId] });
			const previousMessages = queryClient.getQueryData<Message[]>(['messages', conversationId]);

			queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
				const clientId = generateClientId();
				const now = new Date().toISOString();
				
				const newMessage: Message = {
					id: clientId,
					conversationId,
					senderId: userId!,
					content,
					type: type || 'text',
					status: 'sending',
					createdAt: now,
					updatedAt: now,
					clientId,
					localOnly: true,
				};

				return [...old, newMessage];
			});

			return { previousMessages };
		},
		onSuccess: async ({ optimisticMessage, clientId }) => {
			wsClient.send({
				type: 'send_message',
				clientId,
				conversationId,
				content: optimisticMessage.content,
				messageType: optimisticMessage.type,
				mediaUrl: optimisticMessage.mediaUrl,
			});
		},
		onError: (err, variables, context) => {
			if (context?.previousMessages) {
				queryClient.setQueryData(['messages', conversationId], context.previousMessages);
			}
			console.error('useMessages: Send failed:', err);
		},
	});

	// Listen for WebSocket messages (confirmations and incoming messages)
	useEffect(() => {
		const unsubscribe = wsClient.onMessage(async (message: ServerMessage) => {
			try {
				if (message.type === 'message_status') {
					if (message.clientId) {
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							return old.map(msg => 
								msg.clientId === message.clientId
									? { ...msg, id: message.messageId, status: message.status, localOnly: false, clientId: undefined }
									: msg
							);
						});
						
						updateMessageByClientId(db, message.clientId, {
							id: message.messageId,
							status: message.status,
						}).catch(err => console.error('useMessages: Failed to update message in DB:', err));
					} else {
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							return old.map(msg => 
								msg.id === message.messageId
									? { ...msg, status: message.status }
									: msg
							);
						});
						
						updateMessageStatusQuery(db, message.messageId, message.status)
							.catch(err => console.error('useMessages: Failed to update status in DB:', err));
					}
				} else if (message.type == 'new_message') {
					const incomingMessage = message.message;
					
					if (incomingMessage.conversationId === conversationId) {
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							const exists = old.some(msg => msg.id === incomingMessage.id);
							return exists ? old : [...old, incomingMessage];
						});

						insertMessage(db, incomingMessage).catch(() => {});
					}
				} else if (message.type === 'history_response') {
					for (const msg of message.messages) {
						await insertMessage(db, msg).catch(() => {});
					}
					
					queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
				} else if (message.type === 'message_read') {
					// Read receipt update
					queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
						return old.map(msg => 
							msg.id === message.messageId
								? { ...msg, status: 'read' }
								: msg
						);
					});
				}
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
			}
		});

		return () => {
			unsubscribe();
		};
	}, [conversationId, db, queryClient]);

	return {
		messages: messagesQuery.data || [],
		isLoading: messagesQuery.isLoading,
		isError: messagesQuery.isError,
		error: messagesQuery.error,
		sendMessage: sendMessageMutation.mutate,
		isSending: sendMessageMutation.isPending,
		refetch: messagesQuery.refetch,
	};
}

/**
 * Hook for updating message status
 */
export function useMessageStatus() {
	const db = useSQLiteContext();
	const queryClient = useQueryClient();

	const updateStatus = useCallback(async (
		conversationId: string, 
		messageId: string, 
		status: Message['status']
	) => {
		// Update local database
		await updateMessageStatusQuery(db, messageId, status);

		// Update cache
		queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
			return old.map(msg => 
				msg.id === messageId ? { ...msg, status } : msg
			);
		});

		// Notify server via WebSocket if it's a read receipt
		if (status === 'read') {
			const { userId } = useAuthStore.getState();
			if (userId) {
				wsClient.send({
					type: 'mark_read',
					messageId,
					userId,
				});
			}
		}
	}, [db, queryClient]);

	return { updateStatus };
}

