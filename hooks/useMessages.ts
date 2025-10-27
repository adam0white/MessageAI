import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useCallback } from 'react';
import type { Message, ServerMessage } from '../lib/api/types';
import { wsClient } from '../lib/api/websocket';
import {
	getMessagesByConversation,
	insertMessage,
	updateMessageByClientId,
	updateMessageStatus as updateMessageStatusQuery,
	deleteMessage,
	addReaction,
	removeReaction
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
						const currentMessages = queryClient.getQueryData<Message[]>(['messages', conversationId]) || [];
						const existingMessage = currentMessages.find(msg => msg.clientId === message.clientId);

						if (existingMessage) {
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
						}
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

					console.log('useMessages: new_message received', {
						id: incomingMessage.id,
						clientId: incomingMessage.clientId,
						senderId: incomingMessage.senderId,
						content: incomingMessage.content.substring(0, 50),
						conversationId: incomingMessage.conversationId,
						isFromCurrentUser: incomingMessage.senderId === userId
					});

					if (incomingMessage.conversationId === conversationId) {
						// Check if this is our own message coming back (has clientId matching)
						const currentMessages = queryClient.getQueryData<Message[]>(['messages', conversationId]) || [];

						// More robust matching: try multiple strategies
						let existingMessage: Message | null = null;

						// 1. Match by clientId (optimistic message)
						if (incomingMessage.clientId) {
							existingMessage = currentMessages.find(msg => msg.clientId === incomingMessage.clientId) || null;
						}

						// 2. If no clientId match, try by server ID
						if (!existingMessage) {
							existingMessage = currentMessages.find(msg => msg.id === incomingMessage.id) || null;
						}

						// 3. If still no match but it's from current user, it might be a timing issue
						// Look for any message with same content from current user
						if (!existingMessage && incomingMessage.senderId === userId) {
							existingMessage = currentMessages.find(msg =>
								msg.senderId === userId &&
								msg.content === incomingMessage.content &&
								msg.type === incomingMessage.type &&
								Math.abs(new Date(msg.createdAt).getTime() - new Date(incomingMessage.createdAt).getTime()) < 5000 // Within 5 seconds
							) || null;
						}

						if (existingMessage) {
							console.log('useMessages: Replacing existing message', {
								existing: existingMessage ? { id: existingMessage.id, clientId: existingMessage.clientId, status: existingMessage.status } : null,
								incoming: { id: incomingMessage.id, clientId: incomingMessage.clientId, status: incomingMessage.status }
							});

							// Message already exists - this is our own message coming back from server
							// Replace it completely with server data
							queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
								return old.map(msg => {
									// Match by any of the strategies above
									if (msg.clientId === incomingMessage.clientId ||
										msg.id === incomingMessage.id ||
										(msg.senderId === userId &&
										 msg.content === incomingMessage.content &&
										 msg.type === incomingMessage.type &&
										 Math.abs(new Date(msg.createdAt).getTime() - new Date(incomingMessage.createdAt).getTime()) < 5000)) {
										return incomingMessage; // Complete replacement
									}
									return msg;
								});
							});

							// Update DB with server data (complete replacement)
							await db.runAsync(
								`INSERT OR REPLACE INTO messages (
									id, conversation_id, sender_id, content, type, status,
									media_url, media_type, media_size, link_preview, created_at, updated_at,
									client_id, local_only
								) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
								[
									incomingMessage.id,
									incomingMessage.conversationId,
									incomingMessage.senderId,
									incomingMessage.content,
									incomingMessage.type,
									incomingMessage.status,
									incomingMessage.mediaUrl || null,
									incomingMessage.mediaType || null,
									incomingMessage.mediaSize || null,
									incomingMessage.linkPreview ? JSON.stringify(incomingMessage.linkPreview) : null,
									incomingMessage.createdAt,
									incomingMessage.updatedAt,
									incomingMessage.clientId || null,
									0 // No longer local only
								]
							).catch(err => console.error('useMessages: Failed to upsert message:', err));

							// Save reactions for updated message
							if (incomingMessage.reactions) {
								// First remove all existing reactions for this message
								await db.runAsync('DELETE FROM message_reactions WHERE message_id = ?', [incomingMessage.id]).catch(() => {});

								// Then add the new reactions
								for (const [emoji, userIds] of Object.entries(incomingMessage.reactions)) {
									for (const userId of userIds) {
										await addReaction(db, incomingMessage.id, userId, emoji).catch(() => {});
									}
								}
							}
						} else {
							// Check if this might be a duplicate anyway (defensive programming)
							const potentialDuplicates = currentMessages.filter(msg =>
								msg.senderId === incomingMessage.senderId &&
								msg.content === incomingMessage.content &&
								msg.type === incomingMessage.type &&
								Math.abs(new Date(msg.createdAt).getTime() - new Date(incomingMessage.createdAt).getTime()) < 10000 // Within 10 seconds
							);

							if (potentialDuplicates.length > 0) {
								console.log('useMessages: Found potential duplicate, replacing instead of adding', {
									duplicates: potentialDuplicates.length,
									incoming: incomingMessage.id,
									existingIds: potentialDuplicates.map(m => m.id)
								});

								// Replace the first duplicate found
								queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
									return old.map(msg => {
										if (msg.id === potentialDuplicates[0].id) {
											return incomingMessage;
										}
										return msg;
									});
								});

								// Update DB
								await db.runAsync(
									`INSERT OR REPLACE INTO messages (
										id, conversation_id, sender_id, content, type, status,
										media_url, media_type, media_size, link_preview, created_at, updated_at,
										client_id, local_only
									) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
									[
										incomingMessage.id,
										incomingMessage.conversationId,
										incomingMessage.senderId,
										incomingMessage.content,
										incomingMessage.type,
										incomingMessage.status,
										incomingMessage.mediaUrl || null,
										incomingMessage.mediaType || null,
										incomingMessage.mediaSize || null,
										incomingMessage.linkPreview ? JSON.stringify(incomingMessage.linkPreview) : null,
										incomingMessage.createdAt,
										incomingMessage.updatedAt,
										incomingMessage.clientId || null,
										0
									]
								).catch(err => console.error('useMessages: Failed to upsert duplicate:', err));
							} else {
								// Completely new message from someone else
								console.log('useMessages: Adding new message from other user', incomingMessage.id);

								// Before adding, remove any exact duplicates (defensive)
								const deduplicatedMessages = currentMessages.filter(msg =>
									!(msg.senderId === incomingMessage.senderId &&
									  msg.content === incomingMessage.content &&
									  msg.type === incomingMessage.type &&
									  Math.abs(new Date(msg.createdAt).getTime() - new Date(incomingMessage.createdAt).getTime()) < 10000)
								);

								await insertMessage(db, incomingMessage).catch(() => {});

								// Save reactions for new message
								if (incomingMessage.reactions) {
									for (const [emoji, userIds] of Object.entries(incomingMessage.reactions)) {
										for (const userId of userIds) {
											await addReaction(db, incomingMessage.id, userId, emoji).catch(() => {});
										}
									}
								}

								// Add to cache
								queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
									return [...deduplicatedMessages, incomingMessage];
								});
							}
						}
					}

					// Final deduplication safeguard - remove any exact duplicates
					const finalMessages = queryClient.getQueryData<Message[]>(['messages', conversationId]) || [];
					const uniqueMessages = finalMessages.filter((msg, index, arr) =>
						arr.findIndex(m =>
							m.id === msg.id ||
							(m.clientId && msg.clientId && m.clientId === msg.clientId) ||
							(m.senderId === msg.senderId &&
							 m.content === msg.content &&
							 m.type === msg.type &&
							 Math.abs(new Date(m.createdAt).getTime() - new Date(msg.createdAt).getTime()) < 10000)
						) === index
					);

					if (uniqueMessages.length !== finalMessages.length) {
						console.log('useMessages: Removed duplicates in final safeguard', {
							before: finalMessages.length,
							after: uniqueMessages.length
						});
						queryClient.setQueryData<Message[]>(['messages', conversationId], uniqueMessages);
					}
				} else if (message.type === 'reaction') {
					// Handle reaction add/remove
					queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
						return old.map(msg => {
							if (msg.id === message.messageId) {
								const reactions = { ...(msg.reactions || {}) };

								if (message.action === 'add') {
									// Add user to emoji reactions
									if (!reactions[message.emoji]) {
										reactions[message.emoji] = [];
									}
									if (!reactions[message.emoji].includes(message.userId)) {
										reactions[message.emoji] = [...reactions[message.emoji], message.userId];
									}
								} else {
									// Remove user from emoji reactions
									if (reactions[message.emoji]) {
										reactions[message.emoji] = reactions[message.emoji].filter(id => id !== message.userId);
										if (reactions[message.emoji].length === 0) {
											delete reactions[message.emoji];
										}
									}
								}

								return { ...msg, reactions: Object.keys(reactions).length > 0 ? reactions : undefined };
							}
							return msg;
						});
					});

					// Save reaction to local database
					try {
						if (message.action === 'add') {
							await addReaction(db, message.messageId, message.userId, message.emoji);
						} else {
							await removeReaction(db, message.messageId, message.userId, message.emoji);
						}
					} catch (error) {
						console.error('useMessages: Failed to save reaction to local DB:', error);
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

							// Save reactions to local database (even if message exists)
							if (msg.reactions) {
								for (const [emoji, userIds] of Object.entries(msg.reactions)) {
									for (const userId of userIds) {
										await addReaction(db, msg.id, userId, emoji).catch(() => {});
									}
								}
							}
						} else {
							// New message - insert it (catch duplicates at DB level)
							await insertMessage(db, msg).catch(() => {});
							newMessages.push(msg);

							// Save reactions for new message
							if (msg.reactions) {
								for (const [emoji, userIds] of Object.entries(msg.reactions)) {
									for (const userId of userIds) {
										await addReaction(db, msg.id, userId, emoji).catch(() => {});
									}
								}
							}
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
				} else if (message.type === 'error' && message.code === 'MESSAGE_DELETED') {
					// Handle message deletion broadcast
					const deletedMessageId = message.message;
					
					// Delete from local database
					await deleteMessage(db, deletedMessageId)
						.catch(err => console.error('useMessages: Failed to delete message from DB:', err));
					
					// Remove from cache immediately
					queryClient.setQueryData<Message[]>(['messages', conversationId], (old = []) => {
						return old.filter(msg => msg.id !== deletedMessageId);
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

