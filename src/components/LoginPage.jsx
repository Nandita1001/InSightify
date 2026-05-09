import { useState } from "react";
import { Link } from "react-router-dom";
import { Database, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { useApp } from "../context/AppContext";

export default function LoginPage() {
  const { login } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setError("");
    setIsSubmitting(true);
    const result = await login(email.trim().toLowerCase(), password);
    if (!result.success) {
      setError(result.message);
      setIsSubmitting(false);
    }
    // On success, onAuthStateChange in AppContext handles navigation automatically
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "#f8f9fb", fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: "linear-gradient(135deg, #4f46e5, #7c3aed)" }}
          >
            <Database size={26} color="#fff" />
          </div>
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "#1a1a2e" }}
          >
            InSightify
          </h1>
          <p className="text-sm mt-1" style={{ color: "#9ca3af" }}>Talk to Your Data</p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-8"
          style={{ background: "#fff", borderColor: "#e8eaed", boxShadow: "0 4px 24px rgba(79,70,229,0.07)" }}
        >
          <h2 className="text-xl font-bold mb-1" style={{ color: "#1a1a2e", textAlign: "center" }}>Welcome back</h2>
          <p className="text-sm mb-6" style={{ color: "#9ca3af", textAlign: "center" }}>Sign in to your account to continue</p>

          {error && (
            <div
              className="mb-5 px-4 py-3 rounded-xl text-sm font-medium"
              style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: "#1a1a2e" }}>
                Email address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#9ca3af" }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (error) setError(""); }}
                  placeholder="you@company.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border text-sm outline-none transition-colors"
                  style={{ borderColor: "#e8eaed", background: "#fff", color: "#1a1a2e" }}
                  onFocus={e => (e.target.style.borderColor = "#4f46e5")}
                  onBlur={e => (e.target.style.borderColor = "#e8eaed")}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: "#1a1a2e" }}>
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#9ca3af" }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (error) setError(""); }}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-3 rounded-xl border text-sm outline-none transition-colors"
                  style={{ borderColor: "#e8eaed", background: "#fff", color: "#1a1a2e" }}
                  onFocus={e => (e.target.style.borderColor = "#4f46e5")}
                  onBlur={e => (e.target.style.borderColor = "#e8eaed")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2"
                >
                  {showPassword
                    ? <EyeOff size={16} style={{ color: "#9ca3af" }} />
                    : <Eye size={16} style={{ color: "#9ca3af" }} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-opacity mt-2"
              style={{
                background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                opacity: isSubmitting ? 0.7 : 1,
                cursor: isSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Sign in <ArrowRight size={15} /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: "#9ca3af" }}>
            Don&apos;t have an account?{" "}
            <Link
              to="/signup"
              className="font-semibold hover:underline"
              style={{ color: "#4f46e5" }}
            >
              Create one
            </Link>
          </p>
        </div>
      </div>

      <style>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>
    </div>
  );
}
