  
let currentUser   = null;
import MedSim from './firebase.js';

// ── Auth state ────────────────────────────────────────────────────────────
MedSim.onAuthChange(async user => {
  currentUser = user;
  const loginrofiletab = document.getElementById('nav-signin-profile');
  if (user) {
    const myProfile = await MedSim.getUserProfile(user.uid);
    loginrofiletab.innerHTML = `<div class="nav-user-dot"></div>
      <span class="nav-user-name" id="nav-username-label">${myProfile?.username || user.email}</span>`;
    loginrofiletab.href = "./profile.html";
    loginrofiletab.className = "nav-user-pill";
  } else {
    loginrofiletab.textContent = "Sign In";
    loginrofiletab.href = "./login.html";
    loginrofiletab.className = "nav-signin-link";
  }
});