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

// Font family names — split between TT Travels Next (titles / display) and
// Bricolage Grotesque (body / paragraph). The legacy alias map is kept so
// the ~225 existing references compile unchanged; only the underlying value
// changes when an alias is meant for body copy vs a title.
export const Fonts = {
  // Canonical aliases (use these for new code)
  ttLight: 'BricolageGrotesque-Light',
  ttRegular: 'BricolageGrotesque-Regular',
  ttMedium: 'BricolageGrotesque-Medium',
  ttDemiBold: 'TTTravelsNext-DemiBold',
  ttBold: 'TTTravelsNext-Bold',
  ttExtraBold: 'TTTravelsNext-ExtraBold',
  // Legacy aliases — body weights → Bricolage; title weights → TT Travels
  monument: 'TTTravelsNext-ExtraBold',     // logo only — keep heaviest
  jakartaLight: 'BricolageGrotesque-Light',
  jakartaRegular: 'BricolageGrotesque-Regular', // body
  jakartaMedium: 'BricolageGrotesque-Medium',
  jakartaSemiBold: 'TTTravelsNext-DemiBold',
  jakartaBold: 'TTTravelsNext-DemiBold',   // titles use DemiBold per design
  jakartaExtraBold: 'TTTravelsNext-DemiBold',
  montserratMedium: 'BricolageGrotesque-Medium',
  montserratSemiBold: 'TTTravelsNext-DemiBold',
};

// Legacy Typography shim — used by FocusScreen, LogScreen, LogModal
export const Typography = {
  largeHeading: { fontFamily: 'TTTravelsNext-DemiBold', fontSize: 24, color: '#0D0D12' },
  sectionTitle: { fontFamily: 'TTTravelsNext-DemiBold', fontSize: 18, color: 'rgba(0,0,0,0.75)' },
  body: { fontFamily: 'BricolageGrotesque-Regular', fontSize: 14, color: '#0D0D12' },
  secondary: { fontFamily: 'BricolageGrotesque-Regular', fontSize: 12, color: '#818898' },
};

export const Spacing = {
  side: 20,
  card: 16,
};
