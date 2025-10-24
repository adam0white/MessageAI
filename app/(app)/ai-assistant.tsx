import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Stack } from 'expo-router';
import { useConversations } from '../../hooks/useConversations';
import type { AiChatRequest, AiChatResponse } from '../../lib/api/types';

import { config } from '../../lib/config';

const WORKER_URL = config.workerUrl;

interface ChatMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	timestamp: Date;
	isLoading?: boolean;
}

export default function AiAssistantScreen() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: '0',
			role: 'assistant',
			content: 'Hello! I\'m your AI assistant for MessageAI. I can help you with:\n\n• Summarizing conversations\n• Extracting action items\n• Finding important messages\n• Answering questions about your chats\n\nYou can optionally select a conversation to ask questions about, or just ask me general questions!',
			timestamp: new Date(),
		}
	]);
	const [inputText, setInputText] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [selectedConversationId, setSelectedConversationId] = useState<string | undefined>();
	const flatListRef = useRef<FlatList>(null);
	const { conversations } = useConversations();

	async function sendMessage() {
		if (!inputText.trim() || isLoading) return;

		const userMessage: ChatMessage = {
			id: Date.now().toString(),
			role: 'user',
			content: inputText.trim(),
			timestamp: new Date(),
		};

		const loadingMessage: ChatMessage = {
			id: (Date.now() + 1).toString(),
			role: 'assistant',
			content: '',
			timestamp: new Date(),
			isLoading: true,
		};

		setMessages(prev => [...prev, userMessage, loadingMessage]);
		setInputText('');
		setIsLoading(true);

		// Scroll to bottom
		setTimeout(() => {
			flatListRef.current?.scrollToEnd({ animated: true });
		}, 100);

		try {
			const requestBody: AiChatRequest = {
				query: inputText.trim(),
				conversationId: selectedConversationId,
			};

			const response = await fetch(`${WORKER_URL}/api/ai/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(requestBody),
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data: AiChatResponse = await response.json();

			if (data.success && data.response) {
				// Replace loading message with actual response
				setMessages(prev => 
					prev.map(msg => 
						msg.id === loadingMessage.id 
							? { ...msg, content: data.response!, isLoading: false }
							: msg
					)
				);
			} else {
				throw new Error(data.error || 'No response from AI');
			}
		} catch (error) {
			console.error('AI request failed:', error);
			
			// Replace loading message with error
			setMessages(prev => 
				prev.map(msg => 
					msg.id === loadingMessage.id 
						? { 
							...msg, 
							content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`, 
							isLoading: false 
						}
						: msg
				)
			);
			
			Alert.alert('Error', 'Failed to get response from AI assistant. Please try again.');
		} finally {
			setIsLoading(false);
		}
	}

	function renderMessage({ item }: { item: ChatMessage }) {
		return (
			<View style={[
				styles.messageBubble,
				item.role === 'user' ? styles.userMessage : styles.assistantMessage
			]}>
				{item.isLoading ? (
					<View style={styles.loadingContainer}>
						<ActivityIndicator size="small" color="#666" />
						<Text style={styles.loadingText}>Thinking...</Text>
					</View>
				) : (
					<Text style={[
						styles.messageText,
						item.role === 'user' ? styles.userMessageText : styles.assistantMessageText
					]}>
						{item.content}
					</Text>
				)}
			</View>
		);
	}

	function getConversationName(conversationId: string): string {
		const conv = conversations?.find(c => c.id === conversationId);
		if (!conv) return 'Unknown Conversation';
		
		if (conv.name) return conv.name;
		if (conv.type === 'group') return `Group (${conv.participants.length} members)`;
		if (conv.participants.length === 1) return 'You (Notes)';
		
		const otherParticipant = conv.participants.find(p => p.id);
		return otherParticipant?.name || 'Direct Message';
	}

	return (
		<View style={styles.container}>
			<Stack.Screen 
				options={{ 
					title: 'AI Assistant',
					headerBackTitle: 'Back',
				}} 
			/>

			{/* Conversation selector (optional) */}
			{conversations && conversations.length > 0 && (
				<View style={styles.conversationSelector}>
					<Text style={styles.selectorLabel}>Ask about:</Text>
					<TouchableOpacity
						style={styles.selectorButton}
						onPress={() => {
							Alert.alert(
								'Select Conversation',
								'Choose a conversation to ask questions about',
								[
									{ text: 'General Questions', onPress: () => setSelectedConversationId(undefined) },
									...conversations.map(conv => ({
										text: getConversationName(conv.id),
										onPress: () => setSelectedConversationId(conv.id),
									})),
									{ text: 'Cancel', style: 'cancel' },
								]
							);
						}}
					>
						<Text style={styles.selectorButtonText}>
							{selectedConversationId ? getConversationName(selectedConversationId) : 'General Questions'}
						</Text>
					</TouchableOpacity>
				</View>
			)}

			{/* Chat messages */}
			<FlatList
				ref={flatListRef}
				data={messages}
				keyExtractor={(item) => item.id}
				renderItem={renderMessage}
				contentContainerStyle={styles.messageList}
				onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
			/>

			{/* Input area */}
			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				keyboardVerticalOffset={90}
			>
				<View style={styles.inputContainer}>
					<TextInput
						style={styles.input}
						value={inputText}
						onChangeText={setInputText}
						placeholder="Ask me anything about your messages..."
						placeholderTextColor="#999"
						multiline
						maxLength={500}
						editable={!isLoading}
					/>
					<TouchableOpacity
						style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
						onPress={sendMessage}
						disabled={!inputText.trim() || isLoading}
					>
						<Text style={styles.sendButtonText}>
							{isLoading ? '...' : '→'}
						</Text>
					</TouchableOpacity>
				</View>
			</KeyboardAvoidingView>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#f5f5f5',
	},
	conversationSelector: {
		flexDirection: 'row',
		alignItems: 'center',
		padding: 12,
		backgroundColor: '#fff',
		borderBottomWidth: 1,
		borderBottomColor: '#e0e0e0',
	},
	selectorLabel: {
		fontSize: 14,
		color: '#666',
		marginRight: 8,
	},
	selectorButton: {
		flex: 1,
		backgroundColor: '#f0f0f0',
		padding: 8,
		borderRadius: 8,
	},
	selectorButtonText: {
		fontSize: 14,
		color: '#333',
	},
	messageList: {
		padding: 16,
		paddingBottom: 8,
	},
	messageBubble: {
		maxWidth: '80%',
		padding: 12,
		borderRadius: 16,
		marginBottom: 12,
	},
	userMessage: {
		alignSelf: 'flex-end',
		backgroundColor: '#007AFF',
	},
	assistantMessage: {
		alignSelf: 'flex-start',
		backgroundColor: '#fff',
		borderWidth: 1,
		borderColor: '#e0e0e0',
	},
	messageText: {
		fontSize: 16,
		lineHeight: 22,
	},
	userMessageText: {
		color: '#fff',
	},
	assistantMessageText: {
		color: '#333',
	},
	loadingContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: 8,
	},
	loadingText: {
		fontSize: 14,
		color: '#666',
		fontStyle: 'italic',
	},
	inputContainer: {
		flexDirection: 'row',
		padding: 12,
		backgroundColor: '#fff',
		borderTopWidth: 1,
		borderTopColor: '#e0e0e0',
		alignItems: 'flex-end',
	},
	input: {
		flex: 1,
		backgroundColor: '#f0f0f0',
		borderRadius: 20,
		paddingHorizontal: 16,
		paddingVertical: 10,
		fontSize: 16,
		maxHeight: 100,
		marginRight: 8,
	},
	sendButton: {
		width: 40,
		height: 40,
		borderRadius: 20,
		backgroundColor: '#007AFF',
		justifyContent: 'center',
		alignItems: 'center',
	},
	sendButtonDisabled: {
		backgroundColor: '#ccc',
	},
	sendButtonText: {
		color: '#fff',
		fontSize: 24,
		fontWeight: 'bold',
	},
});

