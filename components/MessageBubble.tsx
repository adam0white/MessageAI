import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Modal, Dimensions, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSQLiteContext } from 'expo-sqlite';
import type { Message, User } from '../lib/api/types';
import { useAuthStore } from '../lib/stores/auth';
import { getUserById } from '../lib/db/queries';
import { wsClient } from '../lib/api/websocket';

interface MessageBubbleProps {
	message: Message;
	isGroupChat?: boolean; // Whether this is a group conversation
	showSenderName?: boolean; // Explicitly show sender name (for groups)
	conversationId?: string; // For sending reactions
}

// Quick emoji picker for reactions
const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// Animated Reaction Bubble Component
const ReactionBubble = React.memo(function ReactionBubble({ 
	emoji, 
	count, 
	isUserReaction, 
	onPress 
}: { 
	emoji: string; 
	count: number; 
	isUserReaction: boolean; 
	onPress: () => void;
}) {
	const scaleAnim = React.useRef(new Animated.Value(0)).current;

	React.useEffect(() => {
		Animated.spring(scaleAnim, {
			toValue: 1,
			friction: 3,
			tension: 100,
			useNativeDriver: true,
		}).start();
	}, []);

	return (
		<Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
			<TouchableOpacity
				style={[
					styles.reactionBubble,
					isUserReaction && styles.reactionBubbleActive
				]}
				onPress={onPress}
			>
				<Text style={styles.reactionEmoji}>{emoji}</Text>
				<Text style={[
					styles.reactionCount,
					isUserReaction && styles.reactionCountActive
				]}>
					{count}
				</Text>
			</TouchableOpacity>
		</Animated.View>
	);
});

export const MessageBubble = React.memo(function MessageBubble({ message, isGroupChat = false, showSenderName = false, conversationId }: MessageBubbleProps) {
	const db = useSQLiteContext();
	const { userId } = useAuthStore();
	const isOwnMessage = message.senderId === userId;
	const [senderName, setSenderName] = useState<string | null>(null);
	const [showLightbox, setShowLightbox] = useState(false);
	const [showEmojiPicker, setShowEmojiPicker] = useState(false);
	const [fadeAnim] = useState(new Animated.Value(0));
	const [slideAnim] = useState(new Animated.Value(20));

	// Entrance animation
	useEffect(() => {
		Animated.parallel([
			Animated.timing(fadeAnim, {
				toValue: 1,
				duration: 200,
				useNativeDriver: true,
			}),
			Animated.timing(slideAnim, {
				toValue: 0,
				duration: 200,
				useNativeDriver: true,
			}),
		]).start();
	}, []);

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

	// Handle reaction toggle
	const handleReaction = (emoji: string) => {
		if (!userId || !conversationId) return;
		
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		
		// Check if user already reacted with this emoji
		const userReacted = message.reactions?.[emoji]?.includes(userId);
		
		wsClient.send({
			type: userReacted ? 'remove_reaction' : 'add_reaction',
			messageId: message.id,
			emoji,
			userId,
		});
		
		setShowEmojiPicker(false);
	};

	return (
		<Animated.View style={[
			styles.container,
			isOwnMessage ? styles.ownMessage : styles.otherMessage,
			{
				opacity: fadeAnim,
				transform: [{ translateY: slideAnim }],
			},
		]}>
			<View style={styles.messageWrapper}>
				{/* Show sender name for group chats (only for others' messages) */}
				{senderName && !isOwnMessage && (
					<Text style={styles.senderName}>{senderName}</Text>
				)}
				
				<TouchableOpacity
					onLongPress={() => {
						if (conversationId) {
							Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
							setShowEmojiPicker(true);
						}
					}}
					activeOpacity={0.9}
					style={[
						styles.bubble,
						isOwnMessage ? styles.ownBubble : styles.otherBubble,
						message.type === 'image' && styles.imageBubble
					]}
				>
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
				</TouchableOpacity>

				{/* Reactions */}
				{message.reactions && Object.keys(message.reactions).length > 0 && (
					<View style={styles.reactionsContainer}>
						{Object.entries(message.reactions).map(([emoji, userIds]) => {
							const isUserReaction = userId && userIds.includes(userId);
							return (
								<ReactionBubble
									key={emoji}
									emoji={emoji}
									count={userIds.length}
									isUserReaction={isUserReaction}
									onPress={() => handleReaction(emoji)}
								/>
							);
						})}
					</View>
				)}
			</View>

			{/* Emoji Picker Modal */}
			<Modal
				visible={showEmojiPicker}
				transparent
				animationType="fade"
				onRequestClose={() => setShowEmojiPicker(false)}
			>
				<TouchableOpacity
					style={styles.emojiPickerOverlay}
					activeOpacity={1}
					onPress={() => setShowEmojiPicker(false)}
				>
					<View style={styles.emojiPickerContainer}>
						{QUICK_EMOJIS.map(emoji => (
							<TouchableOpacity
								key={emoji}
								style={styles.emojiButton}
								onPress={() => handleReaction(emoji)}
							>
								<Text style={styles.emojiButtonText}>{emoji}</Text>
							</TouchableOpacity>
						))}
					</View>
				</TouchableOpacity>
			</Modal>

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
		</Animated.View>
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
	reactionsContainer: {
		flexDirection: 'row',
		flexWrap: 'wrap',
		marginTop: 4,
		marginLeft: 12,
		gap: 6,
	},
	reactionBubble: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: '#f0f0f0',
		borderRadius: 12,
		paddingHorizontal: 8,
		paddingVertical: 4,
		gap: 4,
		borderWidth: 1,
		borderColor: '#e0e0e0',
	},
	reactionBubbleActive: {
		backgroundColor: '#e3f2fd',
		borderColor: '#2196F3',
	},
	reactionEmoji: {
		fontSize: 14,
	},
	reactionCount: {
		fontSize: 12,
		fontWeight: '600',
		color: '#666',
	},
	reactionCountActive: {
		color: '#2196F3',
	},
	emojiPickerOverlay: {
		flex: 1,
		backgroundColor: 'rgba(0,0,0,0.4)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	emojiPickerContainer: {
		backgroundColor: '#fff',
		borderRadius: 16,
		padding: 16,
		flexDirection: 'row',
		gap: 12,
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.25,
		shadowRadius: 4,
		elevation: 5,
	},
	emojiButton: {
		width: 50,
		height: 50,
		justifyContent: 'center',
		alignItems: 'center',
		backgroundColor: '#f8f8f8',
		borderRadius: 25,
	},
	emojiButtonText: {
		fontSize: 28,
	},
});

