import React, { useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useRouter, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Modal, TextInput, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useConversations, useCreateConversation } from '../../hooks/useConversations';
import type { ConversationPreview } from '../../lib/api/types';
import { useAuthStore } from '../../lib/stores/auth';
import { useQueryClient } from '@tanstack/react-query';
import { clearAllData, deleteConversation as deleteLocalConv } from '../../lib/db/queries';
import { useTheme } from '../../lib/contexts/ThemeContext';
import { deleteConversationAPI } from '../../lib/api/delete';
import { config } from '../../lib/config';

export default function ConversationListScreen() {
	const { signOut, getToken } = useAuth();
	const { user } = useUser();
	const router = useRouter();
	const db = useSQLiteContext();
	const queryClient = useQueryClient();
	const { userId } = useAuthStore();
	const { colors } = useTheme();
	const { conversations, isLoading, refetch } = useConversations();
	const { createConversationAsync, isCreating } = useCreateConversation();
	const [showUserIdModal, setShowUserIdModal] = useState(false);
	const [conversationName, setConversationName] = useState('');
	const [participantIds, setParticipantIds] = useState<string>(''); // Comma-separated user IDs

	async function handleDeleteConversation(conversationId: string, conversationName: string) {
		try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); } catch {}
		
		Alert.alert(
			'Delete Conversation',
			`Delete "${conversationName}"? This will permanently delete all messages.`,
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Delete',
					style: 'destructive',
					onPress: async () => {
						try {
							const token = await getToken();
							if (!token) {
								Alert.alert('Error', 'Not authenticated');
								return;
							}

						// Delete from backend (also cleans up Durable Object)
						const result = await deleteConversationAPI(conversationId, token);
						
						if (!result.success) {
							throw new Error(result.error || 'Failed to delete');
						}

						// Delete from local database
						await deleteLocalConv(db, conversationId);

						// Clear React Query cache for this conversation's messages
						queryClient.removeQueries({ queryKey: ['messages', conversationId] });
						queryClient.removeQueries({ queryKey: ['conversation', conversationId] });

						// Refresh conversation list
						refetch();
						} catch (error) {
							console.error('Delete conversation error:', error);
							Alert.alert('Error', 'Failed to delete conversation');
						}
					},
				},
			]
		);
	}

	async function handleSignOut() {
		try {
			await clearAllData(db);
		} catch (error) {
			console.error('Failed to clear database on logout:', error);
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

	function getInitials(name: string): string {
		const parts = name.trim().split(' ');
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		}
		return name.substring(0, 2).toUpperCase();
	}

	function getAvatarColor(name: string): string {
		const colors = [
			'#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
			'#98D8C8', '#6C5CE7', '#A29BFE', '#FD79A8',
		];
		const hash = name.split('').reduce((acc, char) => char.charCodeAt(0) + ((acc << 5) - acc), 0);
		return colors[Math.abs(hash) % colors.length];
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

		// Parse participant emails from comma-separated string
		const trimmedParticipantIds = participantIds.trim();
		const emails = trimmedParticipantIds
			? trimmedParticipantIds.split(',').map(email => email.trim().toLowerCase()).filter(email => email.length > 0)
			: [];

		try {
			let userIds: string[] = [userId]; // Start with current user

			if (emails.length > 0) {
				// Look up user IDs by email
				const response = await fetch(`${config.workerUrl}/api/users/lookup-by-email`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ emails }),
				});

				if (!response.ok) {
					throw new Error('Failed to lookup users by email');
				}

				const data = await response.json() as { users: Record<string, string> };
				const foundUserIds = Object.values(data.users);

				if (foundUserIds.length === 0) {
					Alert.alert('Error', 'No users found with those email addresses');
					return;
				}

				if (foundUserIds.length < emails.length) {
					const foundEmails = Object.keys(data.users);
					const notFound = emails.filter(e => !foundEmails.includes(e));
					Alert.alert(
						'Warning',
						`${notFound.length} email(s) not found: ${notFound.join(', ')}. Continue with ${foundUserIds.length} participant(s)?`,
						[
							{ text: 'Cancel', style: 'cancel' },
							{ text: 'Continue', onPress: () => proceedWithCreation([...userIds, ...foundUserIds]) }
						]
					);
					return;
				}

				userIds = [...userIds, ...foundUserIds];
			}

			await proceedWithCreation(userIds);
		} catch (error) {
			console.error('❌ Failed to create conversation:', error);
			Alert.alert('Error', 'Failed to create conversation: ' + (error instanceof Error ? error.message : 'Unknown'));
		}
	}

	async function proceedWithCreation(userIds: string[]) {
		const conversationType: 'direct' | 'group' = userIds.length >= 3 ? 'group' : 'direct';
		const trimmedName = conversationName.trim();

		const conversation = await createConversationAsync({
			type: conversationType,
			participantIds: userIds,
			name: trimmedName || undefined,
		});
		setShowUserIdModal(false);
		setConversationName('');
		setParticipantIds('');
		router.push(`/chat/${conversation.id}`);
	}

	const styles = getStyles(colors);

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
					<View style={styles.headerTop}>
						<Text style={styles.welcomeText}>
							Welcome, {user?.firstName || user?.emailAddresses[0]?.emailAddress.split('@')[0]}
						</Text>
					<View style={styles.headerButtons}>
						<TouchableOpacity onPress={() => router.push('/profile')} style={styles.profileButton}>
							<Text style={styles.profileButtonText}>Profile</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>

		<FlatList<ConversationPreview>
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
						onLongPress={() => handleDeleteConversation(item.id, conversationName)}
					>
				{/* Avatar will use first letter as fallback */}
				<View style={[styles.avatar, { backgroundColor: getAvatarColor(conversationName) }]}>
					<Text style={styles.avatarText}>
						{getInitials(conversationName)}
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
					
					<Text style={styles.modalLabel}>Conversation Name (optional):</Text>
					<TextInput
						style={styles.modalInput}
						value={conversationName}
						onChangeText={setConversationName}
						placeholder="e.g., Project Team, Family..."
						placeholderTextColor="#999"
						autoCapitalize="words"
					/>

					<Text style={styles.modalLabel}>Add Participants:</Text>
					<Text style={styles.helpText}>
						Enter email addresses separated by commas. Leave empty for self-chat (notes), 1 email for direct chat, 2+ for group.
					</Text>
					<TextInput
						style={[styles.modalInput, styles.multilineInput]}
						value={participantIds}
						onChangeText={setParticipantIds}
						placeholder="alice@example.com, bob@example.com"
						placeholderTextColor="#999"
						keyboardType="email-address"
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

const getStyles = (colors: any) => StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: colors.background,
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
	headerTop: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginBottom: 8,
	},
	welcomeText: {
		fontSize: 16,
		fontWeight: '500',
		color: colors.text,
		flex: 1,
	},
	headerButtons: {
		flexDirection: 'row',
		gap: 8,
	},
	aiButton: {
		paddingHorizontal: 12,
		paddingVertical: 6,
		backgroundColor: '#f0f0f0',
		borderRadius: 6,
	},
	aiButtonText: {
		fontSize: 14,
		fontWeight: '600',
	},
	profileButton: {
		paddingHorizontal: 12,
		paddingVertical: 6,
		backgroundColor: '#f0f0f0',
		borderRadius: 6,
	},
	profileButtonText: {
		color: '#007AFF',
		fontSize: 14,
		fontWeight: '600',
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
		color: colors.text,
	},
	timestamp: {
		fontSize: 12,
		color: colors.textSecondary,
	},
	messageRow: {
		flexDirection: 'row',
		justifyContent: 'space-between',
		alignItems: 'center',
	},
	lastMessage: {
		fontSize: 14,
		color: colors.textSecondary,
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
		color: colors.text,
		marginBottom: 8,
	},
	emptySubtext: {
		fontSize: 14,
		color: colors.textSecondary,
	},
	newChatButton: {
		marginRight: 12,
		paddingHorizontal: Platform.OS === 'ios' ? 8 : 12,
		paddingVertical: Platform.OS === 'ios' ? 0 : 6,
		backgroundColor: Platform.OS === 'ios' ? 'transparent' : '#007AFF',
		borderRadius: Platform.OS === 'ios' ? 0 : 6,
		minWidth: Platform.OS === 'ios' ? 0 : 60,
		alignItems: 'center',
		justifyContent: 'center',
	},
	newChatButtonText: {
		color: Platform.OS === 'ios' ? '#007AFF' : '#fff',
		fontSize: Platform.OS === 'ios' ? 17 : 14,
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
		backgroundColor: colors.surface,
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
		color: colors.text,
	},
	modalLabel: {
		fontSize: 14,
		fontWeight: '600',
		marginBottom: 8,
		marginTop: 12,
		color: colors.text,
	},
	quickActions: {
		marginBottom: 16,
	},
	quickActionButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		padding: 16,
		borderRadius: 8,
		gap: 8,
	},
	quickActionEmoji: {
		fontSize: 24,
	},
	quickActionText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
	divider: {
		flexDirection: 'row',
		alignItems: 'center',
		marginVertical: 20,
	},
	dividerLine: {
		flex: 1,
		height: 1,
		backgroundColor: '#e4e6eb',
	},
	dividerText: {
		fontSize: 12,
		color: colors.textSecondary,
		marginHorizontal: 12,
	},
	userIdContainer: {
		backgroundColor: '#f0f2f5',
		padding: 12,
		borderRadius: 8,
		marginBottom: 8,
	},
	userIdText: {
		fontSize: 12,
		color: '#007AFF',
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
		marginBottom: 4,
	},
	userIdCopyHint: {
		fontSize: 10,
		color: '#65676b',
		fontStyle: 'italic',
	},
	modalInput: {
		borderWidth: 1,
		borderColor: colors.border,
		borderRadius: 8,
		padding: 12,
		fontSize: 14,
		marginBottom: 20,
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
		color: colors.text,
		backgroundColor: colors.inputBackground,
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

