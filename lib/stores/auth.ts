/**
 * Auth Store
 * 
 * Global auth state using Zustand.
 * Syncs with Clerk for authentication status.
 */

import { create } from 'zustand';

interface AuthState {
	userId: string | null;
	isAuthenticated: boolean;
	
	// Actions
	setUser: (userId: string) => void;
	clearUser: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
	userId: null,
	isAuthenticated: false,

	setUser: (userId) => set({ userId, isAuthenticated: true }),
	clearUser: () => set({ userId: null, isAuthenticated: false }),
}));

