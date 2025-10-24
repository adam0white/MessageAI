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
import { useSQLiteContext } from 'expo-sqlite';
import { MessageBubble } from '../../../components/MessageBubble';
import { useMessages } from '../../../hooks/useMessages';
import { useConversation } from '../../../hooks/useConversations';
import { usePresence } from '../../../hooks/usePresence';
import { useReadReceipts } from '../../../hooks/useReadReceipts';
import { useTyping } from '../../../hooks/useTyping';
import { wsClient } from '../../../lib/api/websocket';
import { useAuthStore } from '../../../lib/stores/auth';
import { useNetworkStore } from '../../../lib/stores/network';

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || 'https://messageai-worker.abdulisik.workers.dev';

type AiFeature = 'ask' | 'summarize' | 'actions' | 'priority' | 'decisions' | 'search' | 'planner';

interface SummaryResult {
	summary: string;
	bulletPoints: string[];
	messageCount: number;
}

interface ActionItem {
	task: string;
	assignee?: string;
	dueDate?: string;
	mentioned?: string;
}

interface PriorityMessage {
	messageId: string;
	content: string;
	sender: string;
	timestamp: string;
	priority: 'high' | 'medium';
	reason: string;
}

interface Decision {
	decision: string;
	timestamp: string;
	participants: string[];
	context: string;
}

interface SearchResult {
	messageId: string;
	content: string;
	sender: string;
	timestamp: string;
	relevanceScore: number;
	snippet: string;
}

interface AgentProgress {
	currentStep: string;
	message: string;
	completed: boolean;
	error?: string;
	data?: any;
}

export default function ChatScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const conversationId = id!;
	
	const { userId } = useAuthStore();
	const { wsStatus } = useNetworkStore();
	const db = useSQLiteContext();
	
	const [inputText, setInputText] = useState('');
	const [showAiInput, setShowAiInput] = useState(false);
	const [activeFeature, setActiveFeature] = useState<AiFeature>('ask');
	const [aiQuery, setAiQuery] = useState('');
	const [isAskingAi, setIsAskingAi] = useState(false);
	const [isEmbedding, setIsEmbedding] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	
	// Result states
	const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null);
	const [actionItems, setActionItems] = useState<ActionItem[]>([]);
	const [priorityMessages, setPriorityMessages] = useState<PriorityMessage[]>([]);
	const [decisions, setDecisions] = useState<Decision[]>([]);
	const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
	const [showResultsModal, setShowResultsModal] = useState(false);
	
	// Agent states
	const [agentGoal, setAgentGoal] = useState('');
	const [agentProgress, setAgentProgress] = useState<AgentProgress | null>(null);
	const [isRunningAgent, setIsRunningAgent] = useState(false);
	
	// Member list modal state
	const [showMemberList, setShowMemberList] = useState(false);
	const [lastSeenData, setLastSeenData] = useState<Record<string, string>>({});
	
	const flatListRef = useRef<FlatList>(null);
	const previousMessageCountRef = useRef(0);
	const isInitialLoadRef = useRef(true);
	const hasStartedEmbedding = useRef(false);
	
	const { messages, isLoading, sendMessage, isSending, refetch } = useMessages(conversationId);
	const { conversation } = useConversation(conversationId);
	const { onlineUserIds, onlineCount } = usePresence(conversationId);
	const { markAsRead } = useReadReceipts(conversationId);
	const { typingUserIds, startTyping, stopTyping } = useTyping(conversationId, userId || '');
	
	// Determine if this is a group chat (3+ participants)
	const isGroupChat = conversation ? conversation.participants.length >= 3 : false;

	// Helper to get user names from participant list
	const getUserName = (userId: string): string => {
		if (!conversation) return userId.substring(0, 8);
		const participant = conversation.participants.find(p => p.userId === userId);
		return participant?.name || userId.substring(0, 8);
	};

	// Format typing indicator text
	const getTypingText = (): string => {
		if (typingUserIds.length === 0) return '';
		if (typingUserIds.length === 1) {
			return `${getUserName(typingUserIds[0])} is typing...`;
		}
		if (typingUserIds.length === 2) {
			return `${getUserName(typingUserIds[0])} and ${getUserName(typingUserIds[1])} are typing...`;
		}
		return `${typingUserIds.length} people are typing...`;
	};

	// Format last seen time
	const formatLastSeen = (lastSeenAt: string | undefined): string => {
		if (!lastSeenAt) return 'Offline';
		
		const lastSeen = new Date(lastSeenAt);
		const now = new Date();
		const diffMs = now.getTime() - lastSeen.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `Last seen ${diffMins}m ago`;
		if (diffHours < 24) return `Last seen ${diffHours}h ago`;
		if (diffDays < 7) return `Last seen ${diffDays}d ago`;
		return `Last seen ${lastSeen.toLocaleDateString()}`;
	};

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

	// Fetch last seen data when member list opens
	useEffect(() => {
		if (showMemberList && conversation) {
			const fetchLastSeen = async () => {
				try {
					const result = await db.getAllAsync<{ user_id: string; last_seen_at: string }>(
						'SELECT user_id, last_seen_at FROM user_presence'
					);
					
					const lastSeenMap: Record<string, string> = {};
					result.forEach(row => {
						lastSeenMap[row.user_id] = row.last_seen_at;
					});
					setLastSeenData(lastSeenMap);
				} catch (error) {
					console.error('Failed to fetch last seen data:', error);
				}
			};

			fetchLastSeen();
		}
	}, [showMemberList, conversation, db]);

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
		
		// Stop typing indicator
		stopTyping();
		
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

	const handleSummarize = async () => {
		setIsProcessing(true);
		try {
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/summarize`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId }),
			});

			const result = await response.json();

			if (result.success && result.bulletPoints) {
				setSummaryResult({
					summary: result.summary || '',
					bulletPoints: result.bulletPoints,
					messageCount: result.messageCount || 0,
				});
				setShowResultsModal(true);
			} else {
				Alert.alert('Error', result.error || 'Failed to summarize thread');
			}
		} catch (error) {
			console.error('Summarize error:', error);
			Alert.alert('Error', 'Failed to summarize thread');
		} finally {
			setIsProcessing(false);
		}
	};

	const handleExtractActions = async () => {
		setIsProcessing(true);
		try {
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/action-items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId }),
			});

			const result = await response.json();

			if (result.success) {
				setActionItems(result.actionItems || []);
				setShowResultsModal(true);
			} else {
				Alert.alert('Error', result.error || 'Failed to extract action items');
			}
		} catch (error) {
			console.error('Action items error:', error);
			Alert.alert('Error', 'Failed to extract action items');
		} finally {
			setIsProcessing(false);
		}
	};

	const handleDetectPriority = async () => {
		setIsProcessing(true);
		try {
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/priority-messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId }),
			});

			const result = await response.json();

			if (result.success) {
				setPriorityMessages(result.priorityMessages || []);
				setShowResultsModal(true);
			} else {
				Alert.alert('Error', result.error || 'Failed to detect priority messages');
			}
		} catch (error) {
			console.error('Priority detection error:', error);
			Alert.alert('Error', 'Failed to detect priority messages');
		} finally {
			setIsProcessing(false);
		}
	};

	const handleTrackDecisions = async () => {
		setIsProcessing(true);
		try {
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/decisions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId }),
			});

			const result = await response.json();

			if (result.success) {
				setDecisions(result.decisions || []);
				setShowResultsModal(true);
			} else {
				Alert.alert('Error', result.error || 'Failed to track decisions');
			}
		} catch (error) {
			console.error('Decision tracking error:', error);
			Alert.alert('Error', 'Failed to track decisions');
		} finally {
			setIsProcessing(false);
		}
	};

	const handleSmartSearch = async () => {
		if (!aiQuery.trim()) {
			Alert.alert('Error', 'Please enter a search query');
			return;
		}

		setIsProcessing(true);
		const query = aiQuery.trim();
		setAiQuery('');

		try {
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/smart-search`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ query, userId }),
			});

			const result = await response.json();

			if (result.success) {
				setSearchResults(result.results || []);
				setShowResultsModal(true);
			} else {
				Alert.alert('Error', result.error || 'Failed to search');
			}
		} catch (error) {
			console.error('Smart search error:', error);
			Alert.alert('Error', 'Failed to search');
		} finally {
			setIsProcessing(false);
		}
	};

	const handleRunAgent = async () => {
		if (!agentGoal.trim()) {
			Alert.alert('Error', 'Please enter an event planning goal');
			return;
		}

		setIsRunningAgent(true);
		setAgentProgress(null);
		const goal = agentGoal.trim();

		try {
			// Call the agent endpoint - this triggers the workflow
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/run-agent`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ goal, userId }),
			});

			const result = await response.json();

			if (result.success) {
				// Update agent progress
				setAgentProgress({
					currentStep: result.currentStep,
					message: result.message,
					completed: result.completed || false,
					data: result.data,
				});

				// If not complete, continue calling agent to execute next steps
				if (!result.completed && result.nextStep) {
					// Wait a bit for agent to save state, then continue
					setTimeout(() => {
						continueAgent();
					}, 1000);
				} else if (result.completed) {
					setAgentGoal(''); // Clear goal on completion
					setShowResultsModal(true); // Show final plan
				}
			} else {
				Alert.alert('Error', result.error || 'Agent failed');
				setAgentProgress({
					currentStep: 'failed',
					message: result.error || 'Agent encountered an error',
					completed: true,
					error: result.error,
				});
			}
		} catch (error) {
			console.error('Agent error:', error);
			Alert.alert('Error', 'Failed to run event planning agent');
			setAgentProgress({
				currentStep: 'failed',
				message: 'Failed to connect to agent',
				completed: true,
				error: String(error),
			});
		} finally {
			setIsRunningAgent(false);
		}
	};

	const continueAgent = async () => {
		if (!userId || !agentGoal.trim()) return;

		setIsRunningAgent(true);

		try {
			// Call again with same goal - agent will resume from last state
			const response = await fetch(`${WORKER_URL}/api/conversations/${conversationId}/run-agent`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ goal: agentGoal, userId }),
			});

			const result = await response.json();

			if (result.success) {
				setAgentProgress({
					currentStep: result.currentStep,
					message: result.message,
					completed: result.completed || false,
					data: result.data,
				});

				// Continue if not complete
				if (!result.completed && result.nextStep) {
					setTimeout(() => {
						continueAgent();
					}, 1000);
				} else if (result.completed) {
					setAgentGoal('');
					setShowResultsModal(true);
				}
			} else {
				Alert.alert('Error', result.error || 'Agent step failed');
				setAgentProgress({
					currentStep: 'failed',
					message: result.error || 'Agent encountered an error',
					completed: true,
					error: result.error,
				});
			}
		} catch (error) {
			console.error('Agent continuation error:', error);
			setAgentProgress({
				currentStep: 'failed',
				message: 'Failed to continue agent workflow',
				completed: true,
				error: String(error),
			});
		} finally {
			setIsRunningAgent(false);
		}
	};

	const scrollToMessage = (messageId: string) => {
		const messageIndex = messages.findIndex(msg => msg.id === messageId);
		if (messageIndex !== -1 && flatListRef.current) {
			// Close the modal
			setShowResultsModal(false);
			
			// Scroll to the message
			setTimeout(() => {
				flatListRef.current?.scrollToIndex({
					index: messageIndex,
					animated: true,
					viewPosition: 0.5, // Center the message
				});
			}, 300); // Small delay to allow modal to close
		} else {
			Alert.alert('Message not found', 'This message may not be loaded yet.');
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
								style={[styles.aiButton, showAiInput && styles.aiButtonActive, { marginRight: 6 }]}
							>
								<Text style={styles.aiButtonText}>🤖 AI</Text>
							</TouchableOpacity>
							{wsStatus === 'connected' && onlineCount > 0 && (
								<TouchableOpacity 
									style={styles.onlineStatusContainer}
									onPress={() => setShowMemberList(true)}
								>
									<View style={styles.onlineIndicator} />
									<Text style={[styles.onlineCount, { marginLeft: 6 }]}>{onlineCount} online</Text>
								</TouchableOpacity>
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
				{/* AI Panel - Sticky at top */}
				{showAiInput && (
					<View style={styles.aiInputContainer}>
						<View style={styles.aiInputHeader}>
							<Text style={styles.aiInputTitle}>🤖 AI Assistant</Text>
							<TouchableOpacity onPress={() => setShowAiInput(false)}>
								<Text style={styles.aiInputClose}>✕</Text>
							</TouchableOpacity>
						</View>
						
						{/* Feature selector buttons */}
						<View style={styles.featureButtonsContainer}>
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'ask' && styles.featureButtonActive]}
								onPress={() => setActiveFeature('ask')}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'ask' && styles.featureButtonTextActive]}>
									💬 Ask
								</Text>
							</TouchableOpacity>
							
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'summarize' && styles.featureButtonActive]}
								onPress={() => {
									setActiveFeature('summarize');
									handleSummarize();
								}}
								disabled={isProcessing}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'summarize' && styles.featureButtonTextActive]}>
									📝 Summary
								</Text>
							</TouchableOpacity>
							
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'actions' && styles.featureButtonActive]}
								onPress={() => {
									setActiveFeature('actions');
									handleExtractActions();
								}}
								disabled={isProcessing}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'actions' && styles.featureButtonTextActive]}>
									✅ Actions
								</Text>
							</TouchableOpacity>
							
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'priority' && styles.featureButtonActive]}
								onPress={() => {
									setActiveFeature('priority');
									handleDetectPriority();
								}}
								disabled={isProcessing}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'priority' && styles.featureButtonTextActive]}>
									⚡ Priority
								</Text>
							</TouchableOpacity>
						</View>

						<View style={styles.featureButtonsContainer}>
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'decisions' && styles.featureButtonActive]}
								onPress={() => {
									setActiveFeature('decisions');
									handleTrackDecisions();
								}}
								disabled={isProcessing}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'decisions' && styles.featureButtonTextActive]}>
									🎯 Decisions
								</Text>
							</TouchableOpacity>
							
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'search' && styles.featureButtonActive]}
								onPress={() => setActiveFeature('search')}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'search' && styles.featureButtonTextActive]}>
									🔍 Search
								</Text>
							</TouchableOpacity>
							
							<TouchableOpacity
								style={[styles.featureButton, activeFeature === 'planner' && styles.featureButtonActive]}
								onPress={() => setActiveFeature('planner')}
							>
								<Text style={[styles.featureButtonText, activeFeature === 'planner' && styles.featureButtonTextActive]}>
									🎉 Planner
								</Text>
							</TouchableOpacity>
						</View>
						
						{/* Progress indicator */}
						{(isEmbedding || isAskingAi || isProcessing) && (
							<View style={styles.aiProgressContainer}>
								<ActivityIndicator size="small" color="#007AFF" style={{ marginRight: 8 }} />
								<Text style={styles.aiProgressText}>
									{isEmbedding ? `Preparing RAG (${messages.length} messages)...` : 
									 isAskingAi ? 'Asking AI...' : 'Processing...'}
								</Text>
							</View>
						)}

						{/* Input field - for ask, search, and planner features */}
						{(activeFeature === 'ask' || activeFeature === 'search' || activeFeature === 'planner') && (
							<>
								<View style={styles.aiInputRow}>
									<TextInput
										style={styles.aiInput}
										value={activeFeature === 'planner' ? agentGoal : aiQuery}
										onChangeText={activeFeature === 'planner' ? setAgentGoal : setAiQuery}
										placeholder={
											activeFeature === 'ask' ? 'Ask a question...' :
											activeFeature === 'search' ? 'Search messages...' :
											'Plan team lunch next Friday...'
										}
										placeholderTextColor="#999"
										editable={true}
										autoFocus
										multiline={activeFeature === 'planner'}
										numberOfLines={activeFeature === 'planner' ? 2 : 1}
									/>
									<TouchableOpacity
										style={[
											styles.aiSendButton, 
											(activeFeature === 'ask' && (!aiQuery.trim() || isAskingAi || isEmbedding || isProcessing)) && styles.aiSendButtonDisabled,
											(activeFeature === 'search' && (!aiQuery.trim() || isProcessing)) && styles.aiSendButtonDisabled,
											(activeFeature === 'planner' && (!agentGoal.trim() || isRunningAgent)) && styles.aiSendButtonDisabled
										]}
										onPress={
											activeFeature === 'ask' ? handleAskAI :
											activeFeature === 'search' ? handleSmartSearch :
											handleRunAgent
										}
										disabled={
											(activeFeature === 'ask' && (!aiQuery.trim() || isAskingAi || isEmbedding || isProcessing)) ||
											(activeFeature === 'search' && (!aiQuery.trim() || isProcessing)) ||
											(activeFeature === 'planner' && (!agentGoal.trim() || isRunningAgent))
										}
									>
										{(isAskingAi || isEmbedding || isProcessing || isRunningAgent) ? (
											<ActivityIndicator size="small" color="#fff" />
										) : (
											<Text style={styles.aiSendButtonText}>
												{activeFeature === 'ask' ? 'Ask' : 
												 activeFeature === 'search' ? 'Search' :
												 'Plan'}
											</Text>
										)}
									</TouchableOpacity>
								</View>
								
								{/* Agent progress */}
								{activeFeature === 'planner' && agentProgress && (
									<View style={styles.agentProgressContainer}>
										<Text style={styles.agentProgressStep}>
											Step: {agentProgress.currentStep}
										</Text>
										<Text style={styles.agentProgressMessage}>
											{agentProgress.message}
										</Text>
										{agentProgress.error && (
											<Text style={styles.agentProgressError}>
												Error: {agentProgress.error}
											</Text>
										)}
									</View>
								)}
								
								<Text style={styles.aiInputHint}>
									{isEmbedding ? '⏳ Preparing semantic search...' : 
									 isRunningAgent ? '🤖 Agent is working through the workflow...' :
									 activeFeature === 'ask' ? 'Response appears as a message (uses RAG)' :
									 activeFeature === 'search' ? 'Semantic search with relevance ranking' :
									 'Multi-step agent plans team events automatically'}
								</Text>
							</>
						)}
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
							onScrollToIndexFailed={(info) => {
								// Fallback: scroll to offset
								flatListRef.current?.scrollToOffset({
									offset: info.averageItemLength * info.index,
									animated: true,
								});
							}}
							ListEmptyComponent={
								<View style={styles.emptyState}>
									<Text style={styles.emptyText}>No messages yet</Text>
									<Text style={styles.emptySubtext}>Start the conversation!</Text>
								</View>
							}
						/>
					)}

				{/* Typing Indicator */}
				{typingUserIds.length > 0 && (
					<View style={styles.typingIndicatorContainer}>
						<Text style={styles.typingIndicatorText}>{getTypingText()}</Text>
					</View>
				)}

				<View style={styles.inputContainer}>
					<TextInput
						style={styles.input}
						value={inputText}
						onChangeText={(text) => {
							setInputText(text);
							if (text.trim()) {
								startTyping();
							} else {
								stopTyping();
							}
						}}
						onBlur={stopTyping}
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

				{/* Member List Modal */}
				<Modal
					visible={showMemberList}
					animationType="slide"
					transparent={true}
					onRequestClose={() => setShowMemberList(false)}
				>
					<TouchableOpacity 
						style={styles.memberModalOverlay}
						activeOpacity={1}
						onPress={() => setShowMemberList(false)}
					>
						<TouchableOpacity 
							style={styles.memberModalContent}
							activeOpacity={1}
							onPress={(e) => e.stopPropagation()}
						>
							<View style={styles.memberModalHeader}>
								<Text style={styles.memberModalTitle}>
									{conversation?.type === 'group' 
										? `Group Members (${conversation?.participants.length})`
										: 'Chat Info'
									}
								</Text>
								<TouchableOpacity 
									onPress={() => setShowMemberList(false)}
									style={styles.closeButton}
								>
									<Text style={styles.closeButtonText}>✕</Text>
								</TouchableOpacity>
							</View>

							<View style={styles.memberList}>
								{conversation?.participants.map((participant) => {
									const isOnline = onlineUserIds.includes(participant.userId);
									const isCurrentUser = participant.userId === userId;
									const displayName = participant.name || participant.userId.substring(0, 8);
									const lastSeenAt = lastSeenData[participant.userId];

									return (
										<View key={participant.userId} style={styles.memberItem}>
											<View style={styles.memberAvatar}>
												<Text style={styles.memberAvatarText}>
													{displayName.charAt(0).toUpperCase()}
												</Text>
											</View>
											<View style={styles.memberInfo}>
												<View style={styles.memberNameRow}>
													<Text style={styles.memberName}>
														{displayName}
														{isCurrentUser && ' (You)'}
													</Text>
													<View style={[
														styles.memberStatusDot,
														isOnline ? styles.statusOnline : styles.statusOffline
													]} />
												</View>
												<Text style={styles.memberStatus}>
													{isOnline ? 'Online' : formatLastSeen(lastSeenAt)}
												</Text>
											</View>
										</View>
									);
								})}
							</View>
						</TouchableOpacity>
					</TouchableOpacity>
				</Modal>

				{/* Results Modal */}
				<Modal
					visible={showResultsModal}
					animationType="slide"
					transparent={false}
					onRequestClose={() => setShowResultsModal(false)}
				>
					<View style={styles.modalContainer}>
						<View style={styles.modalHeader}>
							<Text style={styles.modalTitle}>
								{activeFeature === 'summarize' && '📝 Thread Summary'}
								{activeFeature === 'actions' && '✅ Action Items'}
								{activeFeature === 'priority' && '⚡ Priority Messages'}
								{activeFeature === 'decisions' && '🎯 Decisions Tracked'}
								{activeFeature === 'search' && '🔍 Search Results'}
								{activeFeature === 'planner' && '🎉 Event Plan'}
							</Text>
							<TouchableOpacity onPress={() => setShowResultsModal(false)}>
								<Text style={styles.modalClose}>✕</Text>
							</TouchableOpacity>
						</View>

						<View style={styles.modalContent}>
							{/* Summary Results */}
							{activeFeature === 'summarize' && summaryResult && (
								<>
									<Text style={styles.resultLabel}>
										Summary of {summaryResult.messageCount} messages:
									</Text>
									{summaryResult.bulletPoints.map((point, idx) => (
										<View key={idx} style={styles.bulletPoint}>
											<Text style={styles.bulletPointText}>• {point}</Text>
										</View>
									))}
								</>
							)}

							{/* Action Items Results */}
							{activeFeature === 'actions' && (
								<>
									{actionItems.length === 0 ? (
										<Text style={styles.emptyResult}>No action items found in this conversation.</Text>
									) : (
										actionItems.map((item, idx) => (
											<View key={idx} style={styles.actionItem}>
												<Text style={styles.actionTask}>✅ {item.task}</Text>
												{item.assignee && (
													<Text style={styles.actionMeta}>Assignee: {item.assignee}</Text>
												)}
												{item.dueDate && (
													<Text style={styles.actionMeta}>Due: {item.dueDate}</Text>
												)}
												{item.mentioned && (
													<Text style={styles.actionContext}>{item.mentioned}</Text>
												)}
											</View>
										))
									)}
								</>
							)}

							{/* Priority Messages Results */}
							{activeFeature === 'priority' && (
								<>
									{priorityMessages.length === 0 ? (
										<Text style={styles.emptyResult}>No priority messages detected.</Text>
									) : (
										priorityMessages.map((msg, idx) => (
											<TouchableOpacity 
												key={idx} 
												style={styles.priorityMessage}
												onPress={() => scrollToMessage(msg.messageId)}
												activeOpacity={0.7}
											>
												<View style={styles.priorityHeader}>
													<Text style={[
														styles.priorityBadge,
														msg.priority === 'high' ? styles.priorityHigh : styles.priorityMedium
													]}>
														{msg.priority === 'high' ? '🔴 HIGH' : '🟡 MEDIUM'}
													</Text>
													<Text style={styles.prioritySender}>{msg.sender}</Text>
												</View>
												<Text style={styles.priorityContent}>{msg.content}</Text>
												<Text style={styles.priorityReason}>Reason: {msg.reason}</Text>
												<Text style={styles.priorityTime}>
													{new Date(msg.timestamp).toLocaleString()}
												</Text>
												<Text style={styles.tapHint}>Tap to view in conversation →</Text>
											</TouchableOpacity>
										))
									)}
								</>
							)}

							{/* Decisions Results */}
							{activeFeature === 'decisions' && (
								<>
									{decisions.length === 0 ? (
										<Text style={styles.emptyResult}>No decisions tracked in this conversation.</Text>
									) : (
										decisions.map((decision, idx) => (
											<View key={idx} style={styles.decision}>
												<Text style={styles.decisionText}>🎯 {decision.decision}</Text>
												<Text style={styles.decisionTime}>
													{new Date(decision.timestamp).toLocaleString()}
												</Text>
												{decision.participants.length > 0 && (
													<Text style={styles.decisionParticipants}>
														Participants: {decision.participants.join(', ')}
													</Text>
												)}
												{decision.context && (
													<Text style={styles.decisionContext}>{decision.context}</Text>
												)}
											</View>
										))
									)}
								</>
							)}

							{/* Search Results */}
							{activeFeature === 'search' && (
								<>
									{searchResults.length === 0 ? (
										<Text style={styles.emptyResult}>No results found.</Text>
									) : (
										<>
											<Text style={styles.resultLabel}>{searchResults.length} results found:</Text>
											{searchResults.map((result, idx) => (
												<TouchableOpacity 
													key={idx} 
													style={styles.searchResult}
													onPress={() => scrollToMessage(result.messageId)}
													activeOpacity={0.7}
												>
													<View style={styles.searchHeader}>
														<Text style={styles.searchSender}>{result.sender}</Text>
														<Text style={styles.searchScore}>
															{(result.relevanceScore * 100).toFixed(0)}% match
														</Text>
													</View>
													<Text style={styles.searchContent}>{result.content}</Text>
													<Text style={styles.searchTime}>
														{new Date(result.timestamp).toLocaleString()}
													</Text>
													<Text style={styles.tapHint}>Tap to view in conversation →</Text>
												</TouchableOpacity>
											))}
										</>
									)}
								</>
							)}
							
							{/* Event Planner Results */}
							{activeFeature === 'planner' && agentProgress && agentProgress.completed && agentProgress.data && (
								<View style={styles.eventPlan}>
									<Text style={styles.eventPlanTitle}>
										{agentProgress.data.venue !== 'N/A' ? '🎉 Event Plan Ready!' : '✅ Meeting Scheduled!'}
									</Text>
									
									<View style={styles.eventDetail}>
										<Text style={styles.eventLabel}>📅 Event Type:</Text>
										<Text style={styles.eventValue}>
											{agentProgress.data.eventType.charAt(0).toUpperCase() + agentProgress.data.eventType.slice(1)}
										</Text>
									</View>
									
									<View style={styles.eventDetail}>
										<Text style={styles.eventLabel}>⏰ Date & Time:</Text>
										<Text style={styles.eventValue}>{agentProgress.data.date} at {agentProgress.data.time}</Text>
									</View>
									
									{/* Only show venue if it's a food event */}
									{agentProgress.data.venue !== 'N/A' && (
										<>
											<View style={styles.eventDetail}>
												<Text style={styles.eventLabel}>🏪 Venue:</Text>
												<Text style={styles.eventValue}>{agentProgress.data.venue}</Text>
											</View>
											
											<View style={styles.eventDetail}>
												<Text style={styles.eventLabel}>📍 Location:</Text>
												<Text style={styles.eventValue}>{agentProgress.data.location}</Text>
											</View>
										</>
									)}
									
									<View style={styles.eventSummary}>
										<Text style={styles.eventSummaryText}>
											{agentProgress.data.venue !== 'N/A' 
												? `The agent has analyzed your conversation and planned this ${agentProgress.data.eventType}. All details have been shared in the chat above.`
												: `The agent has analyzed your conversation. Check the messages above for suggested times and coordinate with your team.`
											}
										</Text>
									</View>
								</View>
							)}
						</View>
					</View>
				</Modal>
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
		color: '#1a1a1a',
	},
	aiInputClose: {
		fontSize: 20,
		color: '#666',
	},
	aiProgressContainer: {
		flexDirection: 'row',
		alignItems: 'center',
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
		marginRight: 8,
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
	// Feature Buttons
	featureButtonsContainer: {
		flexDirection: 'row',
		marginBottom: 8,
		flexWrap: 'wrap',
	},
	featureButton: {
		backgroundColor: '#f0f0f0',
		paddingHorizontal: 12,
		paddingVertical: 8,
		borderRadius: 6,
		borderWidth: 1,
		borderColor: '#e0e0e0',
		marginRight: 8,
		marginBottom: 4,
	},
	featureButtonActive: {
		backgroundColor: '#007AFF',
		borderColor: '#007AFF',
	},
	featureButtonText: {
		fontSize: 12,
		color: '#1a1a1a',
		fontWeight: '600',
	},
	featureButtonTextActive: {
		color: '#ffffff',
	},
	// Results Modal
	modalContainer: {
		flex: 1,
		backgroundColor: '#fff',
	},
	modalHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		padding: 16,
		borderBottomWidth: 1,
		borderBottomColor: '#e0e0e0',
		backgroundColor: '#f8f9fa',
	},
	modalTitle: {
		fontSize: 18,
		fontWeight: '700',
		color: '#333',
	},
	modalClose: {
		fontSize: 24,
		color: '#666',
		fontWeight: '300',
	},
	modalContent: {
		flex: 1,
		padding: 16,
	},
	resultLabel: {
		fontSize: 14,
		fontWeight: '600',
		color: '#666',
		marginBottom: 12,
	},
	emptyResult: {
		fontSize: 14,
		color: '#999',
		fontStyle: 'italic',
		textAlign: 'center',
		marginTop: 20,
	},
	// Summary styles
	bulletPoint: {
		marginBottom: 12,
		paddingLeft: 8,
	},
	bulletPointText: {
		fontSize: 15,
		lineHeight: 22,
		color: '#333',
	},
	// Action Item styles
	actionItem: {
		backgroundColor: '#f8f9fa',
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
		borderLeftWidth: 3,
		borderLeftColor: '#28a745',
	},
	actionTask: {
		fontSize: 15,
		fontWeight: '600',
		color: '#333',
		marginBottom: 6,
	},
	actionMeta: {
		fontSize: 13,
		color: '#666',
		marginTop: 4,
	},
	actionContext: {
		fontSize: 12,
		color: '#999',
		marginTop: 6,
		fontStyle: 'italic',
	},
	// Priority Message styles
	priorityMessage: {
		backgroundColor: '#fff',
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
		borderWidth: 1,
		borderColor: '#e0e0e0',
	},
	priorityHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 8,
	},
	priorityBadge: {
		fontSize: 11,
		fontWeight: '700',
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 4,
	},
	priorityHigh: {
		backgroundColor: '#fee',
		color: '#c00',
	},
	priorityMedium: {
		backgroundColor: '#fffbeb',
		color: '#f59e0b',
	},
	prioritySender: {
		fontSize: 13,
		fontWeight: '600',
		color: '#666',
	},
	priorityContent: {
		fontSize: 14,
		color: '#333',
		marginBottom: 6,
	},
	priorityReason: {
		fontSize: 12,
		color: '#666',
		fontStyle: 'italic',
		marginBottom: 4,
	},
	priorityTime: {
		fontSize: 11,
		color: '#999',
	},
	// Decision styles
	decision: {
		backgroundColor: '#f0f8ff',
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
		borderLeftWidth: 3,
		borderLeftColor: '#007AFF',
	},
	decisionText: {
		fontSize: 15,
		fontWeight: '600',
		color: '#333',
		marginBottom: 6,
	},
	decisionTime: {
		fontSize: 12,
		color: '#666',
		marginBottom: 4,
	},
	decisionParticipants: {
		fontSize: 13,
		color: '#666',
		marginTop: 4,
	},
	decisionContext: {
		fontSize: 12,
		color: '#999',
		marginTop: 6,
		fontStyle: 'italic',
	},
	// Search Result styles
	searchResult: {
		backgroundColor: '#f8f9fa',
		padding: 12,
		borderRadius: 8,
		marginBottom: 12,
	},
	searchHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 6,
	},
	searchSender: {
		fontSize: 13,
		fontWeight: '600',
		color: '#666',
	},
	searchScore: {
		fontSize: 11,
		color: '#007AFF',
		fontWeight: '600',
	},
	searchContent: {
		fontSize: 14,
		color: '#333',
		marginBottom: 6,
	},
	searchTime: {
		fontSize: 11,
		color: '#999',
	},
	tapHint: {
		fontSize: 11,
		color: '#007AFF',
		marginTop: 6,
		fontStyle: 'italic',
		textAlign: 'right',
	},
	// Agent Progress
	agentProgressContainer: {
		backgroundColor: '#f0f8ff',
		padding: 12,
		borderRadius: 8,
		marginTop: 8,
		borderWidth: 1,
		borderColor: '#007AFF',
	},
	agentProgressStep: {
		fontSize: 12,
		fontWeight: '600',
		color: '#007AFF',
		marginBottom: 4,
	},
	agentProgressMessage: {
		fontSize: 14,
		color: '#333',
		marginBottom: 4,
	},
	agentProgressError: {
		fontSize: 12,
		color: '#ff3b30',
		marginTop: 4,
		fontStyle: 'italic',
	},
	// Event Plan
	eventPlan: {
		backgroundColor: '#fff',
	},
	eventPlanTitle: {
		fontSize: 20,
		fontWeight: '700',
		color: '#007AFF',
		marginBottom: 20,
		textAlign: 'center',
	},
	eventDetail: {
		marginBottom: 16,
		borderBottomWidth: 1,
		borderBottomColor: '#f0f0f0',
		paddingBottom: 12,
	},
	eventLabel: {
		fontSize: 13,
		fontWeight: '600',
		color: '#666',
		marginBottom: 6,
	},
	eventValue: {
		fontSize: 16,
		color: '#333',
		fontWeight: '500',
	},
	eventSummary: {
		backgroundColor: '#f8f9fa',
		padding: 16,
		borderRadius: 8,
		marginTop: 8,
	},
	eventSummaryText: {
		fontSize: 14,
		color: '#555',
		lineHeight: 20,
		textAlign: 'center',
	},
	// Typing Indicator
	typingIndicatorContainer: {
		paddingHorizontal: 16,
		paddingVertical: 8,
		backgroundColor: '#f8f9fa',
	},
	typingIndicatorText: {
		fontSize: 13,
		color: '#666',
		fontStyle: 'italic',
	},
	// Online Status Container
	onlineStatusContainer: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 4,
		paddingHorizontal: 8,
		borderRadius: 12,
		backgroundColor: 'rgba(255, 255, 255, 0.1)',
	},
	// Member List Modal
	memberModalOverlay: {
		flex: 1,
		backgroundColor: 'rgba(0, 0, 0, 0.5)',
		justifyContent: 'flex-end',
	},
	memberModalContent: {
		backgroundColor: '#fff',
		borderTopLeftRadius: 20,
		borderTopRightRadius: 20,
		paddingBottom: Platform.OS === 'ios' ? 40 : 20,
		maxHeight: '80%',
	},
	memberModalHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		paddingHorizontal: 20,
		paddingVertical: 16,
		borderBottomWidth: 1,
		borderBottomColor: '#eee',
	},
	memberModalTitle: {
		fontSize: 18,
		fontWeight: '600',
		color: '#000',
	},
	closeButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: '#f0f0f0',
		justifyContent: 'center',
		alignItems: 'center',
	},
	closeButtonText: {
		fontSize: 20,
		color: '#666',
		fontWeight: '500',
	},
	memberList: {
		paddingHorizontal: 20,
		paddingTop: 12,
	},
	memberItem: {
		flexDirection: 'row',
		alignItems: 'center',
		paddingVertical: 12,
		borderBottomWidth: 1,
		borderBottomColor: '#f0f0f0',
	},
	memberAvatar: {
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: '#007AFF',
		justifyContent: 'center',
		alignItems: 'center',
		marginRight: 12,
	},
	memberAvatarText: {
		color: '#fff',
		fontSize: 18,
		fontWeight: '600',
	},
	memberInfo: {
		flex: 1,
	},
	memberNameRow: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		marginBottom: 4,
	},
	memberName: {
		fontSize: 16,
		fontWeight: '500',
		color: '#000',
	},
	memberStatusDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		marginLeft: 8,
	},
	statusOnline: {
		backgroundColor: '#44b700',
	},
	statusOffline: {
		backgroundColor: '#999',
	},
	memberStatus: {
		fontSize: 13,
		color: '#666',
	},
});

