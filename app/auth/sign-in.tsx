import React, { useState } from 'react';
import { useSignIn } from '@clerk/clerk-expo';
import { Link, useRouter } from 'expo-router';
import {
	View,
	Text,
	TextInput,
	TouchableOpacity,
	StyleSheet,
	Alert,
	KeyboardAvoidingView,
	Platform,
} from 'react-native';

export default function SignInScreen() {
	const { signIn, setActive, isLoaded } = useSignIn();
	const router = useRouter();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [isLoading, setIsLoading] = useState(false);

	async function handleSignIn() {
		if (!isLoaded) return;

		setIsLoading(true);

		try {
			const completeSignIn = await signIn.create({
				identifier: email,
				password,
			});

			await setActive({ session: completeSignIn.createdSessionId });
			router.replace('/(app)');
		} catch (err: any) {
			console.error('Sign in error:', err);
			Alert.alert('Error', err.errors?.[0]?.message || 'Failed to sign in');
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			style={styles.container}
		>
			<View style={styles.content}>
				<Text style={styles.title}>Welcome back</Text>
				<Text style={styles.subtitle}>Sign in to MessageAI</Text>

				<TextInput
					style={styles.input}
					placeholder="Email"
					value={email}
					onChangeText={setEmail}
					autoCapitalize="none"
					keyboardType="email-address"
					autoComplete="email"
					editable={!isLoading}
				/>

				<TextInput
					style={styles.input}
					placeholder="Password"
					value={password}
					onChangeText={setPassword}
					secureTextEntry
					autoComplete="password"
					editable={!isLoading}
				/>

				<TouchableOpacity
					style={[styles.button, isLoading && styles.buttonDisabled]}
					onPress={handleSignIn}
					disabled={isLoading}
				>
					<Text style={styles.buttonText}>
						{isLoading ? 'Signing in...' : 'Sign In'}
					</Text>
				</TouchableOpacity>

				<View style={styles.footer}>
					<Text style={styles.footerText}>Don't have an account? </Text>
					<Link href="/auth/sign-up" asChild>
						<TouchableOpacity>
							<Text style={styles.link}>Sign up</Text>
						</TouchableOpacity>
					</Link>
				</View>
			</View>
		</KeyboardAvoidingView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#fff',
	},
	content: {
		flex: 1,
		justifyContent: 'center',
		padding: 20,
	},
	title: {
		fontSize: 32,
		fontWeight: 'bold',
		marginBottom: 8,
		textAlign: 'center',
	},
	subtitle: {
		fontSize: 16,
		color: '#666',
		marginBottom: 32,
		textAlign: 'center',
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
	footer: {
		flexDirection: 'row',
		justifyContent: 'center',
		marginTop: 24,
	},
	footerText: {
		color: '#666',
		fontSize: 14,
	},
	link: {
		color: '#007AFF',
		fontSize: 14,
		fontWeight: '600',
	},
});

