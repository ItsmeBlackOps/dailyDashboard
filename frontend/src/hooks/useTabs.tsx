import { createContext, useContext, useState } from 'react';

export type Tab = 'first' | 'second';

interface TabContextValue {
  selectedTab: Tab;
  setSelectedTab: (tab: Tab) => void;
}

const TabContext = createContext<TabContextValue | undefined>(undefined);

export function TabProvider({ children }: { children: React.ReactNode }) {
  const [selectedTab, setSelectedTab] = useState<Tab>('first');
  return (
    <TabContext.Provider value={{ selectedTab, setSelectedTab }}>
      {children}
    </TabContext.Provider>
  );
}

export function useTab() {
  const ctx = useContext(TabContext);
  if (!ctx) {
    throw new Error('useTab must be used within a TabProvider');
  }
  return ctx;
}
