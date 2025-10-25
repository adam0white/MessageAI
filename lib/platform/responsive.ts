/**
 * Responsive layout utilities for web
 * Helps adapt mobile-first React Native UI to desktop browsers
 */

import { Platform, Dimensions } from 'react-native';

/**
 * Get maximum content width for desktop
 */
export function getMaxContentWidth(): number {
	if (Platform.OS === 'web') {
		const { width } = Dimensions.get('window');
		// On desktop, limit width to 800px for better readability
		// On mobile web, use full width
		return width > 800 ? 800 : width;
	}
	return Dimensions.get('window').width;
}

/**
 * Get responsive padding
 */
export function getResponsivePadding(): number {
	if (Platform.OS === 'web') {
		const { width } = Dimensions.get('window');
		// More padding on desktop
		return width > 800 ? 20 : 10;
	}
	return 10;
}

/**
 * Check if current platform is web
 */
export function isWeb(): boolean {
	return Platform.OS === 'web';
}

/**
 * Check if screen is desktop-sized
 */
export function isDesktop(): boolean {
	if (Platform.OS !== 'web') return false;
	return Dimensions.get('window').width > 800;
}

/**
 * Get container style for centering content on desktop
 */
export function getContainerStyle() {
	if (!isDesktop()) {
		return { flex: 1 };
	}

	return {
		flex: 1,
		alignItems: 'center' as const,
		backgroundColor: '#f5f5f5',
	};
}

/**
 * Get content wrapper style for desktop
 */
export function getContentStyle() {
	if (!isDesktop()) {
		return { flex: 1 };
	}

	return {
		flex: 1,
		width: getMaxContentWidth(),
		maxWidth: 800,
		backgroundColor: '#ffffff',
		shadowColor: '#000',
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 8,
	};
}

