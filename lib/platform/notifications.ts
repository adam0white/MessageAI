/**
 * Platform-agnostic notifications
 * 
 * Uses expo-notifications on native platforms
 * Uses Browser Notifications API on web
 */

import { Platform } from 'react-native';

// Lazy import to avoid bundling on web
let Notifications: any;
if (Platform.OS !== 'web') {
	Notifications = require('expo-notifications');
}

export interface NotificationContent {
	title: string;
	body: string;
	data?: Record<string, any>;
}

export interface NotificationChannel {
	id: string;
	name: string;
	importance: number;
}

export const AndroidImportance = {
	MAX: 5,
	HIGH: 4,
	DEFAULT: 3,
	LOW: 2,
	MIN: 1,
};

/**
 * Request notification permissions
 */
export async function requestPermissions(): Promise<{ status: 'granted' | 'denied' }> {
	if (Platform.OS === 'web') {
		// Web: use Browser Notifications API
		if (!('Notification' in window)) {
			console.warn('Browser does not support notifications');
			return { status: 'denied' };
		}

		if (Notification.permission === 'granted') {
			return { status: 'granted' };
		}

		const permission = await Notification.requestPermission();
		return { status: permission === 'granted' ? 'granted' : 'denied' };
	} else {
		// Native: use expo-notifications
		const { status } = await Notifications.requestPermissionsAsync();
		return { status: status === 'granted' ? 'granted' : 'denied' };
	}
}

/**
 * Set notification channel (Android only)
 */
export async function setNotificationChannelAsync(channel: NotificationChannel): Promise<void> {
	if (Platform.OS === 'android') {
		await Notifications.setNotificationChannelAsync(channel.id, {
			name: channel.name,
			importance: channel.importance,
		});
	}
	// Web/iOS: No-op (iOS doesn't have channels, web has global permission)
}

/**
 * Schedule a notification
 */
export async function scheduleNotificationAsync(content: NotificationContent): Promise<string> {
	if (Platform.OS === 'web') {
		// Web: use Browser Notifications API
		const permission = await requestPermissions();
		if (permission.status !== 'granted') {
			console.warn('Notification permission not granted');
			return 'web-notification-denied';
		}

		const notification = new Notification(content.title, {
			body: content.body,
			tag: content.data?.conversationId || 'default',
			icon: '/favicon.png',
		});

		// Handle click event
		notification.onclick = () => {
			window.focus();
			notification.close();
			// Trigger navigation via custom event
			if (content.data?.conversationId) {
				window.dispatchEvent(new CustomEvent('notification-click', {
					detail: { conversationId: content.data.conversationId },
				}));
			}
		};

		return `web-notification-${Date.now()}`;
	} else {
		// Native: use expo-notifications
		return await Notifications.scheduleNotificationAsync({
			content: {
				title: content.title,
				body: content.body,
				data: content.data,
			},
			trigger: null, // Show immediately
		});
	}
}

/**
 * Set notification handler (foreground behavior)
 */
export function setNotificationHandler(handler: {
	handleNotification: () => Promise<{
		shouldShowAlert: boolean;
		shouldPlaySound: boolean;
		shouldSetBadge: boolean;
	}>;
}): void {
	if (Platform.OS !== 'web') {
		Notifications.setNotificationHandler(handler);
	}
	// Web: No-op (browser handles this automatically)
}

/**
 * Add notification received listener
 */
export function addNotificationReceivedListener(
	listener: (notification: any) => void
): { remove: () => void } {
	if (Platform.OS !== 'web') {
		return Notifications.addNotificationReceivedListener(listener);
	}
	// Web: No-op (browser handles display automatically)
	return { remove: () => {} };
}

/**
 * Add notification response listener (when user taps notification)
 */
export function addNotificationResponseReceivedListener(
	listener: (response: { notification: { request: { content: { data: any } } } }) => void
): { remove: () => void } {
	if (Platform.OS !== 'web') {
		return Notifications.addNotificationResponseReceivedListener(listener);
	}
	
	// Web: Listen for custom event dispatched by notification click
	const handleClick = (event: Event) => {
		const customEvent = event as CustomEvent;
		listener({
			notification: {
				request: {
					content: {
						data: customEvent.detail,
					},
				},
			},
		});
	};

	window.addEventListener('notification-click', handleClick);
	
	return {
		remove: () => window.removeEventListener('notification-click', handleClick),
	};
}

