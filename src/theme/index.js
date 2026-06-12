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
  ttDemiBold: 'TTTravelsNextTrl-DmBd',
  ttBold: 'TTTravelsNextTrl-Bd',
  ttExtraBold: 'TTTravelsNextTrl-XBd',
  // TT Travels Next body weights — the onboarding / auth flow is set entirely
  // in TT Travels (design spec), including light body copy. These map to the
  // real TT Travels TTFs (registered in app.json), NOT Bricolage. Kept as
  // separate aliases so the app-wide ttRegular/ttMedium (Bricolage) stay put.
  travelsLight: 'TTTravelsNextTrl-Lt',
  travelsRegular: 'TTTravelsNextTrl-Rg',
  travelsMedium: 'TTTravelsNextTrl-Md',
  // Legacy aliases — body weights → Bricolage; title weights → TT Travels
  monument: 'TTTravelsNextTrl-XBd',     // logo only — keep heaviest
  jakartaLight: 'BricolageGrotesque-Light',
  jakartaRegular: 'BricolageGrotesque-Regular', // body
  jakartaMedium: 'BricolageGrotesque-Medium',
  jakartaSemiBold: 'TTTravelsNextTrl-DmBd',
  jakartaBold: 'TTTravelsNextTrl-DmBd',   // titles use DemiBold per design
  jakartaExtraBold: 'TTTravelsNextTrl-DmBd',
  montserratMedium: 'BricolageGrotesque-Medium',
  montserratSemiBold: 'TTTravelsNextTrl-DmBd',
};

// Legacy Typography shim — used by FocusScreen, LogScreen, LogModal
export const Typography = {
  largeHeading: { fontFamily: 'TTTravelsNextTrl-DmBd', fontSize: 24, color: '#0D0D12' },
  sectionTitle: { fontFamily: 'TTTravelsNextTrl-DmBd', fontSize: 18, color: 'rgba(0,0,0,0.75)' },
  body: { fontFamily: 'BricolageGrotesque-Regular', fontSize: 14, color: '#0D0D12' },
  secondary: { fontFamily: 'BricolageGrotesque-Regular', fontSize: 12, color: '#818898' },
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
