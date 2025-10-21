/**
 * Conversation List Screen
 * 
 * Displays all conversations for the current user
 */

import { useAuth, useUser } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';

export default function ConversationListScreen() {
	const { signOut } = useAuth();
	const { user } = useUser();
	const router = useRouter();

	// Placeholder conversations
	const conversations = [
		{
			id: '1',
			name: 'John Doe',
			lastMessage: 'Hey, how are you?',
			timestamp: '2m ago',
			unreadCount: 2,
		},
		{
			id: '2',
			name: 'Team Chat',
			lastMessage: 'Meeting at 3pm',
			timestamp: '1h ago',
			unreadCount: 0,
		},
	];

	async function handleSignOut() {
		await signOut();
		router.replace('/auth/sign-in');
	}

	return (
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
				renderItem={({ item }) => (
					<TouchableOpacity style={styles.conversationItem}>
						<View style={styles.avatar}>
							<Text style={styles.avatarText}>
								{item.name.charAt(0).toUpperCase()}
							</Text>
						</View>
						<View style={styles.conversationContent}>
							<View style={styles.conversationHeader}>
								<Text style={styles.conversationName}>{item.name}</Text>
								<Text style={styles.timestamp}>{item.timestamp}</Text>
							</View>
							<View style={styles.messageRow}>
								<Text style={styles.lastMessage} numberOfLines={1}>
									{item.lastMessage}
								</Text>
								{item.unreadCount > 0 && (
									<View style={styles.unreadBadge}>
										<Text style={styles.unreadText}>{item.unreadCount}</Text>
									</View>
								)}
							</View>
						</View>
					</TouchableOpacity>
				)}
				ListEmptyComponent={
					<View style={styles.emptyState}>
						<Text style={styles.emptyText}>No conversations yet</Text>
						<Text style={styles.emptySubtext}>
							Start a new conversation to get started
						</Text>
					</View>
				}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#fff',
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
});

