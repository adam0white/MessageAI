/**
 * MessageBubble Component
 * 
 * Displays an individual message with sender alignment and status
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Message } from '../lib/api/types';
import { useAuthStore } from '../lib/stores/auth';

interface MessageBubbleProps {
	message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
	const { userId } = useAuthStore();
	const isOwnMessage = message.senderId === userId;

	// Format timestamp
	const formatTime = (isoString: string) => {
		const date = new Date(isoString);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	};

	// Get status indicator
	const getStatusIndicator = () => {
		if (!isOwnMessage) return null;

		switch (message.status) {
			case 'sending':
				return '○'; // Hollow circle for sending
			case 'sent':
				return '✓'; // Single check for sent
			case 'delivered':
				return '✓✓'; // Double check for delivered
			case 'read':
				return '✓✓'; // Double check (could be blue/colored in production)
			case 'failed':
				return '!'; // Exclamation for failed
			default:
				return '';
		}
	};

	const statusColor = message.status === 'read' ? '#0084ff' : '#999';

	return (
		<View style={[
			styles.container,
			isOwnMessage ? styles.ownMessage : styles.otherMessage
		]}>
			<View style={[
				styles.bubble,
				isOwnMessage ? styles.ownBubble : styles.otherBubble
			]}>
				<Text style={[
					styles.messageText,
					isOwnMessage ? styles.ownText : styles.otherText
				]}>
					{message.content}
				</Text>
				<View style={styles.footer}>
					<Text style={[
						styles.timestamp,
						isOwnMessage ? styles.ownTimestamp : styles.otherTimestamp
					]}>
						{formatTime(message.createdAt)}
					</Text>
					{isOwnMessage && (
						<Text style={[styles.status, { color: statusColor }]}>
							{getStatusIndicator()}
						</Text>
					)}
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flexDirection: 'row',
		marginVertical: 2,
		marginHorizontal: 12,
	},
	ownMessage: {
		justifyContent: 'flex-end',
	},
	otherMessage: {
		justifyContent: 'flex-start',
	},
	bubble: {
		maxWidth: '75%',
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 18,
	},
	ownBubble: {
		backgroundColor: '#0084ff',
	},
	otherBubble: {
		backgroundColor: '#e4e6eb',
	},
	messageText: {
		fontSize: 16,
		lineHeight: 20,
	},
	ownText: {
		color: '#ffffff',
	},
	otherText: {
		color: '#000000',
	},
	footer: {
		flexDirection: 'row',
		alignItems: 'center',
		marginTop: 2,
		gap: 4,
	},
	timestamp: {
		fontSize: 11,
	},
	ownTimestamp: {
		color: 'rgba(255, 255, 255, 0.7)',
	},
	otherTimestamp: {
		color: '#65676b',
	},
	status: {
		fontSize: 11,
		fontWeight: '600',
	},
});

