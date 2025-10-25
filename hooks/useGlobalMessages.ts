/**
 * useGlobalMessages Hook
 * 
 * Polls for new messages and triggers local notifications when messages arrive
 * for conversations the user is not currently viewing.
 * 
 * This provides foreground notification experience without needing FCM/push notifications.
 * Works in Expo Go, development builds, and production.
 */

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Platform } from 'react-native';
import * as PlatformNotifications from '../lib/platform/notifications';
import { useAuthStore } from '../lib/stores/auth';
import { useQueryClient } from '@tanstack/react-query';
import { upsertConversation } from '../lib/db/queries';
import { config } from '../lib/config';

const WORKER_URL = config.workerUrl;
const POLLING_INTERVAL = 3000; // 3 seconds

// Set notification handler for foreground notifications
PlatformNotifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowAlert: true,
		shouldPlaySound: true,
		shouldSetBadge: false,
	}),
});

/**
 * Hook to poll for new messages and show notifications for non-active conversations
 */
export function useGlobalMessages() {
	const pathname = usePathname();
	const router = useRouter();
	const db = useSQLiteContext();
	const { userId } = useAuthStore();
	const queryClient = useQueryClient();
	const activeConversationId = useRef<string | null>(null);
	const lastCheckedTimestamp = useRef<number>(Date.now());
	const notifiedMessageIds = useRef<Set<string>>(new Set());
	const [permissionsGranted, setPermissionsGranted] = useState(false);

	// Request notification permissions on mount
	useEffect(() => {
		async function requestPermissions() {
			try {
				// Setup Android channel first
				await PlatformNotifications.setNotificationChannelAsync({
					id: 'default',
					name: 'Default',
					importance: PlatformNotifications.AndroidImportance.MAX,
				});

				const { status } = await PlatformNotifications.requestPermissions();
				
				if (status === 'granted') {
					setPermissionsGranted(true);
				}
			} catch (error) {
				console.error('Failed to request notification permissions:', error);
			}
		}

		requestPermissions();
	}, []);

	// Track which conversation is currently active
	useEffect(() => {
		if (pathname?.startsWith('/chat/')) {
			const parts = pathname.split('/');
			activeConversationId.current = parts[2];
		} else {
			activeConversationId.current = null;
		}
	}, [pathname]);

	// Poll for new messages and show notifications
	useEffect(() => {
		if (!userId || !permissionsGranted) return;

		const pollForNewMessages = async () => {
			try {
				const response = await fetch(`${WORKER_URL}/api/conversations?userId=${userId}`);
				if (!response.ok) return;

			const data = await response.json();
			const conversations = data.conversations || [];
			const now = Date.now();

			// Trigger notification for new activity
			let hasNewActivity = false;

			for (const conv of conversations) {
				// Skip active conversation
				if (conv.id === activeConversationId.current) continue;

				// Check if there's activity in this conversation
				if (conv.lastMessageAt) {
					const messageTime = new Date(conv.lastMessageAt).getTime();
					const notificationId = `${conv.id}_${conv.lastMessageAt}`;
					
				// Only show notification for activity newer than last check
				if (messageTime > lastCheckedTimestamp.current) {
					// Skip if already notified
					if (notifiedMessageIds.current.has(notificationId)) continue;

					// Skip if the last message was sent by current user (don't notify about own messages)
					if (conv.lastMessage?.senderId === userId) continue;

					hasNewActivity = true;

					// Get sender name for notification
					const sender = conv.participants?.find((p: any) => p.userId === conv.lastMessage?.senderId);
					const senderName = sender?.name || sender?.user?.name || 'Someone';
					const messagePreview = conv.lastMessage?.content || 'New message';

						// Format notification based on conversation type
						const title = conv.type === 'group' 
							? (conv.name || 'Group Chat')
							: senderName;
						
						const body = conv.type === 'group'
							? `${senderName}: ${messagePreview}`
							: messagePreview;

					// Show local notification with sender and message content
					await PlatformNotifications.scheduleNotificationAsync({
						title,
						body,
						data: {
							conversationId: conv.id,
							messageId: notificationId,
							type: 'new_message',
						},
					});

						notifiedMessageIds.current.add(notificationId);
					}
				}
			}

			// Always invalidate query to keep list fresh
			queryClient.invalidateQueries({ queryKey: ['conversations', userId] });

			lastCheckedTimestamp.current = now;
			} catch (error) {
				console.error('Failed to poll for messages:', error);
			}
		};

		pollForNewMessages();
		const interval = setInterval(pollForNewMessages, POLLING_INTERVAL);

		return () => clearInterval(interval);
	}, [userId, permissionsGranted, queryClient]);

	// Handle notification taps
	useEffect(() => {
		const subscription = PlatformNotifications.addNotificationResponseReceivedListener(response => {
			const conversationId = response.notification.request.content.data?.conversationId as string;
			if (conversationId) {
				router.push(`/chat/${conversationId}`);
			}
		});

		return () => subscription.remove();
	}, [router]);

	return null;
}

