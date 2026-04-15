import { StyleSheet } from 'react-native';

// Styles shared between the login and register screens. Screen-specific
// styles (title, layout wrappers, navigation links) stay in their own
// files; only the byte-identical rules live here.
export const authStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  error: {
    color: '#ff4444',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 14,
  },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
});
