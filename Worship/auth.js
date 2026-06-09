import { auth, firestore, db } from './firebase-config.js';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { ref, set, remove, onDisconnect, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// --- GLOBAL SESSION VARIABLES ---
let currentSessionId = null;
let sessionRef = null;

// --- PASSWORD RESET LOGIC ---
window.forgotPassword = async () => {
    const email = prompt("Please enter your email address to reset password:");
    if (!email) return;
    
    try {
        await sendPasswordResetEmail(auth, email);
        alert(`✅ Password reset email sent to: ${email}\n\n⚠️ IMPORTANT: Please check your SPAM/JUNK folder if you do not see it in your inbox.`);
    } catch (error) {
        alert("Error: " + error.message);
    }
};

// --- LOGOUT LOGIC ---
window.logoutUser = (reason = "") => {
    if (!reason && !confirm("End Session?")) return;
    window.isCleanLogout = true; // Bypass accidental close warning
    
    // Clean up session before signing out
    if (sessionRef) remove(sessionRef);
    signOut(auth).then(() => {
        localStorage.removeItem('korAdminKey');
        set(ref(db, 'presentation/status'), { state: 'offline' });
        if (reason) alert(reason);
        window.location.reload();
    });
};

export function initAuth() {
    // LOGIN BUTTON LISTENER
    document.getElementById('loginBtn').addEventListener('click', () => {
        const email = document.getElementById('loginEmail').value;
        const pass = document.getElementById('loginPass').value;
        const msg = document.getElementById('loginMsg');
        const btn = document.getElementById('loginBtn');

        if(!email || !pass) { msg.textContent = "Please enter email and password."; return; }
        msg.textContent = ""; btn.textContent = "Verifying..."; btn.disabled = true;
  
        signInWithEmailAndPassword(auth, email, pass).catch((error) => {
            msg.textContent = "Error: " + error.message;
            btn.textContent = "Log In"; btn.disabled = false;
        });
    });

    // AUTH STATE & SESSION TRACKER
    onAuthStateChanged(auth, async (user) => {
        const overlay = document.getElementById('login-overlay');
        const appContainer = document.getElementById('app-container');
        const btn = document.getElementById('loginBtn');
        
        if (user) {
            // --- 1. LOGIN TRACKER (Firestore Timestamp & Portal) ---
            try {
                // FIXED: Using 'firestore' variable for user data as per your imports
                await updateDoc(doc(firestore, "users", user.uid), {
                    lastLogin: serverTimestamp(),
                    lastPortal: "Worship Dashboard Desktop"
                });
                console.log("✅ Login timestamp updated.");
            } catch (err) {
                console.error("⚠️ Tracker Error:", err);
            }

            try {
                // --- 2. Check Role Permissions ---
                const userRef = doc(firestore, "users", user.uid);
                const snap = await getDoc(userRef);
                
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.accountStatus === 'disabled') throw new Error("Account deactivated.");

                    let userRoles = [];
                    if (data.role) userRoles.push(String(data.role).toLowerCase().trim());
                    if (data.roles && Array.isArray(data.roles)) {
                        userRoles = [...userRoles, ...data.roles.map(r => String(r).toLowerCase().trim())];
                    }

                    const ALLOWED_ACCESS = ['admin', 'presenter1', 'presenter2', 'presenter3'];
                    if (userRoles.some(r => ALLOWED_ACCESS.includes(r))) {
                        const token = await user.getIdToken();
                        localStorage.setItem('korAdminKey', token);
                        
                        // --- 3. SESSION TRACKING LOGIC (Realtime DB) ---
                        currentSessionId = Date.now() + "_" + Math.random().toString(36).substr(2, 9);
                        sessionRef = ref(db, 'presentation/sessions/' + user.uid);
                        
                        // Write active session
                        set(sessionRef, {
                            email: user.email,
                            loginTime: new Date().toISOString(),
                            device: navigator.userAgent,
                            sessionId: currentSessionId,
                            status: 'active'
                        });
                        
                        // Auto-remove on tab close
                        onDisconnect(sessionRef).remove();
                        
                        // Concurrent Login Listener (Kick-out Logic)
                        onValue(sessionRef, (snapshot) => {
                            const val = snapshot.val();
                            if (val && val.sessionId && val.sessionId !== currentSessionId) {
                                window.logoutUser("Security Alert: You were logged in on another device.");
                            }
                        });

                        // --- 4. UI Reveal ---
                        overlay.style.display = 'none';
                        appContainer.style.opacity = '1';
                        appContainer.style.pointerEvents = 'all';

                        // Restore session settings
                        if (window.loadPrefs) window.loadPrefs();
                        if (document.getElementById('timer').innerText === '00:00') {
                            if(window.startNewSession) window.startNewSession(false);
                        }
                    } else { throw new Error("Access Denied."); }
                } else { throw new Error("User profile not found."); }
            } catch (e) {
                console.error(e);
                signOut(auth);
                document.getElementById('loginMsg').textContent = e.message;
                btn.textContent = "Log In"; btn.disabled = false;
            }
        } else {
            // User Logged Out
            if (sessionRef) remove(sessionRef);
            overlay.style.display = 'flex';
            appContainer.style.opacity = '0';
            appContainer.style.pointerEvents = 'none';
            btn.textContent = "Log In"; btn.disabled = false;
        }
    });
}