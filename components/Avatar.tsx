import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';

interface AvatarProps {
	name?: string;
	size?: number;
	style?: ViewStyle;
}

export const Avatar = React.memo(function Avatar({ name, size = 40, style }: AvatarProps) {
	// Get initials from name
	const getInitials = (name?: string): string => {
		if (!name) return '?';
		
		const parts = name.trim().split(' ');
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		}
		return name.substring(0, 2).toUpperCase();
	};

	// Generate consistent color from name
	const getColor = (name?: string): string => {
		if (!name) return '#999';
		
		const colors = [
			'#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
			'#98D8C8', '#6C5CE7', '#A29BFE', '#FD79A8',
			'#FDCB6E', '#E17055', '#00B894', '#00CEC9',
		];
		
		const hash = name.split('').reduce((acc, char) => {
			return char.charCodeAt(0) + ((acc << 5) - acc);
		}, 0);
		
		return colors[Math.abs(hash) % colors.length];
	};

	const initials = getInitials(name);
	const backgroundColor = getColor(name);

	return (
		<View style={[
			styles.container,
			{ width: size, height: size, borderRadius: size / 2, backgroundColor },
			style
		]}>
			<Text style={[styles.initials, { fontSize: size * 0.4 }]}>
				{initials}
			</Text>
		</View>
	);
});

const styles = StyleSheet.create({
	container: {
		justifyContent: 'center',
		alignItems: 'center',
	},
	initials: {
		color: '#fff',
		fontWeight: '600',
	},
});

