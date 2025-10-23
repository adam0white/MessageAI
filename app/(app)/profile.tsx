import React, { useState } from 'react';
import { useUser } from '@clerk/clerk-expo';
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

export default function ProfileScreen() {
	const { user } = useUser();
	const router = useRouter();
	
	const [firstName, setFirstName] = useState(user?.firstName || '');
	const [lastName, setLastName] = useState(user?.lastName || '');
	const [isUpdating, setIsUpdating] = useState(false);

	async function handleUpdateProfile() {
		if (!user) return;

		setIsUpdating(true);

		try {
			await user.update({
				firstName: firstName.trim() || null,
				lastName: lastName.trim() || null,
			});

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
				}}
			/>
			
			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				style={styles.container}
			>
				<ScrollView contentContainerStyle={styles.scrollContent}>
					<View style={styles.content}>
						<View style={styles.section}>
							<Text style={styles.sectionTitle}>Account Information</Text>
							
							<View style={styles.infoRow}>
								<Text style={styles.label}>Email</Text>
								<Text style={styles.value}>
									{user?.emailAddresses[0]?.emailAddress || 'N/A'}
								</Text>
							</View>

							<View style={styles.infoRow}>
								<Text style={styles.label}>User ID</Text>
								<Text style={styles.valueSmall} selectable>
									{user?.id || 'N/A'}
								</Text>
							</View>
						</View>

						<View style={styles.section}>
							<Text style={styles.sectionTitle}>Personal Information</Text>

							<Text style={styles.inputLabel}>First Name</Text>
							<TextInput
								style={styles.input}
								placeholder="First name (optional)"
								value={firstName}
								onChangeText={setFirstName}
								autoCapitalize="words"
								editable={!isUpdating}
							/>

							<Text style={styles.inputLabel}>Last Name</Text>
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
	valueSmall: {
		fontSize: 12,
		color: '#000',
		fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
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
});
