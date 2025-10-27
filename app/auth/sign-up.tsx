import React, { useState } from 'react';
import { useSignUp } from '@clerk/clerk-expo';
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

export default function SignUpScreen() {
	const { signUp, setActive, isLoaded } = useSignUp();
	const router = useRouter();

	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [firstName, setFirstName] = useState('');
	const [lastName, setLastName] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [pendingVerification, setPendingVerification] = useState(false);
	const [code, setCode] = useState('');

	async function handleSignUp() {
		if (!isLoaded) return;

		setIsLoading(true);

		try {
			const result = await signUp.create({
				emailAddress: email,
				password,
				firstName: firstName.trim() || undefined,
				lastName: lastName.trim() || undefined,
			});

			// Check if sign-up is complete (verification disabled in Clerk)
			if (result.status === 'complete') {
				await setActive({ session: result.createdSessionId });
				router.replace('/(app)');
				return;
			}

			// If verification is required, prepare it
			if (result.status === 'missing_requirements') {
				await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
				setPendingVerification(true);
			}
		} catch (err: any) {
			console.error('Sign up error:', err);
			Alert.alert('Error', err.errors?.[0]?.message || 'Failed to sign up');
		} finally {
			setIsLoading(false);
		}
	}

	async function handleVerify() {
		if (!isLoaded) return;

		setIsLoading(true);

		try {
			const completeSignUp = await signUp.attemptEmailAddressVerification({
				code,
			});

			await setActive({ session: completeSignUp.createdSessionId });
			router.replace('/(app)');
		} catch (err: any) {
			console.error('Verification error:', err);
			Alert.alert('Error', err.errors?.[0]?.message || 'Failed to verify code');
		} finally {
			setIsLoading(false);
		}
	}

	if (pendingVerification) {
		return (
			<KeyboardAvoidingView
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
				style={styles.container}
			>
				<View style={styles.content}>
					<Text style={styles.title}>Verify your email</Text>
					<Text style={styles.subtitle}>
						We sent a verification code to {email}
					</Text>

					<TextInput
						style={styles.input}
						placeholder="Verification code"
						value={code}
						onChangeText={setCode}
						keyboardType="number-pad"
						autoComplete="one-time-code"
						editable={!isLoading}
					/>

					<TouchableOpacity
						style={[styles.button, isLoading && styles.buttonDisabled]}
						onPress={handleVerify}
						disabled={isLoading}
					>
						<Text style={styles.buttonText}>
							{isLoading ? 'Verifying...' : 'Verify'}
						</Text>
					</TouchableOpacity>
				</View>
			</KeyboardAvoidingView>
		);
	}

	return (
		<KeyboardAvoidingView
			behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			style={styles.container}
		>
			<View style={styles.content}>
				<Text style={styles.title}>Create account</Text>
				<Text style={styles.subtitle}>Sign up for MessageAI</Text>

				<TextInput
					style={styles.input}
					placeholder="First Name (optional)"
					value={firstName}
					onChangeText={setFirstName}
					autoCapitalize="words"
					autoComplete="name-given"
					editable={!isLoading}
				/>

				<TextInput
					style={styles.input}
					placeholder="Last Name (optional)"
					value={lastName}
					onChangeText={setLastName}
					autoCapitalize="words"
					autoComplete="name-family"
					editable={!isLoading}
				/>

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
					autoComplete="password-new"
					editable={!isLoading}
				/>

				<TouchableOpacity
					style={[styles.button, isLoading && styles.buttonDisabled]}
					onPress={handleSignUp}
					disabled={isLoading}
				>
					<Text style={styles.buttonText}>
						{isLoading ? 'Creating account...' : 'Sign Up'}
					</Text>
				</TouchableOpacity>

				<View style={styles.footer}>
					<Text style={styles.footerText}>Already have an account? </Text>
					<Link href="/auth/sign-in" asChild>
						<TouchableOpacity>
							<Text style={styles.link}>Sign in</Text>
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

