import React, { createContext, useContext, useState } from 'react';

const ProfileContext = createContext({
  avatarUri: null, setAvatarUri: () => {},
  initials: '',    setInitials:  () => {},
});

export function ProfileProvider({ children }) {
  const [avatarUri, setAvatarUri] = useState(null);
  const [initials,  setInitials]  = useState('');
  return (
    <ProfileContext.Provider value={{ avatarUri, setAvatarUri, initials, setInitials }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
