/**
 * Chat Screen
 * 
 * Main chat interface with message list, input, and send functionality
 */

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
	Keyboard
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { MessageBubble } from '../../../components/MessageBubble';
import { useMessages } from '../../../hooks/useMessages';
import { wsClient } from '../../../lib/api/websocket';
import { useAuthStore } from '../../../lib/stores/auth';
import { useNetworkStore } from '../../../lib/stores/network';

export default function ChatScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const conversationId = id!;
	
	const { userId } = useAuthStore();
	const { wsStatus } = useNetworkStore();
	
	const [inputText, setInputText] = useState('');
	const flatListRef = useRef<FlatList>(null);
	
	const { messages, isLoading, sendMessage, isSending, refetch } = useMessages(conversationId);

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

	// Scroll to bottom when new messages arrive
	useEffect(() => {
		if (messages.length > 0 && flatListRef.current) {
			// Small delay to ensure the list has rendered
			setTimeout(() => {
				flatListRef.current?.scrollToEnd({ animated: true });
			}, 100);
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

	return (
		<>
			<Stack.Screen 
				options={{
					title: 'Chat',
					headerRight: () => (
						<View style={styles.headerRight}>
							{wsStatus === 'connected' && (
								<View style={styles.onlineIndicator} />
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
							renderItem={({ item }) => <MessageBubble message={item} />}
							contentContainerStyle={messages.length === 0 ? styles.emptyMessageList : styles.messageList}
							onContentSizeChange={() => {
								// Auto-scroll to bottom when content changes
								setTimeout(() => {
									flatListRef.current?.scrollToEnd({ animated: true });
								}, 100);
							}}
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
							returnKeyType="send"
							blurOnSubmit={false}
							onSubmitEditing={handleSend}
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
	},
	onlineIndicator: {
		width: 12,
		height: 12,
		borderRadius: 6,
		backgroundColor: '#44b700',
	},
});

