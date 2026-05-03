import { useState } from "react";
import { Database, Mail, Lock, Eye, EyeOff, User, Shield, Users, FileText, BarChart3, ArrowRight, Check, X } from "lucide-react";
import { useApp } from "../context/AppContext";

const PASSWORD_RULES = [
  { id: "len",   label: "At least 8 characters",          test: (p) => p.length >= 8 },
  { id: "lower", label: "One lowercase letter (a–z)",     test: (p) => /[a-z]/.test(p) },
  { id: "upper", label: "One uppercase letter (A–Z)",     test: (p) => /[A-Z]/.test(p) },
  { id: "digit", label: "One number (0–9)",               test: (p) => /[0-9]/.test(p) },
  { id: "sym",   label: "One special character (!@#…)",   test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const ROLES = [
  {
    id: "Owner",
    icon: Shield,
    description: "Full access to all data and can approve requests",
  },
  {
    id: "Finance Team",
    icon: FileText,
    description: "Financial metrics, revenue, and cost data",
  },
  {
    id: "Marketing Team",
    icon: BarChart3,
    description: "Campaign performance and acquisition data",
  },
  {
    id: "HR Team",
    icon: Users,
    description: "People data and organizational metrics",
  },
];

export default function SignupPage() {
  const { signup, setAuthView } = useApp();

  /* ── Signup form state ── */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const passwordValid = PASSWORD_RULES.every((r) => r.test(password));

  /* ── Submit signup form ── */
  const handleSignup = async (e) => {
    e.preventDefault();
    if (!name || !email || !password || !confirmPassword || !selectedRole) {
      setError("Please fill in all fields and select a role.");
      return;
    }
    if (!passwordValid) {
      setError("Password doesn't meet the requirements below.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setIsSubmitting(true);

    const result = await signup(name.trim(), email.trim().toLowerCase(), password, selectedRole);
    if (!result.success) {
      setError(result.message);
      setIsSubmitting(false);
      return;
    }
    // On success, AppContext session state drives navigation automatically.
  };

  /* ─────────────────────────────── Signup form ─────────────────────────────── */
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
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
          <h2 className="text-xl font-bold mb-1" style={{ color: "#1a1a2e", textAlign: "center" }}>Create your account</h2>
          <p className="text-sm mb-6" style={{ color: "#9ca3af", textAlign: "center" }}>Get started - choose your team role below</p>

          {error && (
            <div
              className="mb-5 px-4 py-3 rounded-xl text-sm font-medium"
              style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            {/* Full name */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: "#1a1a2e" }}>Full name</label>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#9ca3af" }} />
                <input
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); if (error) setError(""); }}
                  placeholder="Jane Smith"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border text-sm outline-none transition-colors"
                  style={{ borderColor: "#e8eaed", background: "#fff", color: "#1a1a2e" }}
                  onFocus={e => (e.target.style.borderColor = "#4f46e5")}
                  onBlur={e => (e.target.style.borderColor = "#e8eaed")}
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: "#1a1a2e" }}>Email address</label>
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
              <label className="block text-sm font-semibold mb-1.5" style={{ color: "#1a1a2e" }}>Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#9ca3af" }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (error) setError(""); }}
                  placeholder="At least 8 characters"
                  className="w-full pl-10 pr-10 py-3 rounded-xl border text-sm outline-none transition-colors"
                  style={{ borderColor: "#e8eaed", background: "#fff", color: "#1a1a2e" }}
                  onFocus={e => (e.target.style.borderColor = "#4f46e5")}
                  onBlur={e => (e.target.style.borderColor = "#e8eaed")}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {showPassword ? <EyeOff size={16} style={{ color: "#9ca3af" }} /> : <Eye size={16} style={{ color: "#9ca3af" }} />}
                </button>
              </div>
              {/* Requirements checklist — shown only once user starts typing */}
              {password.length > 0 && (
                <div className="mt-2 p-3 rounded-xl border" style={{ borderColor: "#e8eaed", background: "#fafbfc" }}>
                  <div className="grid grid-cols-1 gap-1">
                    {PASSWORD_RULES.map((rule) => {
                      const passed = rule.test(password);
                      return (
                        <div key={rule.id} className="flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: passed ? "#dcfce7" : "#fef2f2" }}
                          >
                            {passed
                              ? <Check size={9} strokeWidth={3} style={{ color: "#16a34a" }} />
                              : <X size={9} strokeWidth={3} style={{ color: "#ef4444" }} />}
                          </span>
                          <span className="text-[11px] font-medium" style={{ color: passed ? "#16a34a" : "#9ca3af" }}>
                            {rule.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Confirm password */}
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: "#1a1a2e" }}>Confirm password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#9ca3af" }} />
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={e => { setConfirmPassword(e.target.value); if (error) setError(""); }}
                  placeholder="Repeat your password"
                  className="w-full pl-10 pr-10 py-3 rounded-xl border text-sm outline-none transition-colors"
                  style={{ borderColor: "#e8eaed", background: "#fff", color: "#1a1a2e" }}
                  onFocus={e => (e.target.style.borderColor = "#4f46e5")}
                  onBlur={e => (e.target.style.borderColor = "#e8eaed")}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2">
                  {showConfirm ? <EyeOff size={16} style={{ color: "#9ca3af" }} /> : <Eye size={16} style={{ color: "#9ca3af" }} />}
                </button>
              </div>
            </div>

            {/* Role selector */}
            <div>
              <label className="block text-sm font-semibold mb-2" style={{ color: "#1a1a2e" }}>Your role</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map(({ id, icon: Icon, description }) => {
                  const selected = selectedRole === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => { setSelectedRole(id); if (error) setError(""); }}
                      className="relative text-left p-3 rounded-xl border transition-all"
                      style={{
                        borderColor: selected ? "#4f46e5" : "#e8eaed",
                        background: selected ? "#f0f0ff" : "#fff",
                      }}
                    >
                      {selected && (
                        <span
                          className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ background: "#4f46e5" }}
                        >
                          <Check size={10} color="#fff" strokeWidth={3} />
                        </span>
                      )}
                      <Icon
                        size={18}
                        style={{ color: selected ? "#4f46e5" : "#6b7280", marginBottom: 6 }}
                      />
                      <p className="text-xs font-bold leading-tight" style={{ color: selected ? "#4f46e5" : "#1a1a2e" }}>
                        {id}
                      </p>
                      <p className="text-[10px] leading-tight mt-0.5" style={{ color: "#9ca3af" }}>
                        {description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                opacity: isSubmitting ? 0.7 : 1,
                cursor: isSubmitting ? "not-allowed" : "pointer",
                marginTop: "8px",
              }}
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>Create account <ArrowRight size={15} /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm mt-6" style={{ color: "#9ca3af" }}>
            Already have an account?{" "}
            <button
              onClick={() => setAuthView("login")}
              className="font-semibold hover:underline"
              style={{ color: "#4f46e5", background: "none", border: "none", cursor: "pointer" }}
            >
              Sign in
            </button>
          </p>
        </div>
      </div>

      <style>{`* { box-sizing: border-box; } body { margin: 0; }`}</style>
    </div>
  );
}
