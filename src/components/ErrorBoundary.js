import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';

// App-wide error boundary. Catches render-phase crashes anywhere in the tree
// and shows the actual error (message + component stack) instead of a white
// screen or a hard crash. "Try again" clears the error state and re-renders,
// which recovers from transient failures (e.g. a screen that briefly read
// stale state during an auth transition).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep the raw error in the console for `expo start` / dev-client sessions.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  handleReset = () => this.setState({ error: null, info: null });

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.msg}>{String(error?.message || error)}</Text>
          {!!info?.componentStack && (
            <Text style={styles.stack}>{info.componentStack.trim()}</Text>
          )}
        </ScrollView>
        <TouchableOpacity style={styles.btn} onPress={this.handleReset} activeOpacity={0.85}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0D0D12', paddingTop: 64, paddingBottom: 40, paddingHorizontal: 22 },
  content: { paddingBottom: 24 },
  title: { color: '#FFFFFF', fontSize: 20, fontWeight: '700', marginBottom: 14 },
  msg: { color: '#FF6B6B', fontSize: 14, marginBottom: 18, lineHeight: 20 },
  stack: { color: 'rgba(255,255,255,0.55)', fontSize: 11, lineHeight: 16 },
  btn: { backgroundColor: '#E8B530', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  btnText: { color: '#0D0D12', fontSize: 15, fontWeight: '700' },
});
