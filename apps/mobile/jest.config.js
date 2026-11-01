module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.(ts|tsx)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|i18next|react-i18next)',
  ],
  collectCoverageFrom: ['src/domain/**/*.ts', 'src/api/**/*.ts', 'src/storage/**/*.ts', 'src/state/verifyFlow.ts'],
};
