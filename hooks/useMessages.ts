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
	}, [conversationId, queryClient]);

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
						// Update optimistic message with server ID and status
						await updateMessageByClientId(db, message.clientId, {
							id: message.messageId,
							status: message.status,
						}).catch(err => console.error('useMessages: Failed to update message in DB:', err));
						
						// Update cache immediately
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							return old.map(msg => 
								msg.clientId === message.clientId
									? { ...msg, id: message.messageId, status: message.status, localOnly: false }
									: msg
							);
						});
					} else {
						// Update existing message status
						await updateMessageStatusQuery(db, message.messageId, message.status)
							.catch(err => console.error('useMessages: Failed to update status in DB:', err));
						
						// Update cache immediately
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							return old.map(msg => 
								msg.id === message.messageId
									? { ...msg, status: message.status }
									: msg
							);
						});
					}
					
					// Force re-render by invalidating query
					queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
				} else if (message.type == 'new_message') {
					const incomingMessage = message.message;
					
					if (incomingMessage.conversationId === conversationId) {
						// Check if message already exists (prevent duplicates)
						const exists = queryClient.getQueryData<Message[]>(['messages', conversationId])
							?.some(msg => msg.id === incomingMessage.id || msg.clientId === incomingMessage.id);
						
						if (!exists) {
							await insertMessage(db, incomingMessage).catch(() => {});
							
							queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
								return [...old, incomingMessage];
							});
						}
					}
				} else if (message.type === 'history_response') {
					// Get current messages to check for duplicates and status updates
					const currentMessages = queryClient.getQueryData<Message[]>(['messages', conversationId]) || [];
					const currentIds = new Set(currentMessages.map(m => m.id));
					const currentClientIds = new Set(currentMessages.map(m => m.clientId).filter(Boolean));
					
					let newCount = 0;
					let updatedCount = 0;
					
					for (const msg of message.messages) {
						// Check if message already exists
						if (currentIds.has(msg.id) || currentClientIds.has(msg.id)) {
							// Message exists - check if status changed (read receipts while offline)
							const existingMsg = currentMessages.find(m => m.id === msg.id || m.clientId === msg.id);
							if (existingMsg && existingMsg.status !== msg.status) {
								await updateMessageStatusQuery(db, msg.id, msg.status).catch(() => {});
								updatedCount++;
							}
						} else {
							// New message - insert it
							await insertMessage(db, msg).catch(() => {});
							newCount++;
						}
					}
					
					// Invalidate to refresh from DB
					if (newCount > 0 || updatedCount > 0) {
						queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
					}
				} else if (message.type === 'message_read') {
					
					await updateMessageStatusQuery(db, message.messageId, 'read')
						.catch(err => console.error('useMessages: Failed to update read status:', err));
					
					queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
						return old.map(msg => 
							msg.id === message.messageId
								? { ...msg, status: 'read' }
								: msg
						);
					});
					
					// Force re-render
					queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
				}
			} catch (error) {
				console.error('Error handling WebSocket message:', error);
			}
		});

		return () => {
			unsubscribe();
		};
	}, [conversationId, db, queryClient, userId]);

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

