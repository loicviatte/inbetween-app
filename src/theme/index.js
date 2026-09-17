// Color palette from Figma
export const Colors = {
  background: '#FFFFFF',
  orange: '#F2B940',
  green: '#4CAF50',
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

// The whole app is set in Syne, the typeface of useinbetween.com. Five weights,
// named after what they are — the values are the TTFs' PostScript names, so they
// resolve the same whether the font is embedded natively or registered at
// runtime. Syne has no Light cut: `regular` is the lightest there is.
export const Fonts = {
  regular: 'Syne-Regular',
  medium: 'Syne-Medium',
  semiBold: 'Syne-SemiBold',
  bold: 'Syne-Bold',
  extraBold: 'Syne-ExtraBold',
};

// Legacy Typography shim — used by LogScreen and LogModal
export const Typography = {
  largeHeading: { fontFamily: 'Syne-SemiBold', fontSize: 24, color: '#0D0D12' },
  sectionTitle: { fontFamily: 'Syne-SemiBold', fontSize: 18, color: 'rgba(0,0,0,0.75)' },
  body: { fontFamily: 'Syne-Regular', fontSize: 14, color: '#0D0D12' },
  secondary: { fontFamily: 'Syne-Regular', fontSize: 12, color: '#818898' },
};

export const Spacing = {
  side: 20,
  card: 16,
};

// Onboarding / auth palette — cream + gold design language used by the
// Welcome, Login and Register screens. Kept separate from Colors so the
// in-app palette stays untouched.
export const Onboard = {
  bg: '#FBFAF6',
  ink: '#0A0A0A',
  ink2: 'rgba(10,10,10,0.66)',
  ink3: 'rgba(10,10,10,0.40)',
  line: 'rgba(10,10,10,0.10)',
  faint: 'rgba(10,10,10,0.05)',
  card: '#FFFFFF',
  gold: '#E8B530',
  gold400: '#F0C24A',
  gold300: '#F6D27A',
  goldInk: '#A8801A',
  goldTint: 'rgba(232,181,48,0.15)',
  error: '#E84040',
  success: '#2E9E5B',
};
