import { Alert } from 'react-native';
import { useCardActions as useBaseCardActions } from '@teak/shared';

export function useCardActions() {
  return useBaseCardActions({
    onDeleteSuccess: (message) => {
      Alert.alert('Success', message || 'Card deleted successfully');
    },
    onRestoreSuccess: (message) => {
      Alert.alert('Success', message || 'Card restored successfully');
    },
    onPermanentDeleteSuccess: (message) => {
      Alert.alert('Success', message || 'Card permanently deleted');
    },
    onError: (error, operation) => {
      Alert.alert('Error', `Failed to ${operation}. Please try again.`);
    },
  });
}