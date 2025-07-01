import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { authClient } from '@/lib/auth-client';
import type { AuthFormData, AsyncState } from '@/db/types';

// Common auth form validation
const validateAuthForm = (data: AuthFormData, isRegistration = false): string | null => {
  if (!data.email || !data.password) return 'Email and password are required';
  if (data.password.length < 8) return 'Password must be at least 8 characters';
  if (isRegistration && data.password !== data.confirmPassword) return 'Passwords do not match';
  return null;
};

// Reusable auth operations hook
export const useAuthOperations = () => {
  const [state, setState] = useState<AsyncState>({ isLoading: false, error: '', success: false });
  const navigate = useNavigate();

  const resetState = () => setState({ isLoading: false, error: '', success: false });

  const handleAuth = async (
    operation: () => Promise<any>,
    successCallback?: () => void
  ) => {
    setState(prev => ({ ...prev, isLoading: true, error: '' }));

    try {
      const { error } = await operation();

      if (error) {
        setState(prev => ({ ...prev, error: error.message || 'Operation failed', isLoading: false }));
        return;
      }

      setState(prev => ({ ...prev, success: true, isLoading: false }));
      successCallback?.();
    } catch (err) {
      setState(prev => ({
        ...prev,
        error: 'An unexpected error occurred',
        isLoading: false
      }));
    }
  };

  // Login operation
  const login = async (formData: AuthFormData) => {
    const validationError = validateAuthForm(formData);
    if (validationError) {
      setState(prev => ({ ...prev, error: validationError }));
      return;
    }

    await handleAuth(
      () => authClient.signIn.email(formData),
      () => navigate({ to: '/' })
    );
  };

  // Registration operation
  const register = async (formData: AuthFormData) => {
    const validationError = validateAuthForm(formData, true);
    if (validationError) {
      setState(prev => ({ ...prev, error: validationError }));
      return;
    }

    await handleAuth(
      () => authClient.signUp.email({ ...formData, name: formData.name || '' }),
      () => navigate({ to: '/' })
    );
  };

  // Password reset request
  const requestPasswordReset = async (email: string) => {
    if (!email) {
      setState(prev => ({ ...prev, error: 'Email is required' }));
      return;
    }

    await handleAuth(() =>
      authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      })
    );
  };

  // Password reset
  const resetPassword = async (password: string, confirmPassword: string, token: string) => {
    const validationError = validateAuthForm({ email: '', password, confirmPassword });
    if (validationError) {
      setState(prev => ({ ...prev, error: validationError }));
      return;
    }

    if (!token) {
      setState(prev => ({ ...prev, error: 'Invalid reset token' }));
      return;
    }

    await handleAuth(
      () => authClient.resetPassword({ newPassword: password, token }),
      () => navigate({ to: '/login' })
    );
  };

  return {
    ...state,
    login,
    register,
    requestPasswordReset,
    resetPassword,
    resetState,
  };
};
