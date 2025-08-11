// src/hooks/useTabs.ts
import { useState, useEffect } from 'react';

export function useTab() {
  const STORAGE_KEY = 'tab';

  // 1️⃣ Initialize state from localStorage (fallback to 'first')
  const [selectedTab, setSelectedTab] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? 'Date of Interview';
    } catch {
      return 'Date of Interview';
    }
  });

  // 2️⃣ Persist every time it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, selectedTab);
    } catch {
      // maybe storage is full / privacy mode
    }
  }, [selectedTab]);

  return { selectedTab, setSelectedTab };
}
