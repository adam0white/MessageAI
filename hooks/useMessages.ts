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
			// Return all local messages (limited to 5000 for performance)
			return await getMessagesByConversation(db, conversationId, 5000);
		},
		staleTime: 30000, // Consider fresh for 30 seconds (stale-while-revalidate)
		gcTime: 5 * 60 * 1000, // Cache for 5 minutes before garbage collection
		refetchOnWindowFocus: false, // Don't refetch on focus (we have WebSocket)
		refetchOnReconnect: true, // Do refetch on reconnect
	});

	useEffect(() => {
		const requestHistory = () => {
			if (wsClient.isConnected()) {
				wsClient.send({
					type: 'get_history',
					conversationId,
					limit: 1000, // Fetch up to 1000 messages
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
		mutationFn: async ({ content, type = 'text', mediaUrl }: { content: string; type?: 'text' | 'image' | 'file'; mediaUrl?: string }) => {
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
				mediaUrl,
			};

			await insertMessage(db, optimisticMessage);
			return { optimisticMessage, clientId };
		},
		onMutate: async ({ content, type, mediaUrl }) => {
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
					mediaUrl,
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
						
						// Update cache immediately (no invalidation needed - setQueryData triggers re-render)
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
						
						// Update cache immediately (no invalidation needed)
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							return old.map(msg => 
								msg.id === message.messageId
									? { ...msg, status: message.status }
									: msg
							);
						});
					}
				} else if (message.type === 'new_message') {
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
					
					const newMessages: Message[] = [];
					const updatedMessages: { id: string; status: Message['status'] }[] = [];
					
					for (const msg of message.messages) {
						// Check if message already exists by ID or clientId
						const existsByClientId = msg.clientId && currentClientIds.has(msg.clientId);
						const existsById = currentIds.has(msg.id);
						
						if (existsById || existsByClientId) {
							// Message exists - check if status changed (read receipts while offline)
							const existingMsg = currentMessages.find(m => 
								m.id === msg.id || 
								(msg.clientId && m.clientId === msg.clientId)
							);
							if (existingMsg && existingMsg.status !== msg.status) {
								await updateMessageStatusQuery(db, msg.id, msg.status).catch(() => {});
								updatedMessages.push({ id: msg.id, status: msg.status });
							}
						} else {
							// New message - insert it (catch duplicates at DB level)
							await insertMessage(db, msg).catch(() => {});
							newMessages.push(msg);
						}
					}
					
					// Only update cache if we have changes
					if (newMessages.length > 0 || updatedMessages.length > 0) {
						queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
							let updated = [...old];
							
							// Add new messages
							if (newMessages.length > 0) {
								updated = [...updated, ...newMessages];
							}
							
							// Update statuses
							if (updatedMessages.length > 0) {
								const statusMap = new Map(updatedMessages.map(u => [u.id, u.status]));
								updated = updated.map(msg => {
									const newStatus = statusMap.get(msg.id);
									return newStatus ? { ...msg, status: newStatus } : msg;
								});
							}
							
							return updated;
						});
					}
				} else if (message.type === 'message_read') {
					await updateMessageStatusQuery(db, message.messageId, 'read')
						.catch(err => console.error('useMessages: Failed to update read status:', err));
					
					// Update cache immediately (no invalidation needed)
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
	}, [conversationId, db, queryClient, userId]);

	// Clear all messages and reload from server
	const clearAndReload = async () => {
		try {
			// Delete all messages for this conversation from local DB (native only)
			if (db && typeof db.runAsync === 'function') {
				await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
			}
			
			// Clear the query cache
			queryClient.setQueryData<Message[]>(['messages', conversationId], []);
			
			// Request fresh history from server
			if (wsClient.isConnected()) {
				wsClient.send({
					type: 'get_history',
					conversationId,
					limit: 1000,
				});
			}
		} catch (err) {
			console.error('Failed to clear and reload messages:', err);
			throw err;
		}
	};

	return {
		messages: messagesQuery.data || [],
		isLoading: messagesQuery.isLoading,
		isError: messagesQuery.isError,
		error: messagesQuery.error,
		sendMessage: sendMessageMutation.mutate,
		isSending: sendMessageMutation.isPending,
		refetch: messagesQuery.refetch,
		clearAndReload,
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

