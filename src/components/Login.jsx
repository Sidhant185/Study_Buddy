import { useEffect, useState } from "react";
import { signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider } from "../firebase/config.js";
import { createStudent } from "../services/firestore.js";

const ADMIN_EMAIL = "Admin@gmail.com";
const ADMIN_PASSWORD = "Admin@123";
const SESSION_KEY = "vedam_admin_session";

const Login = ({ onAuthSuccess, pendingStudent, onAdminAccess }) => {
  const [loading, setLoading] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [error, setError] = useState(null);
  const [vedamId, setVedamId] = useState("");
  const [adminEmail, setAdminEmail] = useState(ADMIN_EMAIL);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState(null);
  const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || "vedamsot.org";

  useEffect(() => {
    if (!pendingStudent) {
      setVedamId("");
      setError(null);
      setRegisterLoading(false);
    }
  }, [pendingStudent]);

  const handleGoogleSignIn = async () => {
    if (pendingStudent) return;
    setLoading(true);
    setError(null);
    setAdminError(null);

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;

      // Verify email domain
      if (user.email && !user.email.endsWith(`@${ALLOWED_DOMAIN}`)) {
        // Sign out if domain doesn't match
        await signOut(auth);
        setError(`Only ${ALLOWED_DOMAIN} email addresses are allowed.`);
      }
    } catch (err) {
      console.error("Sign-in error:", err);
      if (err.code === "auth/popup-closed-by-user") {
        setError("Sign-in was cancelled. Please try again.");
      } else if (err.code === "auth/popup-blocked") {
        setError("Popup was blocked. Please allow popups for this site.");
      } else {
        setError(err.message || "Failed to sign in. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegistrationSubmit = async (event) => {
    event.preventDefault();
    if (!pendingStudent) return;

    if (!vedamId.trim()) {
      setError("Vedam ID is required to complete registration.");
      return;
    }

    setRegisterLoading(true);
    setError(null);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser || !currentUser.email) {
        setError("Your sign-in session expired. Please sign in again.");
        await signOut(auth);
        return;
      }

      await createStudent({
        name:
          pendingStudent.displayName ||
          currentUser.displayName ||
          currentUser.email.split("@")[0] ||
          "Vedam Student",
        email: currentUser.email.toLowerCase(),
        vedamId: vedamId.trim(),
      });

      if (onAuthSuccess) {
        onAuthSuccess(currentUser);
      }
    } catch (err) {
      console.error("Registration error:", err);
      setError(
        err?.message || "Failed to complete registration. Please try again."
      );
    } finally {
      setRegisterLoading(false);
    }
  };

  const handleCancelRegistration = async () => {
    try {
      await signOut(auth);
    } finally {
      setVedamId("");
      setError(null);
    }
  };

  const handleAdminLogin = async (event) => {
    event.preventDefault();
    setAdminError(null);

    if (!adminEmail.trim() || !adminPassword.trim()) {
      setAdminError("Email and password are required.");
      return;
    }

    if (
      adminEmail.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
      adminPassword === ADMIN_PASSWORD
    ) {
      sessionStorage.setItem(SESSION_KEY, "true");
      setAdminPassword("");
      if (typeof onAdminAccess === "function") {
        onAdminAccess();
      }
    } else {
      setAdminError("Invalid admin credentials.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-md p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-2xl mx-auto mb-4">
            VB
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Vedam Study Buddy</h1>
          <p className="text-sm text-slate-600">Contest Analytics Dashboard</p>
        </div>

        <div className="space-y-6">
          <div>
            {pendingStudent ? (
              <form className="space-y-4" onSubmit={handleRegistrationSubmit}>
                <p className="text-sm text-slate-700 mb-4">
                  Welcome {pendingStudent.displayName || pendingStudent.email}. We couldn't find your Vedam registration.
                  Please enter your Vedam ID to finish onboarding.
                </p>

                {error && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm" role="alert">
                    {error}
                  </div>
                )}

                <label className="block">
                  <span className="block text-sm font-medium text-slate-700 mb-1">Vedam ID</span>
                  <input
                    type="text"
                    value={vedamId}
                    onChange={(event) => setVedamId(event.target.value)}
                    placeholder="VED-2024-001"
                    autoFocus
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </label>

                <button
                  type="submit"
                  className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  disabled={registerLoading}
                >
                  {registerLoading ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                      Completing registration...
                    </>
                  ) : (
                    "Complete registration"
                  )}
                </button>

                <button
                  type="button"
                  className="w-full px-4 py-2 border border-slate-300 bg-white text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleCancelRegistration}
                  disabled={registerLoading}
                >
                  Use a different account
                </button>
              </form>
            ) : (
              <>
                <p className="text-sm text-slate-700 mb-4 text-center">
                  Sign in with your <strong>@{ALLOWED_DOMAIN}</strong> email to access your contest analytics and study insights.
                </p>

                {error && (
                  <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm mb-4" role="alert">
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  className="w-full px-4 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg font-medium hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <span className="w-5 h-5 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></span>
                      Signing in...
                    </>
                  ) : (
                    <>
                      <svg
                        className="flex-shrink-0"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                      Sign in with Google
                    </>
                  )}
                </button>

                <p className="text-xs text-slate-500 text-center mt-4">
                  By signing in, you agree to use this platform for Vedam contest tracking and analytics.
                </p>
              </>
            )}
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white text-slate-500">Admin access</span>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleAdminLogin}>
            <p className="text-sm text-slate-600 text-center">Admin users can review students and publish Vedam scores.</p>

            {adminError && (
              <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm" role="alert">
                {adminError}
              </div>
            )}

            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Email</span>
              <input
                type="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                placeholder="admin@vedam.org"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Password</span>
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Enter admin password"
                className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </label>

            <button
              type="submit"
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
            >
              Enter admin dashboard
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;

