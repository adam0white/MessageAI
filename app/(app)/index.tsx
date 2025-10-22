/**
 * Conversation List Screen
 * 
 * Displays all conversations for the current user
 */

import React, { useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useRouter, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, TextInput, Platform } from 'react-native';
import { useConversations, useCreateConversation } from '../../hooks/useConversations';
import type { ConversationPreview } from '../../lib/api/types';
import { useAuthStore } from '../../lib/stores/auth';
import { clearAllData } from '../../lib/db/queries';

export default function ConversationListScreen() {
	const { signOut } = useAuth();
	const { user } = useUser();
	const router = useRouter();
	const db = useSQLiteContext();
	const { userId } = useAuthStore();
	const { conversations, isLoading, refetch } = useConversations();
	const { createConversationAsync, isCreating } = useCreateConversation();
	const [showUserIdModal, setShowUserIdModal] = useState(false);
	const [conversationName, setConversationName] = useState('');
	const [participantIds, setParticipantIds] = useState<string>(''); // Comma-separated user IDs

	async function handleSignOut() {
		try {
			// Clear local database before signing out
			await clearAllData(db);
			console.log('✅ Database cleared on logout');
		} catch (error) {
			console.error('⚠️ Failed to clear database on logout:', error);
		}
		
		await signOut();
		router.replace('/auth/sign-in');
	}

	function handleConversationPress(conversationId: string) {
		router.push(`/chat/${conversationId}`);
	}

	function formatTimestamp(isoString: string): string {
		const date = new Date(isoString);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;
		
		return date.toLocaleDateString();
	}

	function getConversationName(conv: ConversationPreview): string {
		// For group chats, always use the group name
		if (conv.type === 'group' && conv.name) {
			return conv.name;
		}
		
		// For groups without a name, show participant count
		if (conv.type === 'group') {
			return `Group (${conv.participants.length} members)`;
		}
		
		// For self-chat (only one participant), show "You (Notes)"
		if (conv.participants.length === 1) {
			return 'You (Notes)';
		}
		
		// For direct chats, show the other user's name
		const otherParticipant = conv.participants.find(p => p.id !== userId);
		if (otherParticipant) {
			return otherParticipant.name || otherParticipant.id.substring(0, 8) || 'Unknown';
		}
		
		return 'Unknown';
	}

	async function handleNewChat() {
		// Show modal to choose between self-chat or enter user ID
		setShowUserIdModal(true);
	}

	async function createConversation() {
		if (!userId) {
			Alert.alert('Error', 'User not authenticated');
			return;
		}

		// Parse participant IDs from comma-separated string
		const trimmedParticipantIds = participantIds.trim();
		const parsedParticipantIds = trimmedParticipantIds
			? trimmedParticipantIds.split(',').map(id => id.trim()).filter(id => id.length > 0)
			: [];

		// Build participant list (always include current user)
		const allParticipants = [userId, ...parsedParticipantIds];

		// Determine conversation type based on participant count
		// 1 participant = self-chat
		// 2 participants = direct chat
		// 3+ participants = group chat
		const conversationType: 'direct' | 'group' = allParticipants.length >= 3 ? 'group' : 'direct';
		const trimmedName = conversationName.trim();

		console.log('🆕 Creating conversation:', {
			type: conversationType,
			participants: allParticipants,
			name: trimmedName || '(no name)',
		});

		try {
			const conversation = await createConversationAsync({
				type: conversationType,
				participantIds: allParticipants,
				name: trimmedName || undefined,
			});

			console.log('✅ Conversation created, navigating to:', conversation.id);
			setShowUserIdModal(false);
			setConversationName('');
			setParticipantIds('');
			router.push(`/chat/${conversation.id}`);
		} catch (error) {
			console.error('❌ Failed to create conversation:', error);
			Alert.alert('Error', 'Failed to create conversation: ' + (error instanceof Error ? error.message : 'Unknown'));
		}
	}

	if (isLoading) {
		return (
			<View style={[styles.container, styles.centered]}>
				<ActivityIndicator size="large" color="#007AFF" />
			</View>
		);
	}

	return (
		<>
			<Stack.Screen
				options={{
					title: 'Messages',
					headerRight: () => (
						<TouchableOpacity 
							onPress={handleNewChat}
							disabled={isCreating}
							style={styles.newChatButton}
						>
							{isCreating ? (
								<ActivityIndicator size="small" color="#fff" />
							) : (
								<Text style={styles.newChatButtonText}>+ New</Text>
							)}
						</TouchableOpacity>
					),
				}}
			/>
			
			<View style={styles.container}>
				<View style={styles.header}>
					<Text style={styles.welcomeText}>
						Welcome, {user?.emailAddresses[0]?.emailAddress}
					</Text>
					<TouchableOpacity onPress={handleSignOut} style={styles.signOutButton}>
						<Text style={styles.signOutText}>Sign Out</Text>
					</TouchableOpacity>
				</View>

			<FlatList
				data={conversations}
				keyExtractor={(item) => item.id}
				onRefresh={refetch}
				refreshing={isLoading}
				renderItem={({ item }) => {
					const conversationName = getConversationName(item);
					const lastMessageTime = item.lastMessage?.createdAt 
						? formatTimestamp(item.lastMessage.createdAt)
						: '';

					return (
						<TouchableOpacity 
							style={styles.conversationItem}
							onPress={() => handleConversationPress(item.id)}
						>
							<View style={styles.avatar}>
								<Text style={styles.avatarText}>
									{conversationName.charAt(0).toUpperCase()}
								</Text>
							</View>
							<View style={styles.conversationContent}>
								<View style={styles.conversationHeader}>
									<Text style={styles.conversationName}>{conversationName}</Text>
									{lastMessageTime && (
										<Text style={styles.timestamp}>{lastMessageTime}</Text>
									)}
								</View>
								<View style={styles.messageRow}>
									<Text style={styles.lastMessage} numberOfLines={1}>
										{item.lastMessage?.content || 'No messages yet'}
									</Text>
									{item.unreadCount > 0 && (
										<View style={styles.unreadBadge}>
											<Text style={styles.unreadText}>{item.unreadCount}</Text>
										</View>
									)}
								</View>
							</View>
						</TouchableOpacity>
					);
				}}
				ListEmptyComponent={
					<View style={styles.emptyState}>
						<Text style={styles.emptyText}>No conversations yet</Text>
						<Text style={styles.emptySubtext}>
							Start a new conversation to get started
						</Text>
					</View>
				}
			/>

			{/* User ID Input Modal */}
			<Modal
				visible={showUserIdModal}
				transparent
				animationType="fade"
				onRequestClose={() => setShowUserIdModal(false)}
			>
				<TouchableOpacity 
					style={styles.modalOverlay}
					activeOpacity={1}
					onPress={() => setShowUserIdModal(false)}
				>
					<TouchableOpacity 
						style={styles.modalContent}
						activeOpacity={1}
						onPress={(e) => e.stopPropagation()}
					>
					<Text style={styles.modalTitle}>New Conversation</Text>
					
					<Text style={styles.modalLabel}>Your User ID:</Text>
					<Text style={styles.userIdText} selectable>{userId}</Text>
					
					<Text style={styles.modalLabel}>Conversation Name (optional):</Text>
					<TextInput
						style={styles.modalInput}
						value={conversationName}
						onChangeText={setConversationName}
						placeholder="Name this conversation..."
						placeholderTextColor="#999"
						autoCapitalize="words"
					/>

					<Text style={styles.modalLabel}>Add Participants (optional):</Text>
					<Text style={styles.helpText}>
						Leave empty for self-chat, add 1 for direct chat, or 2+ for group chat. Comma-separated.
					</Text>
					<TextInput
						style={[styles.modalInput, styles.multilineInput]}
						value={participantIds}
						onChangeText={setParticipantIds}
						placeholder="user1, user2, user3..."
						placeholderTextColor="#999"
						autoCapitalize="none"
						autoCorrect={false}
						multiline
					/>
					
					<TouchableOpacity 
						style={[styles.fullWidthButton, styles.primaryButton]}
						onPress={createConversation}
						disabled={isCreating}
					>
						<Text style={styles.primaryButtonText}>
							{isCreating ? 'Creating...' : 'Create Conversation'}
						</Text>
					</TouchableOpacity>
					
					<TouchableOpacity 
						style={styles.cancelButton}
						onPress={() => {
							setShowUserIdModal(false);
							setConversationName('');
							setParticipantIds('');
						}}
					>
						<Text style={styles.cancelButtonText}>Cancel</Text>
					</TouchableOpacity>
					</TouchableOpacity>
				</TouchableOpacity>
			</Modal>
			</View>
		</>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#fff',
	},
	centered: {
		justifyContent: 'center',
		alignItems: 'center',
	},
	header: {
		padding: 16,
		borderBottomWidth: 1,
		borderBottomColor: '#eee',
	},
	welcomeText: {
		fontSize: 14,
		color: '#666',
		marginBottom: 8,
	},
	signOutButton: {
		alignSelf: 'flex-start',
	},
	signOutText: {
		color: '#007AFF',
		fontSize: 14,
		fontWeight: '600',
	},
	conversationItem: {
		flexDirection: 'row',
		padding: 16,
		borderBottomWidth: 1,
		borderBottomColor: '#eee',
	},
	avatar: {
		width: 50,
		height: 50,
		borderRadius: 25,
		backgroundColor: '#007AFF',
		alignItems: 'center',
		justifyContent: 'center',
		marginRight: 12,
	},
	avatarText: {
		color: '#fff',
		fontSize: 20,
		fontWeight: 'bold',
	},
	conversationContent: {
		flex: 1,
	},
	conversationHeader: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		marginBottom: 4,
	},
	conversationName: {
		fontSize: 16,
		fontWeight: '600',
	},
	timestamp: {
		fontSize: 12,
		color: '#999',
	},
	messageRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	lastMessage: {
		fontSize: 14,
		color: '#666',
		flex: 1,
	},
	unreadBadge: {
		backgroundColor: '#007AFF',
		borderRadius: 10,
		minWidth: 20,
		height: 20,
		alignItems: 'center',
		justifyContent: 'center',
		paddingHorizontal: 6,
		marginLeft: 8,
	},
	unreadText: {
		color: '#fff',
		fontSize: 12,
		fontWeight: 'bold',
	},
	emptyState: {
		flex: 1,
		alignItems: 'center',
		justifyContent: 'center',
		paddingTop: 100,
	},
	emptyText: {
		fontSize: 18,
		fontWeight: '600',
		color: '#333',
		marginBottom: 8,
	},
	emptySubtext: {
		fontSize: 14,
		color: '#666',
	},
	newChatButton: {
		marginRight: 12,
		paddingHorizontal: 12,
		paddingVertical: 6,
		backgroundColor: '#007AFF',
		borderRadius: 6,
		minWidth: 60,
		alignItems: 'center',
		justifyContent: 'center',
	},
	newChatButtonText: {
		color: '#fff',
		fontSize: 14,
		fontWeight: '600',
	},
	modalOverlay: {
		flex: 1,
		backgroundColor: 'rgba(0, 0, 0, 0.5)',
		justifyContent: 'center',
		alignItems: 'center',
		padding: 20,
	},
	modalContent: {
		backgroundColor: '#fff',
		borderRadius: 12,
		padding: 20,
		width: '100%',
		maxWidth: 400,
	},
	modalTitle: {
		fontSize: 20,
		fontWeight: 'bold',
		marginBottom: 20,
		textAlign: 'center',
	},
	modalLabel: {
		fontSize: 14,
		fontWeight: '600',
		marginBottom: 8,
		marginTop: 12,
		color: '#333',
	},
	userIdText: {
		fontSize: 12,
		color: '#007AFF',
		backgroundColor: '#f0f2f5',
		padding: 10,
		borderRadius: 6,
		marginBottom: 8,
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
	},
	modalInput: {
		borderWidth: 1,
		borderColor: '#e4e6eb',
		borderRadius: 8,
		padding: 12,
		fontSize: 14,
		marginBottom: 20,
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
	},
	modalButtons: {
		flexDirection: 'row',
		gap: 12,
		marginBottom: 12,
	},
	modalButton: {
		flex: 1,
		padding: 14,
		borderRadius: 8,
		alignItems: 'center',
	},
	primaryButton: {
		backgroundColor: '#007AFF',
	},
	secondaryButton: {
		backgroundColor: '#f0f2f5',
	},
	primaryButtonText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
	secondaryButtonText: {
		color: '#007AFF',
		fontSize: 16,
		fontWeight: '600',
	},
	cancelButton: {
		padding: 12,
		alignItems: 'center',
	},
	cancelButtonText: {
		color: '#999',
		fontSize: 14,
	},
	typeSelector: {
		flexDirection: 'row',
		backgroundColor: '#f0f2f5',
		borderRadius: 8,
		padding: 4,
		marginBottom: 16,
		gap: 4,
	},
	typeButton: {
		flex: 1,
		paddingVertical: 8,
		paddingHorizontal: 12,
		borderRadius: 6,
		alignItems: 'center',
	},
	typeButtonActive: {
		backgroundColor: '#fff',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 1 },
		shadowOpacity: 0.1,
		shadowRadius: 2,
		elevation: 2,
	},
	typeButtonText: {
		fontSize: 14,
		fontWeight: '500',
		color: '#65676b',
	},
	typeButtonTextActive: {
		color: '#007AFF',
		fontWeight: '600',
	},
	helpText: {
		fontSize: 12,
		color: '#65676b',
		marginBottom: 8,
		marginTop: -4,
	},
	multilineInput: {
		minHeight: 60,
		textAlignVertical: 'top',
		paddingTop: 12,
	},
	fullWidthButton: {
		width: '100%',
		padding: 14,
		borderRadius: 8,
		alignItems: 'center',
		marginTop: 8,
	},
});

