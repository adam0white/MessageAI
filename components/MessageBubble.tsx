import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Modal, Dimensions } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import type { Message, User } from '../lib/api/types';
import { useAuthStore } from '../lib/stores/auth';
import { getUserById } from '../lib/db/queries';

interface MessageBubbleProps {
	message: Message;
	isGroupChat?: boolean; // Whether this is a group conversation
	showSenderName?: boolean; // Explicitly show sender name (for groups)
}

export const MessageBubble = React.memo(function MessageBubble({ message, isGroupChat = false, showSenderName = false }: MessageBubbleProps) {
	const db = useSQLiteContext();
	const { userId } = useAuthStore();
	const isOwnMessage = message.senderId === userId;
	const [senderName, setSenderName] = useState<string | null>(null);
	const [showLightbox, setShowLightbox] = useState(false);

	// Fetch sender info for group chats
	useEffect(() => {
		if ((isGroupChat || showSenderName) && !isOwnMessage) {
			getUserById(db, message.senderId)
				.then(user => {
					if (user) {
						setSenderName(user.name || user.email.split('@')[0] || 'Unknown');
					} else {
						// Fallback to sender ID prefix
						setSenderName(message.senderId.substring(0, 8));
					}
				})
				.catch(() => {
					setSenderName(message.senderId.substring(0, 8));
				});
		}
	}, [message.senderId, isGroupChat, showSenderName, isOwnMessage, db]);

	// Format timestamp
	const formatTime = (isoString: string) => {
		const date = new Date(isoString);
		return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	};

	// Get status indicator with proper styling
	const getStatusIndicator = () => {
		if (!isOwnMessage) return null;

		switch (message.status) {
			case 'sending':
				return { icon: '○', color: '#999' }; // Hollow circle for sending
			case 'sent':
				return { icon: '✓', color: '#999' }; // Single check for sent
			case 'delivered':
				return { icon: '✓✓', color: '#999' }; // Double check for delivered
			case 'read':
				return { icon: '✓✓', color: '#44b700' }; // Green double check for read
			case 'failed':
				return { icon: '!', color: '#ff3b30' }; // Red exclamation for failed
			default:
				return null;
		}
	};

	const statusIndicator = getStatusIndicator();

	return (
		<View style={[
			styles.container,
			isOwnMessage ? styles.ownMessage : styles.otherMessage
		]}>
			<View style={styles.messageWrapper}>
				{/* Show sender name for group chats (only for others' messages) */}
				{senderName && !isOwnMessage && (
					<Text style={styles.senderName}>{senderName}</Text>
				)}
				
				<View style={[
					styles.bubble,
					isOwnMessage ? styles.ownBubble : styles.otherBubble,
					message.type === 'image' && styles.imageBubble
				]}>
					{message.type === 'image' && message.mediaUrl ? (
						<TouchableOpacity onPress={() => setShowLightbox(true)}>
							<Image 
								source={{ uri: message.mediaUrl }} 
								style={styles.messageImage}
								resizeMode="cover"
							/>
							{message.content && message.content !== '📷 Image' && (
								<Text style={[
									styles.messageText,
									isOwnMessage ? styles.ownText : styles.otherText,
									styles.captionText
								]}>
									{message.content}
								</Text>
							)}
						</TouchableOpacity>
					) : (
						<Text style={[
							styles.messageText,
							isOwnMessage ? styles.ownText : styles.otherText
						]}>
							{message.content}
						</Text>
					)}
					<View style={styles.footer}>
						<Text style={[
							styles.timestamp,
							isOwnMessage ? styles.ownTimestamp : styles.otherTimestamp
						]}>
							{formatTime(message.createdAt)}
						</Text>
						{isOwnMessage && statusIndicator && (
							<Text style={[styles.status, { color: statusIndicator.color }]}>
								{statusIndicator.icon}
							</Text>
						)}
					</View>
				</View>
			</View>

		{/* Lightbox Modal */}
		{message.type === 'image' && message.mediaUrl && (
			<Modal
				visible={showLightbox}
				transparent
				animationType="fade"
				onRequestClose={() => setShowLightbox(false)}
			>
				<TouchableOpacity 
					style={styles.lightboxContainer}
					activeOpacity={1}
					onPress={() => setShowLightbox(false)}
				>
					<Image 
						source={{ uri: message.mediaUrl }} 
						style={styles.lightboxImage}
						resizeMode="contain"
					/>
				</TouchableOpacity>
			</Modal>
		)}
		</View>
	);
});

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
	messageWrapper: {
		maxWidth: '75%',
	},
	senderName: {
		fontSize: 12,
		fontWeight: '600',
		color: '#65676b',
		marginBottom: 2,
		marginLeft: 12,
	},
	bubble: {
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
	imageBubble: {
		padding: 4,
	},
	messageImage: {
		width: 200,
		height: 200,
		borderRadius: 12,
	},
	captionText: {
		marginTop: 8,
		marginHorizontal: 8,
	},
	lightboxContainer: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.9)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	lightboxImage: {
		width: Dimensions.get('window').width,
		height: Dimensions.get('window').height,
	},
});

