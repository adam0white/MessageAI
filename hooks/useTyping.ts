/**
 * useTyping Hook
 * 
 * Manages typing indicator state for a conversation.
 * Sends typing events to the server and tracks who is typing.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ServerMessage } from '../lib/api/types';
import { wsClient } from '../lib/api/websocket';

const TYPING_TIMEOUT = 3000; // 3 seconds
const TYPING_DEBOUNCE = 300; // 300ms before sending typing event

interface TypingUser {
	userId: string;
	timestamp: number;
}

/**
 * Hook for managing typing indicators in a conversation
 */
export function useTyping(conversationId: string, currentUserId: string) {
	const [typingUsers, setTypingUsers] = useState<Map<string, number>>(new Map());
	const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isTypingRef = useRef(false);

	// Send typing event to server
	const sendTypingEvent = useCallback((isTyping: boolean) => {
		if (!conversationId || !currentUserId) return;

		wsClient.send({
			type: 'typing',
			conversationId,
			userId: currentUserId,
			isTyping,
		});

		isTypingRef.current = isTyping;
	}, [conversationId, currentUserId]);

	// User started typing
	const startTyping = useCallback(() => {
		// Clear existing timeout
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
		}

		// Only send if not already typing
		if (!isTypingRef.current) {
			sendTypingEvent(true);
		}

		// Auto-stop after 3 seconds
		typingTimeoutRef.current = setTimeout(() => {
			sendTypingEvent(false);
		}, TYPING_TIMEOUT);
	}, [sendTypingEvent]);

	// User stopped typing
	const stopTyping = useCallback(() => {
		if (typingTimeoutRef.current) {
			clearTimeout(typingTimeoutRef.current);
			typingTimeoutRef.current = null;
		}

		if (isTypingRef.current) {
			sendTypingEvent(false);
		}
	}, [sendTypingEvent]);

	// Listen for typing events from other users
	useEffect(() => {
		const unsubscribe = wsClient.onMessage((message: ServerMessage) => {
			if (message.type === 'typing') {
				// Ignore own typing events
				if (message.userId === currentUserId) return;

				const now = Date.now();

				setTypingUsers(prev => {
					const next = new Map(prev);

					if (message.isTyping) {
						next.set(message.userId, now);
					} else {
						next.delete(message.userId);
					}

					return next;
				});

				// Auto-remove typing indicator after timeout
				if (message.isTyping) {
					setTimeout(() => {
						setTypingUsers(prev => {
							const lastUpdate = prev.get(message.userId);
							if (lastUpdate && Date.now() - lastUpdate >= TYPING_TIMEOUT) {
								const next = new Map(prev);
								next.delete(message.userId);
								return next;
							}
							return prev;
						});
					}, TYPING_TIMEOUT);
				}
			}
		});

		return () => {
			unsubscribe();
			stopTyping();
		};
	}, [conversationId, currentUserId, stopTyping]);

	// Clean up on unmount
	useEffect(() => {
		return () => {
			if (typingTimeoutRef.current) {
				clearTimeout(typingTimeoutRef.current);
			}
		};
	}, []);

	return {
		typingUserIds: Array.from(typingUsers.keys()),
		startTyping,
		stopTyping,
	};
}

