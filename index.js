import { registerRootComponent } from 'expo';
import React from 'react';

import App from './App';
import ErrorBoundary from './src/components/ErrorBoundary';

// Wrap the app in a top-level error boundary so render-phase crashes surface
// their real message on screen (and stay recoverable) instead of white-
// screening or hard-crashing the process.
function Root() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(Root);
