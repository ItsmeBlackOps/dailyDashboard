
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <Button 
      variant="ghost" 
      size="icon" 
      onClick={toggleTheme}
      aria-label="Toggle theme"
      className="rounded-full w-8 h-8"
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4 text-yellow-200" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
