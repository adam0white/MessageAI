/**
 * Root Index
 * 
 * Redirects to auth or app based on authentication state
 */

import { useAuth } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';

export default function Index() {
	const { isSignedIn, isLoaded } = useAuth();

	if (!isLoaded) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
				<ActivityIndicator size="large" color="#007AFF" />
			</View>
		);
	}

	if (isSignedIn) {
		return <Redirect href="/(app)" />;
	}

	return <Redirect href="/auth/sign-in" />;
}

