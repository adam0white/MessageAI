/**
 * App Layout
 * 
 * Protected routes that require authentication
 */

import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Stack } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';

export default function AppLayout() {
	const { isSignedIn, isLoaded } = useAuth();

	if (!isLoaded) {
		return (
			<View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
				<ActivityIndicator size="large" color="#007AFF" />
			</View>
		);
	}

	if (!isSignedIn) {
		return <Redirect href="/auth/sign-in" />;
	}

	return (
		<Stack
			screenOptions={{
				headerStyle: {
					backgroundColor: '#007AFF',
				},
				headerTintColor: '#fff',
				headerTitleStyle: {
					fontWeight: 'bold',
				},
			}}
		>
			<Stack.Screen
				name="index"
				options={{
					title: 'Messages',
				}}
			/>
		</Stack>
	);
}

