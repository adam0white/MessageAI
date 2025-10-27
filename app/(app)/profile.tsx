import React, { useState } from 'react';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useRouter, Stack } from 'expo-router';
import {
	View,
	Text,
	TextInput,
	TouchableOpacity,
	StyleSheet,
	Alert,
	KeyboardAvoidingView,
	Platform,
	ActivityIndicator,
	ScrollView,
} from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { config } from '../../lib/config';
import { useTheme, type ThemeMode } from '../../lib/contexts/ThemeContext';
import { clearAllData, dropAllTables, initializeDatabase, forceMigration } from '../../lib/db/schema';

const WORKER_URL = config.workerUrl;

export default function ProfileScreen() {
	const { signOut: clerkSignOut } = useAuth();
	const { user } = useUser();
	const router = useRouter();
	const db = useSQLiteContext();
	const { mode, activeTheme, colors, setTheme } = useTheme();
	
	const [firstName, setFirstName] = useState(user?.firstName || '');
	const [lastName, setLastName] = useState(user?.lastName || '');
	const [isUpdating, setIsUpdating] = useState(false);
	const [showDebugPanel, setShowDebugPanel] = useState(false);
	const [headerTapCount, setHeaderTapCount] = useState(0);
	const headerTapTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

	const handleHeaderTap = () => {
		setHeaderTapCount(prev => prev + 1);
		
		if (headerTapTimeoutRef.current) {
			clearTimeout(headerTapTimeoutRef.current);
		}
		
		headerTapTimeoutRef.current = setTimeout(() => {
			if (headerTapCount + 1 >= 3) {
				setShowDebugPanel(prev => !prev);
			}
			setHeaderTapCount(0);
		}, 500);
	};

	async function handleClearDatabase() {
		Alert.alert(
			'Clear Database',
			'This will delete all local messages and conversations. You will need to restart the app. Continue?',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Clear & Restart',
					style: 'destructive',
					onPress: async () => {
						try {
							await dropAllTables(db);
							await initializeDatabase();
							Alert.alert('Success', 'Database cleared. Please restart the app.', [
								{ text: 'OK', onPress: () => {
									// Force close would be ideal but not available
									// User needs to manually close and reopen
								}}
							]);
						} catch (error) {
							console.error('Clear database error:', error);
							Alert.alert('Error', 'Failed to clear database');
						}
					},
				},
			]
		);
	}

	async function handleFixDatabase() {
		Alert.alert(
			'Fix Database Schema',
			'This will update your database schema to the latest version. Safe to run.',
			[
				{ text: 'Cancel', style: 'cancel' },
				{
					text: 'Fix Now',
					onPress: async () => {
						try {
							await forceMigration(db);
							Alert.alert('Success', 'Database schema updated! Try sending a message now.');
						} catch (error) {
							console.error('Fix database error:', error);
							Alert.alert('Error', 'Failed to fix database. Try "Clear Database" instead.');
						}
					},
				},
			]
		);
	}

	async function handleUpdateProfile() {
		if (!user) return;

		setIsUpdating(true);

		try {
			// Update Clerk profile
			await user.update({
				firstName: firstName.trim() || null,
				lastName: lastName.trim() || null,
			});

			// Immediately sync to backend (no webhook dependency)
			try {
				await fetch(`${WORKER_URL}/api/users/sync`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						clerkId: user.id,
						email: user.emailAddresses[0]?.emailAddress || '',
						firstName: firstName.trim() || undefined,
						lastName: lastName.trim() || undefined,
						imageUrl: user.imageUrl,
					}),
				});
			} catch {
				// Silently fail - profile already updated in Clerk
			}

			Alert.alert('Success', 'Profile updated successfully');
		} catch (err: any) {
			console.error('Profile update error:', err);
			Alert.alert('Error', err.errors?.[0]?.message || 'Failed to update profile');
		} finally {
			setIsUpdating(false);
		}
	}

	const hasChanges =
		firstName !== (user?.firstName || '') ||
		lastName !== (user?.lastName || '');

	return (
		<>
			<Stack.Screen
				options={{
					title: 'Profile',
					headerBackTitle: 'Back',
					headerTitle: () => (
						<TouchableOpacity onPress={handleHeaderTap} activeOpacity={0.7}>
							<Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>Profile</Text>
						</TouchableOpacity>
					),
				}}
			/>
			
			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				style={[styles.container, { backgroundColor: colors.background }]}
			>
				<ScrollView contentContainerStyle={styles.scrollContent}>
					<View style={styles.content}>
						<View style={styles.section}>
							<Text style={[styles.sectionTitle, { color: colors.text }]}>Account Information</Text>
							
							<View style={styles.infoRow}>
								<Text style={[styles.label, { color: colors.textSecondary }]}>Display Name</Text>
								<Text style={[styles.valueHighlight, { color: colors.primary }]}>
									{user?.fullName || user?.firstName || user?.emailAddresses[0]?.emailAddress.split('@')[0] || 'Not set'}
								</Text>
								<Text style={[styles.helpTextSmall, { color: colors.textSecondary }]}>
									This is how you appear to other users
								</Text>
							</View>
							
							<View style={styles.infoRow}>
								<Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
								<Text style={[styles.value, { color: colors.text }]}>
									{user?.emailAddresses[0]?.emailAddress || 'N/A'}
								</Text>
							</View>

							<View style={styles.infoRow}>
								<Text style={[styles.label, { color: colors.textSecondary }]}>User ID</Text>
								<Text style={[styles.valueSmall, { color: colors.text }]} selectable>
									{user?.id || 'N/A'}
								</Text>
							</View>
						</View>

						<View style={styles.section}>
							<Text style={[styles.sectionTitle, { color: colors.text }]}>Personal Information</Text>

							<Text style={[styles.inputLabel, { color: colors.text }]}>First Name</Text>
							<TextInput
								style={styles.input}
								placeholder="First name (optional)"
								value={firstName}
								onChangeText={setFirstName}
								autoCapitalize="words"
								editable={!isUpdating}
							/>

							<Text style={[styles.inputLabel, { color: colors.text }]}>Last Name</Text>
							<TextInput
								style={styles.input}
								placeholder="Last name (optional)"
								value={lastName}
								onChangeText={setLastName}
								autoCapitalize="words"
								editable={!isUpdating}
							/>

							<TouchableOpacity
								style={[
									styles.button,
									(!hasChanges || isUpdating) && styles.buttonDisabled,
								]}
								onPress={handleUpdateProfile}
								disabled={!hasChanges || isUpdating}
							>
								{isUpdating ? (
									<ActivityIndicator size="small" color="#fff" />
								) : (
									<Text style={styles.buttonText}>Update Profile</Text>
								)}
							</TouchableOpacity>
						</View>

					{showDebugPanel && (
						<View style={styles.section}>
							<Text style={[styles.sectionTitle, { color: colors.text }]}>Debug Tools</Text>
							
							<TouchableOpacity
								style={[styles.button, { backgroundColor: colors.primary }]}
								onPress={handleFixDatabase}
							>
								<Text style={styles.buttonText}>🔧 Fix Database Schema</Text>
							</TouchableOpacity>
							<Text style={[styles.helpText, { color: colors.textSecondary, marginTop: 8 }]}>
								Use this if you see errors about missing database columns
							</Text>

							<TouchableOpacity
								style={[styles.button, { backgroundColor: '#ff3b30', marginTop: 16 }]}
								onPress={handleClearDatabase}
							>
								<Text style={styles.buttonText}>🗑️ Clear Local Database</Text>
							</TouchableOpacity>
							<Text style={[styles.helpText, { color: colors.textSecondary, marginTop: 8, marginBottom: 16 }]}>
								Deletes all local data. Requires app restart.
							</Text>
						</View>
					)}

					<View style={styles.section}>
						<TouchableOpacity
							style={[styles.button, { backgroundColor: '#ff3b30' }]}
							onPress={async () => {
								Alert.alert(
									'Sign Out',
									'Are you sure you want to sign out?',
									[
										{ text: 'Cancel', style: 'cancel' },
										{
											text: 'Sign Out',
											style: 'destructive',
											onPress: async () => {
												try {
													await clearAllData(db);
												} catch (error) {
													console.error('Failed to clear database on logout:', error);
												}
												await clerkSignOut();
												router.replace('/auth/sign-in');
											},
										},
									]
								);
							}}
						>
							<Text style={styles.buttonText}>Sign Out</Text>
						</TouchableOpacity>
					</View>

					<View style={styles.section}>
						<Text style={styles.sectionTitle}>Appearance</Text>
							
							<View style={styles.themeSelector}>
								{(['light', 'dark', 'auto'] as ThemeMode[]).map((themeMode) => (
									<TouchableOpacity
										key={themeMode}
										style={[
											styles.themeButton,
											mode === themeMode && styles.themeButtonActive
										]}
										onPress={() => setTheme(themeMode)}
									>
										<Text style={[
											styles.themeButtonText,
											mode === themeMode && styles.themeButtonTextActive
										]}>
											{themeMode === 'light' && '☀️ Light'}
											{themeMode === 'dark' && '🌙 Dark'}
											{themeMode === 'auto' && '⚙️ Auto'}
										</Text>
									</TouchableOpacity>
								))}
							</View>
						</View>

						<View style={styles.section}>
							<Text style={styles.helpText}>
								Your name will be visible to other users in conversations.
							</Text>
						</View>
					</View>
				</ScrollView>
			</KeyboardAvoidingView>
		</>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#fff',
	},
	scrollContent: {
		flexGrow: 1,
	},
	content: {
		padding: 20,
	},
	section: {
		marginBottom: 32,
	},
	sectionTitle: {
		fontSize: 18,
		fontWeight: '600',
		marginBottom: 16,
		color: '#000',
	},
	infoRow: {
		marginBottom: 16,
	},
	label: {
		fontSize: 14,
		fontWeight: '500',
		color: '#666',
		marginBottom: 4,
	},
	value: {
		fontSize: 16,
		color: '#000',
	},
	valueHighlight: {
		fontSize: 18,
		color: '#007AFF',
		fontWeight: '600',
		marginBottom: 4,
	},
	valueSmall: {
		fontSize: 12,
		color: '#000',
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
	},
	helpTextSmall: {
		fontSize: 12,
		color: '#999',
		marginTop: 4,
	},
	inputLabel: {
		fontSize: 14,
		fontWeight: '500',
		color: '#333',
		marginBottom: 8,
		marginTop: 4,
	},
	input: {
		height: 50,
		borderWidth: 1,
		borderColor: '#ddd',
		borderRadius: 8,
		paddingHorizontal: 16,
		marginBottom: 16,
		fontSize: 16,
		color: '#000',
		backgroundColor: '#fff',
	},
	button: {
		height: 50,
		backgroundColor: '#007AFF',
		borderRadius: 8,
		alignItems: 'center',
		justifyContent: 'center',
		marginTop: 8,
	},
	buttonDisabled: {
		opacity: 0.6,
	},
	buttonText: {
		color: '#fff',
		fontSize: 16,
		fontWeight: '600',
	},
	helpText: {
		fontSize: 14,
		color: '#666',
		lineHeight: 20,
		textAlign: 'center',
	},
	themeSelector: {
		flexDirection: 'row',
		backgroundColor: '#f0f2f5',
		borderRadius: 8,
		padding: 4,
		gap: 4,
	},
	themeButton: {
		flex: 1,
		paddingVertical: 10,
		borderRadius: 6,
		alignItems: 'center',
	},
	themeButtonActive: {
		backgroundColor: '#007AFF',
	},
	themeButtonText: {
		fontSize: 14,
		fontWeight: '500',
		color: '#666',
	},
	themeButtonTextActive: {
		color: '#fff',
		fontWeight: '600',
	},
});
