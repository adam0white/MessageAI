import React, { useState, useEffect, useRef } from 'react';
import { 
	View, 
	FlatList, 
	TextInput, 
	TouchableOpacity, 
	Text, 
	StyleSheet, 
	KeyboardAvoidingView, 
	Platform,
	ActivityIndicator,
	Keyboard,
	Modal,
	Alert
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { MessageBubble } from '../../../components/MessageBubble';
import { useMessages } from '../../../hooks/useMessages';
import { useConversation } from '../../../hooks/useConversations';
import { usePresence } from '../../../hooks/usePresence';
import { useReadReceipts } from '../../../hooks/useReadReceipts';
import { wsClient } from '../../../lib/api/websocket';
import { useAuthStore } from '../../../lib/stores/auth';
import { useNetworkStore } from '../../../lib/stores/network';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || 'https://messageai-worker.abdulisik.workers.dev';

export default function ChatScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const conversationId = id!;
	
	const { userId } = useAuthStore();
	const { wsStatus } = useNetworkStore();
	
	const [inputText, setInputText] = useState('');
	const [showAiInput, setShowAiInput] = useState(false);
	const [aiQuery, setAiQuery] = useState('');
	const [isAskingAi, setIsAskingAi] = useState(false);
	const [isEmbedding, setIsEmbedding] = useState(false);
	const flatListRef = useRef<FlatList>(null);
	const previousMessageCountRef = useRef(0);
	const isInitialLoadRef = useRef(true);
	const hasStartedEmbedding = useRef(false);
	
	const { messages, isLoading, sendMessage, isSending, refetch } = useMessages(conversationId);
	const { conversation } = useConversation(conversationId);
	const { onlineUserIds, onlineCount } = usePresence(conversationId);
	const { markAsRead } = useReadReceipts(conversationId);
	
	// Determine if this is a group chat (3+ participants)
	const isGroupChat = conversation ? conversation.participants.length >= 3 : false;

	// Connect to WebSocket when screen mounts
	useEffect(() => {
		if (userId && conversationId) {
			wsClient.connect({ userId, conversationId });
		}

		return () => {
			// Disconnect when leaving the chat
			wsClient.disconnect();
		};
	}, [userId, conversationId]);

	// Mark all messages as read when chat is opened/focused
	useEffect(() => {
		if (!userId || messages.length === 0) return;

		// Mark all unread messages from others as read (skip preview messages)
		const unreadMessages = messages.filter(msg => 
			msg.senderId !== userId && 
			msg.status !== 'read' &&
			!msg.id.startsWith('preview_') // Skip preview messages from conversation list
		);

		if (unreadMessages.length > 0) {
			unreadMessages.forEach(msg => {
				markAsRead(msg.id);
			});
		}
	}, [messages, userId, markAsRead]);

	// Scroll to bottom only when new messages arrive (not on initial load or refresh)
	useEffect(() => {
		if (messages.length > 0 && flatListRef.current) {
			// Only scroll if:
			// 1. Initial load (first time opening chat)
			// 2. Message count increased (new message arrived)
			const shouldScroll = isInitialLoadRef.current || messages.length > previousMessageCountRef.current;
			
			if (shouldScroll) {
				setTimeout(() => {
					flatListRef.current?.scrollToEnd({ animated: !isInitialLoadRef.current });
				}, 100);
				isInitialLoadRef.current = false;
			}
			
			previousMessageCountRef.current = messages.length;
		}
	}, [messages.length]);

	const handleSend = () => {
		const trimmedText = inputText.trim();
		if (!trimmedText) return;

		sendMessage({ content: trimmedText, type: 'text' });
		setInputText('');
		
		// Dismiss keyboard after sending
		Keyboard.dismiss();
	};

	// Start proactive embedding when AI panel opens
	useEffect(() => {
		if (showAiInput && !hasStartedEmbedding.current && messages.length > 0) {
			hasStartedEmbedding.current = true;
			setIsEmbedding(true);

			// Start embedding in background
			fetch(`${WORKER_URL}/api/conversations/${conversationId}/start-embedding`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			})
				.then(res => res.json())
			.catch(() => {
				// Embedding will happen on-demand during query
			})
				.finally(() => {
					setIsEmbedding(false);
				});
		}
	}, [showAiInput, conversationId, messages.length]);

	const handleAskAI = async () => {
		if (!aiQuery.trim() || isAskingAi || isEmbedding) return;

		setIsAskingAi(true);
		const query = aiQuery.trim();
		setAiQuery('');

		try {
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/ask-ai`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					query,
					userId,
				}),
			});

			const result = await response.json();

			if (!result.success) {
				Alert.alert('AI Error', result.error || 'Failed to get AI response');
			} else {
				// AI response will appear as a message automatically (broadcast by DO)
				setShowAiInput(false);
			}
		} catch (error) {
			console.error('AI request failed:', error);
			Alert.alert('Error', 'Failed to ask AI. Please try again.');
		} finally {
			setIsAskingAi(false);
		}
	};

	const renderConnectionStatus = () => {
		if (wsStatus === 'connected') return null;

		const statusText = wsStatus === 'connecting' 
			? 'Connecting...' 
			: wsStatus === 'reconnecting'
			? 'Reconnecting...'
			: 'Disconnected';

		return (
			<View style={styles.statusBanner}>
				<Text style={styles.statusText}>{statusText}</Text>
			</View>
		);
	};

	// Get conversation name for header
	const getHeaderTitle = () => {
		if (!conversation) return 'Chat';
		
		if (isGroupChat && conversation.name) {
			return conversation.name;
		}
		
		if (isGroupChat) {
			return `Group (${conversation.participants.length})`;
		}
		
		// For 1-on-1, show the other user's name
		const otherParticipant = conversation.participants.find(p => p.userId !== userId);
		if (otherParticipant && otherParticipant.user) {
			return otherParticipant.user.name || otherParticipant.user.email.split('@')[0];
		}
		
		return 'Chat';
	};

	return (
		<>
			<Stack.Screen 
				options={{
					title: getHeaderTitle(),
					headerRight: () => (
						<View style={styles.headerRight}>
							<TouchableOpacity 
								onPress={() => setShowAiInput(!showAiInput)}
								style={[styles.aiButton, showAiInput && styles.aiButtonActive]}
							>
								<Text style={styles.aiButtonText}>🤖 AI</Text>
							</TouchableOpacity>
							{wsStatus === 'connected' && onlineCount > 0 && (
								<>
									<View style={styles.onlineIndicator} />
									<Text style={styles.onlineCount}>{onlineCount} online</Text>
								</>
							)}
						</View>
					),
				}} 
			/>
			
			<KeyboardAvoidingView 
				style={styles.container}
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				keyboardVerticalOffset={90}
			>
				{/* AI Input - Sticky at top */}
				{showAiInput && (
					<View style={styles.aiInputContainer}>
						<View style={styles.aiInputHeader}>
							<Text style={styles.aiInputTitle}>🤖 Ask AI about this conversation</Text>
							<TouchableOpacity onPress={() => setShowAiInput(false)}>
								<Text style={styles.aiInputClose}>✕</Text>
							</TouchableOpacity>
						</View>
						
						{/* Progress indicator - always show if there's progress */}
						{(isEmbedding || isAskingAi) && (
							<View style={styles.aiProgressContainer}>
								<ActivityIndicator size="small" color="#007AFF" />
								<Text style={styles.aiProgressText}>
									{isEmbedding ? `Preparing RAG (${messages.length} messages)...` : 'Asking AI...'}
								</Text>
							</View>
						)}

						<View style={styles.aiInputRow}>
							<TextInput
								style={styles.aiInput}
								value={aiQuery}
								onChangeText={setAiQuery}
								placeholder="What have we been discussing?"
								placeholderTextColor="#999"
								editable={true}
								autoFocus
							/>
							<TouchableOpacity
								style={[styles.aiSendButton, (!aiQuery.trim() || isAskingAi || isEmbedding) && styles.aiSendButtonDisabled]}
								onPress={handleAskAI}
								disabled={!aiQuery.trim() || isAskingAi || isEmbedding}
							>
								{(isAskingAi || isEmbedding) ? (
									<ActivityIndicator size="small" color="#fff" />
								) : (
									<Text style={styles.aiSendButtonText}>Ask</Text>
								)}
							</TouchableOpacity>
						</View>
						
						<Text style={styles.aiInputHint}>
							{isEmbedding ? '⏳ Preparing semantic search...' : 'Response will appear as a message below (uses RAG)'}
						</Text>
					</View>
				)}

				{renderConnectionStatus()}
					{isLoading ? (
						<View style={styles.loadingContainer}>
							<ActivityIndicator size="large" color="#0084ff" />
						</View>
					) : (
						<FlatList
							ref={flatListRef}
							data={messages}
							keyExtractor={(item) => item.id}
							renderItem={({ item }) => (
								<MessageBubble 
									message={item} 
									isGroupChat={isGroupChat}
								/>
							)}
							contentContainerStyle={messages.length === 0 ? styles.emptyMessageList : styles.messageList}
							onRefresh={refetch}
							refreshing={isLoading}
							ListEmptyComponent={
								<View style={styles.emptyState}>
									<Text style={styles.emptyText}>No messages yet</Text>
									<Text style={styles.emptySubtext}>Start the conversation!</Text>
								</View>
							}
						/>
					)}

				<View style={styles.inputContainer}>
					<TextInput
						style={styles.input}
						value={inputText}
						onChangeText={setInputText}
						placeholder="Type a message..."
						placeholderTextColor="#999"
						multiline
						maxLength={1000}
						editable={!isSending}
					/>
						<TouchableOpacity 
							style={[
								styles.sendButton,
								(!inputText.trim() || isSending) && styles.sendButtonDisabled
							]}
							onPress={handleSend}
							disabled={!inputText.trim() || isSending}
						>
							{isSending ? (
								<ActivityIndicator size="small" color="#fff" />
							) : (
								<Text style={styles.sendButtonText}>Send</Text>
							)}
						</TouchableOpacity>
					</View>
			</KeyboardAvoidingView>
		</>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#fff',
	},
	flex: {
		flex: 1,
	},
	loadingContainer: {
		flex: 1,
		justifyContent: 'center',
		alignItems: 'center',
	},
	messageList: {
		paddingVertical: 8,
		flexGrow: 1,
		justifyContent: 'flex-end',
	},
	emptyMessageList: {
		flexGrow: 1,
		justifyContent: 'center',
		alignItems: 'center',
		paddingVertical: 40,
	},
	emptyState: {
		alignItems: 'center',
	},
	emptyText: {
		fontSize: 16,
		color: '#999',
		marginBottom: 4,
	},
	emptySubtext: {
		fontSize: 14,
		color: '#ccc',
	},
	inputContainer: {
		flexDirection: 'row',
		alignItems: 'flex-end',
		padding: 12,
		paddingBottom: Platform.OS === 'ios' ? 12 : 12,
		borderTopWidth: 1,
		borderTopColor: '#e4e6eb',
		backgroundColor: '#fff',
		minHeight: 64,
	},
	input: {
		flex: 1,
		minHeight: 40,
		maxHeight: 100,
		paddingHorizontal: 16,
		paddingVertical: 10,
		backgroundColor: '#f0f2f5',
		borderRadius: 20,
		fontSize: 16,
		marginRight: 8,
		color: '#000',
		textAlignVertical: 'top',
	},
	sendButton: {
		backgroundColor: '#0084ff',
		paddingHorizontal: 20,
		paddingVertical: 10,
		borderRadius: 20,
		justifyContent: 'center',
		alignItems: 'center',
		minWidth: 60,
	},
	sendButtonDisabled: {
		backgroundColor: '#b0c4de',
	},
	sendButtonText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
	statusBanner: {
		backgroundColor: '#ffc107',
		paddingVertical: 6,
		alignItems: 'center',
	},
	statusText: {
		color: '#000',
		fontSize: 14,
		fontWeight: '500',
	},
	headerRight: {
		marginRight: 12,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 6,
	},
	aiButton: {
		backgroundColor: '#f0f0f0',
		paddingHorizontal: 10,
		paddingVertical: 5,
		borderRadius: 6,
		marginRight: 8,
	},
	aiButtonActive: {
		backgroundColor: '#007AFF',
	},
	aiButtonText: {
		fontSize: 13,
		fontWeight: '600',
	},
	onlineIndicator: {
		width: 12,
		height: 12,
		borderRadius: 6,
		backgroundColor: '#44b700',
	},
	onlineCount: {
		fontSize: 12,
		color: '#65676b',
		fontWeight: '500',
	},
	// AI Input Styles (sticky at top)
	aiInputContainer: {
		backgroundColor: '#f8f9fa',
		borderBottomWidth: 1,
		borderBottomColor: '#e0e0e0',
		padding: 12,
	},
	aiInputHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 8,
	},
	aiInputTitle: {
		fontSize: 14,
		fontWeight: '600',
		color: '#333',
	},
	aiInputClose: {
		fontSize: 20,
		color: '#666',
	},
	aiProgressContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
		marginBottom: 8,
		paddingVertical: 4,
	},
	aiProgressText: {
		fontSize: 12,
		color: '#007AFF',
		fontStyle: 'italic',
	},
	aiInputRow: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	aiInput: {
		flex: 1,
		backgroundColor: '#fff',
		borderWidth: 1,
		borderColor: '#e0e0e0',
		borderRadius: 8,
		paddingHorizontal: 12,
		paddingVertical: 8,
		fontSize: 14,
	},
	aiSendButton: {
		backgroundColor: '#007AFF',
		paddingHorizontal: 16,
		paddingVertical: 8,
		borderRadius: 8,
	},
	aiSendButtonDisabled: {
		backgroundColor: '#ccc',
	},
	aiSendButtonText: {
		color: '#fff',
		fontSize: 14,
		fontWeight: '600',
	},
	aiInputHint: {
		fontSize: 11,
		color: '#999',
		marginTop: 6,
		fontStyle: 'italic',
	},
});

