import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { storage } from '../platform/storage';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ActiveTheme = 'light' | 'dark';

interface ThemeColors {
	background: string;
	surface: string;
	primary: string;
	text: string;
	textSecondary: string;
	border: string;
	messageBubbleOwn: string;
	messageBubbleOther: string;
	messageTextOwn: string;
	messageTextOther: string;
	inputBackground: string;
	inputBorder: string;
	error: string;
	success: string;
	warning: string;
}

const lightColors: ThemeColors = {
	background: '#fff',
	surface: '#f8f9fa',
	primary: '#007AFF',
	text: '#000',
	textSecondary: '#666',
	border: '#eee',
	messageBubbleOwn: '#007AFF',
	messageBubbleOther: '#e4e6eb',
	messageTextOwn: '#fff',
	messageTextOther: '#000',
	inputBackground: '#fff',
	inputBorder: '#ddd',
	error: '#ff3b30',
	success: '#44b700',
	warning: '#f59e0b',
};

const darkColors: ThemeColors = {
	background: '#000',
	surface: '#1c1c1e',
	primary: '#0A84FF',
	text: '#fff',
	textSecondary: '#999',
	border: '#2c2c2e',
	messageBubbleOwn: '#0A84FF',
	messageBubbleOther: '#2c2c2e',
	messageTextOwn: '#fff',
	messageTextOther: '#fff',
	inputBackground: '#1c1c1e',
	inputBorder: '#3a3a3c',
	error: '#ff453a',
	success: '#32d74b',
	warning: '#ffd60a',
};

interface ThemeContextValue {
	mode: ThemeMode;
	activeTheme: ActiveTheme;
	colors: ThemeColors;
	setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const systemColorScheme = useColorScheme();
	const [mode, setMode] = useState<ThemeMode>('auto');

	useEffect(() => {
		storage.getItem('theme').then(stored => {
			if (stored === 'light' || stored === 'dark' || stored === 'auto') {
				setMode(stored);
			}
		});
	}, []);

	const activeTheme: ActiveTheme = mode === 'auto' 
		? (systemColorScheme === 'dark' ? 'dark' : 'light')
		: mode;

	const colors = activeTheme === 'dark' ? darkColors : lightColors;

	const setTheme = async (newMode: ThemeMode) => {
		setMode(newMode);
		await storage.setItem('theme', newMode);
	};

	return (
		<ThemeContext.Provider value={{ mode, activeTheme, colors, setTheme }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error('useTheme must be used within ThemeProvider');
	}
	return context;
}

