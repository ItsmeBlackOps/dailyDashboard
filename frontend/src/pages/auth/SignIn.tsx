import { useState, useMemo } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";
import { SOCKET_URL } from "../../hooks/useAuth";
import { deriveDisplayNameFromEmail } from "@/utils/userNames";
export default function SignIn() {
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/tasks";
  const socket: Socket = useMemo(
    () => io(SOCKET_URL, { autoConnect: false, transports: ["websocket"] }),
    []
  );
  useEffect(() => {
    if (localStorage.getItem("accessToken")) {
      navigate("/tasks", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    socket.connect();
    socket.emit(
      "login",
      { email: formData.email, password: formData.password },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
        setLoading(false);
        if (!response.success) {
          setError(response.error || "Login failed");
          socket.disconnect();
          return;
        }

        const normalizedEmail = formData.email.trim().toLowerCase();

        // Persist credentials
        localStorage.setItem("accessToken", response.accessToken);
        localStorage.setItem("refreshToken", response.refreshToken);
        localStorage.setItem("role", response.role);
        localStorage.setItem("teamLead", response.teamLead);
        localStorage.setItem("manager", response.manager);
        localStorage.setItem("email", normalizedEmail);
        localStorage.setItem("displayName", deriveDisplayNameFromEmail(normalizedEmail));
        localStorage.setItem("supportAnnouncementPending", 'true');

        // Reconnect socket with token for future events
        socket.disconnect();
        socket.auth = { token: response.accessToken };
        socket.connect();

        // Full-page navigation (no Router needed)
        navigate(from, { replace: true });
      }
    );
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center">
            <div className="flex justify-center items-center text-white font-bold">
              <img
                src="https://egvjgtfjstxgszpzvvbx.supabase.co/storage/v1/object/public/images//20250610_1111_3D%20Gradient%20Logo_remix_01jxd69dc9ex29jbj9r701yjkf%20(2).png"
                alt="SilverspaceCRM"
                style={{ width: "25%", height: "25%" }}
              />
            </div>
          </div>

          <CardTitle className="text-2xl text-center">Welcome back</CardTitle>
          <CardDescription className="text-center">
            Enter your credentials to access your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="pl-10 pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Link
                to="/auth/forgot-password"
                className="text-sm text-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
