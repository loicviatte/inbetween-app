// Color palette from Figma
export const Colors = {
  background: '#FFFFFF',
  orange: '#FF9D00',
  green: 'rgba(85, 167, 26, 0.52)',
  coachCard: 'rgba(215, 150, 255, 0.06)',
  tabBarBg: '#F8F9FE',
  activeTabBg: '#FFFFFF',
  activeHome: '#C460FF',
  activeFocus: '#2196F3',
  activeLog: '#4CAF50',
  inactive: '#71727A',
  heading: 'rgba(0, 0, 0, 0.75)',
  secondary: '#818898',
  statCardBg: 'rgba(17, 12, 17, 0.04)',
  statCardBorder: 'rgba(17, 12, 17, 0.08)',
  profileIcon: '#FFDBA1',
  white: '#FFFFFF',
  black: '#0D0D12',
  focusCard: '#1A1A1A',
  timerBg: '#C8F0A0',
  card: '#F5F5F5',
};

// Font family names
// NOTE: Monument Extended (logo/headings) — place font file at:
//   assets/fonts/MonumentExtended-UltraBold.otf
// then add to useFonts in App.js:
//   'MonumentExtended-UltraBold': require('./assets/fonts/MonumentExtended-UltraBold.otf')
// Until then, Montserrat_800ExtraBold is used as a visual stand-in.
export const Fonts = {
  monument: 'Montserrat_800ExtraBold',        // swap to 'MonumentExtended-UltraBold' once file is added
  jakartaLight: 'PlusJakartaSans_300Light',
  jakartaRegular: 'PlusJakartaSans_400Regular',
  jakartaMedium: 'PlusJakartaSans_500Medium',
  jakartaSemiBold: 'PlusJakartaSans_600SemiBold',
  jakartaBold: 'PlusJakartaSans_700Bold',
  jakartaExtraBold: 'PlusJakartaSans_800ExtraBold',
  montserratMedium: 'Montserrat_500Medium',
  montserratSemiBold: 'Montserrat_600SemiBold',
};

// Legacy Typography shim — used by FocusScreen, LogScreen, LogModal
export const Typography = {
  largeHeading: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 24, color: '#0D0D12' },
  sectionTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 18, color: 'rgba(0,0,0,0.75)' },
  body: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 14, color: '#0D0D12' },
  secondary: { fontFamily: 'PlusJakartaSans_400Regular', fontSize: 12, color: '#818898' },
};

export const Spacing = {
  side: 36,
  card: 16,
};
